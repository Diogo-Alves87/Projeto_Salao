from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class HorarioTrabalho(models.Model):
    """Janela em que o profissional atende. Pode haver mais de uma por dia
    (ex.: manhã e tarde)."""

    class Dia(models.IntegerChoices):
        SEGUNDA = 0, 'Segunda-feira'
        TERCA = 1, 'Terça-feira'
        QUARTA = 2, 'Quarta-feira'
        QUINTA = 3, 'Quinta-feira'
        SEXTA = 4, 'Sexta-feira'
        SABADO = 5, 'Sábado'
        DOMINGO = 6, 'Domingo'

    profissional = models.ForeignKey(
        'catalogo.Profissional',
        on_delete=models.CASCADE,
        related_name='horarios',
    )
    dia_semana = models.IntegerField('dia da semana', choices=Dia.choices)
    hora_inicio = models.TimeField('início')
    hora_fim = models.TimeField('fim')

    class Meta:
        verbose_name = 'horário de trabalho'
        verbose_name_plural = 'horários de trabalho'
        ordering = ['profissional', 'dia_semana', 'hora_inicio']

    def __str__(self):
        return (
            f'{self.profissional} - {self.get_dia_semana_display()} '
            f'{self.hora_inicio:%H:%M}-{self.hora_fim:%H:%M}'
        )

    def clean(self):
        if not (self.hora_inicio and self.hora_fim):
            return
        if self.hora_fim <= self.hora_inicio:
            raise ValidationError('O horário de fim deve ser depois do início.')
        if self.profissional_id is None:
            return
        conflito = HorarioTrabalho.objects.filter(
            profissional_id=self.profissional_id,
            dia_semana=self.dia_semana,
            hora_inicio__lt=self.hora_fim,
            hora_fim__gt=self.hora_inicio,
        ).exclude(pk=self.pk)
        if conflito.exists():
            raise ValidationError(
                'Este horário se sobrepõe a outro já cadastrado neste dia.'
            )


class Bloqueio(models.Model):
    """Período em que o profissional não atende (folga, férias, etc.)."""

    profissional = models.ForeignKey(
        'catalogo.Profissional',
        on_delete=models.CASCADE,
        related_name='bloqueios',
    )
    inicio = models.DateTimeField('início')
    fim = models.DateTimeField('fim')
    motivo = models.CharField('motivo', max_length=150, blank=True)

    class Meta:
        verbose_name = 'bloqueio'
        verbose_name_plural = 'bloqueios'
        ordering = ['-inicio']

    def __str__(self):
        return f'{self.profissional} bloqueado de {self.inicio:%d/%m %H:%M} a {self.fim:%d/%m %H:%M}'

    def clean(self):
        if self.inicio and self.fim and self.fim <= self.inicio:
            raise ValidationError('O fim do bloqueio deve ser depois do início.')


class Agendamento(models.Model):
    class Status(models.TextChoices):
        CONFIRMADO = 'confirmado', 'Confirmado'
        CANCELADO = 'cancelado', 'Cancelado'
        CONCLUIDO = 'concluido', 'Concluído'
        FALTOU = 'faltou', 'Cliente faltou'

    cliente = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='agendamentos',
        limit_choices_to={'tipo': 'cliente'},
    )
    profissional = models.ForeignKey(
        'catalogo.Profissional',
        on_delete=models.PROTECT,
        related_name='agendamentos',
    )
    servico = models.ForeignKey(
        'catalogo.Servico',
        on_delete=models.PROTECT,
        related_name='agendamentos',
        verbose_name='serviço',
    )
    inicio = models.DateTimeField('início')
    fim = models.DateTimeField('fim', editable=False)
    preco_cobrado = models.DecimalField(
        'preço cobrado (R$)',
        max_digits=8,
        decimal_places=2,
        blank=True,
        help_text='Se ficar vazio, usa o preço atual do serviço.',
    )
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.CONFIRMADO
    )
    observacoes = models.TextField('observações', blank=True)
    criado_em = models.DateTimeField('criado em', auto_now_add=True)

    class Meta:
        verbose_name = 'agendamento'
        verbose_name_plural = 'agendamentos'
        ordering = ['inicio']
        indexes = [models.Index(fields=['profissional', 'inicio'])]

    def __str__(self):
        return f'{self.cliente.nome} - {self.servico} - {self.inicio:%d/%m/%Y %H:%M}'
    
    def clean(self):
        if not (self.profissional_id and self.servico_id and self.inicio):
            return
        if self.status != self.Status.CONFIRMADO:
            return
        from .services import validar_agendamento

        validar_agendamento(
            self.profissional,
            self.servico,
            self.inicio,
            ignorar_id=self.pk,
            checar_passado=self._state.adding,  # só exige futuro ao criar
        )
    def save(self, *args, **kwargs):
        # O fim é sempre calculado pela duração do serviço.
        self.fim = self.inicio + timedelta(minutes=self.servico.duracao_minutos)
        # O preço fica "congelado" no momento do agendamento.
        if self.preco_cobrado is None:
            self.preco_cobrado = self.servico.preco
        super().save(*args, **kwargs)


class ContaGoogle(models.Model):
    """Conta Google conectada por um usuário (tokens do OAuth).

    A configuração do Google (chaves, escopos) fica em config/google_services.py.
    """

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='conta_google'
    )
    email = models.EmailField('e-mail Google', blank=True)
    access_token = models.TextField()
    refresh_token = models.TextField(blank=True)
    expira_em = models.DateTimeField()
    conectado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'conta Google'
        verbose_name_plural = 'contas Google'

    def __str__(self):
        return f'{self.usuario} · {self.email or "Google"}'


class EventoGoogle(models.Model):
    """Evento criado no Google Agenda de um usuário para um agendamento."""

    conta = models.ForeignKey(ContaGoogle, on_delete=models.CASCADE, related_name='eventos')
    agendamento = models.ForeignKey(Agendamento, on_delete=models.CASCADE, related_name='eventos_google')
    evento_id = models.CharField(max_length=255)

    class Meta:
        verbose_name = 'evento no Google Agenda'
        verbose_name_plural = 'eventos no Google Agenda'
        constraints = [
            models.UniqueConstraint(fields=['conta', 'agendamento'], name='evento_google_unico'),
        ]

