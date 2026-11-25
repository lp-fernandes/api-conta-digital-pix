const { ErroApp } = require('../utils/erros');

// eslint-disable-next-line no-unused-vars
function tratarErros(erro, req, res, _next) {
  if (erro instanceof ErroApp) {
    return res.status(erro.status).json({
      erro: { codigo: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes },
    });
  }

  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: { codigo: 'JSON_INVALIDO', mensagem: 'Corpo da requisição inválido' } });
  }

  // Erro inesperado: registra o detalhe no log, mas não expõe internals ao cliente
  req.log?.error({ err: erro }, 'Erro não tratado');
  return res.status(500).json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' } });
}

module.exports = { tratarErros };
