const { Pool, types } = require('pg');
const config = require('../config');

// BIGINT (OID 20) volta como string no driver; centavos cabem com folga em Number.MAX_SAFE_INTEGER
types.setTypeParser(20, (valor) => Number(valor));

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

async function comTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (texto, params) => pool.query(texto, params),
  comTransacao,
};
