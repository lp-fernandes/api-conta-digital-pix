const { erros } = require('./erros');

const FORMATO = /^\d{1,13}(\.\d{1,2})?$/;

/**
 * Converte um valor em reais ("150.75", "10", 99.9) para centavos inteiros
 * sem passar por aritmética de ponto flutuante.
 */
function reaisParaCentavos(valor) {
  const texto = String(valor).trim();
  if (!FORMATO.test(texto)) {
    throw erros.validacao([{ campo: 'valor', mensagem: 'Use o formato 123.45 (até 2 casas decimais)' }]);
  }
  const [inteiro, decimal = ''] = texto.split('.');
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
  if (centavos <= 0) {
    throw erros.validacao([{ campo: 'valor', mensagem: 'O valor deve ser maior que zero' }]);
  }
  return centavos;
}

function centavosParaReais(centavos) {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const texto = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negativo ? `-${texto}` : texto;
}

module.exports = { reaisParaCentavos, centavosParaReais };
