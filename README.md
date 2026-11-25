# API Conta Digital — PIX

![CI](https://github.com/lp-fernandes/api-conta-digital-pix/actions/workflows/ci.yml/badge.svg)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

API REST de conta digital com transferências no padrão **PIX**. O projeto trata os problemas que um sistema financeiro precisa resolver de verdade: **consistência de saldo sob concorrência**, **idempotência**, **limites transacionais**, **trilha de auditoria** e **proteção de dados pessoais (LGPD)**.

> Projeto de portfólio. Não se conecta ao SPI/DICT do Banco Central: a liquidação é simulada dentro do próprio banco de dados.

## Destaques técnicos

| Problema real | Como foi resolvido |
|---|---|
| Dois PIX ao mesmo tempo podem deixar o saldo negativo | Transação ACID com `SELECT ... FOR UPDATE` e travamento das contas em **ordem determinística** (evita deadlock), além de `CHECK (saldo >= 0)` no banco |
| Timeout ou duplo clique pode duplicar uma transferência | Header **`Idempotency-Key`** com `UNIQUE` no banco: o reenvio devolve a transferência original (HTTP 200) |
| Erros de arredondamento com dinheiro | Valores em **centavos (`BIGINT`)**, convertidos de string sem usar ponto flutuante |
| Fraude e golpes no período noturno | **Limite por transação das 20h às 6h** (fuso de Brasília) e **limite diário** por conta |
| Rastreabilidade para auditoria e compliance | Tabela `auditoria` (cadastro, login com sucesso ou falha, chaves, depósitos, PIX), gravada **na mesma transação** da operação |
| LGPD | CPF sempre **mascarado** nas respostas (`***.982.247-**`); senha, CPF e token **removidos dos logs** |
| Ataque de força bruta | Rate limit nas rotas de autenticação, bcrypt, JWT com expiração curta e mensagens genéricas, para não revelar quais usuários existem |

O teste de concorrência dispara **20 PIX simultâneos de R$ 100 com saldo de R$ 1.000** e confirma que exatamente 10 são aprovados e o saldo termina em R$ 0,00.

## Stack

- **Node.js 22 + Express 5**
- **PostgreSQL 16** (SQL puro com `pg`, migrações versionadas)
- **JWT** + **bcrypt** · **Zod** (validação) · **Helmet** · **express-rate-limit** · **Pino** (logs estruturados)
- **Jest + Supertest**: 30 testes unitários e de integração contra um PostgreSQL real
- **Docker / Docker Compose** · **GitHub Actions** (lint, testes, cobertura e `npm audit`)
- **OpenAPI 3** com Swagger UI em `/docs`

## Arquitetura

```
src/
├── app.js                 # Composição do Express (segurança, logs, rotas, erros)
├── server.js              # Inicialização e encerramento gracioso
├── config.js
├── db/
│   ├── pool.js            # Pool de conexões + helper de transação
│   ├── migrar.js          # Executor de migrações
│   └── migrations/        # SQL versionado
├── middlewares/           # Autenticação JWT, validação Zod, tratamento de erros
├── modulos/
│   ├── auth/              # Cadastro e login
│   ├── contas/            # Saldo, depósito (sandbox) e extrato paginado
│   ├── pix/               # Chaves PIX e transferências (regras de negócio)
│   └── auditoria.js
└── utils/                 # Dinheiro, CPF, relógio/fuso, erros
```

## Como executar

**Com Docker:**

```bash
docker compose up --build
# API em http://localhost:3000 e documentação em http://localhost:3000/docs
```

**Localmente:**

```bash
cp .env.example .env      # ajuste DATABASE_URL e JWT_SECRET
npm install
npm run migrar
npm run dev
```

**Testes** (precisam de um PostgreSQL com o banco `contadigital_test`):

```bash
npm test
```

## Exemplo de uso

```bash
# 1. Cadastro (abre a conta automaticamente)
curl -X POST localhost:3000/auth/cadastro -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","cpf":"529.982.247-25","email":"maria@email.com","senha":"Senha123"}'

# 2. Login
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"maria@email.com","senha":"Senha123"}' | jq -r .token)

# 3. PIX com idempotência
curl -X POST localhost:3000/pix/transferencias \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: pedido-0001" \
  -H "Content-Type: application/json" \
  -d '{"chave":"joao@email.com","valor":"150.75","descricao":"Aluguel"}'
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/cadastro` | Cadastra o cliente e abre a conta |
| `POST` | `/auth/login` | Devolve um JWT (15 min) |
| `GET` | `/contas/me` | Saldo, limites e status |
| `POST` | `/contas/me/deposito` | Depósito simulado (sandbox) |
| `GET` | `/contas/me/extrato` | Extrato paginado (entradas e saídas) |
| `POST` | `/pix/chaves` | Cadastra chave CPF, e-mail ou aleatória |
| `GET` | `/pix/chaves` | Lista as chaves da conta |
| `POST` | `/pix/transferencias` | Envia um PIX |
| `GET` | `/health` | Saúde da API e do banco |

Erros seguem um formato único: `{ "erro": { "codigo": "SALDO_INSUFICIENTE", "mensagem": "..." } }`.

## Próximos passos

- Refresh token e bloqueio temporário após falhas de login seguidas
- Agendamento de PIX e devolução (MED)
- Observabilidade com OpenTelemetry e métricas Prometheus

---

Desenvolvido por **Luis Paulo Fernandes** · [LinkedIn](https://www.linkedin.com/in/luispaulofernandes/)
