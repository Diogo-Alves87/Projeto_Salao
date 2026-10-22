from rest_framework.permissions import SAFE_METHODS, BasePermission


class AdminEscreveTodosLeem(BasePermission):
    """Autenticado pode ler; só o tipo 'admin' pode criar, editar e apagar."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.tipo == 'admin'