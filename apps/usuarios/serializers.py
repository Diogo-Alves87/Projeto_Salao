import re

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Usuario

CAMPOS_ENDERECO = ('cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado')


def so_digitos(valor):
    return re.sub(r'\D', '', valor or '')


def cpf_valido(cpf):
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for t in (9, 10):
        soma = sum(int(cpf[i]) * (t + 1 - i) for i in range(t))
        if (soma * 10) % 11 % 10 != int(cpf[t]):
            return False
    return True


class RegistroSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    # O CPF é obrigatório no cadastro; o endereço inteiro é opcional
    cpf = serializers.CharField(max_length=14)
    # Aceita com máscara (00000-000); só os dígitos são salvos
    cep = serializers.CharField(max_length=9, required=False, allow_blank=True)

    class Meta:
        model = Usuario
        fields = ('id', 'nome', 'email', 'telefone', 'cpf', 'password') + CAMPOS_ENDERECO
        extra_kwargs = {c: {'required': False} for c in CAMPOS_ENDERECO}

    def validate_cpf(self, valor):
        cpf = so_digitos(valor)
        if not cpf_valido(cpf):
            raise serializers.ValidationError('CPF inválido.')
        if Usuario.objects.filter(cpf=cpf).exists():
            raise serializers.ValidationError('Já existe uma conta com este CPF.')
        return cpf

    def validate_cep(self, valor):
        cep = so_digitos(valor)
        if cep and len(cep) != 8:
            raise serializers.ValidationError('O CEP deve ter 8 números.')
        return cep

    def validate_estado(self, valor):
        return (valor or '').strip().upper()

    def create(self, validated_data):
        # O tipo não vem do cliente: todo cadastro público é "cliente".
        return Usuario.objects.create_user(**validated_data)


class UsuarioSerializer(serializers.ModelSerializer):
    """Perfil do usuário logado. Nome, e-mail, CPF e tipo não mudam por aqui."""

    cep = serializers.CharField(max_length=9, required=False, allow_blank=True)

    class Meta:
        model = Usuario
        fields = ('id', 'nome', 'email', 'tipo', 'cpf', 'telefone', 'data_nascimento', 'foto') + CAMPOS_ENDERECO
        read_only_fields = ('id', 'nome', 'email', 'tipo', 'cpf')

    def validate_cep(self, valor):
        cep = so_digitos(valor)
        if cep and len(cep) != 8:
            raise serializers.ValidationError('O CEP deve ter 8 números.')
        return cep

    def validate_estado(self, valor):
        estado = (valor or '').strip().upper()
        if estado and not re.fullmatch(r'[A-Z]{2}', estado):
            raise serializers.ValidationError('Use a sigla do estado com 2 letras, por exemplo SP.')
        return estado
