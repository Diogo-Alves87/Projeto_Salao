from rest_framework import serializers

from .models import Profissional, Servico
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

class ServicoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Servico
        fields = ('id', 'nome', 'descricao', 'duracao_minutos', 'preco', 'ativo')


class ProfissionalSerializer(serializers.ModelSerializer):
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)
    nome = serializers.CharField(source='usuario.nome', read_only=True)
    email = serializers.EmailField(source='usuario.email', read_only=True)
    # Usados só ao criar um profissional novo
    novo_nome = serializers.CharField(write_only=True, required=False, max_length=150)
    novo_email = serializers.EmailField(write_only=True, required=False)
    novo_telefone = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=20)
    senha = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = Profissional
        fields = (
            'id', 'usuario', 'nome', 'email', 'servicos', 'intervalo_minutos', 'ativo',
            'novo_nome', 'novo_email', 'novo_telefone', 'senha',
        )

    def validate(self, attrs):
        if self.instance is None:
            erros = {c: 'Campo obrigatório.' for c in ('novo_nome', 'novo_email', 'senha') if not attrs.get(c)}
            if erros:
                raise serializers.ValidationError(erros)
            if get_user_model().objects.filter(email__iexact=attrs['novo_email']).exists():
                raise serializers.ValidationError({'novo_email': 'Já existe um usuário com este e-mail.'})
            try:
                validate_password(attrs['senha'])
            except DjangoValidationError as e:
                raise serializers.ValidationError({'senha': list(e.messages)})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        nome = validated_data.pop('novo_nome')
        email = validated_data.pop('novo_email')
        telefone = validated_data.pop('novo_telefone', '')
        senha = validated_data.pop('senha')
        servicos = validated_data.pop('servicos', [])
        usuario = get_user_model().objects.create_user(
            email=email, password=senha, nome=nome, telefone=telefone, tipo='profissional'
        )
        profissional = Profissional.objects.create(usuario=usuario, **validated_data)
        profissional.servicos.set(servicos)
        return profissional