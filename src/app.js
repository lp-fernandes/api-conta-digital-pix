const path = require('path');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const config = require('./config');
const db = require('./db/pool');
const rotasAuth = require('./modulos/auth/rotas');
const { rotas: rotasContas } = require('./modulos/contas/rotas');
const rotasPix = require('./modulos/pix/rotas');
const { tratarErros } = require('./middlewares/tratarErros');

function criarApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(pinoHttp({
    enabled: config.ambiente !== 'test',
    // Dados sensíveis nunca vão para o log (LGPD)
    redact: ['req.headers.authorization', 'req.body.senha', 'req.body.cpf'],
  }));

  const openapi = YAML.load(path.join(__dirname, '..', 'docs', 'openapi.yaml'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', banco: 'ok' });
    } catch {
      res.status(503).json({ status: 'degradado', banco: 'indisponivel' });
    }
  });

  app.use('/auth', rotasAuth);
  app.use('/contas', rotasContas);
  app.use('/pix', rotasPix);

  app.use((_req, res) => res.status(404).json({ erro: { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: 'Rota não encontrada' } }));
  app.use(tratarErros);

  return app;
}

module.exports = { criarApp };
