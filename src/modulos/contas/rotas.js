const { Router } = require('express');
const { z } = require('zod');

const db = require('../../db/pool');
const { autenticar } = require('../../middlewares/autenticacao');
const { validar } = require('../../middlewares/validar');
const { erros } = require('../../utils/erros');
const { reaisParaCentavos, centavosParaReais } = require('../../utils/dinheiro');
const { registrarAuditoria } = require('../auditoria');

const rotas = Router();
rotas.use(autenticar);

async function buscarConta(executor, clienteId) {
  const { rows: [conta] } = await executor.query(
    'SELECT id, agencia, numero, saldo_centavos, limite_diario_pix_centavos, status FROM contas WHERE cliente_id = $1',
    [clienteId],
  );
  if (!conta) throw erros.naoEncontrado('Conta não encontrada');
  return conta;
}

rotas.get('/me', async (req, res, next) => {
  try {
    const conta = await buscarConta(db, req.clienteId);
    res.json({
      agencia: conta.agencia,
      numero: String(conta.numero),
      status: conta.status,
      saldo: centavosParaReais(conta.saldo_centavos),
      limiteDiarioPix: centavosParaReais(conta.limite_diario_pix_centavos),
    });
  } catch (erro) {
    next(erro);
  }
});

// Endpoint de sandbox para simular entrada de dinheiro na conta
const schemaDeposito = z.object({ valor: z.union([z.string(), z.number()]) });

rotas.post('/me/deposito', validar(schemaDeposito), async (req, res, next) => {
  try {
    const valorCentavos = reaisParaCentavos(req.dados.valor);
    const transacao = await db.comTransacao(async (client) => {
      const conta = await buscarConta(client, req.clienteId);
      await client.query('UPDATE contas SET saldo_centavos = saldo_centavos + $1 WHERE id = $2', [valorCentavos, conta.id]);
      const { rows: [t] } = await client.query(
        `INSERT INTO transacoes (tipo, conta_destino_id, valor_centavos, descricao)
         VALUES ('DEPOSITO', $1, $2, 'Depósito (sandbox)') RETURNING id, criado_em`,
        [conta.id, valorCentavos],
      );
      await registrarAuditoria(client, {
        clienteId: req.clienteId, acao: 'DEPOSITO', detalhes: { transacaoId: t.id, valorCentavos }, ip: req.ip,
      });
      return t;
    });
    res.status(201).json({ id: transacao.id, valor: centavosParaReais(valorCentavos), criadoEm: transacao.criado_em });
  } catch (erro) {
    next(erro);
  }
});

const schemaExtrato = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

rotas.get('/me/extrato', validar(schemaExtrato, 'query'), async (req, res, next) => {
  try {
    const { pagina, limite } = req.dados;
    const conta = await buscarConta(db, req.clienteId);
    const { rows } = await db.query(
      `SELECT t.id, t.tipo, t.valor_centavos, t.descricao, t.criado_em,
              CASE WHEN t.conta_origem_id = $1 THEN 'SAIDA' ELSE 'ENTRADA' END AS direcao,
              COUNT(*) OVER() AS total
         FROM transacoes t
        WHERE t.conta_origem_id = $1 OR t.conta_destino_id = $1
        ORDER BY t.criado_em DESC, t.id
        LIMIT $2 OFFSET $3`,
      [conta.id, limite, (pagina - 1) * limite],
    );
    res.json({
      pagina,
      limite,
      total: rows[0]?.total ?? 0,
      itens: rows.map((t) => ({
        id: t.id,
        tipo: t.tipo,
        direcao: t.direcao,
        valor: centavosParaReais(t.valor_centavos),
        descricao: t.descricao,
        criadoEm: t.criado_em,
      })),
    });
  } catch (erro) {
    next(erro);
  }
});

module.exports = { rotas, buscarConta };
