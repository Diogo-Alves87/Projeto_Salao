from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AgendamentoViewSet, DisponibilidadeView

router = DefaultRouter()
router.register('agendamentos', AgendamentoViewSet, basename='agendamento')

urlpatterns = [
    path('disponibilidade/', DisponibilidadeView.as_view(), name='disponibilidade'),
] + router.urls