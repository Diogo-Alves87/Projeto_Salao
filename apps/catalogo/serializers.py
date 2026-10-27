from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from apps.agenda.models import HorarioTrabalho

from .models import Profissional, Servico


class ServicoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Servico
        fields = ('id', 'nome', 'descricao', 'duracao_minutos', 'preco', 'ativo')


class HorarioTrabalhoSerializer(serializers.ModelSerializer):
    hora_inicio = serializers.TimeField(format='%H:%M')
    hora_fim = serializers.TimeField(format='%H:%M')

    class Meta:
        model = HorarioTrabalho
        fields = ('dia_semana', 'hora_inicio', 'hora_fim')


class ProfissionalSerializer(serializers.ModelSerializer):
    """
    Cria o profissional promovendo um usuário já existente (cliente, ou profissional
    ainda sem cadastro): o tipo dele passa a ser 'profissional'.
    Na edição, o usuário não pode ser trocado.
    """
    nome = serializers.CharField(source='usuario.nome', read_only=True)
    email = serializers.EmailField(source='usuario.email', read_only=True)
    # Lista completa de horários de trabalho; ao salvar, substitui a anterior
    horarios = HorarioTrabalhoSerializer(many=True, required=False)

    class Meta:
        model = Profissional
        fields = (
            'id', 'usuario', 'nome', 'email', 'servicos', 'intervalo_minutos',
            'comissao_percentual', 'ativo', 'horarios',
        )

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is None:
            # Criação: escolhe entre usuários comuns que ainda não têm cadastro de profissional.
            fields['usuario'] = serializers.PrimaryKeyRelatedField(
                queryset=get_user_model().objects.filter(
                    tipo__in=['cliente', 'profissional'], profissional__isnull=True, is_superuser=False
                ),
                error_messages={
                    'does_not_exist': 'Usuário inválido ou já cadastrado como profissional.',
                    'incorrect_type': 'Usuário inválido.',
                },
            )
        else:
            fields['usuario'] = serializers.PrimaryKeyRelatedField(read_only=True)
        return fields

    def validate_horarios(self, horarios):
        dias = dict(HorarioTrabalho.Dia.choices)
        por_dia = {}
        for h in horarios:
            if h['hora_fim'] <= h['hora_inicio']:
                raise serializers.ValidationError(f"{dias[h['dia_semana']]}: o fim deve ser depois do início.")
            por_dia.setdefault(h['dia_semana'], []).append(h)
        for dia, lista in por_dia.items():
            lista.sort(key=lambda h: h['hora_inicio'])
            for anterior, atual in zip(lista, lista[1:]):
                if atual['hora_inicio'] < anterior['hora_fim']:
                    raise serializers.ValidationError(f'{dias[dia]}: há horários que se sobrepõem.')
        return horarios

    def _salvar_horarios(self, profissional, horarios):
        if horarios is None:
            return
        profissional.horarios.all().delete()
        HorarioTrabalho.objects.bulk_create(HorarioTrabalho(profissional=profissional, **h) for h in horarios)

    @transaction.atomic
    def create(self, validated_data):
        horarios = validated_data.pop('horarios', None)
        servicos = validated_data.pop('servicos', [])
        usuario = validated_data['usuario']
        usuario.tipo = 'profissional'
        usuario.save(update_fields=['tipo'])
        profissional = Profissional.objects.create(**validated_data)
        profissional.servicos.set(servicos)
        self._salvar_horarios(profissional, horarios)
        return profissional

    @transaction.atomic
    def update(self, instance, validated_data):
        horarios = validated_data.pop('horarios', None)
        instance = super().update(instance, validated_data)
        self._salvar_horarios(instance, horarios)
        return instance
