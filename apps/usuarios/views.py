from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RegistroSerializer, UsuarioSerializer


class RegistroView(generics.CreateAPIView):
    serializer_class = RegistroSerializer
    permission_classes = [permissions.AllowAny]


class PerfilView(generics.RetrieveAPIView):
    serializer_class = UsuarioSerializer

    def get_object(self):
        return self.request.user


class AlterarSenhaView(APIView):
    """Troca a senha do usuário logado; exige a senha atual."""

    def post(self, request):
        user = request.user
        atual = request.data.get('senha_atual') or ''
        nova = request.data.get('nova_senha') or ''
        if not user.check_password(atual):
            return Response({'senha_atual': ['Senha atual incorreta.']}, status=status.HTTP_400_BAD_REQUEST)
        if nova == atual:
            return Response({'nova_senha': ['A nova senha precisa ser diferente da atual.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(nova, user)
        except DjangoValidationError as e:
            return Response({'nova_senha': list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(nova)
        user.save(update_fields=['password'])
        return Response({'detail': 'Senha alterada com sucesso.'})
