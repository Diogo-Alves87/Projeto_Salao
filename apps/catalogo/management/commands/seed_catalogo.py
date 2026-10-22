from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.catalogo.models import Servico

# Para adicionar outro serviço, copie um bloco e mude os valores.
SERVICOS = [
    {
        'nome': 'Unha de gel',
        'descricao': 'Unha de gel é feita com gel',
        'duracao_minutos': 60,
        'preco': Decimal('100.00'),
        'ativo': True,
    },
    # {
    #     'nome': 'Manicure',
    #     'descricao': 'Cuidado completo das unhas das mãos',
    #     'duracao_minutos': 45,
    #     'preco': Decimal('35.00'),
    #     'ativo': True,
    # },
]


class Command(BaseCommand):
    help = 'Cria ou atualiza os serviços de exemplo do catálogo.'

    def handle(self, *args, **options):
        for dados in SERVICOS:
            nome = dados['nome']
            defaults = {k: v for k, v in dados.items() if k != 'nome'}
            servico, criado = Servico.objects.update_or_create(
                nome=nome, defaults=defaults
            )
            acao = 'criado' if criado else 'atualizado'
            self.stdout.write(self.style.SUCCESS(f'{servico.nome}: {acao}'))