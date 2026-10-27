from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Sum
from django.db.models.functions import ExtractIsoWeekDay
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
    """Agendamentos agregados por profissional, dia da semana (1=seg ... 7=dom) e serviço.

    Só para admin. Cancelados e faltas não entram. O filtro por dia e por
    profissional é feito no navegador, em cima destas linhas.

    Também devolve a comissão de cada profissional no mês (?mes=AAAA-MM, padrão:
    mês atual): 'a_receber' conta os atendimentos concluídos e 'previsto' soma
    os confirmados que ainda não foram finalizados.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.tipo != 'admin':
            return Response({'detail': 'Apenas administradores.'}, status=status.HTTP_403_FORBIDDEN)
        linhas = (
            Agendamento.objects
            .filter(status__in=[Agendamento.Status.CONFIRMADO, Agendamento.Status.CONCLUIDO])
            .annotate(dia=ExtractIsoWeekDay('inicio'))
            .values('profissional', 'dia', 'servico')
            .annotate(qtd=Count('id'), total=Sum('preco_cobrado'))
            .order_by()
        )

        hoje = timezone.localdate()
        try:
            ano, mes = (int(x) for x in request.query_params.get('mes', '').split('-'))
            primeiro = date(ano, mes, 1)
        except ValueError:
            primeiro = hoje.replace(day=1)
        proximo = (primeiro + timedelta(days=32)).replace(day=1)
        tz = timezone.get_current_timezone()
        no_mes = (
            Agendamento.objects
            .filter(
                inicio__gte=timezone.make_aware(datetime.combine(primeiro, time.min), tz),
                inicio__lt=timezone.make_aware(datetime.combine(proximo, time.min), tz),
                status__in=[Agendamento.Status.CONFIRMADO, Agendamento.Status.CONCLUIDO],
            )
            .values('profissional', 'status')
            .annotate(qtd=Count('id'), total=Sum('preco_cobrado'))
            .order_by()
        )
        somas = {}
        for l in no_mes:
            somas[(l['profissional'], l['status'])] = (l['qtd'], l['total'] or Decimal('0'))

        profissionais = list(Profissional.objects.select_related('usuario'))
        comissoes = []
        for p in profissionais:
            qtd_c, renda_c = somas.get((p.id, Agendamento.Status.CONCLUIDO), (0, Decimal('0')))
            qtd_p, renda_p = somas.get((p.id, Agendamento.Status.CONFIRMADO), (0, Decimal('0')))
            fator = p.comissao_percentual / 100
            comissoes.append({
                'profissional': p.id,
                'percentual': float(p.comissao_percentual),
                'qtd_concluidos': qtd_c,
                'renda_concluida': float(renda_c),
                'a_receber': float((renda_c * fator).quantize(Decimal('0.01'))),
                'qtd_previstos': qtd_p,
                'previsto': float((renda_p * fator).quantize(Decimal('0.01'))),
            })

        return Response({
            'profissionais': [{'id': p.id, 'nome': p.usuario.nome} for p in profissionais],
            'servicos': [{'id': s.id, 'nome': s.nome} for s in Servico.objects.all()],
            'linhas': [
                {'profissional': l['profissional'], 'dia': l['dia'], 'servico': l['servico'],
                 'qtd': l['qtd'], 'total': float(l['total'] or 0)}
                for l in linhas
            ],
            'mes': primeiro.strftime('%Y-%m'),
            'comissoes': comissoes,
        })
