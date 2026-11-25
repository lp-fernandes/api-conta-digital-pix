async function registrarAuditoria(executor, { clienteId, acao, detalhes = {}, ip }) {
  await executor.query(
    'INSERT INTO auditoria (cliente_id, acao, detalhes, ip) VALUES ($1, $2, $3, $4)',
    [clienteId || null, acao, JSON.stringify(detalhes), ip || null],
  );
}

module.exports = { registrarAuditoria };
