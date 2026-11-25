const { erros } = require('../utils/erros');

/** Valida req.body / req.query com um schema zod e substitui pelos dados já normalizados */
function validar(schema, origem = 'body') {
  return (req, _res, next) => {
    const resultado = schema.safeParse(req[origem]);
    if (!resultado.success) {
      const detalhes = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensagem: i.message,
      }));
      return next(erros.validacao(detalhes));
    }
    req.dados = { ...(req.dados || {}), ...resultado.data };
    return next();
  };
}

module.exports = { validar };
