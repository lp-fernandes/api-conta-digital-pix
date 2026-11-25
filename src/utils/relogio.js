const config = require('../config');

// Isolado em um módulo para que os testes possam controlar o horário
const relogio = {
  agora: () => new Date(),
};

function horaLocal(data = relogio.agora()) {
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.fusoHorario,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(data);
  return Number(hora);
}

function emPeriodoNoturno(data = relogio.agora()) {
  const hora = horaLocal(data);
  const { inicioNoturno, fimNoturno } = config.pix;
  return hora >= inicioNoturno || hora < fimNoturno;
}

module.exports = { relogio, horaLocal, emPeriodoNoturno };
