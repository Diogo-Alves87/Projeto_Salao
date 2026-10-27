"""Endpoints da integração com o Google Agenda (usados em Perfil > Integrações)."""

import logging

from django.core import signing
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from config import google_services as google

from .models import ContaGoogle

logger = logging.getLogger(__name__)

SALT_STATE = 'google-oauth'
STATE_VALIDADE = 600  # segundos para concluir o consentimento no Google


class GoogleStatusView(APIView):
    """GET: situação da integração. DELETE: desconecta (e revoga no Google)."""

    def get(self, request):
        conta = ContaGoogle.objects.filter(usuario=request.user).first()
        return Response({
            'configurado': google.configurado(),
            'conectado': conta is not None,
            'email': conta.email if conta else '',
        })

    def delete(self, request):
        conta = ContaGoogle.objects.filter(usuario=request.user).first()
        if conta:
            try:
                google.revogar(conta.refresh_token or conta.access_token)
            except google.GoogleErro:
                logger.warning('Falha ao revogar o acesso Google do usuário %s', request.user.pk)
            conta.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class GoogleConectarView(APIView):
    """Devolve o endereço da tela de consentimento do Google."""

    def get(self, request):
        if not google.configurado():
            return Response(
                {'detail': 'A integração com o Google ainda não foi configurada neste site.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        # O callback chega sem o token JWT; o "state" assinado diz de quem é a conexão
        state = signing.dumps({'u': request.user.pk}, salt=SALT_STATE)
        return Response({'url': google.url_autorizacao(state)})


class GoogleCallbackView(APIView):
    """O Google redireciona para cá depois do consentimento."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        code = request.query_params.get('code')
        try:
            dados = signing.loads(request.query_params.get('state', ''), salt=SALT_STATE, max_age=STATE_VALIDADE)
        except signing.BadSignature:
            return redirect('/?google=erro')
        if not code or not google.configurado():
            return redirect('/?google=erro')

        try:
            tokens = google.trocar_codigo(code)
            agora = timezone.now()
            try:
                email = google.email_da_conta(tokens['access_token'])
            except google.GoogleErro:
                email = ''
            conta = ContaGoogle.objects.filter(usuario_id=dados['u']).first() or ContaGoogle(usuario_id=dados['u'])
            conta.access_token = tokens['access_token']
            conta.expira_em = google.expiracao(tokens, agora)
            conta.email = email
            if tokens.get('refresh_token'):
                conta.refresh_token = tokens['refresh_token']
            conta.save()
        except (google.GoogleErro, KeyError):
            logger.exception('Falha ao concluir a conexão com o Google')
            return redirect('/?google=erro')
        return redirect('/?google=ok')
