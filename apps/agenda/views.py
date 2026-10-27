from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
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


class GraficoProfissionaisView(APIView):
    """Dados dos gráficos do admin num período (?inicio=AAAA-MM-DD&fim=AAAA-MM-DD,
    padrão: mês atual; as duas datas entram no período).

    'linhas': agendamentos confirmados/concluídos somados por profissional, dia e
    serviço. O filtro por profissional é feito no navegador, em cima delas.
    'comissoes': por profissional, 'a_receber' é a comissão sobre os atendimentos
    concluídos e 'previsto' sobre os confirmados que ainda não foram finalizados.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.tipo != 'admin':
            return Response({'detail': 'Apenas administradores.'}, status=status.HTTP_403_FORBIDDEN)

        hoje = timezone.localdate()
        try:
            inicio = date.fromisoformat(request.query_params['inicio'])
            fim = date.fromisoformat(request.query_params['fim'])
        except (KeyError, ValueError):
            inicio = hoje.replace(day=1)
            fim = (inicio + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        if fim < inicio:
            inicio, fim = fim, inicio

        tz = timezone.get_current_timezone()
        qs = Agendamento.objects.filter(
            inicio__gte=timezone.make_aware(datetime.combine(inicio, time.min), tz),
            inicio__lt=timezone.make_aware(datetime.combine(fim + timedelta(days=1), time.min), tz),
            status__in=[Agendamento.Status.CONFIRMADO, Agendamento.Status.CONCLUIDO],
        )
        linhas = (
            qs.annotate(dia=TruncDate('inicio', tzinfo=tz))
            .values('profissional', 'dia', 'servico', 'status')
            .annotate(qtd=Count('id'), total=Sum('preco_cobrado'))
            .order_by()
        )

        profissionais = list(Profissional.objects.select_related('usuario'))
        somas = {}  # (profissional, status) -> renda
        saida = []
        for l in linhas:
            total = l['total'] or Decimal('0')
            chave = (l['profissional'], l['status'])
            somas[chave] = somas.get(chave, Decimal('0')) + total
            saida.append({
                'profissional': l['profissional'], 'dia': l['dia'].isoformat(), 'servico': l['servico'],
                'qtd': l['qtd'], 'total': float(total),
            })

        comissoes = []
        for p in profissionais:
            fator = p.comissao_percentual / 100
            concluida = somas.get((p.id, Agendamento.Status.CONCLUIDO), Decimal('0'))
            confirmada = somas.get((p.id, Agendamento.Status.CONFIRMADO), Decimal('0'))
            comissoes.append({
                'profissional': p.id,
                'percentual': float(p.comissao_percentual),
                'renda_concluida': float(concluida),
                'a_receber': float((concluida * fator).quantize(Decimal('0.01'))),
                'previsto': float((confirmada * fator).quantize(Decimal('0.01'))),
            })

        return Response({
            'inicio': inicio.isoformat(),
            'fim': fim.isoformat(),
            'profissionais': [{'id': p.id, 'nome': p.usuario.nome} for p in profissionais],
            'servicos': [{'id': s.id, 'nome': s.nome} for s in Servico.objects.all()],
            'linhas': saida,
            'comissoes': comissoes,
        })