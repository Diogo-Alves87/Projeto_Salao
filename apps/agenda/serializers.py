from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Agendamento
from .services import validar_agendamento


class AgendamentoSerializer(serializers.ModelSerializer):
    cliente_nome = serializers.CharField(source='cliente.nome', read_only=True)
    profissional_nome = serializers.CharField(
        source='profissional.usuario.nome', read_only=True
    )
    servico_nome = serializers.CharField(source='servico.nome', read_only=True)

    class Meta:
        model = Agendamento
        fields = (
            'id', 'cliente', 'cliente_nome',
            'profissional', 'profissional_nome',
            'servico', 'servico_nome',
            'inicio', 'fim', 'preco_cobrado', 'status', 'observacoes',
        )
        read_only_fields = ('fim', 'preco_cobrado', 'status')
        extra_kwargs = {'cliente': {'required': False}}

    def validate(self, attrs):
        user = self.context['request'].user

        if user.tipo == 'cliente':
            attrs['cliente'] = user  # cliente só agenda para si mesmo
        elif 'cliente' not in attrs:
            raise serializers.ValidationError({'cliente': 'Informe o cliente.'})

        try:
            validar_agendamento(attrs['profissional'], attrs['servico'], attrs['inicio'])
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.messages)
        return attrs