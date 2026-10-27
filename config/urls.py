from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from django.urls import include, path
from django.views.generic import TemplateView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='login'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/', include('apps.usuarios.urls')),
    path('api/catalogo/', include('apps.catalogo.urls')),
    path('api/agenda/', include('apps.agenda.urls')),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
]