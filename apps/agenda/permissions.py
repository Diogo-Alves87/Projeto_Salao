from rest_framework.permissions import BasePermission


class PodeAgendar(BasePermission):
    """Logado vê a própria agenda; só cliente e admin criam agendamentos."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if view.action == 'create':
            return user.tipo in ('cliente', 'admin')
        return True