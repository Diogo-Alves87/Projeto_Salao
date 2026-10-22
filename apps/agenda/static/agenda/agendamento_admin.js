document.addEventListener('DOMContentLoaded', function () {
  const hora = document.getElementById('id_hora');
  const profissional = document.getElementById('id_profissional');
  const servico = document.getElementById('id_servico');
  const data = document.getElementById('id_data');
  if (!hora || !profissional || !servico || !data) return;

  async function atualizar() {
    hora.innerHTML = '';

    if (!profissional.value || !servico.value || !data.value) {
      hora.add(new Option('Escolha profissional, serviço e data', ''));
      return;
    }

    const params = new URLSearchParams({
      profissional: profissional.value,
      servico: servico.value,
      data: data.value,
      ignorar: hora.dataset.ignorar || '',
    });

    const resposta = await fetch(hora.dataset.url + '?' + params.toString());
    const json = await resposta.json();

    hora.add(new Option(json.horarios.length ? '---------' : 'Sem horários livres neste dia', ''));
    json.horarios.forEach(function (h) {
      hora.add(new Option(h, h));
    });
  }

  [profissional, servico, data].forEach(function (campo) {
    campo.addEventListener('change', atualizar);
  });
});