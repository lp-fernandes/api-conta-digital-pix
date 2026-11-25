const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const config = require('../../config');
const db = require('../../db/pool');
const { validar } = require('../../middlewares/validar');
const { erros } = require('../../utils/erros');
const { cpfValido, somenteDigitos, mascararCpf } = require('../../utils/cpf');
const { registrarAuditoria } = require('../auditoria');

const rotas = Router();

// Proteção contra força bruta nos endpoints de autenticação
rotas.use(rateLimit({
  windowMs: 60 * 1000,
  limit: config.ambiente === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas. Aguarde 1 minuto.' } },
}));

const schemaCadastro = z.object({
  nome: z.string().trim().min(3).max(120),
  cpf: z.string().transform(somenteDigitos).refine(cpfValido, 'CPF inválido'),
  email: z.string().trim().toLowerCase().email().max(160),
  senha: z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(72)
    .regex(/[A-Za-z]/, 'A senha deve conter letras')
    .regex(/\d/, 'A senha deve conter números'),
});

const schemaLogin = z.object({
  email: z.string().trim().toLowerCase().email(),
  senha: z.string().min(1),
});

rotas.post('/cadastro', validar(schemaCadastro), async (req, res, next) => {
  const { nome, cpf, email, senha } = req.dados;
  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const resultado = await db.comTransacao(async (client) => {
      const { rows: [cliente] } = await client.query(
        'INSERT INTO clientes (nome, cpf, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING id, nome, cpf, email',
        [nome, cpf, email, senhaHash],
      );
      const { rows: [conta] } = await client.query(
        'INSERT INTO contas (cliente_id) VALUES ($1) RETURNING agencia, numero',
        [cliente.id],
      );
      await registrarAuditoria(client, { clienteId: cliente.id, acao: 'CADASTRO', ip: req.ip });
      return { cliente, conta };
    });

    return res.status(201).json({
      id: resultado.cliente.id,
      nome: resultado.cliente.nome,
      cpf: mascararCpf(resultado.cliente.cpf),
      email: resultado.cliente.email,
      conta: { agencia: resultado.conta.agencia, numero: String(resultado.conta.numero) },
    });
  } catch (erro) {
    if (erro.code === '23505') {
      // Mensagem genérica para não revelar se o CPF ou o e-mail já existe (enumeração de usuários)
      return next(erros.conflito('CLIENTE_JA_EXISTE', 'Não foi possível concluir o cadastro com esses dados'));
    }
    return next(erro);
  }
});

rotas.post('/login', validar(schemaLogin), async (req, res, next) => {
  const { email, senha } = req.dados;
  try {
    const { rows: [cliente] } = await db.query('SELECT id, senha_hash FROM clientes WHERE email = $1', [email]);
    const senhaConfere = cliente ? await bcrypt.compare(senha, cliente.senha_hash) : false;

    await registrarAuditoria(db, {
      clienteId: cliente?.id,
      acao: senhaConfere ? 'LOGIN_SUCESSO' : 'LOGIN_FALHA',
      ip: req.ip,
    });

    if (!senhaConfere) throw erros.naoAutenticado('E-mail ou senha inválidos');

    const token = jwt.sign({ sub: cliente.id }, config.jwt.segredo, { expiresIn: config.jwt.expiraEm });
    return res.json({ token, tipo: 'Bearer', expiraEm: config.jwt.expiraEm });
  } catch (erro) {
    return next(erro);
  }
});

module.exports = rotas;
