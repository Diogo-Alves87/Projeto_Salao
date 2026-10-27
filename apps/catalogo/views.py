from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

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
    queryset = Profissional.objects.select_related('usuario').prefetch_related('servicos', 'horarios')
    serializer_class = ProfissionalSerializer
    permission_classes = [AdminEscreveTodosLeem]

    def destroy(self, request, *args, **kwargs):
        """Remove só o cadastro de profissional; a conta volta a ser de cliente."""
        profissional = self.get_object()
        usuario = profissional.usuario
        try:
            with transaction.atomic():
                profissional.delete()
                usuario.tipo = 'cliente'
                usuario.save(update_fields=['tipo'])
        except ProtectedError:
            return Response(
                {'detail': 'Este profissional tem agendamentos e não pode ser removido. Desative-o em vez disso.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], url_path='usuarios-disponiveis')
    def usuarios_disponiveis(self, request):
        if request.user.tipo != 'admin':
            return Response([], status=status.HTTP_403_FORBIDDEN)
        # Clientes (e profissionais ainda sem cadastro) podem ser promovidos
        qs = (
            get_user_model().objects
            .filter(tipo__in=['cliente', 'profissional'], profissional__isnull=True, is_superuser=False, is_active=True)
            .order_by('nome')
        )
        return Response([{'id': u.id, 'nome': u.nome, 'email': u.email} for u in qs])
