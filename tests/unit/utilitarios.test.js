const { reaisParaCentavos, centavosParaReais } = require('../../src/utils/dinheiro');
const { cpfValido, mascararCpf } = require('../../src/utils/cpf');
const { emPeriodoNoturno } = require('../../src/utils/relogio');
const { normalizarChave } = require('../../src/modulos/pix/servico');

describe('dinheiro', () => {
  test.each([
    ['10', 1000],
    ['10.5', 1050],
    ['0.01', 1],
    ['150.75', 15075],
    [99.9, 9990],
  ])('converte %p para %p centavos sem erro de ponto flutuante', (entrada, esperado) => {
    expect(reaisParaCentavos(entrada)).toBe(esperado);
  });

  test.each(['0', '-5', '1.999', 'abc', '1,50', ''])('rejeita %p', (entrada) => {
    expect(() => reaisParaCentavos(entrada)).toThrow();
  });

  test('formata centavos em reais', () => {
    expect(centavosParaReais(15075)).toBe('150.75');
    expect(centavosParaReais(5)).toBe('0.05');
  });
});

describe('cpf', () => {
  test('valida dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  test('mascara no padrão do PIX', () => {
    expect(mascararCpf('52998224725')).toBe('***.982.247-**');
  });
});

describe('período noturno do PIX', () => {
  // Horários em UTC; Brasília = UTC-3
  test('23h em Brasília é noturno', () => {
    expect(emPeriodoNoturno(new Date('2026-01-10T02:00:00Z'))).toBe(true);
  });
  test('14h em Brasília é diurno', () => {
    expect(emPeriodoNoturno(new Date('2026-01-10T17:00:00Z'))).toBe(false);
  });
  test('6h em Brasília já é diurno', () => {
    expect(emPeriodoNoturno(new Date('2026-01-10T09:00:00Z'))).toBe(false);
  });
});

describe('normalização de chave PIX', () => {
  test('CPF com pontuação vira só dígitos e e-mail vira minúsculo', () => {
    expect(normalizarChave('529.982.247-25')).toBe('52998224725');
    expect(normalizarChave(' Maria@Email.com ')).toBe('maria@email.com');
  });
});
