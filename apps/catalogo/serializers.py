from rest_framework import serializers

from .models import Profissional, Servico


class ServicoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Servico
        fields = ('id', 'nome', 'descricao', 'duracao_minutos', 'preco', 'ativo')


class ProfissionalSerializer(serializers.ModelSerializer):
    nome = serializers.CharField(source='usuario.nome', read_only=True)

    class Meta:
        model = Profissional
        fields = ('id', 'usuario', 'nome', 'servicos', 'intervalo_minutos', 'ativo')