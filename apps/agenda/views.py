from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalogo.models import Profissional, Servico

from .models import Agendamento
from .permissions import PodeAgendar
from .serializers import AgendamentoSerializer
from .services import horarios_livres


class AgendamentoViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AgendamentoSerializer
    permission_classes = [PodeAgendar]

    def get_queryset(self):
        qs = Agendamento.objects.select_related(
            'cliente', 'profissional__usuario', 'servico'
        )
        user = self.request.user
        if user.tipo == 'profissional':
            qs = qs.filter(profissional__usuario=user)
        elif user.tipo != 'admin':
            qs = qs.filter(cliente=user)

        params = self.request.query_params
        if params.get('data'):
            try:
                qs = qs.filter(inicio__date=date.fromisoformat(params['data']))
            except ValueError:
                qs = qs.none()
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        return qs

    @action(detail=True, methods=['post'])
    def cancelar(self, request, pk=None):
        agendamento = self.get_object()

        if agendamento.status != Agendamento.Status.CONFIRMADO:
            return Response(
                {'detail': 'Só é possível cancelar agendamentos confirmados.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.user.tipo == 'cliente':
            horas = settings.AGENDA_CANCELAMENTO_ANTECEDENCIA_HORAS
            if timezone.now() > agendamento.inicio - timedelta(hours=horas):
                return Response(
                    {'detail': f'O cancelamento deve ser feito com pelo menos {horas} horas de antecedência.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        agendamento.status = Agendamento.Status.CANCELADO
        agendamento.save()
        return Response(self.get_serializer(agendamento).data)

    def _finalizar(self, request, novo_status):
        if request.user.tipo == 'cliente':
            return Response(
                {'detail': 'Você não tem permissão para esta ação.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        agendamento = self.get_object()

        if agendamento.status != Agendamento.Status.CONFIRMADO:
            return Response(
                {'detail': 'Só é possível finalizar agendamentos confirmados.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # O profissional só finaliza depois que o atendimento começou; o admin pode a qualquer momento.
        if request.user.tipo == 'profissional' and timezone.now() < agendamento.inicio:
            return Response(
                {'detail': 'Este atendimento ainda não começou.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agendamento.status = novo_status
        agendamento.save()
        return Response(self.get_serializer(agendamento).data)

    @action(detail=True, methods=['post'])
    def concluir(self, request, pk=None):
        return self._finalizar(request, Agendamento.Status.CONCLUIDO)

    @action(detail=True, methods=['post'])
    def faltou(self, request, pk=None):
        return self._finalizar(request, Agendamento.Status.FALTOU)


class DisponibilidadeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        params = request.query_params
        try:
            profissional = Profissional.objects.get(pk=params.get('profissional'), ativo=True)
            servico = Servico.objects.get(pk=params.get('servico'), ativo=True)
            dia = date.fromisoformat(params.get('data', ''))
        except (Profissional.DoesNotExist, Servico.DoesNotExist, ValueError, TypeError):
            return Response(
                {'detail': 'Informe profissional, servico e data (AAAA-MM-DD) válidos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not profissional.servicos.filter(pk=servico.pk).exists():
            return Response(
                {'detail': 'Este profissional não realiza este serviço.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        horarios = [
            timezone.localtime(h).strftime('%H:%M')
            for h in horarios_livres(profissional, servico, dia)
        ]
        return Response({'data': dia.isoformat(), 'horarios': horarios})