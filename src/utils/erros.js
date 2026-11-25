class ErroApp extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const erros = {
  validacao: (detalhes) => new ErroApp(400, 'VALIDACAO', 'Dados inválidos', detalhes),
  naoAutenticado: (msg = 'Token ausente ou inválido') => new ErroApp(401, 'NAO_AUTENTICADO', msg),
  naoEncontrado: (msg) => new ErroApp(404, 'NAO_ENCONTRADO', msg),
  conflito: (codigo, msg) => new ErroApp(409, codigo, msg),
  regraNegocio: (codigo, msg) => new ErroApp(422, codigo, msg),
};

module.exports = { ErroApp, erros };
