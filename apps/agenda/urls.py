from django.urls import path
from rest_framework.routers import DefaultRouter

from .google_views import GoogleCallbackView, GoogleConectarView, GoogleStatusView
from .views import AgendamentoViewSet, DisponibilidadeView, GraficoProfissionaisView

router = DefaultRouter()
router.register('agendamentos', AgendamentoViewSet, basename='agendamento')

urlpatterns = [
    path('disponibilidade/', DisponibilidadeView.as_view(), name='disponibilidade'),
    path('graficos/profissionais/', GraficoProfissionaisView.as_view(), name='grafico-profissionais'),
    path('google/', GoogleStatusView.as_view(), name='google'),
    path('google/conectar/', GoogleConectarView.as_view(), name='google-conectar'),
    path('google/callback/', GoogleCallbackView.as_view(), name='google-callback'),
] + router.urls