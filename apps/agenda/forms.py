from datetime import date, datetime, time

from django import forms
from django.utils import timezone

from apps.catalogo.models import Profissional, Servico

from .models import Agendamento
from .services import horarios_livres


class AgendamentoAdminForm(forms.ModelForm):
    data = forms.DateField(
        label='Data',
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
    )
    hora = forms.ChoiceField(label='Horário', choices=[('', '---------')])

    class Meta:
        model = Agendamento
        fields = (
            'cliente', 'profissional', 'servico', 'data', 'hora',
            'preco_cobrado', 'status', 'observacoes',
        )

    class Media:
        js = ('agenda/agendamento_admin.js',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        local = None
        hora_atual = None
        if self.instance.pk:
            local = timezone.localtime(self.instance.inicio)
            hora_atual = local.strftime('%H:%M')
            self.initial['data'] = local.date()
            self.initial['hora'] = hora_atual

        if self.is_bound:
            prof_id = self.data.get('profissional')
            serv_id = self.data.get('servico')
            data_txt = self.data.get('data')
        elif local:
            prof_id = self.instance.profissional_id
            serv_id = self.instance.servico_id
            data_txt = local.date().isoformat()
        else:
            prof_id = serv_id = data_txt = None

        self.fields['hora'].choices = self._opcoes(prof_id, serv_id, data_txt, hora_atual)

        # O JavaScript usa estes dados para atualizar a lista de horários.
        from django.urls import reverse

        self.fields['hora'].widget.attrs['data-url'] = reverse(
            'admin:agenda_agendamento_horarios_livres'
        )
        self.fields['hora'].widget.attrs['data-ignorar'] = self.instance.pk or ''

    def _opcoes(self, prof_id, serv_id, data_txt, hora_atual):
        horarios = []
        try:
            profissional = Profissional.objects.get(pk=prof_id)
            servico = Servico.objects.get(pk=serv_id)
            dia = date.fromisoformat(data_txt)
            livres = horarios_livres(profissional, servico, dia, ignorar_id=self.instance.pk)
            horarios = [timezone.localtime(h).strftime('%H:%M') for h in livres]
        except (Profissional.DoesNotExist, Servico.DoesNotExist, ValueError, TypeError):
            pass
        # Na edição, o horário atual do agendamento sempre continua disponível.
        if hora_atual and hora_atual not in horarios:
            horarios.append(hora_atual)
            horarios.sort()
        return [('', '---------')] + [(h, h) for h in horarios]

    def clean(self):
        cleaned = super().clean()
        dia = cleaned.get('data')
        hora = cleaned.get('hora')
        if dia and hora:
            h, m = (int(x) for x in hora.split(':'))
            self.instance.inicio = timezone.make_aware(datetime.combine(dia, time(h, m)))
        return cleaned