from django.contrib import admin

from apps.agenda.models import HorarioTrabalho

from .models import Profissional, Servico


@admin.register(Servico)
class ServicoAdmin(admin.ModelAdmin):
    list_display = ('nome', 'duracao_minutos', 'preco', 'ativo')
    list_filter = ('ativo',)
    list_editable = ('ativo',)
    search_fields = ('nome',)


class HorarioTrabalhoInline(admin.TabularInline):
    model = HorarioTrabalho
    extra = 1


@admin.register(Profissional)
class ProfissionalAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'intervalo_minutos', 'comissao_percentual', 'ativo')
    list_filter = ('ativo',)
    filter_horizontal = ('servicos',)
    inlines = [HorarioTrabalhoInline]