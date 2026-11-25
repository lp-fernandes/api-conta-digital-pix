require('dotenv').config({ quiet: true });

const ambiente = process.env.NODE_ENV || 'development';

function segredoJwt() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (ambiente === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção');
  }
  return 'segredo-de-desenvolvimento-troque-em-producao';
}

module.exports = {
  ambiente,
  porta: Number(process.env.PORT || 3000),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/contadigital',
  jwt: {
    segredo: segredoJwt(),
    expiraEm: process.env.JWT_EXPIRES_IN || '15m',
  },
  fusoHorario: 'America/Sao_Paulo',
  pix: {
    // Limite por transação no período noturno (20h às 6h), inspirado nas regras de segurança do PIX
    limiteNoturnoCentavos: Number(process.env.PIX_LIMITE_NOTURNO_CENTAVOS || 100000),
    inicioNoturno: 20,
    fimNoturno: 6,
    maxChavesPorConta: 5,
  },
};
