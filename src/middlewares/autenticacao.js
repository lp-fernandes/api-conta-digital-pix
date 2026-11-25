const jwt = require('jsonwebtoken');
const config = require('../config');
const { erros } = require('../utils/erros');

function autenticar(req, _res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return next(erros.naoAutenticado());

  try {
    const payload = jwt.verify(token, config.jwt.segredo);
    req.clienteId = payload.sub;
    return next();
  } catch {
    return next(erros.naoAutenticado('Token expirado ou inválido'));
  }
}

module.exports = { autenticar };
