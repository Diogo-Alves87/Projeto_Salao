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

    objects = UsuarioManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['nome']

    class Meta:
        verbose_name = 'usuário'
        verbose_name_plural = 'usuários'

    def __str__(self):
        return f'{self.nome} ({self.email})'