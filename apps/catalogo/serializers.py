from rest_framework import serializers

from apps.agenda.models import HorarioTrabalho

from .models import Profissional, Servico
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

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
    # Lista completa de horários de trabalho; ao salvar, substitui a anterior
    horarios = HorarioTrabalhoSerializer(many=True, required=False)
    # Ao criar: id de um usuário existente (cliente) que passa a ser profissional
    usuario = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.exclude(tipo='admin'), required=False
    )
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
            'id', 'usuario', 'nome', 'email', 'servicos', 'intervalo_minutos', 'comissao_percentual', 'ativo', 'horarios',
            'novo_nome', 'novo_email', 'novo_telefone', 'senha',
        )

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
    def update(self, instance, validated_data):
        horarios = validated_data.pop('horarios', None)
        instance = super().update(instance, validated_data)
        self._salvar_horarios(instance, horarios)
        return instance

    def validate(self, attrs):
        if self.instance is not None:
            attrs.pop('usuario', None)  # o usuário vinculado não muda na edição
            return attrs
        usuario = attrs.get('usuario')
        if usuario is not None:
            if usuario.is_superuser or Profissional.objects.filter(usuario=usuario).exists():
                raise serializers.ValidationError({'usuario': 'Este usuário não pode ser promovido a profissional.'})
            return attrs
        # Sem 'usuario': cria um usuário novo já como profissional
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
        horarios = validated_data.pop('horarios', None)
        servicos = validated_data.pop('servicos', [])
        usuario = validated_data.pop('usuario', None)
        if usuario is not None:
            usuario.tipo = 'profissional'
            usuario.save(update_fields=['tipo'])
        else:
            usuario = get_user_model().objects.create_user(
                email=validated_data.pop('novo_email'),
                password=validated_data.pop('senha'),
                nome=validated_data.pop('novo_nome'),
                telefone=validated_data.pop('novo_telefone', ''),
                tipo='profissional',
            )
        profissional = Profissional.objects.create(usuario=usuario, **validated_data)
        profissional.servicos.set(servicos)
        self._salvar_horarios(profissional, horarios)
        return profissional
