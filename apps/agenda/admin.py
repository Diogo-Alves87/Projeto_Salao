from datetime import date

from django.contrib import admin, messages
from django.http import JsonResponse
from django.urls import path
from django.utils import timezone

from apps.catalogo.models import Profissional, Servico

from .forms import AgendamentoAdminForm
from .models import Agendamento, Bloqueio
from .services import horarios_livres


@admin.register(Bloqueio)
class BloqueioAdmin(admin.ModelAdmin):
    list_display = ('profissional', 'inicio', 'fim', 'motivo')
    list_filter = ('profissional',)


@admin.register(Agendamento)
class AgendamentoAdmin(admin.ModelAdmin):
    form = AgendamentoAdminForm
    list_display = ('inicio', 'cliente', 'profissional', 'servico', 'status', 'preco_cobrado')
    list_filter = ('status', 'profissional', 'servico')
    search_fields = ('cliente__nome', 'cliente__email')
    date_hierarchy = 'inicio'
    fields = (
        'cliente', 'profissional', 'servico', 'data', 'hora',
        'preco_cobrado', 'status', 'observacoes', 'fim', 'criado_em',
    )
    readonly_fields = ('fim', 'criado_em')
    actions = ['marcar_concluido', 'marcar_faltou']

    def get_urls(self):
        extra = [
            path(
                'horarios-livres/',
                self.admin_site.admin_view(self.horarios_livres_view),
                name='agenda_agendamento_horarios_livres',
            ),
        ]
        return extra + super().get_urls()

    def horarios_livres_view(self, request):
        p = request.GET
        try:
            profissional = Profissional.objects.get(pk=p.get('profissional'))
            servico = Servico.objects.get(pk=p.get('servico'))
            dia = date.fromisoformat(p.get('data', ''))
            ignorar = int(p['ignorar']) if p.get('ignorar') else None
        except (Profissional.DoesNotExist, Servico.DoesNotExist, ValueError, TypeError):
            return JsonResponse({'horarios': []})

        livres = horarios_livres(profissional, servico, dia, ignorar_id=ignorar)
        return JsonResponse(
            {'horarios': [timezone.localtime(h).strftime('%H:%M') for h in livres]}
        )

    def _finalizar(self, request, queryset, novo_status):
        total = queryset.filter(status=Agendamento.Status.CONFIRMADO).update(status=novo_status)
        self.message_user(request, f'{total} agendamento(s) atualizado(s).', messages.SUCCESS)

    @admin.action(description='Marcar selecionados como concluído')
    def marcar_concluido(self, request, queryset):
        self._finalizar(request, queryset, Agendamento.Status.CONCLUIDO)

    @admin.action(description='Marcar selecionados como "cliente faltou"')
    def marcar_faltou(self, request, queryset):
        self._finalizar(request, queryset, Agendamento.Status.FALTOU)