from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Usuario


class RegistroSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = Usuario
        fields = ('id', 'nome', 'email', 'telefone', 'password')

    def create(self, validated_data):
        # O tipo não vem do cliente: todo cadastro público é "cliente".
        return Usuario.objects.create_user(**validated_data)


class UsuarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Usuario
        fields = ('id', 'nome', 'email', 'telefone', 'tipo')
        read_only_fields = fields