from django.urls import path

from .views import AlterarSenhaView, PerfilView, RegistroView

urlpatterns = [
    path('registro/', RegistroView.as_view(), name='registro'),
    path('perfil/', PerfilView.as_view(), name='perfil'),
    path('alterar-senha/', AlterarSenhaView.as_view(), name='alterar-senha'),
]
