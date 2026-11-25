-- Estrutura inicial da Conta Digital
-- Valores monetários sempre em centavos (BIGINT) para evitar erros de ponto flutuante.

CREATE TABLE IF NOT EXISTS clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        VARCHAR(120) NOT NULL,
  cpf         CHAR(11)     NOT NULL UNIQUE,
  email       VARCHAR(160) NOT NULL UNIQUE,
  senha_hash  TEXT         NOT NULL,
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contas (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id                  UUID NOT NULL UNIQUE REFERENCES clientes(id),
  agencia                     CHAR(4) NOT NULL DEFAULT '0001',
  numero                      BIGSERIAL UNIQUE,
  saldo_centavos              BIGINT NOT NULL DEFAULT 0 CHECK (saldo_centavos >= 0),
  limite_diario_pix_centavos  BIGINT NOT NULL DEFAULT 500000 CHECK (limite_diario_pix_centavos >= 0),
  status                      VARCHAR(10) NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA', 'BLOQUEADA')),
  criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chaves_pix (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id   UUID NOT NULL REFERENCES contas(id),
  tipo       VARCHAR(10)  NOT NULL CHECK (tipo IN ('CPF', 'EMAIL', 'ALEATORIA')),
  valor      VARCHAR(160) NOT NULL UNIQUE,
  criado_em  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chaves_pix_conta ON chaves_pix(conta_id);

CREATE TABLE IF NOT EXISTS transacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                VARCHAR(10) NOT NULL CHECK (tipo IN ('PIX', 'DEPOSITO')),
  conta_origem_id     UUID REFERENCES contas(id),
  conta_destino_id    UUID NOT NULL REFERENCES contas(id),
  valor_centavos      BIGINT NOT NULL CHECK (valor_centavos > 0),
  descricao           VARCHAR(140),
  chave_idempotencia  VARCHAR(64),
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transacao_idempotencia UNIQUE (conta_origem_id, chave_idempotencia)
);
CREATE INDEX IF NOT EXISTS idx_transacoes_origem  ON transacoes(conta_origem_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_transacoes_destino ON transacoes(conta_destino_id, criado_em DESC);

-- Trilha de auditoria: quem fez o quê, quando e de onde
CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  UUID REFERENCES clientes(id),
  acao        VARCHAR(40) NOT NULL,
  detalhes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          VARCHAR(45),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_cliente ON auditoria(cliente_id, criado_em DESC);
