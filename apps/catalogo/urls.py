from rest_framework.routers import DefaultRouter

from .views import ProfissionalViewSet, ServicoViewSet

router = DefaultRouter()
router.register('servicos', ServicoViewSet, basename='servico')
router.register('profissionais', ProfissionalViewSet, basename='profissional')

urlpatterns = router.urls