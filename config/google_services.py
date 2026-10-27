"""
Integração com o Google (OAuth 2.0 + Google Agenda).

>>> Para ativar, só é preciso preencher as 3 configurações da seção "CHAVES" abaixo. <<<

Passo a passo para conseguir as chaves:
  1. Acesse https://console.cloud.google.com/ e crie (ou escolha) um projeto.
  2. Em "APIs e serviços" > "Biblioteca", ative a "Google Calendar API".
  3. Em "APIs e serviços" > "Tela de consentimento OAuth", configure o app
     (tipo "Externo"; enquanto estiver em teste, adicione os e-mails que vão testar).
  4. Em "APIs e serviços" > "Credenciais" > "Criar credenciais" > "ID do cliente OAuth":
       - Tipo de aplicativo: "Aplicativo da Web"
       - URIs de redirecionamento autorizados: o mesmo valor de GOOGLE_REDIRECT_URI
         (em desenvolvimento: http://localhost:8000/api/agenda/google/callback/)
  5. Copie o "ID do cliente" e a "Chave secreta do cliente" para as variáveis abaixo.

Enquanto as chaves estiverem vazias, o site continua funcionando normalmente: a tela
de Integrações avisa que o Google ainda não foi configurado e nada é enviado ao Google.

"""

import json
import logging
import os
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


# =============================================================================
# CHAVES — preencha aqui (ou use as variáveis de ambiente de mesmo nome)
# =============================================================================
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI = os.environ.get(
    'GOOGLE_REDIRECT_URI', 'http://localhost:8000/api/agenda/google/callback/'
)

# Permissões pedidas ao usuário. "calendar.events" basta para criar/remover eventos;
# "openid email" permite saber qual conta Google foi conectada (e servirá para um
# futuro "Entrar com Google").
GOOGLE_SCOPES = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.events',
]

# Agenda onde os eventos são criados ("primary" = agenda principal da pessoa)
GOOGLE_CALENDAR_ID = 'primary'


# =============================================================================
# Endereços do Google (não precisam ser alterados)
# =============================================================================
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/{calendario}/events'

TIMEOUT = 10  # segundos


class GoogleErro(Exception):
    """Falha ao falar com o Google (rede, chave inválida, token revogado...)."""

    def __init__(self, mensagem, status=None):
        super().__init__(mensagem)
        self.status = status  # código HTTP devolvido pelo Google, quando houver


def configurado():
    """True quando as chaves foram preenchidas."""
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI)


# -----------------------------------------------------------------------------
# HTTP
# -----------------------------------------------------------------------------
def _requisicao(metodo, url, dados=None, json_corpo=None, token=None):
    headers = {}
    corpo = None
    if dados is not None:
        corpo = urlencode(dados).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    elif json_corpo is not None:
        corpo = json.dumps(json_corpo).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    try:
        with urlopen(Request(url, data=corpo, headers=headers, method=metodo), timeout=TIMEOUT) as r:
            conteudo = r.read()
            return json.loads(conteudo) if conteudo else {}
    except HTTPError as e:
        detalhe = e.read().decode(errors='replace')[:300]
        raise GoogleErro(f'Google respondeu {e.code}: {detalhe}', status=e.code) from e
    except (URLError, TimeoutError, ValueError) as e:
        raise GoogleErro(f'Falha de comunicação com o Google: {e}') from e


# -----------------------------------------------------------------------------
# OAuth 2.0
# -----------------------------------------------------------------------------
def url_autorizacao(state):
    """Endereço da tela de consentimento do Google. `state` volta no callback."""
    return AUTH_URL + '?' + urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': ' '.join(GOOGLE_SCOPES),
        'access_type': 'offline',       # devolve refresh_token (acesso sem o usuário presente)
        'prompt': 'consent',            # garante o refresh_token mesmo em reconexões
        'include_granted_scopes': 'true',
        'state': state,
    })


def trocar_codigo(code):
    """Troca o `code` do callback por tokens: access_token, refresh_token, expires_in."""
    return _requisicao('POST', TOKEN_URL, dados={
        'code': code,
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'grant_type': 'authorization_code',
    })


def renovar_token(refresh_token):
    """Gera um novo access_token a partir do refresh_token."""
    return _requisicao('POST', TOKEN_URL, dados={
        'refresh_token': refresh_token,
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'grant_type': 'refresh_token',
    })


def revogar(token):
    """Revoga o acesso concedido (usado ao remover a integração)."""
    _requisicao('POST', REVOKE_URL, dados={'token': token})


def email_da_conta(access_token):
    return _requisicao('GET', USERINFO_URL, token=access_token).get('email', '')


def expiracao(resposta_token, agora):
    """Momento em que o access_token expira (com 1 minuto de folga)."""
    return agora + timedelta(seconds=int(resposta_token.get('expires_in', 3600)) - 60)


# -----------------------------------------------------------------------------
# Google Agenda
# -----------------------------------------------------------------------------
def _url_eventos(sufixo=''):
    return CALENDAR_URL.format(calendario=quote(GOOGLE_CALENDAR_ID, safe='')) + sufixo


def criar_evento(access_token, titulo, inicio, fim, descricao='', fuso='America/Sao_Paulo'):
    """Cria um evento e devolve o id dele no Google. `inicio`/`fim` são datetimes com fuso."""
    evento = _requisicao('POST', _url_eventos(), token=access_token, json_corpo={
        'summary': titulo,
        'description': descricao,
        'start': {'dateTime': inicio.isoformat(), 'timeZone': fuso},
        'end': {'dateTime': fim.isoformat(), 'timeZone': fuso},
    })
    return evento['id']


def remover_evento(access_token, evento_id):
    try:
        _requisicao('DELETE', _url_eventos('/' + quote(evento_id, safe='')), token=access_token)
    except GoogleErro as e:
        # 404/410: o evento já tinha sido apagado no Google; não é um erro para nós
        if e.status not in (404, 410):
            raise
