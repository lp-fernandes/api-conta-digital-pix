const { Router } = require('express');
const { z } = require('zod');

const db = require('../../db/pool');
const { autenticar } = require('../../middlewares/autenticacao');
const { validar } = require('../../middlewares/validar');
const { erros } = require('../../utils/erros');
const { reaisParaCentavos, centavosParaReais } = require('../../utils/dinheiro');
const { mascararCpf } = require('../../utils/cpf');
const servico = require('./servico');

const rotas = Router();
rotas.use(autenticar);

function exibirChave(chave) {
  return {
    id: chave.id,
    tipo: chave.tipo,
    valor: chave.tipo === 'CPF' ? mascararCpf(chave.valor) : chave.valor,
    criadoEm: chave.criado_em,
  };
}

const schemaChave = z.object({ tipo: z.enum(['CPF', 'EMAIL', 'ALEATORIA']) });

rotas.post('/chaves', validar(schemaChave), async (req, res, next) => {
  try {
    const chave = await servico.cadastrarChave({ clienteId: req.clienteId, tipo: req.dados.tipo, ip: req.ip });
    res.status(201).json(exibirChave(chave));
  } catch (erro) {
    next(erro);
  }
});

rotas.get('/chaves', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT k.id, k.tipo, k.valor, k.criado_em
         FROM chaves_pix k JOIN contas c ON c.id = k.conta_id
        WHERE c.cliente_id = $1 ORDER BY k.criado_em`,
      [req.clienteId],
    );
    res.json(rows.map(exibirChave));
  } catch (erro) {
    next(erro);
  }
});

const schemaTransferencia = z.object({
  chave: z.string().trim().min(1).max(160),
  valor: z.union([z.string(), z.number()]),
  descricao: z.string().trim().max(140).optional(),
});

const schemaIdempotencia = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional();

rotas.post('/transferencias', validar(schemaTransferencia), async (req, res, next) => {
  try {
    const chaveIdempotencia = schemaIdempotencia.safeParse(req.get('Idempotency-Key') || undefined);
    if (!chaveIdempotencia.success) {
      throw erros.validacao([{ campo: 'Idempotency-Key', mensagem: 'Use de 8 a 64 caracteres (letras, números, - ou _)' }]);
    }

    const { transacao, reprocessada } = await servico.transferir({
      clienteId: req.clienteId,
      chave: req.dados.chave,
      valorCentavos: reaisParaCentavos(req.dados.valor),
      descricao: req.dados.descricao,
      chaveIdempotencia: chaveIdempotencia.data,
      ip: req.ip,
    });

    res.status(reprocessada ? 200 : 201).json({
      id: transacao.id,
      valor: centavosParaReais(transacao.valor_centavos),
      descricao: transacao.descricao,
      criadoEm: transacao.criado_em,
      reprocessada,
    });
  } catch (erro) {
    next(erro);
  }
});

module.exports = rotas;
