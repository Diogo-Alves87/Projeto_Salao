from datetime import datetime, time, timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import Agendamento, Bloqueio


def _minutos(t):
    return t.hour * 60 + t.minute


def validar_agendamento(profissional, servico, inicio, ignorar_id=None, checar_passado=True):
    """Levanta ValidationError com todos os problemas encontrados."""
    erros = []

    if not profissional.ativo:
        erros.append('Este profissional não está ativo.')
    if not servico.ativo:
        erros.append('Este serviço não está ativo.')
    if not profissional.servicos.filter(pk=servico.pk).exists():
        erros.append('Este profissional não realiza este serviço.')
    if checar_passado and inicio <= timezone.now():
        erros.append('Não é possível agendar no passado.')

    fim = inicio + timedelta(minutes=servico.duracao_minutos)
    ini_local = timezone.localtime(inicio)
    fim_local = timezone.localtime(fim)

    # O atendimento inteiro precisa caber dentro de uma janela de trabalho.
    janelas = []
    if ini_local.date() == fim_local.date():
        janelas = list(
            profissional.horarios.filter(
                dia_semana=ini_local.weekday(),
                hora_inicio__lte=ini_local.time(),
                hora_fim__gte=fim_local.time(),
            )
        )
    if not janelas:
        erros.append('Horário fora do expediente do profissional.')
    else:
        # O início precisa coincidir com os horários oferecidos (ex.: 10:00, 10:15...).
        passo = profissional.intervalo_minutos
        alinhado = any(
            ini_local.second == 0
            and ini_local.microsecond == 0
            and (_minutos(ini_local) - _minutos(j.hora_inicio)) % passo == 0
            for j in janelas
        )
        if not alinhado:
            erros.append(
                f'Horário inválido: os horários são oferecidos de {passo} em {passo} minutos.'
            )

    if Bloqueio.objects.filter(
        profissional=profissional, inicio__lt=fim, fim__gt=inicio
    ).exists():
        erros.append('O profissional não atende neste período.')

    if (
        Agendamento.objects.filter(
            profissional=profissional,
            status=Agendamento.Status.CONFIRMADO,
            inicio__lt=fim,
            fim__gt=inicio,
        )
        .exclude(pk=ignorar_id)
        .exists()
    ):
        erros.append('Já existe um agendamento neste horário.')

    if erros:
        raise ValidationError(erros)


def horarios_livres(profissional, servico, dia, ignorar_id=None):
    """Lista de datetimes livres para o profissional/serviço em um dia (date).
    ignorar_id: agendamento que não deve contar como ocupado (usado na edição)."""
    if not profissional.ativo or not profissional.servicos.filter(pk=servico.pk).exists():
        return []

    tz = timezone.get_current_timezone()
    duracao = timedelta(minutes=servico.duracao_minutos)
    passo = timedelta(minutes=profissional.intervalo_minutos)
    agora = timezone.now()

    comeco_dia = timezone.make_aware(datetime.combine(dia, time.min), tz)
    fim_dia = comeco_dia + timedelta(days=1)

    bloqueios = list(
        Bloqueio.objects.filter(
            profissional=profissional, inicio__lt=fim_dia, fim__gt=comeco_dia
        )
    )
    ocupados = list(
        Agendamento.objects.filter(
            profissional=profissional,
            status=Agendamento.Status.CONFIRMADO,
            inicio__lt=fim_dia,
            fim__gt=comeco_dia,
        ).exclude(pk=ignorar_id)
    )

    livres = set()
    for janela in profissional.horarios.filter(dia_semana=dia.weekday()):
        atual = timezone.make_aware(datetime.combine(dia, janela.hora_inicio), tz)
        limite = timezone.make_aware(datetime.combine(dia, janela.hora_fim), tz)
        while atual + duracao <= limite:
            fim = atual + duracao
            if (
                atual > agora
                and not any(b.inicio < fim and b.fim > atual for b in bloqueios)
                and not any(a.inicio < fim and a.fim > atual for a in ocupados)
            ):
                livres.add(atual)
            atual += passo

    return sorted(livres)