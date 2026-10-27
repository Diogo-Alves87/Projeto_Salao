"""Sincroniza agendamentos com o Google Agenda de quem conectou a conta.

Toda falha do Google é só registrada no log: um agendamento nunca deixa de ser
criado ou cancelado por causa do Google.
"""

import logging

from django.db import transaction
from django.utils import timezone

from config import google_services as google

from .models import Agendamento, ContaGoogle, EventoGoogle

logger = logging.getLogger(__name__)


def token_valido(conta):
    """Devolve um access_token válido, renovando-o se tiver expirado."""
    agora = timezone.now()
    if conta.expira_em > agora:
        return conta.access_token
    if not conta.refresh_token:
        raise google.GoogleErro('Conta sem refresh_token; é preciso conectar de novo.')
    r = google.renovar_token(conta.refresh_token)
    conta.access_token = r['access_token']
    conta.expira_em = google.expiracao(r, agora)
    conta.save(update_fields=['access_token', 'expira_em'])
    return conta.access_token


def _contas(agendamento):
    usuarios = [agendamento.cliente_id, agendamento.profissional.usuario_id]
    return ContaGoogle.objects.filter(usuario_id__in=usuarios)


def _criar_eventos(agendamento_id):
    ag = Agendamento.objects.select_related('cliente', 'profissional__usuario', 'servico').get(pk=agendamento_id)
    for conta in _contas(ag):
        if EventoGoogle.objects.filter(conta=conta, agendamento=ag).exists():
            continue
        e_cliente = conta.usuario_id == ag.cliente_id
        titulo = f'{ag.servico.nome} · ' + (ag.profissional.usuario.nome if e_cliente else ag.cliente.nome)
        descricao = f'Agendamento no salão. Valor: R$ {ag.preco_cobrado:.2f}'
        try:
            evento_id = google.criar_evento(
                token_valido(conta), titulo, timezone.localtime(ag.inicio), timezone.localtime(ag.fim),
                descricao, fuso=str(timezone.get_current_timezone()),
            )
            EventoGoogle.objects.create(conta=conta, agendamento=ag, evento_id=evento_id)
        except google.GoogleErro:
            logger.exception('Não foi possível criar o evento do agendamento %s no Google', ag.pk)


def _remover_eventos(agendamento_id):
    for ev in EventoGoogle.objects.filter(agendamento_id=agendamento_id).select_related('conta'):
        try:
            google.remover_evento(token_valido(ev.conta), ev.evento_id)
            ev.delete()
        except google.GoogleErro:
            logger.exception('Não foi possível remover o evento %s do Google', ev.evento_id)


def agendamento_criado(agendamento):
    if google.configurado():
        transaction.on_commit(lambda: _criar_eventos(agendamento.pk))


def agendamento_cancelado(agendamento):
    if google.configurado():
        transaction.on_commit(lambda: _remover_eventos(agendamento.pk))
