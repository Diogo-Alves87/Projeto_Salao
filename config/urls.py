from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='login'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/', include('apps.usuarios.urls')),
    path('api/catalogo/', include('apps.catalogo.urls')),
    path('api/agenda/', include('apps.agenda.urls')),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
]

# Em desenvolvimento o próprio Django serve as fotos de perfil enviadas
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
