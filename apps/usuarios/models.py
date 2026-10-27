from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class UsuarioManager(BaseUserManager):
    use_in_migrations = True

    def _criar(self, email, password, **extra):
        if not email:
            raise ValueError('O e-mail é obrigatório.')
        usuario = self.model(email=self.normalize_email(email), **extra)
        usuario.set_password(password)
        usuario.save(using=self._db)
        return usuario

    def create_user(self, email, password=None, **extra):
        extra.setdefault('is_staff', False)
        extra.setdefault('is_superuser', False)
        return self._criar(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        extra.setdefault('tipo', Usuario.Tipo.ADMIN)
        return self._criar(email, password, **extra)


class Usuario(AbstractBaseUser, PermissionsMixin):
    class Tipo(models.TextChoices):
        CLIENTE = 'cliente', 'Cliente'
        PROFISSIONAL = 'profissional', 'Profissional'
        ADMIN = 'admin', 'Administrador'

    email = models.EmailField('e-mail', unique=True)
    nome = models.CharField(max_length=150)
    telefone = models.CharField(max_length=20, blank=True)
    tipo = models.CharField(max_length=15, choices=Tipo.choices, default=Tipo.CLIENTE)
    is_active = models.BooleanField('ativo', default=True)
    is_staff = models.BooleanField('acesso ao admin', default=False)
    date_joined = models.DateTimeField('cadastrado em', default=timezone.now)

    # Dados pessoais (cpf e cep guardam só dígitos)
    cpf = models.CharField('CPF', max_length=11, unique=True, null=True, blank=True)
    data_nascimento = models.DateField('data de nascimento', null=True, blank=True)
    foto = models.ImageField('foto', upload_to='fotos/', blank=True)

    # Endereço
    cep = models.CharField('CEP', max_length=8, blank=True)
    rua = models.CharField(max_length=150, blank=True)
    numero = models.CharField('número', max_length=20, blank=True)
    complemento = models.CharField(max_length=100, blank=True)
    bairro = models.CharField(max_length=100, blank=True)
    cidade = models.CharField(max_length=100, blank=True)
    estado = models.CharField('UF', max_length=2, blank=True)

    # Autenticação em dois fatores
    totp_secret = models.CharField(max_length=32, blank=True)
    totp_ativo = models.BooleanField('2FA ativo', default=False)

    objects = UsuarioManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['nome']

    class Meta:
        verbose_name = 'usuário'
        verbose_name_plural = 'usuários'

    def __str__(self):
        return f'{self.nome} ({self.email})'


class Sessao(models.Model):
    """Um login (par access/refresh) de um dispositivo."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sessoes'
    )
    dispositivo = models.CharField(max_length=80)
    descricao = models.CharField(max_length=120, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    criado_em = models.DateTimeField(default=timezone.now)
    ultimo_acesso = models.DateTimeField(default=timezone.now)
    expira_em = models.DateTimeField()
    revogada = models.BooleanField(default=False)

    class Meta:
        verbose_name = 'sessão'
        verbose_name_plural = 'sessões'
        ordering = ['-ultimo_acesso']

    def __str__(self):
        return f'{self.usuario} · {self.dispositivo}'

    @classmethod
    def ativas(cls):
        return cls.objects.filter(revogada=False, expira_em__gt=timezone.now())