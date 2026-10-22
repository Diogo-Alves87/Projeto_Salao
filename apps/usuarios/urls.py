from django.urls import path

from .views import PerfilView, RegistroView

urlpatterns = [
    path('registro/', RegistroView.as_view(), name='registro'),
    path('perfil/', PerfilView.as_view(), name='perfil'),
]