from django.shortcuts import render

from rest_framework import generics, permissions

from .serializers import RegistroSerializer, UsuarioSerializer


class RegistroView(generics.CreateAPIView):
    serializer_class = RegistroSerializer
    permission_classes = [permissions.AllowAny]


class PerfilView(generics.RetrieveAPIView):
    serializer_class = UsuarioSerializer

    def get_object(self):
        return self.request.user