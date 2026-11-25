const crypto = require('crypto');

const config = require('../../config');
const db = require('../../db/pool');
const { erros } = require('../../utils/erros');
const { somenteDigitos } = require('../../utils/cpf');
const { emPeriodoNoturno } = require('../../utils/relogio');
const { registrarAuditoria } = require('../auditoria');

function normalizarChave(chave) {
  const texto = String(chave).trim();
  if (texto.includes('@')) return texto.toLowerCase();
  const digitos = somenteDigitos(texto);
  return digitos.length === 11 ? digitos : texto.toLowerCase();
}

async function cadastrarChave({ clienteId, tipo, ip }) {
  return db.comTransacao(async (client) => {
    const { rows: [dados] } = await client.query(
      `SELECT c.id AS conta_id, cl.cpf, cl.email
         FROM contas c JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.cliente_id = $1
        FOR UPDATE OF c`,
      [clienteId],
    );
    if (!dados) throw erros.naoEncontrado('Conta não encontrada');

    const { rows: [{ total }] } = await client.query(
      'SELECT COUNT(*)::int AS total FROM chaves_pix WHERE conta_id = $1',
      [dados.conta_id],
    );
    if (total >= config.pix.maxChavesPorConta) {
      throw erros.regraNegocio('LIMITE_CHAVES', `Máximo de ${config.pix.maxChavesPorConta} chaves por conta`);
    }

    const valor = { CPF: dados.cpf, EMAIL: dados.email, ALEATORIA: crypto.randomUUID() }[tipo];

    try {
      await client.query('SAVEPOINT nova_chave');
      const { rows: [chave] } = await client.query(
        'INSERT INTO chaves_pix (conta_id, tipo, valor) VALUES ($1, $2, $3) RETURNING id, tipo, valor, criado_em',
        [dados.conta_id, tipo, valor],
      );
      await registrarAuditoria(client, { clienteId, acao: 'CHAVE_PIX_CRIADA', detalhes: { chaveId: chave.id, tipo }, ip });
      return chave;
    } catch (erro) {
      if (erro.code === '23505') {
        await client.query('ROLLBACK TO SAVEPOINT nova_chave');
        throw erros.conflito('CHAVE_JA_CADASTRADA', 'Esta chave PIX já está cadastrada');
      }
      throw erro;
    }
  });
}

async function buscarPorIdempotencia(contaOrigemId, chaveIdempotencia) {
  const { rows: [t] } = await db.query(
    `SELECT id, valor_centavos, descricao, criado_em FROM transacoes
      WHERE conta_origem_id = $1 AND chave_idempotencia = $2`,
    [contaOrigemId, chaveIdempotencia],
  );
  return t;
}

/**
 * Transferência PIX com:
 *  - lock pessimista (SELECT ... FOR UPDATE) em ordem determinística, evitando deadlock e saldo negativo
 *  - idempotência via header Idempotency-Key (reenvio não duplica a transferência)
 *  - limite diário por conta e limite noturno por transação
 *  - trilha de auditoria na mesma transação do banco
 */
async function transferir({ clienteId, chave, valorCentavos, descricao, chaveIdempotencia, ip }) {
  const { rows: [origem] } = await db.query('SELECT id FROM contas WHERE cliente_id = $1', [clienteId]);
  if (!origem) throw erros.naoEncontrado('Conta não encontrada');

  if (chaveIdempotencia) {
    const existente = await buscarPorIdempotencia(origem.id, chaveIdempotencia);
    if (existente) return { transacao: existente, reprocessada: true };
  }

  try {
    const transacao = await db.comTransacao(async (client) => {
      const { rows: [destinoChave] } = await client.query(
        'SELECT conta_id FROM chaves_pix WHERE valor = $1',
        [normalizarChave(chave)],
      );
      if (!destinoChave) throw erros.naoEncontrado('Chave PIX não encontrada');
      if (destinoChave.conta_id === origem.id) {
        throw erros.regraNegocio('MESMA_CONTA', 'Não é possível transferir para a própria conta');
      }

      const { rows: contas } = await client.query(
        `SELECT id, saldo_centavos, limite_diario_pix_centavos, status
           FROM contas WHERE id = ANY($1::uuid[])
          ORDER BY id
          FOR UPDATE`,
        [[origem.id, destinoChave.conta_id]],
      );
      const contaOrigem = contas.find((c) => c.id === origem.id);
      const contaDestino = contas.find((c) => c.id === destinoChave.conta_id);

      if (contaOrigem.status !== 'ATIVA' || contaDestino.status !== 'ATIVA') {
        throw erros.regraNegocio('CONTA_BLOQUEADA', 'Conta de origem ou destino bloqueada');
      }

      if (emPeriodoNoturno() && valorCentavos > config.pix.limiteNoturnoCentavos) {
        throw erros.regraNegocio('LIMITE_NOTURNO_EXCEDIDO', 'Valor acima do limite para o período noturno (20h às 6h)');
      }

      const { rows: [{ usado }] } = await client.query(
        `SELECT COALESCE(SUM(valor_centavos), 0)::bigint AS usado
           FROM transacoes
          WHERE conta_origem_id = $1 AND tipo = 'PIX'
            AND criado_em >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`,
        [contaOrigem.id, config.fusoHorario],
      );
      if (usado + valorCentavos > contaOrigem.limite_diario_pix_centavos) {
        throw erros.regraNegocio('LIMITE_DIARIO_EXCEDIDO', 'Limite diário de PIX excedido');
      }

      if (contaOrigem.saldo_centavos < valorCentavos) {
        throw erros.regraNegocio('SALDO_INSUFICIENTE', 'Saldo insuficiente');
      }

      await client.query('UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2', [valorCentavos, contaOrigem.id]);
      await client.query('UPDATE contas SET saldo_centavos = saldo_centavos + $1 WHERE id = $2', [valorCentavos, contaDestino.id]);

      const { rows: [t] } = await client.query(
        `INSERT INTO transacoes (tipo, conta_origem_id, conta_destino_id, valor_centavos, descricao, chave_idempotencia)
         VALUES ('PIX', $1, $2, $3, $4, $5)
         RETURNING id, valor_centavos, descricao, criado_em`,
        [contaOrigem.id, contaDestino.id, valorCentavos, descricao || null, chaveIdempotencia || null],
      );

      await registrarAuditoria(client, {
        clienteId,
        acao: 'PIX_ENVIADO',
        detalhes: { transacaoId: t.id, valorCentavos, contaDestinoId: contaDestino.id },
        ip,
      });
      return t;
    });
    return { transacao, reprocessada: false };
  } catch (erro) {
    // Duas requisições simultâneas com a mesma Idempotency-Key: a segunda devolve a primeira
    if (erro.code === '23505' && erro.constraint === 'uq_transacao_idempotencia') {
      const existente = await buscarPorIdempotencia(origem.id, chaveIdempotencia);
      return { transacao: existente, reprocessada: true };
    }
    throw erro;
  }
}

module.exports = { cadastrarChave, transferir, normalizarChave };
