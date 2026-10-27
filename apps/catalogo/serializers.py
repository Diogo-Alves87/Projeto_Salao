from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Profissional, Servico


class ServicoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Servico
        fields = ('id', 'nome', 'descricao', 'duracao_minutos', 'preco', 'ativo')


class ProfissionalSerializer(serializers.ModelSerializer):
    """
    Cria o profissional a partir de um usuário já existente do tipo 'profissional'
    (o mesmo que o front envia: usuario, servicos, intervalo_minutos, ativo).
    Na edição, o usuário não pode ser trocado.
    """
    usuario = serializers.PrimaryKeyRelatedField(read_only=True)
    nome = serializers.CharField(source='usuario.nome', read_only=True)
    email = serializers.EmailField(source='usuario.email', read_only=True)

    class Meta:
        model = Profissional
        fields = ('id', 'usuario', 'nome', 'email', 'servicos', 'intervalo_minutos', 'ativo')

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is None:
            # Criação: escolhe entre usuários "profissional" que ainda não têm cadastro.
            fields['usuario'] = serializers.PrimaryKeyRelatedField(
                queryset=get_user_model().objects.filter(
                    tipo='profissional', profissional__isnull=True
                ),
                error_messages={
                    'does_not_exist': 'Usuário inválido ou já cadastrado como profissional.',
                    'incorrect_type': 'Usuário inválido.',
                },
            )
        return fields
