from rest_framework import viewsets

from .models import Profissional, Servico
from .permissions import AdminEscreveTodosLeem
from .serializers import ProfissionalSerializer, ServicoSerializer


class AtivosParaClientes:
    """Clientes só enxergam itens ativos; admin enxerga tudo."""

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.tipo != 'admin':
            qs = qs.filter(ativo=True)
        return qs


class ServicoViewSet(AtivosParaClientes, viewsets.ModelViewSet):
    queryset = Servico.objects.all()
    serializer_class = ServicoSerializer
    permission_classes = [AdminEscreveTodosLeem]


class ProfissionalViewSet(AtivosParaClientes, viewsets.ModelViewSet):
    queryset = Profissional.objects.select_related('usuario').prefetch_related('servicos')
    serializer_class = ProfissionalSerializer
    permission_classes = [AdminEscreveTodosLeem]