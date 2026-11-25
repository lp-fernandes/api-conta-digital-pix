const config = require('./config');
const { criarApp } = require('./app');
const { pool } = require('./db/pool');

const servidor = criarApp().listen(config.porta, () => {
  console.log(`API Conta Digital rodando na porta ${config.porta} — documentação em /docs`);
});

// Encerramento gracioso: termina requisições em andamento e fecha o pool de conexões
function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  servidor.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
