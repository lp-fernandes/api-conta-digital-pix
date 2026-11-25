const request = require('supertest');
const { criarApp } = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { migrar } = require('../../src/db/migrar');
const { relogio } = require('../../src/utils/relogio');

const app = criarApp();
const DIA = new Date('2026-03-10T15:00:00Z'); // 12h em Brasília
const NOITE = new Date('2026-03-11T01:00:00Z'); // 22h em Brasília

async function criarCliente(nome, cpf, email) {
  await request(app).post('/auth/cadastro').send({ nome, cpf, email, senha: 'Senha123' }).expect(201);
  const { body } = await request(app).post('/auth/login').send({ email, senha: 'Senha123' }).expect(200);
  return { token: body.token, email, auth: { Authorization: `Bearer ${body.token}` } };
}

let maria;
let joao;

beforeAll(async () => {
  await migrar({ silencioso: true });
});

beforeEach(async () => {
  jest.spyOn(relogio, 'agora').mockReturnValue(DIA);
  await pool.query('TRUNCATE auditoria, transacoes, chaves_pix, contas, clientes RESTART IDENTITY CASCADE');
  maria = await criarCliente('Maria Silva', '529.982.247-25', 'maria@email.com');
  joao = await criarCliente('João Souza', '111.444.777-35', 'joao@email.com');
  await request(app).post('/pix/chaves').set(joao.auth).send({ tipo: 'EMAIL' }).expect(201);
  await request(app).post('/contas/me/deposito').set(maria.auth).send({ valor: '1000.00' }).expect(201);
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());

const saldo = async (cliente) => (await request(app).get('/contas/me').set(cliente.auth)).body.saldo;

describe('autenticação e privacidade', () => {
  test('rotas protegidas exigem token', async () => {
    await request(app).get('/contas/me').expect(401);
    await request(app).get('/contas/me').set('Authorization', 'Bearer token-falso').expect(401);
  });

  test('login com senha errada devolve 401 e é auditado', async () => {
    await request(app).post('/auth/login').send({ email: 'maria@email.com', senha: 'errada123' }).expect(401);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM auditoria WHERE acao = 'LOGIN_FALHA'");
    expect(rows[0].n).toBe(1);
  });

  test('CPF nunca é devolvido completo (LGPD)', async () => {
    const { body } = await request(app).post('/pix/chaves').set(maria.auth).send({ tipo: 'CPF' }).expect(201);
    expect(body.valor).toBe('***.982.247-**');
  });

  test('cadastro com CPF inválido é rejeitado', async () => {
    const { body } = await request(app).post('/auth/cadastro')
      .send({ nome: 'Teste', cpf: '123.456.789-00', email: 't@t.com', senha: 'Senha123' }).expect(400);
    expect(body.erro.codigo).toBe('VALIDACAO');
  });
});

describe('transferência PIX', () => {
  test('debita a origem, credita o destino e aparece no extrato', async () => {
    const { body } = await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: 'JOAO@email.com', valor: '150.75', descricao: 'Aluguel' }).expect(201);
    expect(body.valor).toBe('150.75');

    expect(await saldo(maria)).toBe('849.25');
    expect(await saldo(joao)).toBe('150.75');

    const extrato = await request(app).get('/contas/me/extrato').set(joao.auth).expect(200);
    expect(extrato.body.itens[0]).toMatchObject({ tipo: 'PIX', direcao: 'ENTRADA', valor: '150.75' });
  });

  test('saldo insuficiente não altera nenhum saldo', async () => {
    const { body } = await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: joao.email, valor: '1000.01' }).expect(422);
    expect(body.erro.codigo).toBe('SALDO_INSUFICIENTE');
    expect(await saldo(maria)).toBe('1000.00');
  });

  test('chave inexistente devolve 404', async () => {
    await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: 'ninguem@email.com', valor: '10' }).expect(404);
  });

  test('não permite PIX para a própria conta', async () => {
    await request(app).post('/pix/chaves').set(maria.auth).send({ tipo: 'EMAIL' }).expect(201);
    const { body } = await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: maria.email, valor: '10' }).expect(422);
    expect(body.erro.codigo).toBe('MESMA_CONTA');
  });

  test('Idempotency-Key evita transferência duplicada em reenvio', async () => {
    const envio = () => request(app).post('/pix/transferencias').set(maria.auth)
      .set('Idempotency-Key', 'pedido-12345').send({ chave: joao.email, valor: '100' });

    const primeiro = await envio().expect(201);
    const segundo = await envio().expect(200);
    expect(segundo.body.id).toBe(primeiro.body.id);
    expect(segundo.body.reprocessada).toBe(true);
    expect(await saldo(maria)).toBe('900.00');
  });

  test('respeita o limite diário de PIX', async () => {
    await pool.query('UPDATE contas SET limite_diario_pix_centavos = 20000');
    await request(app).post('/pix/transferencias').set(maria.auth).send({ chave: joao.email, valor: '150' }).expect(201);
    const { body } = await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: joao.email, valor: '60' }).expect(422);
    expect(body.erro.codigo).toBe('LIMITE_DIARIO_EXCEDIDO');
  });

  test('aplica limite por transação no período noturno (R$ 1.000)', async () => {
    await request(app).post('/contas/me/deposito').set(maria.auth).send({ valor: '500' }).expect(201);
    relogio.agora.mockReturnValue(NOITE);
    const { body } = await request(app).post('/pix/transferencias').set(maria.auth)
      .send({ chave: joao.email, valor: '1000.01' }).expect(422);
    expect(body.erro.codigo).toBe('LIMITE_NOTURNO_EXCEDIDO');
    await request(app).post('/pix/transferencias').set(maria.auth).send({ chave: joao.email, valor: '1000.00' }).expect(201);
  });

  test('concorrência: 20 PIX simultâneos nunca deixam o saldo negativo', async () => {
    // Saldo de R$ 1.000 e 20 pedidos de R$ 100 ao mesmo tempo: só 10 podem passar
    const respostas = await Promise.all(Array.from({ length: 20 }, () => request(app)
      .post('/pix/transferencias').set(maria.auth).send({ chave: joao.email, valor: '100' })));

    const aprovadas = respostas.filter((r) => r.status === 201).length;
    const recusadas = respostas.filter((r) => r.body.erro?.codigo === 'SALDO_INSUFICIENTE').length;
    expect(aprovadas).toBe(10);
    expect(recusadas).toBe(10);
    expect(await saldo(maria)).toBe('0.00');
    expect(await saldo(joao)).toBe('1000.00');
  });
});
