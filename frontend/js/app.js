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
    token2fa: null,
    fotoNova: null,
    fotoPreview: null,
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

  /* ---------- Máscaras e validações (CPF, CEP, telefone, data) ---------- */
  function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  function mascaraCPF(v) {
    var d = soDigitos(v).slice(0, 11), o = d.slice(0, 3);
    if (d.length > 3) o += '.' + d.slice(3, 6);
    if (d.length > 6) o += '.' + d.slice(6, 9);
    if (d.length > 9) o += '-' + d.slice(9, 11);
    return o;
  }

  function mascaraCEP(v) {
    var d = soDigitos(v).slice(0, 8);
    return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  }

  function mascaraTel(v) {
    var d = soDigitos(v).slice(0, 11);
    if (!d.length) return '';
    if (d.length <= 2) return '(' + d;
    var ddd = '(' + d.slice(0, 2) + ') ';
    if (d.length <= 6) return ddd + d.slice(2);
    var corte = d.length > 10 ? 7 : 6;
    return ddd + d.slice(2, corte) + '-' + d.slice(corte);
  }

  function mascaraData(v) {
    var d = soDigitos(v).slice(0, 8), o = d.slice(0, 2);
    if (d.length > 2) o += '/' + d.slice(2, 4);
    if (d.length > 4) o += '/' + d.slice(4);
    return o;
  }

  function mascaraCodigo(v) { return soDigitos(v).slice(0, 6); }

  var MASCARAS = { cpf: mascaraCPF, cep: mascaraCEP, tel: mascaraTel, data: mascaraData, cod: mascaraCodigo };

  function cpfValido(c) {
    var d = soDigitos(c);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
      if (((soma * 10) % 11) % 10 !== Number(d[t])) return false;
    }
    return true;
  }

  // 'dd/mm/aaaa' -> 'aaaa-mm-dd' (ou null se a data não existir / for futura)
  function dataParaISO(br) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || '');
    if (!m) return null;
    var d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return null;
    if (+m[3] < 1900 || d > new Date()) return null;
    return m[3] + '-' + m[2] + '-' + m[1];
  }

  function dataDeISO(iso) {
    return iso ? fmtDataCurta(String(iso).slice(0, 10)) : '';
  }

  // Preenche rua/bairro/cidade/estado a partir do CEP (ViaCEP). Falhas são silenciosas.
  function buscarCep(input) {
    var cep = soDigitos(input.value);
    var form = input.form;
    if (cep.length !== 8 || !form || input.dataset.cepBuscado === cep) return;
    input.dataset.cepBuscado = cep;
    fetch('https://viacep.com.br/ws/' + cep + '/json/')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.erro || soDigitos(input.value) !== cep) return;
        var mapa = { rua: j.logradouro, bairro: j.bairro, cidade: j.localidade, estado: j.uf };
        Object.keys(mapa).forEach(function (k) {
          if (form.elements[k] && mapa[k]) form.elements[k].value = mapa[k];
        });
      })
      .catch(function () { input.dataset.cepBuscado = ''; });
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  var CAMPOS = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', password: 'Senha', inicio: 'Horário', servico: 'Serviço', profissional: 'Profissional', cliente: 'Cliente', descricao: 'Descrição', duracao_minutos: 'Duração', preco: 'Preço', servicos: 'Serviços', intervalo_minutos: 'Intervalo', usuario: 'Usuário', horarios: 'Dias de trabalho', comissao_percentual: 'Comissão',
    cpf: 'CPF', cep: 'CEP', rua: 'Rua', numero: 'Número', complemento: 'Complemento', cidade: 'Cidade', bairro: 'Bairro', estado: 'Estado',
    data_nascimento: 'Data de nascimento', foto: 'Foto', senha_atual: 'Senha atual', nova_senha: 'Nova senha', codigo: 'Código' };

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
    this.message = (status === 404 && !data) ? 'Recurso ainda não disponível no servidor.' : mensagemErro(data);
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
    var multipart = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    var headers = multipart ? {} : { 'Content-Type': 'application/json' };
    if (auth && state.access) headers.Authorization = 'Bearer ' + state.access;

    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? (multipart ? opts.body : JSON.stringify(opts.body)) : undefined,
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
  function concluirLogin(d) {
    state.access = d.access;
    state.refresh = d.refresh;
    state.token2fa = null;
    save('access', d.access);
    save('refresh', d.refresh);
    return carregarPerfil();
  }

  function entrar(email, password) {
    return api('/api/auth/login/', { method: 'POST', auth: false, body: { email: email, password: password } })
      .then(function (d) {
        // Conta com verificação em duas etapas: o servidor ainda não entregou os tokens.
        if (d && d.requer_2fa) {
          state.token2fa = d.token_2fa;
          state.authTab = '2fa';
          return renderHome();
        }
        return concluirLogin(d);
      }, function (e) {
        if (e.status === 401) throw new ApiError(401, { detail: 'E-mail ou senha incorretos.' });
        throw e;
      });
  }

  function verificar2faLogin(form) {
    var erro = document.getElementById('auth-erro');
    var btn = form.querySelector('button[type=submit]');
    var codigo = mascaraCodigo(form.elements.codigo.value);
    erro.innerHTML = '';
    if (codigo.length !== 6) { erro.innerHTML = '<div class="alert">Digite o código de 6 dígitos.</div>'; return; }
    btn.disabled = true;
    api('/api/auth/2fa/verificar/', { method: 'POST', auth: false, body: { token_2fa: state.token2fa, codigo: codigo } })
      .then(concluirLogin)
      .catch(function (e) {
        erro.innerHTML = '<div class="alert">' + esc(e.message) + '</div>';
        btn.disabled = false;
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
    state.authTab = 'login';
    state.token2fa = null;
    state.fotoNova = null;
    state.fotoPreview = null;
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
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 10h14v10H5V10z"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm-8.5 9.2L12 15.5l8.5-4.3L22 12l-10 5-10-5 1.5-.8zm0 4L12 19.5l8.5-4.3L22 16l-10 5-10-5 1.5-.8z"/></svg>',
    exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5v-2H6V6h4V4zm6.6 4.6L15.2 10l1 1H9v2h7.2l-1 1 1.4 1.4L20 12l-3.4-3.4z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3 4a1 1 0 0 1 1-1h7l10 10-8 8L3 11V4zm4.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v2h14v-2c0-2.3-3.7-4-7-4zm7-2a3 3 0 1 0-1-5.8 5 5 0 0 1 0 5.6c.3.1.6.2 1 .2zm.5 2.1c1.9.6 3.5 1.8 3.5 3.9v2h4v-2c0-1.9-3.1-3.4-7.5-3.9z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.8.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.8L22 10.3v3.4l-2.6.5-.8 1.8 1.5 2.2-2.4 2.4-2.2-1.5-1.8.8-.5 2.6h-3.4l-.5-2.6-1.8-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.8L2 13.7v-3.4l2.6-.5.8-1.8-1.5-2.2 2.4-2.4 2.2 1.5 1.8-.8L10.3 2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z"/></svg>',
    key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.65 10A6 6 0 1 0 7 18a6 6 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
    laptop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 18c1.1 0 1.99-.9 1.99-2L22 6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>',
    desktop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 2H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H3V4h18v12z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 1H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 18H7V5h10v14z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    shieldOk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
    checkCircle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    calX: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.31 17l2.44-2.44L14.19 17l1.06-1.06-2.44-2.44 2.44-2.44L14.19 10l-2.44 2.44L9.31 10l-1.06 1.06 2.44 2.44-2.44 2.44L9.31 17zM19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11z"/></svg>',
    calOk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11zM10.5 17.4l-2.9-2.9 1.06-1.06 1.84 1.84 4.04-4.04 1.06 1.06-5.1 5.1z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5z"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>'
  };

  var TITULOS = { agendar: 'Início', novo: 'Início', meus: 'Agendamentos', planos: 'Planos', servicos: 'Serviços', profissionais: 'Profissionais', graficos: 'Gráficos', perfil: 'Perfil', integracoes: 'Perfil' };

  function itensMenu() {
    var t = state.user.tipo;
    var itens;
    if (t === 'admin') itens = [
      ['meus', 'Agendamentos', ICO.cal],
      ['servicos', 'Serviços', ICO.tag],
      ['profissionais', 'Profissionais', ICO.users],
      ['graficos', 'Gráficos', ICO.chart],
      ['admin', 'Painel completo', ICO.gear],
    ];
    else if (t === 'profissional') itens = [['meus', 'Agendamentos', ICO.cal]];
    else itens = [['agendar', 'Início', ICO.home], ['meus', 'Agendamentos', ICO.cal], ['planos', 'Planos', ICO.layers]];
    itens.push(['perfil', 'Perfil', ICO.user]);
    return itens;
  }

  var SUBTELAS_PERFIL = ['integracoes'];

  function avatarHTML(u, classe) {
    return '<span class="avatar ' + (classe || '') + '">' +
      (u.foto ? '<img src="' + esc(u.foto) + '" alt="">' : esc(iniciais(u.nome))) + '</span>';
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
      var ativo = state.view === it[0] || (it[0] === 'agendar' && state.view === 'novo') ||
        (it[0] === 'perfil' && SUBTELAS_PERFIL.indexOf(state.view) !== -1);
      return '<button class="menu-item ' + (ativo ? 'active' : '') + '" data-go="' + it[0] + '">' + it[2] + '<span>' + it[1] + '</span></button>';
    }).join('');
    h += '<button class="menu-item" data-action="sair">' + ICO.exit + '<span>Sair</span></button>';
    el.innerHTML = '<button class="drawer-back" data-action="fechar-menu" aria-label="Fechar menu"></button>' +
      '<aside class="drawer-panel"><div class="drawer-user">' + avatarHTML(state.user, 'sm') +
      '<div><strong>' + esc(state.user.nome) + '</strong><small>' + esc(state.user.email) + '</small></div></div>' + h + '</aside>';
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
          return '<button type="button" class="appt appt-btn" data-action="editar-prof" data-id="' + p.id + '">' +
            '<div><div class="what">' + esc(p.nome) + '</div>' +
            '<div class="who">' + p.servicos.length + ' serviço(s) · ' + resumoDias(p.horarios || []) +
            ' · comissão ' + Number(p.comissao_percentual).toLocaleString('pt-BR') + '%</div></div>' +
            '<div class="appt-side"><span class="badge ' + (p.ativo ? 'confirmado' : 'cancelado') + '">' + (p.ativo ? 'Ativo' : 'Inativo') + '</span>' +
            ICO.chev + '</div></button>';
        }).join('') + '</div>' : '<div class="empty">Nenhum profissional cadastrado.</div>') +
        '<p class="hint">Clique em um profissional para editar dias, horários, comissão ou removê-lo. Folgas e bloqueios pontuais ficam no <a class="link" href="/admin/">painel completo</a>.</p>';
    }, erroAdmin);
  }

  /* Dias de trabalho: um bloco por dia (0 = segunda ... 6 = domingo), cada um com uma ou mais janelas */
  var NOMES_DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

  function resumoDias(horarios) {
    var dias = [];
    horarios.forEach(function (h) { if (dias.indexOf(h.dia_semana) === -1) dias.push(h.dia_semana); });
    if (!dias.length) return '<span class="aviso-sem-horario">sem dias de trabalho (não aparece para agendar)</span>';
    return dias.sort().map(function (d) { return NOMES_DIAS[d].slice(0, 3); }).join(', ');
  }

  function janelaHTML(ini, fim) {
    return '<div class="janela"><input type="time" data-ini value="' + esc(ini || '09:00') + '" aria-label="Início">' +
      '<span>às</span><input type="time" data-fim value="' + esc(fim || '18:00') + '" aria-label="Fim">' +
      '<button type="button" class="janela-rm" data-action="rm-janela" aria-label="Remover horário">×</button></div>';
  }

  function diasTrabalho(horarios) {
    return '<div class="field"><label>Dias e horários de trabalho</label><div class="checks dias-trab">' +
      NOMES_DIAS.map(function (nome, dia) {
        var hs = horarios.filter(function (h) { return h.dia_semana === dia; });
        return '<div class="dia-trab' + (hs.length ? '' : ' off') + '" data-dia="' + dia + '">' +
          '<label class="check-row"><input type="checkbox" data-dia-ativo' + (hs.length ? ' checked' : '') + '> ' + nome + '</label>' +
          '<div class="janelas">' + hs.map(function (h) { return janelaHTML(h.hora_inicio, h.hora_fim); }).join('') + '</div>' +
          '<button type="button" class="link janela-add" data-action="add-janela">+ outro horário</button></div>';
      }).join('') + '</div></div>';
  }

  function marcarDiaTrab(input) {
    var bloco = input.closest('.dia-trab');
    bloco.classList.toggle('off', !input.checked);
    var janelas = bloco.querySelector('.janelas');
    if (input.checked && !janelas.children.length) janelas.insertAdjacentHTML('beforeend', janelaHTML());
  }

  function addJanela(btn) {
    var janelas = btn.closest('.dia-trab').querySelector('.janelas');
    var ultima = janelas.lastElementChild;
    // Sugere começar onde o horário anterior terminou (ex.: 13:00 depois do almoço)
    janelas.insertAdjacentHTML('beforeend', ultima ? janelaHTML(ultima.querySelector('[data-fim]').value, '18:00') : janelaHTML());
  }

  function rmJanela(btn) {
    var bloco = btn.closest('.dia-trab');
    btn.closest('.janela').remove();
    if (!bloco.querySelector('.janela')) {
      bloco.classList.add('off');
      bloco.querySelector('[data-dia-ativo]').checked = false;
    }
  }

  function lerHorarios(form) {
    var horarios = [], erro = null;
    [].forEach.call(form.querySelectorAll('.dia-trab'), function (bloco) {
      if (!bloco.querySelector('[data-dia-ativo]').checked) return;
      var dia = Number(bloco.dataset.dia);
      [].forEach.call(bloco.querySelectorAll('.janela'), function (j) {
        var ini = j.querySelector('[data-ini]').value, fim = j.querySelector('[data-fim]').value;
        if (!ini || !fim) erro = erro || NOMES_DIAS[dia] + ': preencha início e fim.';
        else if (fim <= ini) erro = erro || NOMES_DIAS[dia] + ': o fim deve ser depois do início.';
        horarios.push({ dia_semana: dia, hora_inicio: ini, hora_fim: fim });
      });
    });
    return { horarios: horarios, erro: erro };
  }

  function formProf(p, usuarios) {
    var sel = usuarios ? '<div class="field"><label>Usuário que será promovido a profissional</label>' +
      '<input type="search" id="busca-usuario" placeholder="Buscar por nome ou e-mail" autocomplete="off">' +
      '<select name="usuario" size="6" required>' + usuarios.map(function (u, i) {
        return '<option value="' + u.id + '"' + (i === 0 ? ' selected' : '') + '>' + esc(u.nome) + ' (' + esc(u.email) + ')</option>';
      }).join('') + '</select></div>' : '';
    var checks = (state.admServicos || []).map(function (x) {
      return '<label class="check-row"><input type="checkbox" name="servicos" value="' + x.id + '"' +
        (p && p.servicos.indexOf(x.id) !== -1 ? ' checked' : '') + '> ' + esc(x.nome) + '</label>';
    }).join('');
    return '<form id="form-prof" data-id="' + (p ? p.id : '') + '" novalidate><div id="form-erro"></div>' + sel +
      '<div class="field"><label>Serviços que realiza</label><div class="checks">' + (checks || '<p class="hint">Cadastre serviços primeiro.</p>') + '</div></div>' +
      diasTrabalho(p ? p.horarios || [] : []) +
      campo('intervalo_minutos', 'Intervalo entre horários (minutos)', p ? p.intervalo_minutos : 15, 'number', 'min="5" max="120"') +
      '<div class="field"><label for="f-comissao">Comissão</label><div class="campo-prefixo"><span>%</span>' +
        '<input id="f-comissao" name="comissao_percentual" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="' +
        esc(p ? Number(p.comissao_percentual) : 0) + '"></div>' +
        '<small class="hint">Porcentagem do valor dos serviços que fica com o profissional.</small></div>' +
      '<div class="field"><label class="check-row"><input type="checkbox" name="ativo"' + (!p || p.ativo ? ' checked' : '') + '> Ativo</label></div>' +
      '<button class="btn block" type="submit">Salvar</button>' +
      (p ? '<button class="btn danger block" type="button" data-action="remover-prof" data-id="' + p.id + '" style="margin-top:10px">Remover profissional</button>' : '') +
      '</form>';
  }

  function removerProf(id, btn) {
    var p = state.admProfs.filter(function (x) { return x.id === id; })[0];
    if (!window.confirm('Remover ' + p.nome + ' dos profissionais? A conta continuará existindo como cliente.')) return;
    btn.disabled = true;
    api('/api/catalogo/profissionais/' + id + '/', { method: 'DELETE' }).then(function () {
      state.profissionais = [];
      fecharSheet();
      toast('Profissional removido.');
      renderProfissionais();
    }, function (e) {
      document.getElementById('form-erro').innerHTML = '<div class="alert">' + esc(e.message) + '</div>';
      btn.disabled = false;
    });
  }

  function abrirProf(id) {
    if (id) {
      var p = state.admProfs.filter(function (x) { return x.id === id; })[0];
      return folha('Editar ' + p.nome, formProf(p, null));
    }
    api('/api/catalogo/profissionais/usuarios-disponiveis/').then(function (us) {
      if (!us.length) { toast('Não há usuários disponíveis para promover a profissional.'); return; }
      folha('Novo profissional', formProf(null, us));
      var busca = document.getElementById('busca-usuario');
      busca.addEventListener('input', function () {
        var termo = busca.value.trim().toLowerCase();
        var opts = busca.form.elements.usuario.options;
        for (var i = 0; i < opts.length; i++) opts[i].hidden = termo && opts[i].text.toLowerCase().indexOf(termo) === -1;
      });
    }, function (e) { toast(e.message); });
  }

  function salvarProf(form) {
    var d = new FormData(form);
    var id = form.dataset.id;
    var erroEl = document.getElementById('form-erro');
    var corpo = {
      servicos: d.getAll('servicos').map(Number),
      intervalo_minutos: Number(d.get('intervalo_minutos')),
      comissao_percentual: String(d.get('comissao_percentual') || '0').replace(',', '.'),
      ativo: form.elements.ativo.checked,
    };
    var h = lerHorarios(form);
    if (h.erro) { erroEl.innerHTML = '<div class="alert">' + esc(h.erro) + '</div>'; return; }
    corpo.horarios = h.horarios;
    if (!id) {
      if (!d.get('usuario')) { erroEl.innerHTML = '<div class="alert">Selecione um usuário.</div>'; return; }
      corpo.usuario = Number(d.get('usuario'));
    }
    enviarForm(form, '/api/catalogo/profissionais/' + (id ? id + '/' : ''), id ? 'PATCH' : 'POST', corpo, renderProfissionais);
  }

  /* ---------- Admin: gráficos ---------- */
  // Cores categóricas em ordem fixa (seguras para daltonismo); a partir da 8ª série vira "Outros"
  var CORES_SERIE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  var COR_OUTROS = '#a3a29d';
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function isoDia(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function deIso(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function ddmm(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }

  function renderGraficos() {
    if (!state.graf) state.graf = { inicio: null, fim: null, profs: null, aberto: null };
    app.innerHTML = '<div class="page-head row-head"><h1 style="font-size:clamp(34px,6vw,52px)">Gráficos</h1>' +
      '<div class="segmented" role="tablist"><button class="seg active" role="tab" aria-selected="true">Profissionais</button></div></div>' +
      '<div id="graf-area"><div class="loading">Carregando…</div></div><div id="graf-tip" class="graf-tip" hidden></div>';
    carregarGraficos();
  }

  function carregarGraficos() {
    var g = state.graf;
    api('/api/agenda/graficos/profissionais/' + (g.inicio ? '?inicio=' + g.inicio + '&fim=' + g.fim : '')).then(function (d) {
      g.dados = d;
      g.inicio = d.inicio;
      g.fim = d.fim;
      if (!g.calMes) g.calMes = deIso(d.inicio);
      if (!g.profs) g.profs = d.profissionais.map(function (p) { return p.id; });
      // A cor segue o serviço (mais agendados primeiro), não a posição da fatia após o filtro
      var qtd = {};
      d.linhas.forEach(function (l) { qtd[l.servico] = (qtd[l.servico] || 0) + l.qtd; });
      var ordem = d.servicos.slice().sort(function (a, b) { return (qtd[b.id] || 0) - (qtd[a.id] || 0) || a.nome.localeCompare(b.nome); });
      var vagas = ordem.length > CORES_SERIE.length ? CORES_SERIE.length - 1 : ordem.length;
      g.corServ = {};
      ordem.forEach(function (s, i) { g.corServ[s.id] = i < vagas ? CORES_SERIE[i] : null; });
      desenharGraficos();
    }, function (e) {
      var area = document.getElementById('graf-area');
      if (area) area.innerHTML = '<div class="alert">' + esc(e.message) + '</div>';
    });
  }

  /* Filtro de período: mini calendário em que o 1º clique marca o início e o 2º o fim */
  function filtroPeriodo() {
    var g = state.graf, aberto = g.aberto === 'periodo';
    var h = '<div class="graf-filtro">' +
      '<button type="button" class="graf-filtro-btn' + (aberto ? ' aberto' : '') + '" data-graf-abrir="periodo" aria-expanded="' + aberto + '">' +
        '<span><strong>Período</strong><small>' + ddmm(g.inicio) + '/' + g.inicio.slice(0, 4) + ' até ' + ddmm(g.fim) + '/' + g.fim.slice(0, 4) + '</small></span>' + ICO.chev + '</button>';
    if (!aberto) return h + '</div>';

    var m = g.calMes, ano = m.getFullYear(), mes = m.getMonth();
    var primeiro = new Date(ano, mes, 1), vazios = (primeiro.getDay() + 6) % 7;
    var nDias = new Date(ano, mes + 1, 0).getDate();
    var ini = g.selIni || g.inicio, fim = g.selIni ? null : g.fim, hoje = isoDia(new Date());
    var cel = '';
    for (var i = 0; i < vazios; i++) cel += '<span></span>';
    for (var d = 1; d <= nDias; d++) {
      var k = isoDia(new Date(ano, mes, d));
      var cls = (k === ini || k === fim ? ' ponta' : '') + (fim && k > ini && k < fim ? ' meio' : '') + (k === hoje ? ' hoje' : '');
      cel += '<button type="button" class="cal-dia' + cls + '" data-cal-dia="' + k + '">' + d + '</button>';
    }
    return h + '<div class="graf-opcoes mini-cal">' +
      '<div class="cal-topo"><button type="button" class="cal-seta" data-cal-mes="-1" aria-label="Mês anterior">‹</button>' +
        '<strong>' + MESES[mes] + ' ' + ano + '</strong>' +
        '<button type="button" class="cal-seta" data-cal-mes="1" aria-label="Próximo mês">›</button></div>' +
      '<div class="cal-grade">' + ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(function (x) { return '<span class="cal-sem">' + x + '</span>'; }).join('') + cel + '</div>' +
      '<p class="cal-dica">' + (g.selIni ? 'Agora escolha a data final.' : 'Clique na data inicial e depois na final.') + '</p>' +
      '<div class="cal-atalhos"><button type="button" class="link" data-cal-atalho="mes">Este mês</button>' +
        '<button type="button" class="link" data-cal-atalho="7">Últimos 7 dias</button>' +
        '<button type="button" class="link" data-cal-atalho="30">Últimos 30 dias</button></div>' +
      '</div></div>';
  }

  function escolherDiaCal(k) {
    var g = state.graf;
    if (!g.selIni) { g.selIni = k; return desenharGraficos(); }
    var a = g.selIni < k ? g.selIni : k, b = g.selIni < k ? k : g.selIni;
    g.selIni = null;
    g.aberto = null;
    aplicarPeriodo(a, b);
  }

  function atalhoPeriodo(tipo) {
    var hoje = new Date();
    state.graf.selIni = null;
    state.graf.aberto = null;
    if (tipo === 'mes') return aplicarPeriodo(isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), isoDia(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)));
    aplicarPeriodo(isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Number(tipo) + 1)), isoDia(hoje));
  }

  function aplicarPeriodo(a, b) {
    var g = state.graf;
    g.inicio = a;
    g.fim = b;
    g.calMes = deIso(a);
    var area = document.getElementById('graf-area');
    if (area) area.classList.add('carregando');
    carregarGraficos();
  }

  function filtroProfs(marcados) {
    var g = state.graf, aberto = g.aberto === 'profs', opcoes = g.dados.profissionais;
    var resumo = marcados.length === opcoes.length ? 'Todos' : marcados.length ? marcados.length + ' selecionado(s)' : 'Nenhum';
    return '<div class="graf-filtro">' +
      '<button type="button" class="graf-filtro-btn' + (aberto ? ' aberto' : '') + '" data-graf-abrir="profs" aria-expanded="' + aberto + '">' +
        '<span><strong>Profissionais</strong><small>' + resumo + '</small></span>' + ICO.chev + '</button>' +
      (aberto ? '<div class="graf-opcoes" data-graf-filtro="profs">' +
        '<label class="check-row"><input type="checkbox" data-todos' + (marcados.length === opcoes.length ? ' checked' : '') + '> Todos</label>' +
        opcoes.map(function (o) {
          return '<label class="check-row"><input type="checkbox" value="' + o.id + '"' +
            (marcados.indexOf(o.id) !== -1 ? ' checked' : '') + '> ' + esc(o.nome) + '</label>';
        }).join('') + '</div>' : '') +
      '</div>';
  }

  function mudarFiltroGraf(input) {
    var g = state.graf;
    var caixa = input.closest('[data-graf-filtro]');
    if (input.hasAttribute('data-todos')) g.profs = input.checked ? g.dados.profissionais.map(function (p) { return p.id; }) : [];
    else g.profs = [].map.call(caixa.querySelectorAll('input[value]:checked'), function (i) { return Number(i.value); });
    desenharGraficos();
  }

  function desenharGraficos() {
    var g = state.graf, d = g && g.dados;
    var area = document.getElementById('graf-area');
    if (!area || !d) return;
    area.classList.remove('carregando');
    var linhas = d.linhas.filter(function (l) { return g.profs.indexOf(l.profissional) !== -1; });

    // Séries por serviço: a cor segue o serviço; quem ficou sem cor entra em "Outros"
    var chave = function (id) { return g.corServ[id] ? String(id) : 'outros'; };
    var porServ = {}, totalQtd = 0;
    linhas.forEach(function (l) {
      totalQtd += l.qtd;
      porServ[chave(l.servico)] = (porServ[chave(l.servico)] || 0) + l.qtd;
    });
    var series = d.servicos.filter(function (s) { return g.corServ[s.id] && porServ[s.id]; }).map(function (s) {
      return { chave: String(s.id), nome: s.nome, cor: g.corServ[s.id] };
    }).sort(function (a, b) { return CORES_SERIE.indexOf(a.cor) - CORES_SERIE.indexOf(b.cor); });
    if (porServ.outros) series.push({ chave: 'outros', nome: 'Outros', cor: COR_OUTROS });
    var fatias = series.map(function (s) { return { nome: s.nome, valor: porServ[s.chave], cor: s.cor }; });

    // Colunas: um dia do período por coluna, separadas por serviço
    var cols = [];
    for (var dia = deIso(d.inicio); isoDia(dia) <= d.fim; dia.setDate(dia.getDate() + 1)) {
      cols.push({ dia: isoDia(dia), rotulo: ddmm(isoDia(dia)), renda: 0, qtd: 0, partes: {} });
    }
    var porDia = {};
    cols.forEach(function (c) { porDia[c.dia] = c; });
    linhas.forEach(function (l) {
      var c = porDia[l.dia];
      if (!c) return;
      c.renda += l.total;
      c.qtd += l.qtd;
      var p = c.partes[chave(l.servico)] || (c.partes[chave(l.servico)] = { renda: 0, qtd: 0 });
      p.renda += l.total;
      p.qtd += l.qtd;
    });
    cols.forEach(function (c) { c.ticket = c.qtd ? c.renda / c.qtd : 0; });

    area.innerHTML = '<div class="graf-layout"><div class="graf-col">' + cartaoComissoes() +
      '<section class="card graf-card"><h3>Serviços por dia</h3><p class="graf-sub">Agendamentos por serviço no período · ' + totalQtd + ' no total</p>' +
        graficoPizza(fatias, totalQtd) + '</section>' +
      '<section class="card graf-card"><h3>Ticket médio</h3><p class="graf-sub">Valor médio por agendamento em cada dia. Cada cor mostra quanto o serviço contribui para a média.</p>' +
        graficoColunas(cols, 'ticket', series) + '</section>' +
      '<section class="card graf-card"><h3>Renda por dia</h3><p class="graf-sub">Soma dos valores em cada dia, separada por serviço</p>' +
        graficoColunas(cols, 'renda', series) + '</section>' +
      '</div><aside class="graf-filtros">' + filtroPeriodo() + filtroProfs(g.profs) +
        '<p class="hint">Cancelados e faltas não entram nos gráficos.</p>' +
      '</aside></div>';
  }

  // Total a receber: comissão no período dos profissionais selecionados
  function cartaoComissoes() {
    var g = state.graf, d = g.dados;
    var nomes = {};
    d.profissionais.forEach(function (p) { nomes[p.id] = p.nome; });
    var itens = d.comissoes.filter(function (c) { return g.profs.indexOf(c.profissional) !== -1; });
    var total = 0, previsto = 0;
    itens.forEach(function (c) { total += c.a_receber; previsto += c.previsto; });
    var linhas = itens.map(function (c) {
      return '<tr><th scope="row">' + esc(nomes[c.profissional]) + '</th>' +
        '<td>' + c.percentual.toLocaleString('pt-BR') + '%</td>' +
        '<td>' + brl(c.renda_concluida) + '</td>' +
        '<td class="com-valor">' + brl(c.a_receber) + (c.previsto ? '<small>+ ' + brl(c.previsto) + ' previsto</small>' : '') + '</td></tr>';
    }).join('');
    return '<section class="card graf-card com-card"><h3>Total a receber</h3>' +
      '<div class="com-total">' + brl(total) + '</div>' +
      '<p class="graf-sub">Comissão sobre os atendimentos concluídos de ' + ddmm(d.inicio) + ' a ' + ddmm(d.fim) +
        (previsto ? ' · mais ' + brl(previsto) + ' previsto em agendamentos ainda não finalizados' : '') + '.</p>' +
      (linhas ? '<div class="graf-scroll"><table class="com-tabela"><thead><tr><th>Profissional</th><th>Comissão</th><th>Trabalhado</th><th>A receber</th></tr></thead>' +
        '<tbody>' + linhas + '</tbody></table></div>' : '<div class="empty">Nenhum profissional selecionado.</div>') +
      '</section>';
  }

  function graficoPizza(fatias, total) {
    if (!total) return '<div class="empty">Nenhum agendamento para os filtros escolhidos.</div>';
    var R = 100, C = 110, ang = -Math.PI / 2;
    var svg = fatias.map(function (f) {
      var pct = f.valor / total;
      var tip = esc(f.nome + '|' + f.valor + ' agendamento(s) · ' + Math.round(pct * 100) + '%');
      if (pct >= 0.9999) return '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="' + f.cor + '" data-tip="' + tip + '"/>';
      var a2 = ang + pct * 2 * Math.PI;
      var p = 'M' + C + ' ' + C + 'L' + (C + R * Math.cos(ang)).toFixed(2) + ' ' + (C + R * Math.sin(ang)).toFixed(2) +
        'A' + R + ' ' + R + ' 0 ' + (pct > 0.5 ? 1 : 0) + ' 1 ' + (C + R * Math.cos(a2)).toFixed(2) + ' ' + (C + R * Math.sin(a2)).toFixed(2) + 'Z';
      ang = a2;
      return '<path d="' + p + '" fill="' + f.cor + '" data-tip="' + tip + '"/>';
    }).join('');
    var legenda = fatias.map(function (f) {
      return '<li><span class="graf-chip" style="background:' + f.cor + '"></span><span class="graf-leg-nome">' + esc(f.nome) +
        '</span><span class="graf-leg-val">' + f.valor + ' · ' + Math.round(f.valor / total * 100) + '%</span></li>';
    }).join('');
    return '<div class="graf-pizza"><svg viewBox="0 0 220 220" role="img" aria-label="Gráfico de pizza: agendamentos por serviço">' +
      '<g class="graf-fatias">' + svg + '</g></svg><ul class="graf-legenda">' + legenda + '</ul></div>';
  }

  function tetoBonito(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }

  function brlCurto(v) {
    if (v >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  }

  // Valor do segmento de um serviço: na renda é a soma; no ticket é a contribuição
  // do serviço para a média do dia (renda do serviço / agendamentos do dia), então
  // os segmentos somam exatamente o ticket médio.
  function valorParte(c, p, campo) {
    return campo === 'renda' ? p.renda : (c.qtd ? p.renda / c.qtd : 0);
  }

  function graficoColunas(cols, campo, series) {
    if (!cols.some(function (c) { return c.qtd; })) return '<div class="empty">Nenhum agendamento para os filtros escolhidos.</div>';
    var W = 560, H = 240, L = 64, T = 22, B = 30, Rm = 8, GAP = 2;
    var valores = cols.map(function (c) { return c[campo]; });
    var max = Math.max.apply(null, valores);
    var teto = tetoBonito(max), alt = H - T - B, banda = (W - L - Rm) / cols.length;
    var larg = Math.max(1, Math.min(36, banda * 0.7)), base = T + alt;
    var passoRotulo = Math.ceil(cols.length / 10);  // no máximo ~10 datas no eixo
    var grade = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      var yy = (base - f * alt).toFixed(1);
      return '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + yy + '" y2="' + yy + '" class="' + (f ? 'graf-grade' : 'graf-base') + '"/>' +
        '<text x="' + (L - 8) + '" y="' + yy + '" class="graf-eixo" text-anchor="end" dominant-baseline="middle">' + brlCurto(teto * f) + '</text>';
    }).join('');
    var iMax = max > 0 ? valores.indexOf(max) : -1;
    var barras = cols.map(function (c, i) {
      var cx = L + banda * i + banda / 2, x = cx - larg / 2, v = c[campo];
      var segs = series.filter(function (s) { return c.partes[s.chave] && valorParte(c, c.partes[s.chave], campo) > 0; });
      var y = base;
      var blocos = segs.map(function (s, j) {
        var p = c.partes[s.chave], val = valorParte(c, p, campo);
        var h = Math.max(1, alt * val / teto), topo = y - h;
        // 2px de respiro entre segmentos; cantos de 4px só no topo da coluna
        var baixo = j ? y - Math.min(GAP, h / 2) : y;
        var forma;
        if (j === segs.length - 1) {
          var r = Math.min(4, baixo - topo, larg / 2);
          forma = '<path d="M' + x.toFixed(1) + ' ' + baixo.toFixed(1) + 'V' + (topo + r).toFixed(1) +
            'Q' + x.toFixed(1) + ' ' + topo.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + topo.toFixed(1) +
            'H' + (x + larg - r).toFixed(1) + 'Q' + (x + larg).toFixed(1) + ' ' + topo.toFixed(1) + ' ' + (x + larg).toFixed(1) + ' ' + (topo + r).toFixed(1) +
            'V' + baixo.toFixed(1) + 'Z" fill="' + s.cor + '"/>';
        } else {
          forma = '<rect x="' + x.toFixed(1) + '" y="' + topo.toFixed(1) + '" width="' + larg.toFixed(1) +
            '" height="' + Math.max(0, baixo - topo).toFixed(1) + '" fill="' + s.cor + '"/>';
        }
        y = topo;
        var tip = campo === 'renda'
          ? s.nome + ' · ' + c.rotulo + '|' + brl(val) + ' de ' + brl(v) + '|' + p.qtd + ' agendamento(s)'
          : s.nome + ' · ' + c.rotulo + '|Contribui ' + brl(val) + ' do ticket de ' + brl(v) +
            '|Média do serviço: ' + brl(p.renda / p.qtd) + ' (' + p.qtd + ' agend.)';
        return '<g class="graf-seg" data-tip="' + esc(tip) + '">' + forma + '</g>';
      }).join('');
      var rotulo = i === iMax ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" class="graf-valor" text-anchor="middle">' + brlCurto(v) + '</text>' : '';
      var resumo = c.rotulo + '|' + (campo === 'renda' ? 'Total: ' : 'Ticket médio: ') + brl(v) + '|' +
        (c.qtd ? c.qtd + ' agendamento(s)' : 'Sem agendamentos');
      var eixo = i % passoRotulo === 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" class="graf-eixo" text-anchor="middle">' + c.rotulo + '</text>' : '';
      // Área de hover é a faixa inteira do dia, maior que a coluna; cada segmento tem o seu próprio detalhe
      return '<g class="graf-coluna" data-tip="' + esc(resumo) + '">' +
        '<rect x="' + (L + banda * i).toFixed(1) + '" y="' + T + '" width="' + banda.toFixed(1) + '" height="' + alt + '" class="graf-alvo"/>' +
        blocos + rotulo + eixo + '</g>';
    }).join('');
    var legenda = series.length ? '<ul class="graf-legenda-linha">' + series.map(function (s) {
      return '<li><span class="graf-chip" style="background:' + s.cor + '"></span>' + esc(s.nome) + '</li>';
    }).join('') + '</ul>' : '';
    return '<div class="graf-scroll"><svg viewBox="0 0 ' + W + ' ' + H + '" class="graf-svg" role="img">' + grade + barras + '</svg></div>' + legenda;
  }

  function mostrarTip(ev) {
    var tip = document.getElementById('graf-tip');
    if (!tip) return;
    var alvo = ev.target.closest && ev.target.closest('[data-tip]');
    if (!alvo) { tip.hidden = true; return; }
    var partes = alvo.getAttribute('data-tip').split('|');
    tip.innerHTML = '<strong>' + esc(partes[0]) + '</strong>' +
      partes.slice(1).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    tip.hidden = false;
    var x = ev.clientX + 14, w = tip.offsetWidth;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    tip.style.left = x + 'px';
    tip.style.top = (ev.clientY + 14) + 'px';
  }

  function render() {
    fecharSheet();
    fecharMenu();
    renderNav();
    summarySlot.innerHTML = '';

    if (!state.user) return renderHome();
    var tipo = state.user.tipo;
    if (state.view === 'perfil') return renderPerfil();
    if (state.view === 'integracoes') return renderIntegracoes();
    if (state.view === 'planos') return renderPlanos();
    if (tipo === 'admin' && state.view === 'servicos') return renderServicos();
    if (tipo === 'admin' && state.view === 'profissionais') return renderProfissionais();
    if (tipo === 'admin' && state.view === 'graficos') return renderGraficos();
    if (state.view === 'meus') return renderMeus();
    if (tipo !== 'cliente') { state.view = 'meus'; return renderMeus(); }
    if (state.confirmado) return renderSucesso();
    if (state.view === 'novo') return renderNovo();
    return renderAgendar();
  }

  /* ---------- Home / login ---------- */
  function campoAuth(nome, rotulo, extra) {
    return '<div class="field"><label for="f-' + nome + '">' + rotulo + '</label>' +
      '<input id="f-' + nome + '" name="' + nome + '" type="text" ' + (extra || '') + '></div>';
  }

  // Segunda etapa do login, para contas com autenticação em dois fatores.
  function renderCodigo2fa() {
    app.innerHTML =
      '<section class="hero">' +
        '<p class="eyebrow">Salão</p>' +
        '<h1>Só mais<br>um passo.</h1>' +
        '<p class="lead">Confirme que é você para entrar.</p>' +
        '<div class="auth-card">' +
          '<div id="auth-erro"></div>' +
          '<form id="form-2fa-login" novalidate>' +
            '<p class="form-nota">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>' +
            '<div class="field"><label for="f-codigo">Código</label>' +
              '<input id="f-codigo" name="codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" data-mask="cod" required></div>' +
            '<button class="btn block" type="submit">Verificar</button>' +
            '<button class="btn ghost block" type="button" data-action="voltar-login" style="margin-top:10px">Voltar</button>' +
          '</form>' +
        '</div>' +
      '</section>';
    var c = document.getElementById('f-codigo');
    if (c) c.focus();
  }

  function renderHome() {
    if (state.authTab === '2fa') return renderCodigo2fa();
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
              campoAuth('cpf', 'CPF', 'inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14" data-mask="cpf" required') +
              '<div class="field"><label for="f-tel">Telefone</label><input id="f-tel" name="telefone" type="tel" autocomplete="tel" placeholder="(11) 90000-0000" maxlength="15" data-mask="tel"></div>') +
            '<div class="field"><label for="f-email">E-mail</label><input id="f-email" name="email" type="email" autocomplete="email" required></div>' +
            '<div class="field"><label for="f-senha">Senha</label><input id="f-senha" name="password" type="password" autocomplete="' + (login ? 'current-password' : 'new-password') + '" required></div>' +
            (login ? '' :
              '<p class="form-sep">Endereço <span>opcional, você pode completar depois no perfil</span></p>' +
              campoAuth('cep', 'CEP', 'inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" data-mask="cep"') +
              campoAuth('rua', 'Rua', 'autocomplete="address-line1"') +
              '<div class="field-row">' +
                campoAuth('numero', 'Número', 'autocomplete="off"') +
                campoAuth('complemento', 'Complemento', 'autocomplete="address-line2" placeholder="Apto, bloco…"') +
              '</div>' +
              campoAuth('bairro', 'Bairro', 'autocomplete="address-level3"') +
              campoAuth('cidade', 'Cidade', 'autocomplete="address-level2"')) +
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

    var registro = state.authTab === 'registro';
    if (!d.email || !d.password || (registro && (!d.nome || !d.cpf))) {
      erro.innerHTML = '<div class="alert">Preencha todos os campos obrigatórios.</div>';
      return;
    }
    if (registro) {
      if (!cpfValido(d.cpf)) {
        erro.innerHTML = '<div class="alert">CPF inválido. Confira os números.</div>';
        return;
      }
      if (d.cep && soDigitos(d.cep).length !== 8) {
        erro.innerHTML = '<div class="alert">CEP inválido. Ele deve ter 8 números.</div>';
        return;
      }
      d.cpf = soDigitos(d.cpf);
      d.cep = soDigitos(d.cep);
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

  /* ============================================================
     PERFIL
  ============================================================ */
  function pf(nome, rotulo, valor, extra, somenteLeitura) {
    return '<label class="pf' + (somenteLeitura ? ' ro' : '') + '"><span>' + rotulo + '</span>' +
      '<input name="' + nome + '" type="text" value="' + esc(valor) + '" ' + (somenteLeitura ? 'readonly ' : '') + (extra || '') + '></label>';
  }

  function fotoHTML() {
    var src = state.fotoPreview || state.user.foto;
    return src ? '<img src="' + esc(src) + '" alt="Foto de perfil">' : esc(iniciais(state.user.nome));
  }

  /* ---------- Notificações (preferência deste dispositivo) ---------- */
  function notifSuportada() { return typeof Notification !== 'undefined'; }
  function notifAtiva() { return notifSuportada() && Notification.permission === 'granted' && load('notif') === '1'; }

  function notifTexto() {
    if (!notifSuportada()) return 'Não disponíveis neste navegador';
    if (Notification.permission === 'denied') return 'Bloqueadas nas configurações do navegador';
    return notifAtiva() ? 'Ativadas neste dispositivo' : 'Desativadas neste dispositivo';
  }

  function atualizarNotif() {
    var b = document.getElementById('btn-notif');
    var t = document.getElementById('notif-txt');
    if (b) b.setAttribute('aria-checked', notifAtiva() ? 'true' : 'false');
    if (t) t.textContent = notifTexto();
  }

  function alternarNotif() {
    if (!notifSuportada()) { toast('Este navegador não suporta notificações.'); return; }
    if (notifAtiva()) {
      save('notif', null);
      atualizarNotif();
      toast('Notificações desativadas neste dispositivo.');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('As notificações estão bloqueadas. Libere nas configurações do site no navegador.');
      return;
    }
    Promise.resolve(Notification.requestPermission()).then(function (p) {
      if (p === 'granted') { save('notif', '1'); toast('Notificações ativadas neste dispositivo.'); }
      else toast('Permissão não concedida. As notificações continuam desativadas.');
      atualizarNotif();
    });
  }

  /* ---------- Foto: recorta quadrado e reduz antes de enviar ---------- */
  function prepararFoto(file) {
    return new Promise(function (ok, no) {
      if (!/^image\//.test(file.type)) return no(new Error('Escolha um arquivo de imagem.'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var L = 320, lado = Math.min(img.width, img.height);
        var c = document.createElement('canvas');
        c.width = c.height = L;
        c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, L, L);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : no(new Error('Não foi possível processar a imagem.')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('Não foi possível ler essa imagem.')); };
      img.src = url;
    });
  }

  function trocarFoto(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    prepararFoto(file).then(function (blob) {
      state.fotoNova = blob;
      if (state.fotoPreview) URL.revokeObjectURL(state.fotoPreview);
      state.fotoPreview = URL.createObjectURL(blob);
      var b = document.querySelector('.foto-btn');
      if (b) b.innerHTML = fotoHTML();
      toast('Foto escolhida. Toque em "Salvar alterações" para confirmar.');
    }, function (e) { toast(e.message); });
  }

  function renderPerfil() {
    var u = state.user;
    app.innerHTML =
      '<form id="form-perfil" class="perfil" novalidate>' +
        '<div class="perfil-foto">' +
          '<button type="button" class="foto-btn" data-action="foto" aria-label="Alterar foto de perfil">' + fotoHTML() + '</button>' +
          '<input type="file" id="foto-input" accept="image/*" hidden>' +
          '<small>Altere sua foto de perfil</small>' +
        '</div>' +
        '<div id="perfil-erro"></div>' +
        pf('nome', 'Nome completo *', u.nome, '', true) +
        pf('email', 'E-mail *', u.email, '', true) +
        pf('telefone', 'Telefone *', mascaraTel(u.telefone), 'inputmode="tel" autocomplete="tel" placeholder="(11) 90000-0000" maxlength="15" data-mask="tel"') +
        pf('data_nascimento', 'Data nascimento *', dataDeISO(u.data_nascimento), 'inputmode="numeric" autocomplete="bday" placeholder="dd/mm/aaaa" maxlength="10" data-mask="data"') +
        pf('cpf', 'CPF', mascaraCPF(u.cpf), '', true) +
        pf('cep', 'CEP', mascaraCEP(u.cep), 'inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" data-mask="cep"') +
        pf('rua', 'Rua', u.rua, 'autocomplete="address-line1"') +
        pf('numero', 'Número', u.numero, 'autocomplete="off"') +
        pf('complemento', 'Complemento', u.complemento, 'autocomplete="address-line2" placeholder="Apto, bloco…"') +
        pf('cidade', 'Cidade', u.cidade, 'autocomplete="address-level2"') +
        pf('bairro', 'Bairro', u.bairro, 'autocomplete="address-level3"') +
        pf('estado', 'Estado', u.estado, 'autocomplete="address-level1" maxlength="2" placeholder="UF" style="text-transform:uppercase"') +
        '<div class="link-cards">' +
          '<button type="button" class="card-link" data-action="alterar-senha">' + ICO.key +
            '<span class="t"><strong>Alterar senha</strong><small>Troque a senha de acesso à sua conta</small></span>' + ICO.chev + '</button>' +
          '<button type="button" class="card-link" data-go="integracoes">' + ICO.gear +
            '<span class="t"><strong>Integrações</strong><small>Google Agenda</small></span>' + ICO.chev + '</button>' +
          '<button type="button" class="card-link" id="btn-notif" role="switch" data-action="notif" aria-checked="' + (notifAtiva() ? 'true' : 'false') + '">' + ICO.bell +
            '<span class="t"><strong>Notificações</strong><small id="notif-txt">' + esc(notifTexto()) + '</small></span><span class="switch"></span></button>' +
        '</div>' +
        '<div class="bottom-bar"><div class="bottom-inner"><button class="btn block" type="submit">Salvar alterações</button></div></div>' +
      '</form>';
  }

  function salvarPerfil(form) {
    var erro = document.getElementById('perfil-erro');
    var btn = form.querySelector('button[type=submit]');
    var el = form.elements;
    function falha(msg) {
      erro.innerHTML = '<div class="alert">' + esc(msg) + '</div>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    erro.innerHTML = '';

    var tel = soDigitos(el.telefone.value);
    if (tel.length < 10 || tel.length > 11) return falha('Informe um telefone válido, com DDD.');
    var nasc = dataParaISO(el.data_nascimento.value.trim());
    if (!nasc) return falha('Informe uma data de nascimento válida, no formato dd/mm/aaaa.');
    var cep = soDigitos(el.cep.value);
    if (cep && cep.length !== 8) return falha('CEP inválido. Ele deve ter 8 números.');
    var estado = el.estado.value.trim().toUpperCase();
    if (estado && !/^[A-Z]{2}$/.test(estado)) return falha('Use a sigla do estado com 2 letras, por exemplo SP.');

    var dados = {
      telefone: el.telefone.value.trim(),
      data_nascimento: nasc,
      cep: cep,
      rua: el.rua.value.trim(),
      numero: el.numero.value.trim(),
      complemento: el.complemento.value.trim(),
      cidade: el.cidade.value.trim(),
      bairro: el.bairro.value.trim(),
      estado: estado,
    };
    var corpo = dados;
    if (state.fotoNova) {
      corpo = new FormData();
      Object.keys(dados).forEach(function (k) { corpo.append(k, dados[k]); });
      corpo.append('foto', state.fotoNova, 'foto.jpg');
    }

    btn.disabled = true;
    btn.textContent = 'Salvando…';
    api('/api/auth/perfil/', { method: 'PATCH', body: corpo }).then(function (r) {
      var novo = Object.assign({}, state.user, (r && typeof r === 'object') ? r : dados);
      if (state.fotoNova && !(r && r.foto)) novo.foto = state.fotoPreview;
      state.user = novo;
      state.fotoNova = null;
      toast('Perfil atualizado.');
    }, function (e) {
      falha(e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    });
  }

  /* ============================================================
     ALTERAR SENHA
  ============================================================ */
  function erroSheet(msg) {
    var e = document.getElementById('form-erro');
    if (e) e.innerHTML = '<div class="alert">' + esc(msg) + '</div>';
  }

  function enviarSheet(form, url, metodo, corpo, depois) {
    var btn = form.querySelector('button[type=submit]');
    document.getElementById('form-erro').innerHTML = '';
    btn.disabled = true;
    api(url, { method: metodo, body: corpo }).then(function (r) {
      fecharSheet();
      depois(r);
    }, function (e) {
      erroSheet(e.message);
      btn.disabled = false;
    });
  }

  /* ---------- Alterar senha ---------- */
  function formSenha() {
    return '<form id="form-senha" novalidate><div id="form-erro"></div>' +
      '<div class="field"><label for="f-sa">Senha atual</label><input id="f-sa" name="senha_atual" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="f-sn">Nova senha</label><input id="f-sn" name="nova_senha" type="password" autocomplete="new-password" required></div>' +
      '<div class="field"><label for="f-sc">Confirmar nova senha</label><input id="f-sc" name="confirmar" type="password" autocomplete="new-password" required></div>' +
      '<button class="btn block" type="submit">Salvar nova senha</button></form>';
  }

  function salvarSenha(form) {
    var atual = form.elements.senha_atual.value;
    var nova = form.elements.nova_senha.value;
    if (!atual || !nova || !form.elements.confirmar.value) return erroSheet('Preencha todos os campos.');
    if (nova.length < 8) return erroSheet('A nova senha precisa ter pelo menos 8 caracteres.');
    if (nova !== form.elements.confirmar.value) return erroSheet('A confirmação não é igual à nova senha.');
    if (nova === atual) return erroSheet('A nova senha precisa ser diferente da atual.');
    enviarSheet(form, '/api/auth/alterar-senha/', 'POST', { senha_atual: atual, nova_senha: nova }, function () {
      toast('Senha alterada com sucesso.');
    });
  }

  /* ============================================================
     INTEGRAÇÕES · GOOGLE AGENDA
  ============================================================ */
  function renderIntegracoes() {
    app.innerHTML = barraTopo('Integrações', 'perfil') +
      '<div class="stack"><section class="card" id="card-google"><p class="hint center">Carregando…</p></section></div>';
    carregarGoogle();
  }

  function carregarGoogle() {
    var el = document.getElementById('card-google');
    if (el) el.innerHTML = '<p class="hint center">Carregando…</p>';
    api('/api/agenda/google/').then(function (r) {
      desenharGoogle(!!(r && r.conectado));
    }, function (e) {
      var c = document.getElementById('card-google');
      if (c) c.innerHTML = '<div class="alert">' + esc(e.message) + '</div>' +
        '<button class="btn outline block" data-action="google-recarregar">Tentar novamente</button>';
    });
  }

  function desenharGoogle(conectado) {
    var el = document.getElementById('card-google');
    if (!el) return;
    el.innerHTML =
      '<div class="card-head centro"><span class="ico-badge blue">' + ICO.cal + '</span><h3>Google Agenda</h3></div>' +
      '<p class="card-texto">' + (conectado
        ? 'Seus agendamentos são sincronizados automaticamente com o seu Google Agenda.'
        : 'Conecte sua conta Google para sincronizar seus agendamentos automaticamente com o Google Agenda.') + '</p>' +
      '<span class="badge com-icone ' + (conectado ? 'concluido' : 'cancelado') + '">' + (conectado ? ICO.checkCircle + 'Conectado' : 'Não conectado') + '</span>' +
      (conectado
        ? '<button class="btn outline-danger block" data-action="google-remover">' + ICO.calX + 'Remover integração</button>'
        : '<button class="btn block" data-action="google-conectar">Conectar Google Agenda</button>');
  }

  function conectarGoogle(btn) {
    btn.disabled = true;
    api('/api/agenda/google/conectar/').then(function (r) {
      if (r && typeof r.url === 'string' && /^https:\/\//.test(r.url)) { window.location.href = r.url; return; }
      throw new ApiError(500, { detail: 'O servidor não devolveu o endereço de autorização do Google.' });
    }).catch(function (e) {
      btn.disabled = false;
      toast(e.message);
    });
  }

  function removerGoogle(btn) {
    if (!window.confirm('Remover a integração com o Google Agenda? Seus próximos agendamentos deixarão de ser sincronizados.')) return;
    btn.disabled = true;
    api('/api/agenda/google/', { method: 'DELETE' }).then(function () {
      toast('Integração removida.');
      desenharGoogle(false);
    }, function (e) {
      toast(e.message);
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
  function barraTopo(titulo, destino) {
    return '<div class="head-bar"><button class="back" data-go="' + (destino || 'agendar') + '" aria-label="Voltar">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/></svg>' +
      '</button><h1 class="bar-title">' + esc(titulo || 'Novo agendamento') + '</h1></div>';
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

    if (el.dataset.action === 'voltar-login') { state.authTab = 'login'; state.token2fa = null; return renderHome(); }
    if (el.dataset.action === 'foto') return document.getElementById('foto-input').click();
    if (el.dataset.action === 'notif') return alternarNotif();
    if (el.dataset.action === 'alterar-senha') return folha('Alterar senha', formSenha());
    if (el.dataset.action === 'google-conectar') return conectarGoogle(el);
    if (el.dataset.action === 'google-remover') return removerGoogle(el);
    if (el.dataset.action === 'google-recarregar') return carregarGoogle();

    if (el.dataset.action === 'menu') return abrirMenu();
    if (el.dataset.action === 'fechar-menu') return fecharMenu();
    if (el.dataset.action === 'novo-servico') return folha('Novo serviço', formServico());
    if (el.dataset.action === 'editar-servico') {
      return folha('Editar serviço', formServico(state.admServicos.filter(function (x) { return x.id === Number(el.dataset.id); })[0]));
    }
    if (el.dataset.action === 'novo-prof') return abrirProf(null);
    if (el.dataset.action === 'editar-prof') return abrirProf(Number(el.dataset.id));
    if (el.dataset.action === 'remover-prof') return removerProf(Number(el.dataset.id), el);
    if (el.dataset.action === 'add-janela') return addJanela(el);
    if (el.dataset.action === 'rm-janela') return rmJanela(el);
    if (el.dataset.grafAbrir) {
      state.graf.aberto = state.graf.aberto === el.dataset.grafAbrir ? null : el.dataset.grafAbrir;
      state.graf.selIni = null;
      return desenharGraficos();
    }
    if (el.dataset.calDia) return escolherDiaCal(el.dataset.calDia);
    if (el.dataset.calMes) {
      var cm = state.graf.calMes;
      state.graf.calMes = new Date(cm.getFullYear(), cm.getMonth() + Number(el.dataset.calMes), 1);
      return desenharGraficos();
    }
    if (el.dataset.calAtalho) return atalhoPeriodo(el.dataset.calAtalho);
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

  // Máscaras (CPF, CEP, telefone, data, código) e busca de endereço pelo CEP
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    var mascara = el.dataset && MASCARAS[el.dataset.mask];
    if (!mascara) return;
    var v = mascara(el.value);
    if (v !== el.value) el.value = v;
    if (el.dataset.mask === 'cep') buscarCep(el);
  });

  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'foto-input') trocarFoto(ev.target);
    if (ev.target.closest('[data-graf-filtro]')) mudarFiltroGraf(ev.target);
    if (ev.target.hasAttribute('data-dia-ativo')) marcarDiaTrab(ev.target);
  });

  document.addEventListener('mousemove', mostrarTip);

  document.addEventListener('submit', function (ev) {
    var fid = ev.target.id;
    if (fid === 'auth-form') { ev.preventDefault(); submeterAuth(ev.target); }
    else if (fid === 'form-2fa-login') { ev.preventDefault(); verificar2faLogin(ev.target); }
    else if (fid === 'form-servico') { ev.preventDefault(); salvarServico(ev.target); }
    else if (fid === 'form-prof') { ev.preventDefault(); salvarProf(ev.target); }
    else if (fid === 'form-perfil') { ev.preventDefault(); salvarPerfil(ev.target); }
    else if (fid === 'form-senha') { ev.preventDefault(); salvarSenha(ev.target); }
  });

  /* ------------------------------------------------------------
     Início
  ------------------------------------------------------------ */
  // Retorno do consentimento do Google: o servidor redireciona para /?google=ok (ou erro)
  var retornoGoogle = null;
  try {
    retornoGoogle = new URLSearchParams(window.location.search).get('google');
    if (retornoGoogle) window.history.replaceState(null, '', window.location.pathname);
  } catch (e) {}

  if (state.access) {
    app.innerHTML = '<div class="loading">Carregando…</div>';
    carregarPerfil().then(function () {
      if (!retornoGoogle) return;
      state.view = 'integracoes';
      render();
      toast(retornoGoogle === 'ok' ? 'Google Agenda conectado com sucesso.' : 'Não foi possível conectar o Google Agenda.');
    }, function () { sair(true); });
  } else {
    render();
  }
})();
