from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

class Servico(models.Model):
    nome = models.CharField('nome', max_length=100, unique=True)
    descricao = models.TextField('descrição', blank=True)
    duracao_minutos = models.PositiveIntegerField('duração (minutos)')
    preco = models.DecimalField('preço (R$)', max_digits=8, decimal_places=2)
    ativo = models.BooleanField('ativo', default=True)

    class Meta:
        verbose_name = 'serviço'
        verbose_name_plural = 'serviços'
        ordering = ['nome']

    def __str__(self):
        return self.nome


class Profissional(models.Model):
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profissional',
        limit_choices_to={'tipo': 'profissional'},
    )
    servicos = models.ManyToManyField(
        Servico, related_name='profissionais', blank=True
    )
    intervalo_minutos = models.PositiveIntegerField(
        'intervalo entre horários (minutos)',
        default=15,
        validators=[MinValueValidator(5), MaxValueValidator(120)],
        help_text='De quanto em quanto tempo os horários são oferecidos. Padrão: 15.',
    )
    ativo = models.BooleanField('ativo', default=True)

    class Meta:
        verbose_name = 'profissional'
        verbose_name_plural = 'profissionais'
        ordering = ['usuario__nome']

    def __str__(self):
        return self.usuario.nome