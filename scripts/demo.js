/**
 * Roteiro de demonstração: executa um fluxo completo contra a API em execução.
 * Uso: npm run demo   (com a API rodando em outro terminal: npm run dev)
 */
const BASE = process.env.API_URL || 'http://localhost:3000';

const cor = { verde: '\x1b[32m', vermelho: '\x1b[31m', azul: '\x1b[36m', cinza: '\x1b[90m', reset: '\x1b[0m' };

function cpfAleatorio() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join('');
}

async function chamar(metodo, rota, { corpo, token, headers = {} } = {}) {
  const resposta = await fetch(`${BASE}${rota}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  return { status: resposta.status, dados };
}

function passo(titulo, { status, dados }, esperado) {
  const ok = status === esperado;
  console.log(`\n${cor.azul}▶ ${titulo}${cor.reset}`);
  console.log(`${ok ? cor.verde : cor.vermelho}  HTTP ${status}${ok ? '' : ` (esperado ${esperado})`}${cor.reset}`);
  console.log(cor.cinza + JSON.stringify(dados, null, 2).replace(/^/gm, '  ') + cor.reset);
  return dados;
}

async function criarCliente(nome) {
  const sufixo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `${nome.toLowerCase()}.${sufixo}@demo.com`;
  passo(`Cadastro de ${nome}`, await chamar('POST', '/auth/cadastro', {
    corpo: { nome: `${nome} Demo`, cpf: cpfAleatorio(), email, senha: 'Senha123' },
  }), 201);
  const { token } = passo(`Login de ${nome}`, await chamar('POST', '/auth/login', {
    corpo: { email, senha: 'Senha123' },
  }), 200);
  return { email, token };
}

async function main() {
  console.log(`Demonstração da API Conta Digital PIX em ${BASE}`);

  passo('Saúde da API e do banco', await chamar('GET', '/health'), 200);

  const maria = await criarCliente('Maria');
  const joao = await criarCliente('Joao');

  passo('João cadastra a chave PIX de e-mail', await chamar('POST', '/pix/chaves', {
    token: joao.token, corpo: { tipo: 'EMAIL' },
  }), 201);
  passo('João cadastra a chave PIX de CPF (repare no CPF mascarado - LGPD)', await chamar('POST', '/pix/chaves', {
    token: joao.token, corpo: { tipo: 'CPF' },
  }), 201);

  passo('Maria recebe um depósito de R$ 1.000,00 (sandbox)', await chamar('POST', '/contas/me/deposito', {
    token: maria.token, corpo: { valor: '1000.00' },
  }), 201);

  const chaveIdempotencia = `demo-${Date.now()}`;
  const pix = { token: maria.token, headers: { 'Idempotency-Key': chaveIdempotencia }, corpo: { chave: joao.email, valor: '150.75', descricao: 'Aluguel' } };
  passo('Maria envia PIX de R$ 150,75 para o João', await chamar('POST', '/pix/transferencias', pix), 201);
  passo('Reenvio do MESMO PIX (mesma Idempotency-Key): não cobra de novo', await chamar('POST', '/pix/transferencias', pix), 200);

  passo('Maria tenta enviar R$ 5.000 sem saldo', await chamar('POST', '/pix/transferencias', {
    token: maria.token, corpo: { chave: joao.email, valor: '5000.00' },
  }), 422);

  passo('Maria tenta enviar para uma chave inexistente', await chamar('POST', '/pix/transferencias', {
    token: maria.token, corpo: { chave: 'ninguem@demo.com', valor: '10' },
  }), 404);

  passo('Acesso sem token é bloqueado', await chamar('GET', '/contas/me'), 401);

  passo('Saldo da Maria (esperado 849.25)', await chamar('GET', '/contas/me', { token: maria.token }), 200);
  passo('Saldo do João (esperado 150.75)', await chamar('GET', '/contas/me', { token: joao.token }), 200);
  passo('Extrato do João', await chamar('GET', '/contas/me/extrato', { token: joao.token }), 200);

  console.log(`\n${cor.verde}Demonstração concluída. Explore também a documentação interativa em ${BASE}/docs${cor.reset}\n`);
}

main().catch((erro) => {
  console.error(`${cor.vermelho}Falha: ${erro.message}. A API está rodando em ${BASE}? (npm run dev)${cor.reset}`);
  process.exit(1);
});
