from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AgendamentoViewSet, DisponibilidadeView, GraficoProfissionaisView

router = DefaultRouter()
router.register('agendamentos', AgendamentoViewSet, basename='agendamento')

urlpatterns = [
    path('disponibilidade/', DisponibilidadeView.as_view(), name='disponibilidade'),
    path('graficos/profissionais/', GraficoProfissionaisView.as_view(), name='grafico-profissionais'),
] + router.urls