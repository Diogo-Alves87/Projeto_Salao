# Projeto Salão

Sistema web de agendamento para salões de beleza. Clientes marcam horários com o profissional e o serviço que preferirem; profissionais acompanham a própria agenda; o administrador gerencia serviços, equipe, comissões e acompanha os resultados em gráficos.

Backend em **Django + Django REST Framework** com autenticação **JWT**, e frontend em **HTML, CSS e JavaScript puro** (sem framework e sem etapa de build), servido pelo próprio Django.

> Projeto em desenvolvimento.

---

## Funcionalidades

### Cliente
- Cadastro com nome, e-mail, telefone e **CPF** (validado); o **endereço é opcional** e é preenchido automaticamente a partir do CEP (ViaCEP).
- Agendamento em poucos passos: escolhe o profissional, o serviço e um dos **horários livres** do dia.
- Lista dos próprios agendamentos, com cancelamento (até 4 horas antes do horário).
- Perfil com troca de senha.
- Integração opcional com o **Google Agenda** (ver [Integração com o Google](#integração-com-o-google)).

### Profissional
- Vê os atendimentos marcados com ele.
- Os atendimentos podem ser marcados como **concluídos** ou com **falta** do cliente (pela API ou pelo painel do Django), o que alimenta o cálculo de comissão.

### Administrador
- **Serviços:** cadastro de nome, descrição, duração e preço; ativa ou desativa serviços.
- **Profissionais:**
  - promove um usuário já cadastrado a profissional;
  - define os serviços que ele realiza, os **dias e horários de trabalho** (vários períodos por dia, por exemplo manhã e tarde) e o intervalo entre horários;
  - define a **porcentagem de comissão**;
  - remove o profissional (a conta volta a ser de cliente).
- **Gráficos**, com filtro por **período** (mini calendário de/até) e por **profissional**:
  - **Total a receber:** comissão de cada profissional sobre os atendimentos concluídos no período;
  - pizza de **serviços** realizados;
  - colunas de **ticket médio** e **renda por dia**, separadas por serviço e com legenda.
- Painel administrativo completo do Django em `/admin/` (folgas, bloqueios de agenda, ajustes manuais).

### Regras de agenda
- Os horários livres respeitam o expediente do profissional, a duração do serviço, os bloqueios e os agendamentos já existentes.
- O preço é "congelado" no momento do agendamento: mudar o preço do serviço depois não altera agendamentos antigos.
- Agendamentos cancelados ou com falta não entram nos gráficos nem na comissão.

---

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Backend | Python 3.12+, Django 6.1, Django REST Framework, Simple JWT |
| Banco de dados | SQLite (padrão do Django; pode ser trocado por PostgreSQL) |
| Frontend | HTML, CSS e JavaScript puro; gráficos desenhados em SVG, sem bibliotecas |
| Integrações | ViaCEP (endereço pelo CEP) e Google Agenda via OAuth 2.0 (opcional) |

---

## Como rodar localmente

Pré-requisito: **Python 3.12 ou superior**.

```bash
# 1. Clone o repositório
git clone https://github.com/Diogo-Alves87/Projeto_Salao.git
cd Projeto_Salao

# 2. Crie e ative um ambiente virtual
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux / macOS

# 3. Instale as dependências
pip install -r requirements.txt

# 4. Crie o banco de dados
python manage.py migrate

# 5. Crie um usuário administrador
python manage.py createsuperuser

# 6. Inicie o servidor
python manage.py runserver
```

Acesse **http://localhost:8000**. Entre com o administrador criado no passo 5 para cadastrar serviços e profissionais; o painel do Django fica em **http://localhost:8000/admin/**.

### Primeiros passos no sistema
1. Como administrador, cadastre os **serviços** (menu *Serviços*).
2. Crie uma conta comum pelo site (aba *Criar conta*) e, como administrador, promova-a em *Profissionais → + Novo profissional*, marcando os serviços e os **dias de trabalho**.
3. Com outra conta de cliente, faça um agendamento.

> Um profissional sem dias de trabalho cadastrados não aparece com horários disponíveis.

---

## Integração com o Google

A integração com o Google Agenda (OAuth 2.0) já está pronta, mas vem **desligada**: sem as chaves, o site funciona normalmente e a tela *Perfil → Integrações* mostra "Em breve".

Para ativar, preencha as chaves em [`config/google_services.py`](config/google_services.py). O próprio arquivo explica, passo a passo, como gerar as credenciais no Google Cloud Console. O recomendado é defini-las como variáveis de ambiente, em vez de escrevê-las no arquivo:

| Variável | O que é |
|---|---|
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | Chave secreta do cliente OAuth |
| `GOOGLE_REDIRECT_URI` | Endereço de retorno (padrão: `http://localhost:8000/api/agenda/google/callback/`) |

Com as chaves configuradas, cada usuário pode conectar a própria conta Google; os agendamentos passam a aparecer no Google Agenda do cliente e do profissional e são removidos quando cancelados.

> **Nunca faça commit das chaves.** Se uma chave secreta for publicada por engano, gere outra no Google Cloud Console.

---

## Estrutura do projeto

```
Projeto_Salao/
├── apps/
│   ├── usuarios/     # usuário customizado (login por e-mail), cadastro, perfil, troca de senha
│   ├── catalogo/     # serviços e profissionais (dias de trabalho, comissão)
│   └── agenda/       # agendamentos, horários livres, gráficos e integração com o Google Agenda
├── config/
│   ├── settings.py
│   ├── urls.py
│   └── google_services.py   # chaves e chamadas da integração com o Google
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js     # aplicação de página única que consome a API
├── manage.py
└── requirements.txt
```

---

## API

Todas as rotas exigem o cabeçalho `Authorization: Bearer <token>`, exceto cadastro, login e renovação do token.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/registro/` | Cria uma conta de cliente |
| POST | `/api/auth/login/` | Login (devolve `access` e `refresh`) |
| POST | `/api/auth/refresh/` | Renova o token de acesso |
| GET | `/api/auth/perfil/` | Dados do usuário logado |
| POST | `/api/auth/alterar-senha/` | Troca a senha (exige a senha atual) |
| GET/POST | `/api/catalogo/servicos/` | Lista / cria serviços (criar: só admin) |
| GET/POST | `/api/catalogo/profissionais/` | Lista / promove profissionais (criar: só admin) |
| PATCH/DELETE | `/api/catalogo/profissionais/{id}/` | Edita / remove um profissional (só admin) |
| GET | `/api/agenda/disponibilidade/?profissional=&servico=&data=` | Horários livres de um dia |
| GET/POST | `/api/agenda/agendamentos/` | Lista / cria agendamentos |
| POST | `/api/agenda/agendamentos/{id}/cancelar/` | Cancela um agendamento |
| POST | `/api/agenda/agendamentos/{id}/concluir/` | Marca como concluído (profissional/admin) |
| POST | `/api/agenda/agendamentos/{id}/faltou/` | Registra falta (profissional/admin) |
| GET | `/api/agenda/graficos/profissionais/?inicio=&fim=` | Dados dos gráficos e comissões (só admin) |
| GET/DELETE | `/api/agenda/google/` | Situação / remoção da integração com o Google |
| GET | `/api/agenda/google/conectar/` | Endereço de autorização do Google |

---

## Antes de colocar em produção

Sem nenhuma configuração, o projeto roda em modo de **desenvolvimento**. Para publicar, defina estas variáveis de ambiente no servidor:

| Variável | Valor em produção |
|---|---|
| `DJANGO_DEBUG` | `0` |
| `DJANGO_SECRET_KEY` | uma chave nova e secreta (veja abaixo como gerar) |
| `DJANGO_ALLOWED_HOSTS` | domínios do site, separados por vírgula (ex.: `meusalao.com,www.meusalao.com`) |

Para gerar uma chave:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Com `DJANGO_DEBUG=0` o site **não inicia** sem `DJANGO_SECRET_KEY`, para evitar publicar com a chave de desenvolvimento. Além disso:

- Rode `python manage.py collectstatic` e sirva as pastas `staticfiles/` e `media/` (fotos de perfil) pelo servidor web.
- Troque o SQLite por um banco de produção (por exemplo, PostgreSQL).
- Rode `python manage.py check --deploy` e siga as recomendações de segurança.
- Configure as chaves do Google por variáveis de ambiente e atualize `GOOGLE_REDIRECT_URI` para o domínio real.
- Sirva o site com HTTPS.

---

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
