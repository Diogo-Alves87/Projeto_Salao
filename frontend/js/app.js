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

  function haTempo(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    function plural(n, um, varios) { return 'há ' + n + ' ' + (n === 1 ? um : varios); }
    if (isNaN(s)) return '';
    if (s < 60) return 'há menos de um minuto';
    if (s < 3600) return plural(Math.floor(s / 60), 'minuto', 'minutos');
    if (s < 86400) return plural(Math.floor(s / 3600), 'hora', 'horas');
    if (s < 86400 * 30) return plural(Math.floor(s / 86400), 'dia', 'dias');
    if (s < 86400 * 365) return plural(Math.floor(s / (86400 * 30)), 'mês', 'meses');
    return plural(Math.floor(s / (86400 * 365)), 'ano', 'anos');
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  var CAMPOS = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', password: 'Senha', inicio: 'Horário', servico: 'Serviço', profissional: 'Profissional', cliente: 'Cliente', descricao: 'Descrição', duracao_minutos: 'Duração', preco: 'Preço', servicos: 'Serviços', intervalo_minutos: 'Intervalo', usuario: 'Usuário',
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

  var TITULOS = { agendar: 'Início', novo: 'Início', meus: 'Agendamentos', planos: 'Planos', servicos: 'Serviços', profissionais: 'Profissionais', perfil: 'Perfil', seguranca: 'Perfil', integracoes: 'Perfil' };

  function itensMenu() {
    var t = state.user.tipo;
    var itens;
    if (t === 'admin') itens = [
      ['meus', 'Agendamentos', ICO.cal],
      ['servicos', 'Serviços', ICO.tag],
      ['profissionais', 'Profissionais', ICO.users],
      ['admin', 'Painel completo', ICO.gear],
    ];
    else if (t === 'profissional') itens = [['meus', 'Agendamentos', ICO.cal]];
    else itens = [['agendar', 'Início', ICO.home], ['meus', 'Agendamentos', ICO.cal], ['planos', 'Planos', ICO.layers]];
    itens.push(['perfil', 'Perfil', ICO.user]);
    return itens;
  }

  var SUBTELAS_PERFIL = ['seguranca', 'integracoes'];

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
    if (state.view === 'perfil') return renderPerfil();
    if (state.view === 'seguranca') return renderSeguranca();
    if (state.view === 'integracoes') return renderIntegracoes();
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
          '<button type="button" class="card-link" data-go="seguranca">' + ICO.shield +
            '<span class="t"><strong>Segurança da conta</strong><small>Senha, autenticação em dois fatores</small></span>' + ICO.chev + '</button>' +
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
     SEGURANÇA DA CONTA
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

  function campoCodigo(id) {
    return '<div class="field"><label for="' + id + '">Código de 6 dígitos</label>' +
      '<input id="' + id + '" name="codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" data-mask="cod"></div>';
  }

  function renderSeguranca() {
    app.innerHTML = barraTopo('Segurança da conta', 'perfil') +
      '<div class="stack">' +
        '<section class="card" id="card-2fa"><p class="hint center">Carregando…</p></section>' +
        '<section class="card">' +
          '<div class="card-head"><span class="plain-ico">' + ICO.lock + '</span>' +
            '<div class="grow"><h3>Senha</h3><p>Altere sua senha de acesso</p></div></div>' +
          '<button class="btn outline block" data-action="alterar-senha">' + ICO.key + 'Alterar Senha</button>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card-head"><span class="plain-ico">' + ICO.laptop + '</span>' +
            '<div class="grow"><h3>Sessões Ativas</h3><p>Gerencie os dispositivos conectados à sua conta</p></div></div>' +
          '<div id="lista-sessoes"><p class="hint center">Carregando…</p></div>' +
        '</section>' +
      '</div>';
    carregar2fa();
    carregarSessoes();
  }

  /* ---------- Autenticação em dois fatores ---------- */
  function desenhar2fa(ativo) {
    var el = document.getElementById('card-2fa');
    if (!el) return;
    el.innerHTML =
      '<div class="card-head">' +
        '<span class="ico-badge ' + (ativo ? 'ok' : 'warn') + '">' + (ativo ? ICO.shieldOk : ICO.warn) + '</span>' +
        '<div class="grow"><h3>Autenticação em Dois Fatores</h3><p>' +
          (ativo
            ? 'Sua conta está protegida. A cada novo login vamos pedir o código do seu aplicativo autenticador.'
            : 'Adicione uma camada extra de segurança à sua conta usando um aplicativo autenticador como Google Authenticator ou Authy.') +
        '</p></div>' +
        '<span class="badge ' + (ativo ? 'concluido' : 'aviso') + '">' + (ativo ? 'Ativo' : 'Inativo') + '</span>' +
      '</div>' +
      (ativo
        ? '<button class="btn outline-danger block" data-action="2fa-desativar">Desativar</button>'
        : '<button class="btn block" data-action="2fa-ativar">Ativar</button>');
  }

  function carregar2fa() {
    var el = document.getElementById('card-2fa');
    if (el) el.innerHTML = '<p class="hint center">Carregando…</p>';
    api('/api/auth/2fa/').then(function (r) {
      desenhar2fa(!!(r && r.ativo));
    }, function (e) {
      var c = document.getElementById('card-2fa');
      if (c) c.innerHTML = '<div class="alert">' + esc(e.message) + '</div>' +
        '<button class="btn outline block" data-action="2fa-recarregar">Tentar novamente</button>';
    });
  }

  function corpo2fa(r) {
    var chave = String(r.secret || '').replace(/\s+/g, '');
    var agrupada = chave.replace(/(.{4})/g, '$1 ').trim();
    var qr = (typeof r.qr === 'string' && /^data:image\/(png|jpeg|svg\+xml);/.test(r.qr)) ? r.qr : '';
    var uri = (typeof r.otpauth_url === 'string' && /^otpauth:\/\//.test(r.otpauth_url)) ? r.otpauth_url : '';
    return '<ol class="passos">' +
        '<li>Instale um aplicativo autenticador, como Google Authenticator ou Authy.</li>' +
        '<li>' + (qr ? 'Escaneie o QR code ou digite a chave abaixo.' : 'Adicione uma conta digitando a chave abaixo.') + '</li>' +
        '<li>Digite aqui o código de 6 dígitos que o aplicativo mostrar.</li>' +
      '</ol>' +
      (qr ? '<div class="qr"><img src="' + esc(qr) + '" alt="QR code para o aplicativo autenticador"></div>' : '') +
      '<div class="chave"><code id="chave-2fa" data-chave="' + esc(chave) + '">' + esc(agrupada) + '</code>' +
        '<button type="button" class="btn ghost small" data-action="copiar-chave">Copiar</button></div>' +
      (uri ? '<a class="link link-centro" href="' + esc(uri) + '">Abrir no aplicativo autenticador</a>' : '') +
      '<form id="form-2fa-ativar" novalidate><div id="form-erro"></div>' + campoCodigo('f-cod-ativar') +
        '<button class="btn block" type="submit">Confirmar e ativar</button></form>';
  }

  function iniciar2fa(btn) {
    btn.disabled = true;
    api('/api/auth/2fa/configurar/', { method: 'POST' }).then(function (r) {
      btn.disabled = false;
      if (!r || !r.secret) throw new ApiError(500, { detail: 'O servidor não devolveu a chave do autenticador.' });
      folha('Ativar dois fatores', corpo2fa(r));
    }).catch(function (e) {
      btn.disabled = false;
      toast(e.message);
    });
  }

  function copiarChave() {
    var chave = document.getElementById('chave-2fa').dataset.chave;
    var manual = function () { toast('Não foi possível copiar. Selecione a chave e copie manualmente.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(chave).then(function () { toast('Chave copiada.'); }, manual);
    } else manual();
  }

  function confirmar2fa(form, ativar) {
    var codigo = mascaraCodigo(form.elements.codigo.value);
    if (codigo.length !== 6) return erroSheet('Digite o código de 6 dígitos.');
    enviarSheet(form, ativar ? '/api/auth/2fa/ativar/' : '/api/auth/2fa/desativar/', 'POST', { codigo: codigo }, function () {
      toast(ativar ? 'Autenticação em dois fatores ativada.' : 'Autenticação em dois fatores desativada.');
      desenhar2fa(ativar);
    });
  }

  function abrirDesativar2fa() {
    folha('Desativar dois fatores',
      '<p class="form-nota">Para desativar, digite o código de 6 dígitos do seu aplicativo autenticador.</p>' +
      '<form id="form-2fa-desativar" novalidate><div id="form-erro"></div>' + campoCodigo('f-cod-desativar') +
      '<button class="btn danger block" type="submit">Desativar</button></form>');
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

  /* ---------- Sessões ativas ---------- */
  function carregarSessoes() {
    api('/api/auth/sessoes/').then(function (d) {
      desenharSessoes(lista(d));
    }, function (e) {
      var box = document.getElementById('lista-sessoes');
      if (box) box.innerHTML = '<div class="alert">' + esc(e.message) + '</div>' +
        '<button class="btn outline block" data-action="sessoes-recarregar">Tentar novamente</button>';
    });
  }

  function desenharSessoes(itens) {
    var box = document.getElementById('lista-sessoes');
    if (!box) return;
    itens = itens.slice().sort(function (a, b) {
      if (!!a.atual !== !!b.atual) return a.atual ? -1 : 1;
      return new Date(b.ultimo_acesso) - new Date(a.ultimo_acesso);
    });
    if (!itens.length) { box.innerHTML = '<p class="hint center">Nenhuma sessão ativa encontrada.</p>'; return; }
    var outras = itens.filter(function (s) { return !s.atual; }).length;

    box.innerHTML = '<div class="sessoes">' + itens.map(function (s) {
      var movel = /android|ios|iphone|ipad|mobile/i.test(s.dispositivo || '');
      return '<div class="sessao' + (s.atual ? ' atual' : '') + '">' +
        '<span class="sessao-ico">' + (movel ? ICO.phone : ICO.desktop) + '</span>' +
        '<div class="sessao-info">' +
          '<strong>' + esc(s.dispositivo || 'dispositivo') + (s.atual ? '<span class="badge concluido">Este dispositivo</span>' : '') + '</strong>' +
          '<span>' + esc(s.descricao) + '</span>' +
          '<small>IP: ' + esc(s.ip) + ' • ' + esc(haTempo(s.ultimo_acesso)) + '</small>' +
        '</div>' +
        (s.atual ? '' : '<button class="btn outline-danger small" data-sessao="' + esc(s.id) + '">Encerrar</button>') +
      '</div>';
    }).join('') + '</div>' +
    (outras
      ? '<button class="btn outline-danger block" data-action="encerrar-outras">' + ICO.logout + 'Sair de todos os outros dispositivos</button>' +
        '<p class="nota">Ao sair de todos os outros dispositivos, essa sessão continuará ativa.</p>'
      : '');
  }

  function encerrarSessao(id, btn) {
    if (!window.confirm('Encerrar esta sessão? O dispositivo será desconectado.')) return;
    btn.disabled = true;
    api('/api/auth/sessoes/' + encodeURIComponent(id) + '/', { method: 'DELETE' }).then(function () {
      toast('Sessão encerrada.');
      carregarSessoes();
    }, function (e) {
      toast(e.message);
      btn.disabled = false;
    });
  }

  function encerrarOutras(btn) {
    if (!window.confirm('Sair de todos os outros dispositivos? Esta sessão continuará ativa.')) return;
    btn.disabled = true;
    api('/api/auth/sessoes/encerrar-outras/', { method: 'POST' }).then(function () {
      toast('Os outros dispositivos foram desconectados.');
      carregarSessoes();
    }, function (e) {
      toast(e.message);
      btn.disabled = false;
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
    if (el.dataset.action === '2fa-ativar') return iniciar2fa(el);
    if (el.dataset.action === '2fa-desativar') return abrirDesativar2fa();
    if (el.dataset.action === '2fa-recarregar') return carregar2fa();
    if (el.dataset.action === 'copiar-chave') return copiarChave();
    if (el.dataset.action === 'sessoes-recarregar') return carregarSessoes();
    if (el.dataset.action === 'encerrar-outras') return encerrarOutras(el);
    if (el.dataset.sessao) return encerrarSessao(el.dataset.sessao, el);
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
  });

  document.addEventListener('submit', function (ev) {
    var fid = ev.target.id;
    if (fid === 'auth-form') { ev.preventDefault(); submeterAuth(ev.target); }
    else if (fid === 'form-2fa-login') { ev.preventDefault(); verificar2faLogin(ev.target); }
    else if (fid === 'form-servico') { ev.preventDefault(); salvarServico(ev.target); }
    else if (fid === 'form-prof') { ev.preventDefault(); salvarProf(ev.target); }
    else if (fid === 'form-perfil') { ev.preventDefault(); salvarPerfil(ev.target); }
    else if (fid === 'form-senha') { ev.preventDefault(); salvarSenha(ev.target); }
    else if (fid === 'form-2fa-ativar') { ev.preventDefault(); confirmar2fa(ev.target, true); }
    else if (fid === 'form-2fa-desativar') { ev.preventDefault(); confirmar2fa(ev.target, false); }
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
