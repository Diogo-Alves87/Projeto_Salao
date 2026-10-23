(function () {
  'use strict';

  /* ------------------------------------------------------------
     Estado
  ------------------------------------------------------------ */
  var state = {
    access: load('access'),
    refresh: load('refresh'),
    user: null,
    view: 'home',
    servicos: [],
    profissionais: [],
    horarios: null,
    carregandoHorarios: false,
    authTab: 'login',
    sel: { servico: null, profissional: null, data: '', hora: '' },
    confirmado: null,
  };

  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var summarySlot = document.getElementById('summary-slot');
  var toastEl = document.getElementById('toast');

  /* ------------------------------------------------------------
     Utilidades
  ------------------------------------------------------------ */
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function brl(v) {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function lista(d) { return Array.isArray(d) ? d : (d && d.results) || []; }

  function hojeISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function fmtQuando(iso) {
    return new Date(iso).toLocaleString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  }

  function fmtDataCurta(iso) {
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function iniciais(nome) {
    return String(nome || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p[0]; }).join('').toUpperCase();
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  var CAMPOS = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', password: 'Senha', inicio: 'Horário', servico: 'Serviço', profissional: 'Profissional', cliente: 'Cliente', descricao: 'Descrição', duracao_minutos: 'Duração', preco: 'Preço', servicos: 'Serviços', intervalo_minutos: 'Intervalo', usuario: 'Usuário' };

  function mensagemErro(data) {
    if (!data) return 'Algo deu errado. Tente novamente.';
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data.map(mensagemErro).join(' ');
    if (data.detail) return data.detail;
    var partes = [];
    Object.keys(data).forEach(function (k) {
      var t = mensagemErro(data[k]);
      partes.push(k === 'non_field_errors' ? t : (CAMPOS[k] || k) + ': ' + t);
    });
    return partes.join(' ');
  }

  /* ------------------------------------------------------------
     API
  ------------------------------------------------------------ */
  function ApiError(status, data) {
    this.status = status;
    this.data = data;
    this.message = mensagemErro(data);
  }

  function renovarToken() {
    if (!state.refresh) return Promise.resolve(false);
    return fetch('/api/auth/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: state.refresh }),
    }).then(function (r) {
      if (!r.ok) return false;
      return r.json().then(function (d) {
        state.access = d.access;
        save('access', d.access);
        if (d.refresh) { state.refresh = d.refresh; save('refresh', d.refresh); }
        return true;
      });
    }).catch(function () { return false; });
  }

  function api(path, opts) {
    opts = opts || {};
    var auth = opts.auth !== false;
    var headers = { 'Content-Type': 'application/json' };
    if (auth && state.access) headers.Authorization = 'Bearer ' + state.access;

    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      if (res.status === 401 && auth && !opts.jaTentou) {
        return renovarToken().then(function (ok) {
          if (ok) return api(path, Object.assign({}, opts, { jaTentou: true }));
          sair(true);
          throw new ApiError(401, { detail: 'Sua sessão expirou. Entre novamente.' });
        });
      }
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new ApiError(res.status, data);
        return data;
      });
    }, function () {
      throw new ApiError(0, { detail: 'Não foi possível conectar ao servidor.' });
    });
  }

  /* ------------------------------------------------------------
     Autenticação
  ------------------------------------------------------------ */
  function entrar(email, password) {
    return api('/api/auth/login/', { method: 'POST', auth: false, body: { email: email, password: password } })
      .then(function (d) {
        state.access = d.access;
        state.refresh = d.refresh;
        save('access', d.access);
        save('refresh', d.refresh);
        return carregarPerfil();
      }, function (e) {
        if (e.status === 401) throw new ApiError(401, { detail: 'E-mail ou senha incorretos.' });
        throw e;
      });
  }

  function carregarPerfil() {
    return api('/api/auth/perfil/').then(function (u) {
      state.user = u;
      state.view = 'agendar';
      render();
    });
  }

  function sair(silencioso) {
    state.access = state.refresh = null;
    state.user = null;
    state.view = 'home';
    state.confirmado = null;
    resetSelecao();
    save('access', null);
    save('refresh', null);
    render();
    if (!silencioso) toast('Você saiu da sua conta.');
  }

  function resetSelecao() {
    state.sel = { servico: null, profissional: null, data: '', hora: '' };
    state.horarios = null;
  }

  /* ------------------------------------------------------------
     Navegação e renderização
  ------------------------------------------------------------ */
  function irPara(view) {
    state.view = view;
    if (view === 'agendar' || view === 'novo') state.confirmado = null;
    if (view === 'novo') resetSelecao();
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Menu lateral ---------- */
  var ICO = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 10h14v10H5V10z"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm-8.5 9.2L12 15.5l8.5-4.3L22 12l-10 5-10-5 1.5-.8zm0 4L12 19.5l8.5-4.3L22 16l-10 5-10-5 1.5-.8z"/></svg>',
    exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5v-2H6V6h4V4zm6.6 4.6L15.2 10l1 1H9v2h7.2l-1 1 1.4 1.4L20 12l-3.4-3.4z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3 4a1 1 0 0 1 1-1h7l10 10-8 8L3 11V4zm4.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v2h14v-2c0-2.3-3.7-4-7-4zm7-2a3 3 0 1 0-1-5.8 5 5 0 0 1 0 5.6c.3.1.6.2 1 .2zm.5 2.1c1.9.6 3.5 1.8 3.5 3.9v2h4v-2c0-1.9-3.1-3.4-7.5-3.9z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.8.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.8L22 10.3v3.4l-2.6.5-.8 1.8 1.5 2.2-2.4 2.4-2.2-1.5-1.8.8-.5 2.6h-3.4l-.5-2.6-1.8-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.8L2 13.7v-3.4l2.6-.5.8-1.8-1.5-2.2 2.4-2.4 2.2 1.5 1.8-.8L10.3 2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>'
  };

  var TITULOS = { agendar: 'Início', novo: 'Início', meus: 'Agendamentos', planos: 'Planos', servicos: 'Serviços', profissionais: 'Profissionais' };

  function itensMenu() {
    var t = state.user.tipo;
    if (t === 'admin') return [
      ['meus', 'Agendamentos', ICO.cal],
      ['servicos', 'Serviços', ICO.tag],
      ['profissionais', 'Profissionais', ICO.users],
      ['admin', 'Painel completo', ICO.gear],
    ];
    if (t === 'profissional') return [['meus', 'Agendamentos', ICO.cal]];
    return [['agendar', 'Início', ICO.home], ['meus', 'Agendamentos', ICO.cal], ['planos', 'Planos', ICO.layers]];
  }

  function renderNav() {
    var inner = document.querySelector('.nav-inner');
    if (!state.user) { inner.innerHTML = '<span class="brand">Salão</span>'; return; }
    inner.innerHTML = '<div class="nav-left"><button class="burger" data-action="menu" aria-label="Menu">' + ICO.menu +
      '</button><span class="brand">' + esc(TITULOS[state.view] || 'Início') + '</span></div>';
  }

  function abrirMenu() {
    var el = document.getElementById('drawer');
    if (!el) { el = document.createElement('div'); el.id = 'drawer'; document.body.appendChild(el); }
    var h = itensMenu().map(function (it) {
      if (it[0] === 'admin') return '<a class="menu-item" href="/admin/">' + it[2] + '<span>' + it[1] + '</span></a>';
      var ativo = state.view === it[0] || (it[0] === 'agendar' && state.view === 'novo');
      return '<button class="menu-item ' + (ativo ? 'active' : '') + '" data-go="' + it[0] + '">' + it[2] + '<span>' + it[1] + '</span></button>';
    }).join('');
    h += '<button class="menu-item" data-action="sair">' + ICO.exit + '<span>Sair</span></button>';
    el.innerHTML = '<button class="drawer-back" data-action="fechar-menu" aria-label="Fechar menu"></button>' +
      '<aside class="drawer-panel"><div class="drawer-user"><strong>' + esc(state.user.nome) + '</strong><small>' + esc(state.user.email) + '</small></div>' + h + '</aside>';
    document.body.classList.add('noscroll');
  }

  function fecharMenu() {
    var el = document.getElementById('drawer');
    if (el) { el.innerHTML = ''; document.body.classList.remove('noscroll'); }
  }

  /* ---------- Folha genérica ---------- */
  function folha(titulo, corpo) {
    sheetEl().innerHTML =
      '<button class="sheet-back" data-action="fechar" aria-label="Fechar"></button>' +
      '<div class="sheet" role="dialog" aria-label="' + esc(titulo) + '">' +
        '<div class="grabber"></div>' +
        '<h3 class="sheet-title">' + esc(titulo) + '</h3>' +
        '<div class="sheet-body">' + corpo + '</div>' +
      '</div>';
    document.body.classList.add('noscroll');
  }

  /* ---------- Planos (em breve) ---------- */
  function renderPlanos() {
    app.innerHTML = '<div class="page-head"><h1 style="font-size:clamp(34px,6vw,52px)">Planos</h1><p>Em breve por aqui.</p></div>' +
      '<div class="empty">Os planos estarão disponíveis em breve.</div>';
  }

  /* ---------- Admin: serviços e profissionais ---------- */
  function cabecalhoAdmin(titulo, acao, rotulo) {
    return '<div class="page-head row-head"><h1 style="font-size:clamp(34px,6vw,52px)">' + titulo + '</h1>' +
      '<button class="btn small" data-action="' + acao + '">' + rotulo + '</button></div>';
  }

  function campo(nome, rotulo, valor, tipo, extra) {
    return '<div class="field"><label>' + rotulo + '</label><input name="' + nome + '" type="' + tipo + '" value="' + esc(valor) + '" ' + (extra || '') + '></div>';
  }

  function erroAdmin(e) {
    app.innerHTML = '<div class="page-head"><h1>Ops</h1></div><div class="alert">' + esc(e.message) + '</div>';
  }

  function enviarForm(form, url, metodo, corpo, depois) {
    var btn = form.querySelector('button[type=submit]');
    var erro = document.getElementById('form-erro');
    erro.innerHTML = '';
    btn.disabled = true;
    api(url, { method: metodo, body: corpo }).then(function () {
      state.servicos = [];
      state.profissionais = [];
      fecharSheet();
      toast('Salvo com sucesso.');
      depois();
    }, function (e) {
      erro.innerHTML = '<div class="alert">' + esc(e.message) + '</div>';
      btn.disabled = false;
    });
  }

  function renderServicos() {
    app.innerHTML = cabecalhoAdmin('Serviços', 'novo-servico', '+ Novo serviço') + '<div class="loading">Carregando…</div>';
    api('/api/catalogo/servicos/').then(function (d) {
      state.admServicos = lista(d);
      app.innerHTML = cabecalhoAdmin('Serviços', 'novo-servico', '+ Novo serviço') +
        (state.admServicos.length ? '<div class="list">' + state.admServicos.map(function (x) {
          return '<article class="appt"><div><div class="what">' + esc(x.nome) + '</div>' +
            '<div class="who">' + esc(x.duracao_minutos) + ' min · ' + brl(x.preco) + '</div></div>' +
            '<div class="appt-side"><span class="badge ' + (x.ativo ? 'confirmado' : 'cancelado') + '">' + (x.ativo ? 'Ativo' : 'Inativo') + '</span>' +
            '<button class="btn ghost small" data-action="editar-servico" data-id="' + x.id + '">Editar</button></div></article>';
        }).join('') + '</div>' : '<div class="empty">Nenhum serviço cadastrado.</div>');
    }, erroAdmin);
  }

  function formServico(x) {
    x = x || { ativo: true };
    return '<form id="form-servico" data-id="' + (x.id || '') + '" novalidate><div id="form-erro"></div>' +
      campo('nome', 'Nome', x.nome, 'text') +
      campo('descricao', 'Descrição', x.descricao, 'text') +
      campo('duracao_minutos', 'Duração (minutos)', x.duracao_minutos, 'number', 'min="5"') +
      campo('preco', 'Preço (R$)', x.preco, 'number', 'min="0" step="0.01"') +
      '<div class="field"><label class="check-row"><input type="checkbox" name="ativo"' + (x.ativo ? ' checked' : '') + '> Ativo (aparece para os clientes)</label></div>' +
      '<button class="btn block" type="submit">Salvar</button></form>';
  }

  function salvarServico(form) {
    var d = new FormData(form);
    var id = form.dataset.id;
    enviarForm(form,
      '/api/catalogo/servicos/' + (id ? id + '/' : ''),
      id ? 'PATCH' : 'POST',
      {
        nome: String(d.get('nome')).trim(),
        descricao: String(d.get('descricao')).trim(),
        duracao_minutos: Number(d.get('duracao_minutos')),
        preco: String(d.get('preco')).replace(',', '.'),
        ativo: form.elements.ativo.checked,
      },
      renderServicos);
  }

  function renderProfissionais() {
    app.innerHTML = cabecalhoAdmin('Profissionais', 'novo-prof', '+ Novo profissional') + '<div class="loading">Carregando…</div>';
    Promise.all([api('/api/catalogo/profissionais/'), api('/api/catalogo/servicos/')]).then(function (r) {
      state.admProfs = lista(r[0]);
      state.admServicos = lista(r[1]);
      app.innerHTML = cabecalhoAdmin('Profissionais', 'novo-prof', '+ Novo profissional') +
        (state.admProfs.length ? '<div class="list">' + state.admProfs.map(function (p) {
          return '<article class="appt"><div><div class="what">' + esc(p.nome) + '</div>' +
            '<div class="who">' + p.servicos.length + ' serviço(s) · horários de ' + esc(p.intervalo_minutos) + ' em ' + esc(p.intervalo_minutos) + ' min</div></div>' +
            '<div class="appt-side"><span class="badge ' + (p.ativo ? 'confirmado' : 'cancelado') + '">' + (p.ativo ? 'Ativo' : 'Inativo') + '</span>' +
            '<button class="btn ghost small" data-action="editar-prof" data-id="' + p.id + '">Editar</button></div></article>';
        }).join('') + '</div>' : '<div class="empty">Nenhum profissional cadastrado.</div>') +
        '<p class="hint">Dias e horários de trabalho, e novos usuários, ficam no <a class="link" href="/admin/">painel completo</a>.</p>';
    }, erroAdmin);
  }

  function formProf(p, usuarios) {
    var sel = usuarios ? '<div class="field"><label>Usuário</label><select name="usuario">' + usuarios.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.nome) + ' (' + esc(u.email) + ')</option>';
    }).join('') + '</select></div>' : '';
    var checks = (state.admServicos || []).map(function (x) {
      return '<label class="check-row"><input type="checkbox" name="servicos" value="' + x.id + '"' +
        (p && p.servicos.indexOf(x.id) !== -1 ? ' checked' : '') + '> ' + esc(x.nome) + '</label>';
    }).join('');
    return '<form id="form-prof" data-id="' + (p ? p.id : '') + '" novalidate><div id="form-erro"></div>' + sel +
      '<div class="field"><label>Serviços que realiza</label><div class="checks">' + (checks || '<p class="hint">Cadastre serviços primeiro.</p>') + '</div></div>' +
      campo('intervalo_minutos', 'Intervalo entre horários (minutos)', p ? p.intervalo_minutos : 15, 'number', 'min="5" max="120"') +
      '<div class="field"><label class="check-row"><input type="checkbox" name="ativo"' + (!p || p.ativo ? ' checked' : '') + '> Ativo</label></div>' +
      '<button class="btn block" type="submit">Salvar</button></form>';
  }

  function abrirProf(id) {
    if (id) {
      var p = state.admProfs.filter(function (x) { return x.id === id; })[0];
      return folha('Editar ' + p.nome, formProf(p, null));
    }
    api('/api/catalogo/profissionais/usuarios-disponiveis/').then(function (us) {
      if (!us.length) { toast('Não há usuários do tipo Profissional sem cadastro. Crie um no painel completo.'); return; }
      folha('Novo profissional', formProf(null, us));
    }, function (e) { toast(e.message); });
  }

  function salvarProf(form) {
    var d = new FormData(form);
    var id = form.dataset.id;
    var corpo = {
      servicos: d.getAll('servicos').map(Number),
      intervalo_minutos: Number(d.get('intervalo_minutos')),
      ativo: form.elements.ativo.checked,
    };
    if (!id) corpo.usuario = Number(d.get('usuario'));
    enviarForm(form, '/api/catalogo/profissionais/' + (id ? id + '/' : ''), id ? 'PATCH' : 'POST', corpo, renderProfissionais);
  }

  function render() {
    fecharSheet();
    fecharMenu();
    renderNav();
    summarySlot.innerHTML = '';

    if (!state.user) return renderHome();
    var tipo = state.user.tipo;
    if (state.view === 'planos') return renderPlanos();
    if (tipo === 'admin' && state.view === 'servicos') return renderServicos();
    if (tipo === 'admin' && state.view === 'profissionais') return renderProfissionais();
    if (state.view === 'meus') return renderMeus();
    if (tipo !== 'cliente') { state.view = 'meus'; return renderMeus(); }
    if (state.confirmado) return renderSucesso();
    if (state.view === 'novo') return renderNovo();
    return renderAgendar();
  }

  /* ---------- Home / login ---------- */
  function renderHome() {
    var login = state.authTab === 'login';
    app.innerHTML =
      '<section class="hero">' +
        '<p class="eyebrow">Salão</p>' +
        '<h1>Seu momento,<br>no horário certo.</h1>' +
        '<p class="lead">Escolha o serviço, a profissional e o melhor horário. Simples assim.</p>' +
        '<div class="auth-card">' +
          '<div class="tabs">' +
            '<button data-tab="login" class="' + (login ? 'active' : '') + '">Entrar</button>' +
            '<button data-tab="registro" class="' + (!login ? 'active' : '') + '">Criar conta</button>' +
          '</div>' +
          '<div id="auth-erro"></div>' +
          '<form id="auth-form" novalidate>' +
            (login ? '' :
              '<div class="field"><label for="f-nome">Nome</label><input id="f-nome" name="nome" autocomplete="name" required></div>' +
              '<div class="field"><label for="f-tel">Telefone</label><input id="f-tel" name="telefone" type="tel" autocomplete="tel" placeholder="(11) 90000-0000"></div>') +
            '<div class="field"><label for="f-email">E-mail</label><input id="f-email" name="email" type="email" autocomplete="email" required></div>' +
            '<div class="field"><label for="f-senha">Senha</label><input id="f-senha" name="password" type="password" autocomplete="' + (login ? 'current-password' : 'new-password') + '" required></div>' +
            '<button class="btn block" type="submit">' + (login ? 'Entrar' : 'Criar conta') + '</button>' +
          '</form>' +
        '</div>' +
      '</section>';
  }

  function submeterAuth(form) {
    var d = {};
    new FormData(form).forEach(function (v, k) { d[k] = String(v).trim(); });
    var erro = document.getElementById('auth-erro');
    var btn = form.querySelector('button[type=submit]');
    erro.innerHTML = '';

    if (!d.email || !d.password || (state.authTab === 'registro' && !d.nome)) {
      erro.innerHTML = '<div class="alert">Preencha todos os campos obrigatórios.</div>';
      return;
    }

    btn.disabled = true;
    var fluxo;
    if (state.authTab === 'registro') {
      fluxo = api('/api/auth/registro/', { method: 'POST', auth: false, body: d })
        .then(function () { return entrar(d.email, d.password); })
        .then(function () { toast('Conta criada. Bem-vindo(a)!'); });
    } else {
      fluxo = entrar(d.email, d.password);
    }
    fluxo.catch(function (e) {
      erro.innerHTML = '<div class="alert">' + esc(e.message) + '</div>';
      btn.disabled = false;
    });
  }

  /* ---------- Agendar (tela com botão) ---------- */
  var ICON = {
    user: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>',
    cal: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 10h14v10H5V10z"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>'
  };

  function renderAgendar() {
    app.innerHTML =
      '<section class="start"><button class="btn big" data-go="novo">+ Novo agendamento</button></section>';
  }

  function acharProf(id) {
    return state.profissionais.filter(function (p) { return p.id === id; })[0];
  }
  function acharServ(id) {
    return state.servicos.filter(function (x) { return x.id === id; })[0];
  }
  function servicosDoProf(prof) {
    return prof ? state.servicos.filter(function (x) { return prof.servicos.indexOf(x.id) !== -1; }) : [];
  }

  function carregarCatalogo() {
    if (state.servicos.length && state.profissionais.length) return Promise.resolve();
    return Promise.all([
      api('/api/catalogo/servicos/'),
      api('/api/catalogo/profissionais/'),
    ]).then(function (r) {
      state.servicos = lista(r[0]).filter(function (s) { return s.ativo; });
      state.profissionais = lista(r[1]).filter(function (p) { return p.ativo; });
    });
  }

  /* ---------- Novo agendamento ---------- */
  function barraTopo() {
    return '<div class="head-bar"><button class="back" data-go="agendar" aria-label="Voltar">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/></svg>' +
      '</button><h1 class="bar-title">Novo agendamento</h1></div>';
  }

  function renderNovo() {
    app.innerHTML = barraTopo() + '<div class="loading">Carregando…</div>';
    carregarCatalogo().then(desenharNovo, function (e) {
      app.innerHTML = barraTopo() + '<div class="alert">' + esc(e.message) + '</div>';
    });
  }

  function linha(chave, icone, rotulo, vazio, valor, bloqueado) {
    return '<button class="row ' + (valor ? 'filled' : '') + '" data-sheet="' + chave + '"' + (bloqueado ? ' disabled' : '') + '>' +
      icone +
      '<span class="row-text">' +
        (valor ? '<small>' + rotulo + '</small><strong>' + esc(valor) + '</strong>' : esc(vazio)) +
      '</span>' + ICON.chev + '</button>';
  }

  function desenharNovo() {
    var s = state.sel;
    var prof = acharProf(s.profissional);
    var serv = acharServ(s.servico);
    var completo = !!(prof && serv && s.data && s.hora);

    app.innerHTML =
      barraTopo() +
      '<p class="subtle">Selecione os detalhes do seu agendamento</p>' +
      '<div class="rows">' +
        linha('profissional', ICON.user, 'Profissional', 'Selecione um profissional', prof ? prof.nome : '', false) +
        linha('servico', ICON.plus, 'Serviço', 'Selecione o serviço', serv ? serv.nome + ' · ' + brl(serv.preco) : '', !prof) +
        linha('horario', ICON.cal, 'Horário', 'Selecione um horário', s.hora ? fmtDataCurta(s.data) + ' às ' + s.hora : '', !serv) +
      '</div>' +
      '<div class="bottom-bar"><div class="bottom-inner">' +
        '<button class="btn block" data-action="confirmar"' + (completo ? '' : ' disabled') + '>Agendar</button>' +
      '</div></div>';
  }

  /* ---------- Folha de seleção ---------- */
  function sheetEl() {
    var el = document.getElementById('sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sheet';
      document.body.appendChild(el);
    }
    return el;
  }

  function fecharSheet() {
    var el = document.getElementById('sheet');
    if (el) el.innerHTML = '';
    document.body.classList.remove('noscroll');
  }

  function abrirSheet(tipo) {
    var s = state.sel;
    var titulo;
    var corpo = '';

    if (tipo === 'profissional') {
      titulo = 'Selecione um profissional';
      var profs = state.profissionais.filter(function (p) { return p.servicos.length; });
      corpo = profs.length ? profs.map(function (p) {
        return '<button class="opt ' + (p.id === s.profissional ? 'selected' : '') + '" data-prof="' + p.id + '">' +
          '<span class="avatar sm">' + esc(iniciais(p.nome)) + '</span>' +
          '<span class="opt-text"><strong>' + esc(p.nome) + '</strong></span>' +
          '<span class="radio"></span></button>';
      }).join('') : '<p class="hint">Nenhum profissional disponível no momento.</p>';
    } else if (tipo === 'servico') {
      titulo = 'Selecione o serviço';
      var servs = servicosDoProf(acharProf(s.profissional));
      corpo = servs.length ? servs.map(function (x) {
        return '<button class="opt ' + (x.id === s.servico ? 'selected' : '') + '" data-servico="' + x.id + '">' +
          '<span class="opt-text"><strong>' + esc(x.nome) + '</strong>' +
          '<small>' + esc(x.duracao_minutos) + ' min · ' + brl(x.preco) + '</small></span>' +
          '<span class="radio"></span></button>';
      }).join('') : '<p class="hint">Este profissional ainda não tem serviços cadastrados.</p>';
    } else {
      titulo = 'Selecione data e hora';
      corpo = '<div id="horarios"></div>';
    }

    sheetEl().innerHTML =
      '<button class="sheet-back" data-action="fechar" aria-label="Fechar"></button>' +
      '<div class="sheet" role="dialog" aria-label="' + esc(titulo) + '">' +
        '<div class="grabber"></div>' +
        '<h3 class="sheet-title">' + esc(titulo) + '</h3>' +
        '<div class="sheet-body">' + corpo + '</div>' +
      '</div>';
    document.body.classList.add('noscroll');

    if (tipo === 'horario') {
      var chave = s.profissional + '|' + s.servico;
      if (state.diasChave !== chave) { s.data = ''; s.hora = ''; carregarDias(); }
      else desenharDias();
    }
  }

  function escolherProf(id) {
    var s = state.sel;
    if (s.profissional !== id) {
      s.profissional = id;
      var prof = acharProf(id);
      if (s.servico && prof.servicos.indexOf(s.servico) === -1) s.servico = null;
      s.hora = '';
      state.horarios = null;
    }
    fecharSheet();
    desenharNovo();
  }

  function escolherServ(id) {
    var s = state.sel;
    if (s.servico !== id) {
      s.servico = id;
      s.hora = '';
      state.horarios = null;
    }
    fecharSheet();
    desenharNovo();
  }

  function proximosDias(n) {
    var out = [];
    var hoje = new Date();
    for (var i = 0; i < n; i++) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      out.push({
        iso: iso,
        sem: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
        num: d.getDate(),
        horarios: null,
      });
    }
    return out;
  }

  function fmtDiaMes(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }

  function desenharDias() {
    var box = document.getElementById('horarios');
    if (!box) return;
    var s = state.sel;
    if (!state.dias) { box.innerHTML = '<p class="hint center">Buscando datas…</p>'; return; }

    var tira = '<div class="days">' + state.dias.map(function (d) {
      var indisponivel = d.horarios == null || !d.horarios.length;
      return '<button class="day ' + (d.iso === s.data ? 'selected' : '') + '" data-dia="' + d.iso + '"' + (indisponivel ? ' disabled' : '') + '>' +
        '<small>' + esc(d.sem) + '</small><span class="num">' + d.num + '</span></button>';
    }).join('') + '</div>';

    var resto = '';
    var carregando = state.dias.some(function (d) { return d.horarios == null; });
    var algum = state.dias.some(function (d) { return d.horarios && d.horarios.length; });
    var dia = s.data ? state.dias.filter(function (d) { return d.iso === s.data; })[0] : null;

    if (dia && dia.horarios && dia.horarios.length) {
      resto = '<div class="sep"></div><p class="slots-title">Horários disponíveis no dia ' + fmtDiaMes(s.data) + '</p>' +
        '<div class="times center">' + dia.horarios.map(function (hr) {
          return '<button class="time ' + (hr === s.hora ? 'selected' : '') + '" data-hora="' + hr + '">' + hr + '</button>';
        }).join('') + '</div>';
    } else if (carregando) {
      resto = '<p class="hint center">Buscando horários…</p>';
    } else if (!algum) {
      resto = '<p class="hint center">Sem horários livres nos próximos dias.</p>';
    } else {
      resto = '<p class="hint center">Escolha um dia para ver os horários livres.</p>';
    }
    box.innerHTML = tira + resto;
  }

  function carregarDias() {
    var s = state.sel;
    var chave = s.profissional + '|' + s.servico;
    state.diasChave = chave;
    state.dias = proximosDias(14);
    desenharDias();

    state.dias.forEach(function (d) {
      var q = '?profissional=' + s.profissional + '&servico=' + s.servico + '&data=' + d.iso;
      api('/api/agenda/disponibilidade/' + q).then(function (r) {
        d.horarios = r.horarios || [];
      }, function () {
        d.horarios = [];
      }).then(function () {
        if (state.diasChave === chave) desenharDias();
      });
    });
  }

  function confirmar(btn) {
    var s = state.sel;
    btn.disabled = true;
    btn.textContent = 'Agendando…';
    api('/api/agenda/agendamentos/', {
      method: 'POST',
      body: { profissional: s.profissional, servico: s.servico, inicio: s.data + 'T' + s.hora + ':00' },
    }).then(function (ag) {
      state.confirmado = ag;
      resetSelecao();
      render();
      window.scrollTo({ top: 0 });
    }, function (e) {
      toast(e.message);
      s.hora = '';
      state.horarios = null;
      state.diasChave = null;
      desenharNovo();
    });
  }

  function renderSucesso() {
    var a = state.confirmado;
    app.innerHTML =
      '<section class="success">' +
        '<div class="check">✓</div>' +
        '<h1 style="font-size:clamp(32px,6vw,48px)">Tudo certo.</h1>' +
        '<p class="lead">Seu horário está confirmado.</p>' +
        '<div class="box"><h3>' + esc(a.servico_nome) + '</h3>' +
          '<p>' + esc(a.profissional_nome) + '</p>' +
          '<p style="text-transform:capitalize">' + esc(fmtQuando(a.inicio)) + '</p>' +
          '<p>' + brl(a.preco_cobrado) + '</p></div>' +
        '<div class="actions">' +
          '<button class="btn" data-go="meus">Ver meus horários</button>' +
          '<button class="btn ghost" data-go="novo">Novo agendamento</button>' +
        '</div>' +
      '</section>';
  }

  /* ---------- Meus agendamentos ---------- */
  function renderMeus() {
    var cliente = state.user.tipo === 'cliente';
    app.innerHTML =
      '<div class="page-head"><h1 style="font-size:clamp(34px,6vw,52px)">' + 'Agendamentos' + '</h1>' +
      '<p>' + (cliente ? 'Acompanhe e gerencie seus agendamentos.' : 'Os atendimentos marcados.') + '</p></div>' +
      '<div class="loading">Carregando…</div>';

    api('/api/agenda/agendamentos/').then(function (d) {
      desenharMeus(lista(d));
    }, function (e) {
      app.innerHTML = '<div class="page-head"><h1>Agenda</h1></div><div class="alert">' + esc(e.message) + '</div>';
    });
  }

  var STATUS = { confirmado: 'Confirmado', cancelado: 'Cancelado', concluido: 'Concluído', faltou: 'Faltou' };

  function cartaoAgendamento(a, cliente) {
    var futuro = a.status === 'confirmado' && new Date(a.inicio) > new Date();
    return '<article class="appt"><div>' +
      '<div class="when">' + esc(fmtQuando(a.inicio)) + '</div>' +
      '<div class="what">' + esc(a.servico_nome) + '</div>' +
      '<div class="who">' + (cliente ? esc(a.profissional_nome) : esc(a.cliente_nome) + ' · ' + esc(a.profissional_nome)) + ' · ' + brl(a.preco_cobrado) + '</div>' +
      '</div><div class="appt-side">' +
      '<span class="badge ' + esc(a.status) + '">' + esc(STATUS[a.status] || a.status) + '</span>' +
      (cliente && futuro ? '<button class="btn danger small" data-cancelar="' + a.id + '">Cancelar</button>' : '') +
      '</div></article>';
  }

  function desenharMeus(itens) {
    var cliente = state.user.tipo === 'cliente';
    var agora = new Date();
    var proximos = itens.filter(function (a) { return a.status === 'confirmado' && new Date(a.fim) >= agora; });
    var historico = itens.filter(function (a) { return proximos.indexOf(a) === -1; }).reverse();

    var h = '<div class="page-head"><h1 style="font-size:clamp(34px,6vw,52px)">' + 'Agendamentos' + '</h1>' +
      '<p>' + (cliente ? 'Acompanhe e gerencie seus agendamentos.' : 'Os atendimentos marcados.') + '</p></div>';

    if (!itens.length) {
      h += '<div class="empty">Você ainda não tem agendamentos.' +
        (cliente ? '<br><button class="btn" data-go="agendar">Agendar agora</button>' : '') + '</div>';
      app.innerHTML = h;
      return;
    }

    h += '<div class="section-label" style="margin-top:0">Próximos</div>';
    h += proximos.length
      ? '<div class="list">' + proximos.map(function (a) { return cartaoAgendamento(a, cliente); }).join('') + '</div>'
      : '<div class="empty">Nenhum horário marcado.' + (cliente ? '<br><button class="btn" data-go="agendar">Agendar agora</button>' : '') + '</div>';

    if (historico.length) {
      h += '<div class="section-label">Histórico</div><div class="list">' +
        historico.map(function (a) { return cartaoAgendamento(a, cliente); }).join('') + '</div>';
    }
    app.innerHTML = h;
  }

  function cancelar(id, btn) {
    if (!window.confirm('Deseja cancelar este agendamento?')) return;
    btn.disabled = true;
    api('/api/agenda/agendamentos/' + id + '/cancelar/', { method: 'POST' }).then(function () {
      toast('Agendamento cancelado.');
      renderMeus();
    }, function (e) {
      toast(e.message);
      btn.disabled = false;
    });
  }

  /* ------------------------------------------------------------
     Eventos (delegação)
  ------------------------------------------------------------ */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('button');
    if (!el) return;

    if (el.dataset.go) return irPara(el.dataset.go);
    if (el.dataset.tab) { state.authTab = el.dataset.tab; return renderHome(); }
    if (el.dataset.action === 'sair') return sair();
    if (el.dataset.action === 'confirmar') return confirmar(el);
    if (el.dataset.cancelar) return cancelar(el.dataset.cancelar, el);

    if (el.dataset.action === 'menu') return abrirMenu();
    if (el.dataset.action === 'fechar-menu') return fecharMenu();
    if (el.dataset.action === 'novo-servico') return folha('Novo serviço', formServico());
    if (el.dataset.action === 'editar-servico') {
      return folha('Editar serviço', formServico(state.admServicos.filter(function (x) { return x.id === Number(el.dataset.id); })[0]));
    }
    if (el.dataset.action === 'novo-prof') return abrirProf(null);
    if (el.dataset.action === 'editar-prof') return abrirProf(Number(el.dataset.id));
    if (el.dataset.action === 'fechar') return fecharSheet();
    if (el.dataset.sheet) return abrirSheet(el.dataset.sheet);
    if (el.dataset.prof) return escolherProf(Number(el.dataset.prof));
    if (el.dataset.servico) return escolherServ(Number(el.dataset.servico));
    if (el.dataset.dia) {
      state.sel.data = el.dataset.dia;
      state.sel.hora = '';
      return desenharDias();
    }
    if (el.dataset.hora) {
      state.sel.hora = el.dataset.hora;
      fecharSheet();
      desenharNovo();
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { fecharSheet(); fecharMenu(); }
  });

  document.addEventListener('submit', function (ev) {
    var fid = ev.target.id;
    if (fid === 'auth-form') { ev.preventDefault(); submeterAuth(ev.target); }
    else if (fid === 'form-servico') { ev.preventDefault(); salvarServico(ev.target); }
    else if (fid === 'form-prof') { ev.preventDefault(); salvarProf(ev.target); }
  });

  /* ------------------------------------------------------------
     Início
  ------------------------------------------------------------ */
  if (state.access) {
    app.innerHTML = '<div class="loading">Carregando…</div>';
    carregarPerfil().catch(function () { sair(true); });
  } else {
    render();
  }
})();
