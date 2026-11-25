const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const PASTA = path.join(__dirname, 'migrations');

async function migrar({ silencioso = false } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nome TEXT PRIMARY KEY,
    aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const { rows } = await pool.query('SELECT nome FROM schema_migrations');
  const aplicadas = new Set(rows.map((r) => r.nome));
  const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(PASTA, arquivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
      await client.query('COMMIT');
      if (!silencioso) console.log(`Migração aplicada: ${arquivo}`);
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  migrar()
    .then(() => pool.end())
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}

module.exports = { migrar };
