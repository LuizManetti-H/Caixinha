/* Caixinha · Lógica da interface */
(function () {
  'use strict';

  const $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  const $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  const FAM_COLORS = ['#009C3B', '#FFDF00', '#002776', '#e5484d', '#0ea5e9', '#d946ef',
    '#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#22c55e', '#eab308'];
  // Tons da bandeira do Brasil e defaults por família (interior, letra, borda).
  const FLAG_GREEN = '#009C3B', FLAG_YELLOW = '#FFDF00', FLAG_BLUE = '#002776';
  const FAM_DEFAULTS = [
    { bg: FLAG_GREEN, fg: FLAG_BLUE, border: FLAG_YELLOW },
    { bg: FLAG_YELLOW, fg: FLAG_GREEN, border: FLAG_BLUE },
    { bg: FLAG_BLUE, fg: FLAG_YELLOW, border: FLAG_GREEN }
  ];

  const state = {
    tripId: null,
    editingExpenseId: null,
    confirmCb: null,
    deletePassCb: null,
    search: '',
    view: 'resumo',
    route: 'gate',
    gatePrefill: '',
    gateError: ''
  };

  // ---------- Helpers ----------
  function famColor(i) { return FAM_COLORS[i % FAM_COLORS.length]; }

  // Cores do "box" de cada família (borda, interior, letra), com defaults por índice.
  function famVisual(trip, i) {
    const c = trip && trip.colors && trip.colors[i];
    if (c && (c.bg || c.fg || c.border)) {
      const bg = c.bg || '#ffffff';
      return { bg: bg, fg: c.fg || '#ffffff', border: c.border || bg };
    }
    if (FAM_DEFAULTS[i]) return Object.assign({}, FAM_DEFAULTS[i]);
    const base = famColor(i);
    return { bg: base, fg: '#ffffff', border: base };
  }
  function avatarStyle(trip, i) {
    const v = famVisual(trip, i);
    return 'background:' + v.bg + ';color:' + v.fg + ';border:1.5px solid ' + v.border;
  }
  function dotStyle(trip, i) {
    if (i < 0) return 'background:#999;border-color:#999';
    const v = famVisual(trip, i);
    return 'background:' + v.bg + ';border-color:' + v.border;
  }
  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0] || '')[0] || '' ).toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
  }

  function currentTrip() { return state.tripId ? Store.getTrip(state.tripId) : null; }

  function fmtMoney(n, trip) {
    const sym = (trip && trip.currency && trip.currency.symbol) || '$';
    const neg = n < 0;
    const v = Math.abs(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + sym + ' ' + v;
  }
  function fmtNum(n) {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  // Nº de casas decimais reais de um número (sem arredondar).
  function partDecimalsOf(n) {
    const s = String(Number(n));
    if (!isFinite(n) || s.indexOf('e') !== -1 || s.indexOf('E') !== -1) return 0;
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }
  // Regras de exibição das partes:
  // - inteiro: sem casas
  // - decimal: no mínimo 2 casas
  // - se houver zero após a segunda casa, limita a exibição a 2 casas
  function partDisplayDecimals(n) {
    const v = Number(n);
    if (!isFinite(v) || Number.isInteger(v)) return 0;
    const decimals = partDecimalsOf(v);
    if (decimals <= 2) return 2;
    const fraction = String(v).split('.')[1] || '';
    return fraction.slice(2).indexOf('0') !== -1 ? 2 : decimals;
  }
  function partFixedString(n, dec, grouped) {
    const v = Number(n);
    if (!isFinite(v)) return '';
    const sign = v < 0 ? '-' : '';
    const raw = String(Math.abs(v)).split('.');
    const integer = grouped
      ? Number(raw[0]).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
      : raw[0];
    if (dec <= 0) return sign + integer;
    const fraction = (raw[1] || '').padEnd(dec, '0').slice(0, dec);
    return sign + integer + ',' + fraction;
  }
  // Valor da parte para o input (precisão total, vírgula decimal).
  function partToInput(n) {
    if (n === '' || n == null) return '';
    const v = Number(n);
    if (!isFinite(v)) return '';
    const dec = partDisplayDecimals(v);
    return partFixedString(v, dec, false);
  }
  // Formata a parte com um nº fixo de casas decimais.
  function fmtPartNum(n, dec) {
    return partFixedString(n, dec, true);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const parts = String(iso).split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    return iso;
  }
  function fmtDateShort(iso) {
    if (!iso) return '';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parts = String(iso).split('-');
    if (parts.length === 3) {
      const m = parseInt(parts[1], 10);
      return parts[2] + '.' + (MONTHS[m - 1] || parts[1]);
    }
    return iso;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    const host = $('#toastHost');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(function () { el.remove(); }, 260);
    }, 2600);
  }

  // ---------- Sincronização (GitHub) ----------
  // Envia a caixinha para o repositório. Silencioso quando não há token.
  function syncPush(trip) {
    if (!trip || typeof Sync === 'undefined' || !Sync.isConfigured()) return;
    Sync.pushTrip(trip).catch(function (e) {
      if (e && e.code === 'NOT_CONFIGURED') return;
      toast('Falha ao enviar ao GitHub: ' + (e && e.message ? e.message : 'erro'), 'error');
    });
  }

  function syncDelete(id) {
    if (!id || typeof Sync === 'undefined' || !Sync.isConfigured()) return;
    Sync.deleteTrip(id).catch(function (e) {
      if (e && e.code === 'NOT_CONFIGURED') return;
      toast('Falha ao remover no GitHub: ' + (e && e.message ? e.message : 'erro'), 'error');
    });
  }

  // Edições só são permitidas quando há token (sync ready). Sem token, modo somente leitura.
  function canEdit() {
    return typeof Sync !== 'undefined' && !!(Sync.getConfig().token);
  }
  function requireEdit() {
    if (canEdit()) return true;
    toast('Somente leitura: configure o token em Sincronização para editar.', 'error');
    return false;
  }
  function applyEditability() {
    const ro = !canEdit();
    document.body.classList.toggle('is-readonly', ro);
    $$('.fn-chip[data-action="add-expense"]').forEach(function (b) { b.disabled = ro; });
    $$('[data-action="new-trip"]').forEach(function (b) { b.disabled = ro; });
    $$('[data-action="edit-trip"]').forEach(function (b) { b.disabled = ro; });
    $$('[data-action="sync-now"]').forEach(function (b) { b.disabled = ro; });
    const modeEl = $('#menuMode');
    if (modeEl) {
      modeEl.textContent = ro ? 'Modo Leitura' : 'Modo Escrita';
      modeEl.classList.toggle('read', ro);
      modeEl.classList.toggle('write', !ro);
    }
  }

  // Busca as edições do repositório e re-renderiza se necessário.
  function pullAndRefresh(silent) {
    if (typeof Sync === 'undefined' || !Sync.hasRepo()) {
      if (!silent) toast('Sincronização não configurada.', 'error');
      return Promise.resolve();
    }
    return Sync.pull().then(function () {
      if (state.route === 'trip' && state.tripId) {
        if (Store.getTrip(state.tripId)) render();
        else handleRoute();
      } else if (state.route === 'gate') {
        // Uma caixinha nova pode ter chegado; se o gate espera um código, tenta abrir.
        handleRoute();
      }
      if (!silent) toast('Sincronizado.', 'success');
    }).catch(function (e) {
      if (!silent) toast('Falha ao sincronizar: ' + (e && e.message ? e.message : 'erro'), 'error');
    });
  }

  // ---------- Render principal ----------
  function render() {
    const trip = currentTrip();
    const onGate = state.route !== 'trip' || !trip;

    $('#gateView').hidden = !onGate;
    $('#tripView').hidden = onGate;
    $('#chipBar').hidden = onGate;
    $('#topbarActions').hidden = onGate;
    document.body.classList.toggle('is-gate', onGate);
    document.documentElement.classList.toggle('is-gate', onGate);
    applyEditability();

    if (onGate) {
      $('#brandTitle').textContent = 'Caixinha';
      $('#brandSub').textContent = 'Finanças de viagem';
      renderGate();
      return;
    }

    const data = Calc.compute(trip);
    renderTripHeader(trip, data);
    renderConsolidated(trip, data);
    renderBalances(trip, data);
    renderMatrix(trip, data);
    renderExpenses(trip);
    applyView();
  }

  // ---------- Entrada por código (gate) e roteamento por URL (#CODIGO) ----------
  function getHashCode() {
    return Store.sanitizeCode((location.hash || '').replace(/^#/, ''));
  }

  function setHash(code) {
    const c = Store.sanitizeCode(code);
    if (c) {
      if (getHashCode() !== c) location.hash = c;
    } else if (location.hash) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        location.hash = '';
      }
    }
  }

  function handleRoute() {
    const code = getHashCode();
    if (!code) { showGate(); return; }
    const trip = Store.getTripByCode(code);
    if (trip) {
      state.tripId = trip.id;
      Store.setCurrent(trip.id);
      state.route = 'trip';
      state.view = 'resumo';
      render();
    } else {
      showGate(code, 'Nenhuma caixinha encontrada com o código "' + code + '".');
    }
  }

  function openTrip(tripId) {
    const trip = Store.getTrip(tripId);
    if (!trip) { showGate(); return; }
    state.tripId = tripId;
    Store.setCurrent(tripId);
    state.route = 'trip';
    state.view = 'resumo';
    setHash(trip.code || '');
    render();
  }

  function showGate(prefillCode, errorMsg) {
    state.route = 'gate';
    state.tripId = null;
    state.gatePrefill = prefillCode || '';
    state.gateError = errorMsg || '';
    setHash('');
    render();
  }

  function renderGate() {
    const gc = $('#gateCode');
    if (gc._setCode) gc._setCode(state.gatePrefill || '');
    const err = $('#gateError');
    if (state.gateError) { err.textContent = state.gateError; err.hidden = false; }
    else { err.hidden = true; }
    state.gateError = '';
    updateSyncBadge();
    setTimeout(function () { if (gc._focus) gc._focus(); }, 60);
  }

  // Verde só quando o teste de sincronização passa (token válido com escrita).
  function updateSyncBadge() {
    const syncLink = $('.gate-sync-link');
    if (!syncLink) return;
    if (typeof Sync === 'undefined' || !Sync.isConfigured()) {
      syncLink.classList.remove('is-synced');
      return;
    }
    Sync.test().then(function (r) {
      syncLink.classList.toggle('is-synced', !!(r && r.ok));
    }).catch(function () {
      syncLink.classList.remove('is-synced');
    });
  }

  function submitGate(ev) {
    ev.preventDefault();
    const code = $('#gateCode')._getCode();
    const err = $('#gateError');
    if (!code) { err.textContent = 'Digite o código da caixinha.'; err.hidden = false; return; }
    const trip = Store.getTripByCode(code);
    if (!trip) {
      err.textContent = 'Nenhuma caixinha encontrada com o código "' + code + '".';
      err.hidden = false;
      return;
    }
    openTrip(trip.id);
  }

  // Componente de código: N caixinhas de 1 caractere.
  function setupCodeInput(container) {
    const len = parseInt(container.getAttribute('data-len'), 10) || 10;
    container.innerHTML = '';
    const boxes = [];
    function clean(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    for (let i = 0; i < len; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'code-box';
      inp.maxLength = 1;
      inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Caractere ' + (i + 1));
      container.appendChild(inp);
      boxes.push(inp);
    }
    boxes.forEach(function (inp, i) {
      inp.addEventListener('input', function () {
        inp.value = clean(inp.value).slice(-1);
        if (inp.value && i < len - 1) boxes[i + 1].focus();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !inp.value && i > 0) {
          e.preventDefault();
          boxes[i - 1].value = '';
          boxes[i - 1].focus();
        } else if (e.key === 'ArrowLeft' && i > 0) {
          e.preventDefault(); boxes[i - 1].focus();
        } else if (e.key === 'ArrowRight' && i < len - 1) {
          e.preventDefault(); boxes[i + 1].focus();
        }
      });
      inp.addEventListener('paste', function (e) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const chars = clean(text).split('');
        for (let k = 0; k < chars.length && i + k < len; k++) boxes[i + k].value = chars[k];
        boxes[Math.min(i + chars.length, len - 1)].focus();
      });
    });
    container._getCode = function () {
      return boxes.map(function (b) { return b.value; }).join('');
    };
    container._setCode = function (code) {
      const c = clean(code);
      boxes.forEach(function (b, k) { b.value = c[k] || ''; });
    };
    container._focus = function () { boxes[0].focus(); };
    container._clear = function () { boxes.forEach(function (b) { b.value = ''; }); };
  }

  function applyView() {
    $$('#tripView [data-view]').forEach(function (el) {
      el.hidden = el.getAttribute('data-view') !== state.view;
    });
    $$('.fn-chip').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-view') === state.view);
    });
  }

  function setView(view) {
    state.view = view;
    applyView();
  }

  function renderTripHeader(trip, data) {
    const moeda = currencyLabel(trip.currency);
    $('#brandTitle').textContent = trip.name;
    $('#brandSub').textContent =
      trip.families.length + ' famílias · ' +
      data.count + ' despesa' + (data.count === 1 ? '' : 's') + ' · ' +
      moeda;
  }

  // Moeda no formato "Nome (símbolo)", ex.: "Dólar ($)".
  const CURRENCY_NAMES = {
    USD: 'Dólar', BRL: 'Real', EUR: 'Euro', GBP: 'Libra',
    ARS: 'Peso argentino', JPY: 'Iene', CAD: 'Dólar canadense',
    AUD: 'Dólar australiano', CHF: 'Franco suíço', MXN: 'Peso mexicano',
    CLP: 'Peso chileno', UYU: 'Peso uruguaio', COP: 'Peso colombiano'
  };
  function currencyLabel(cur) {
    cur = cur || {};
    const name = CURRENCY_NAMES[(cur.code || '').toUpperCase()] || cur.code || 'Moeda';
    return name + ' (' + (cur.symbol || '') + ')';
  }

  function renderConsolidated(trip, data) {
    const host = $('#consolidatedBox');
    host.innerHTML = '';
    const fams = trip.families;
    if (!fams.length) return;

    let head = '<div class="cons-cell cons-corner"></div>';
    fams.forEach(function (fam, i) {
      head += '<div class="cons-cell cons-head">' +
        '<span class="fam-avatar" style="' + avatarStyle(trip, i) + '">' + escapeHtml(initials(fam)) + '</span>' +
        '<span class="cons-name">' + escapeHtml(fam) + '</span>' +
      '</div>';
    });

    function row(label, arr, isNet) {
      const extra = isNet ? ' cons-saldo' : '';
      let out = '<div class="cons-cell cons-label' + extra + '">' + label + '</div>';
      arr.forEach(function (v, i) {
        let cls = 'cons-cell cons-val' + extra;
        if (isNet) {
          const c = Math.abs(v) < 0.005 ? 'zero' : (v > 0 ? 'pos' : 'neg');
          cls += ' net ' + c;
        }
        out += '<div class="' + cls + '">' + fmtMoney(v, trip) + '</div>';
      });
      return out;
    }

    const card = document.createElement('div');
    card.className = 'card consolidated-card';
    card.style.setProperty('--cons-cols', fams.length);
    card.innerHTML =
      '<div class="cons-grid">' +
        head +
        row('Pagou', data.totals.paid, false) +
        row('Usou', data.totals.consumed, false) +
        row('Saldo', data.totals.net, true) +
      '</div>';
    host.appendChild(card);
  }

  function renderBalances(trip, data) {
    const host = $('#balanceList');
    host.innerHTML = '';
    const fams = trip.families;
    if (data.balances.length === 0) {
      host.innerHTML = '<div class="table-empty" style="grid-column:1/-1">Adicione despesas para ver o balanço.</div>';
      return;
    }
    data.balances.forEach(function (b) {
      const item = document.createElement('div');
      if (b.settled) {
        item.className = 'balance-item settled';
        item.innerHTML =
          '<div class="balance-flow">' +
            '<span class="who">' + escapeHtml(fams[b.a]) + '</span>' +
            '<span class="balance-arrow">↔</span>' +
            '<span class="who">' + escapeHtml(fams[b.b]) + '</span>' +
          '</div>' +
          '<span class="balance-amount settled">quitado</span>';
      } else {
        item.className = 'balance-item';
        item.innerHTML =
          '<div>' +
            '<div class="balance-flow">' +
              '<span class="who">' + escapeHtml(fams[b.from]) + '</span>' +
              '<span class="balance-arrow" title="deve a">→</span>' +
              '<span class="who">' + escapeHtml(fams[b.to]) + '</span>' +
            '</div>' +
            '<span class="balance-detail">' + escapeHtml(fams[b.from]) + ' deve a ' + escapeHtml(fams[b.to]) + '</span>' +
          '</div>' +
          '<span class="balance-amount">' + fmtMoney(b.amount, trip) + '</span>';
      }
      host.appendChild(item);
    });
  }

  function renderMatrix(trip, data) {
    const fams = trip.families;
    const M = data.matrix;
    const t = data.totals;
    const table = $('#summaryMatrix');
    function av(i, f) {
      return '<span class="fam-avatar mtx-av" style="' + avatarStyle(trip, i) + '">' + escapeHtml(initials(f)) + '</span>';
    }
    let html = '<thead><tr><th class="corner"></th>';
    fams.forEach(function (f, j) { html += '<th class="fam-col">' + av(j, f) + '</th>'; });
    html += '<th class="total-col">Pago</th></tr></thead><tbody>';
    fams.forEach(function (payer, i) {
      html += '<tr><td class="row-label">' + av(i, payer) + '</td>';
      fams.forEach(function (_, j) {
        const cls = i === j ? 'diag' : '';
        html += '<td class="fam-col ' + cls + '"><span class="mnum">' + fmtMoney(M[i][j], trip) + '</span></td>';
      });
      html += '<td class="total-col">' + fmtMoney(t.paid[i], trip) + '</td></tr>';
    });
    html += '<tr class="total-row"><td>Usado</td>';
    fams.forEach(function (_, j) { html += '<td class="fam-col"><span class="mnum">' + fmtMoney(t.consumed[j], trip) + '</span></td>'; });
    html += '<td>' + fmtMoney(t.grand, trip) + '</td></tr>';
    html += '</tbody>';
    table.innerHTML = html;

    // Iguala a largura do bloco numérico de cada coluna ao maior valor (o total),
    // para o total ficar centralizado e os demais alinharem na borda direita dele.
    const numSpans = $$('td.fam-col .mnum', table);
    let maxW = 0;
    numSpans.forEach(function (s) { s.style.minWidth = '0'; });
    numSpans.forEach(function (s) { maxW = Math.max(maxW, s.getBoundingClientRect().width); });
    maxW = Math.ceil(maxW);
    $$('.fam-col .mnum', table).forEach(function (s) { s.style.minWidth = maxW + 'px'; });
  }

  function renderExpenses(trip) {
    const table = $('#expensesTable');
    const panelEl = table.closest('.panel');
    const fams = trip.families;
    const q = state.search.trim().toLowerCase();

    // Ícones das famílias no topo, alinhados às colunas da lista.
    const head = $('#expensesHead');
    head.style.setProperty('--cols', fams.length + 2);
    head.innerHTML = fams.map(function (f, i) {
      return '<span class="fam-avatar" style="grid-column:' + (i + 1) + ';' + avatarStyle(trip, i) + '" title="' + escapeHtml(f) + '">' + escapeHtml(initials(f)) + '</span>';
    }).join('');

    let list = trip.expenses.slice();
    if (q) {
      list = list.filter(function (e) {
        return (e.desc || '').toLowerCase().indexOf(q) !== -1 ||
               (e.payer || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // Mesma data: mais recém-adicionada primeiro.
      return trip.expenses.indexOf(b) - trip.expenses.indexOf(a);
    });

    if (trip.expenses.length === 0) {
      table.innerHTML = '';
      head.hidden = true;
      if (panelEl) panelEl.classList.add('is-empty');
      $('#expensesEmpty').hidden = false;
      return;
    }
    head.hidden = false;
    if (panelEl) panelEl.classList.remove('is-empty');
    $('#expensesEmpty').hidden = true;

    let html = '<tbody>';

    if (list.length === 0) {
      html += '<tr><td class="table-empty">Nenhuma despesa encontrada para "' + escapeHtml(state.search) + '".</td></tr>';
    }

    list.forEach(function (e) {
      const payerIdx = fams.indexOf(e.payer);
      const sh = Calc.shares(e);
      const weightsHtml = fams.map(function (f, i) {
        const p = Number(e.parts[i]) || 0;
        const has = p > 0;
        // Lista de despesas: sempre 0 (inteiro) ou 2 casas decimais.
        const dec = Number.isInteger(p) ? 0 : 2;
        return '<span class="part-weight' + (has ? '' : ' empty') + '" style="grid-column:' + (i + 1) + ';grid-row:2" title="' + escapeHtml(f) + '">' +
          (has ? fmtPartNum(p, dec) : '–') +
        '</span>';
      }).join('');
      const moneyHtml = fams.map(function (f, i) {
        const p = Number(e.parts[i]) || 0;
        const has = p > 0;
        return '<span class="part-money' + (has ? '' : ' empty') + '" style="grid-column:' + (i + 1) + ';grid-row:3" title="' + escapeHtml(f) + '">' +
          (has ? fmtMoney(sh[i], trip) : '–') +
        '</span>';
      }).join('');
      html +=
        '<tr class="exp-row" data-id="' + e.id + '">' +
          '<td class="exp-cell" style="--cols:' + (fams.length + 2) + '">' +
            '<span class="fam-avatar exp-payer" style="' + avatarStyle(trip, payerIdx) + '" title="' + escapeHtml(e.payer || '—') + '">' + escapeHtml(initials(e.payer) || '—') + '</span>' +
            weightsHtml +
            '<button type="button" class="exp-date" data-edit="' + e.id + '" title="Editar despesa">' + fmtDateShort(e.date) + '</button>' +
            moneyHtml +
            '<span class="exp-value">' + fmtMoney(e.value, trip) + '</span>' +
            '<div class="exp-desc">' + escapeHtml(e.desc || '—') + '</div>' +
          '</td>' +
        '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
  }

  // ---------- Modal de caixinha ----------
  function openTripModal(editId) {
    if (!requireEdit()) return;
    const modal = $('#tripModal');
    const isEdit = !!editId;
    const trip = isEdit ? Store.getTrip(editId) : null;
    $('#tripModalTitle').textContent = isEdit ? 'Editar caixinha' : 'Nova Caixinha';
    $('#tripSubmitBtn').textContent = isEdit ? 'Salvar' : 'Criar caixinha';
    $('#tripDeleteBtn').hidden = !isEdit;
    modal.dataset.editId = editId || '';

    $('#tripName').value = trip ? trip.name : '';
    $('#tripCode')._setCode(trip ? (trip.code || '') : '');
    $('#familyCount').value = trip ? trip.families.length : 3;

    // moeda
    const preset = $('#currencyPreset');
    if (trip) {
      const key = trip.currency.code + '|' + trip.currency.symbol;
      const match = Array.prototype.some.call(preset.options, function (o) { return o.value === key; });
      if (match) { preset.value = key; $('#customCurrencyRow').hidden = true; }
      else {
        preset.value = '__custom__';
        $('#customCurrencyRow').hidden = false;
        $('#currencyCode').value = trip.currency.code || '';
        $('#currencySymbol').value = trip.currency.symbol || '';
      }
    } else {
      preset.value = 'BRL|R$';
      $('#customCurrencyRow').hidden = true;
    }

    buildFamilyNameInputs(trip ? trip.families : ['', '', ''], trip ? trip.colors : null);
    modal.hidden = false;
    setTimeout(function () { $('#tripName').focus(); }, 40);
  }

  function defaultHexColors(i) {
    const v = famVisual(null, i);
    return { bg: v.bg, fg: v.fg, border: v.border };
  }

  function buildFamilyNameInputs(names, colors) {
    const host = $('#familyNames');
    const count = Math.max(2, Math.min(12, parseInt($('#familyCount').value, 10) || 2));
    host.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const val = names[i] || '';
      const def = defaultHexColors(i);
      const c = (colors && colors[i]) || {};
      const bg = c.bg || def.bg, fg = c.fg || def.fg, border = c.border || def.border;
      const row = document.createElement('div');
      row.className = 'family-name-input';
      row.dataset.index = i;
      row.innerHTML =
        '<span class="fam-avatar fam-preview" style="background:' + bg + ';color:' + fg + ';border:1.5px solid ' + border + '">' + (initials(val) || (i + 1)) + '</span>' +
        '<input type="text" class="fam-name-field" placeholder="Família ' + (i + 1) + '" value="' + escapeHtml(val) + '" />' +
        '<div class="fam-colors">' +
          '<input type="color" class="fam-color-border" title="Borda" value="' + border + '">' +
          '<input type="color" class="fam-color-bg" title="Interior" value="' + bg + '">' +
          '<input type="color" class="fam-color-fg" title="Letra" value="' + fg + '">' +
        '</div>';
      host.appendChild(row);
    }
  }

  function updateFamilyPreview(row) {
    const bg = row.querySelector('.fam-color-bg').value;
    const fg = row.querySelector('.fam-color-fg').value;
    const border = row.querySelector('.fam-color-border').value;
    const av = row.querySelector('.fam-preview');
    av.style.background = bg;
    av.style.color = fg;
    av.style.border = '1.5px solid ' + border;
  }

  function readFamilyInputs() {
    const names = [], colors = [];
    $$('#familyNames .family-name-input').forEach(function (row) {
      names.push(row.querySelector('.fam-name-field').value);
      colors.push({
        bg: row.querySelector('.fam-color-bg').value,
        border: row.querySelector('.fam-color-border').value,
        fg: row.querySelector('.fam-color-fg').value
      });
    });
    return { names: names, colors: colors };
  }

  function submitTripForm(ev) {
    ev.preventDefault();
    if (!requireEdit()) return;
    const editId = $('#tripModal').dataset.editId || '';
    const name = $('#tripName').value.trim();
    if (!name) { toast('Informe o nome da caixinha.', 'error'); return; }

    const code = Store.sanitizeCode($('#tripCode')._getCode());
    if (!code) { toast('Informe o código da caixinha.', 'error'); return; }
    const codeOwner = Store.getTripByCode(code);
    if (codeOwner && codeOwner.id !== editId) {
      toast('Já existe uma caixinha com o código "' + code + '".', 'error');
      return;
    }

    const fam = readFamilyInputs();
    const families = fam.names.map(function (nm, i) {
      return String(nm).trim() || ('Família ' + (i + 1));
    });
    const colors = fam.colors;
    const seen = {};
    for (let i = 0; i < families.length; i++) {
      let nm = families[i], k = 2;
      while (seen[nm.toLowerCase()]) { nm = families[i] + ' ' + k; k++; }
      families[i] = nm; seen[nm.toLowerCase()] = true;
    }

    let currency;
    const presetVal = $('#currencyPreset').value;
    if (presetVal === '__custom__') {
      currency = {
        code: ($('#currencyCode').value.trim() || 'CUR').toUpperCase(),
        symbol: $('#currencySymbol').value.trim() || '$'
      };
    } else {
      const p = presetVal.split('|');
      currency = { code: p[0], symbol: p[1] };
    }

    if (editId) {
      const trip = Store.getTrip(editId);
      // Remapeia despesas se a quantidade de famílias mudou
      const old = trip.families;
      const patchedExpenses = trip.expenses.map(function (e) {
        const parts = [];
        for (let i = 0; i < families.length; i++) parts.push(Number(e.parts[i]) || 0);
        let payer = e.payer;
        const oldIdx = old.indexOf(e.payer);
        if (oldIdx >= 0 && oldIdx < families.length) payer = families[oldIdx];
        else if (families.indexOf(payer) === -1) payer = families[0];
        return Object.assign({}, e, { parts: parts, payer: payer });
      });
      Store.updateTrip(editId, { code: code, name: name, currency: currency, families: families, colors: colors, expenses: patchedExpenses });
      toast('Caixinha atualizada.', 'success');
      syncPush(Store.getTrip(editId));
      closeModal($('#tripModal'));
      openTrip(editId);
    } else {
      const trip = Store.createTrip({ code: code, name: name, currency: currency, families: families, colors: colors });
      toast('Caixinha criada!', 'success');
      syncPush(trip);
      closeModal($('#tripModal'));
      openTrip(trip.id);
    }
  }

  // ---------- Modal de despesa ----------
  function openExpenseModal(editId) {
    const trip = currentTrip();
    if (!trip) return;
    if (!requireEdit()) return;
    state.editingExpenseId = editId || null;
    const exp = editId ? trip.expenses.find(function (e) { return e.id === editId; }) : null;

    $('#expenseModalTitle').textContent = exp ? 'Editar despesa' : 'Nova despesa';
    $('#expenseSubmitBtn').textContent = exp ? 'Salvar' : 'Adicionar';
    $('#expenseDeleteBtn').hidden = !exp;

    $('#expDate').value = exp ? exp.date : new Date().toISOString().slice(0, 10);
    $('#expValue').value = exp ? String(exp.value).replace('.', ',') : '';
    $('#expDesc').value = exp ? exp.desc : '';

    const payerSel = $('#expPayer');
    payerSel.innerHTML = '';
    trip.families.forEach(function (f) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (exp && exp.payer === f) o.selected = true;
      payerSel.appendChild(o);
    });

    const partsHost = $('#expParts');
    partsHost.innerHTML = '';
    trip.families.forEach(function (f, i) {
      const valStr = exp ? partToInput(exp.parts[i] != null ? exp.parts[i] : 0) : '';
      const row = document.createElement('div');
      row.className = 'part-input';
      row.innerHTML =
        '<span class="fam-avatar" style="' + avatarStyle(trip, i) + '">' + escapeHtml(initials(f)) + '</span>' +
        '<span class="part-label">' + escapeHtml(f) + '</span>' +
        '<input type="text" inputmode="text" class="part-field" data-fam="' + i + '" value="' + valStr + '" />' +
        '<span class="part-share" data-share="' + i + '"></span>';
      partsHost.appendChild(row);
    });

    updateExpensePreview();
    $('#expenseModal').hidden = false;
    setTimeout(function () { $('#expValue').focus(); }, 40);
  }

  function readExpenseForm() {
    const trip = currentTrip();
    const value = Calc.evalAmount($('#expValue').value);
    const parts = $$('.part-field').map(function (inp) { const v = Calc.evalAmount(inp.value); return isNaN(v) ? 0 : v; });
    return {
      date: $('#expDate').value,
      value: value,
      payer: $('#expPayer').value,
      parts: parts,
      desc: $('#expDesc').value.trim(),
      trip: trip
    };
  }

  function updateExpensePreview() {
    const trip = currentTrip();
    if (!trip) return;
    const raw = $('#expValue').value;
    const value = Calc.evalAmount(raw);
    const hint = $('#expValueHint');
    if (raw && /[+\-*/]/.test(raw.replace(/^-/, '')) && !isNaN(value)) {
      hint.textContent = '= ' + fmtMoney(value, trip);
    } else { hint.textContent = ''; }

    const partFields = $$('.part-field');
    const parts = partFields.map(function (inp) { const v = Calc.evalAmount(inp.value); return isNaN(v) ? 0 : v; });
    const shares = Calc.shares({ value: isNaN(value) ? 0 : value, parts: parts });
    const partsTotal = parts.reduce(function (a, b) { return a + b; }, 0);

    // Formatação individual por valor (evita zeros finais adicionais).
    function fmtPart(n) {
      return fmtPartNum(n, partDisplayDecimals(n));
    }
    // Reformata as partes preenchidas (menos a em foco) conforme a regra de exibição.
    partFields.forEach(function (inp, i) {
      if (inp === document.activeElement || inp.value.trim() === '') return;
      inp.value = partToInput(parts[i]);
    });

    const shareEls = $$('.part-share');
    shareEls.forEach(function (el, i) {
      // Só a última família mostra o total das partes (à direita).
      el.textContent = (i === shareEls.length - 1 && partsTotal > 0) ? fmtPart(partsTotal) : '';
    });

    const preview = $('#expPreview');
    if (!isNaN(value) && value > 0) {
      let rows = trip.families.map(function (f, i) {
        return '<div class="pv-row"><span>' + escapeHtml(f) + '</span><span>' + fmtMoney(shares[i], trip) + '</span></div>';
      }).join('');
      preview.innerHTML = rows +
        '<div class="pv-row pv-total"><span>Total</span><span>' + fmtMoney(value, trip) + '</span></div>';
      preview.classList.add('show');
    } else {
      preview.classList.remove('show');
    }
  }

  function submitExpenseForm(ev) {
    ev.preventDefault();
    const trip = currentTrip();
    if (!trip) return;
    if (!requireEdit()) return;
    const f = readExpenseForm();
    if (!f.date) { toast('Informe a data.', 'error'); return; }
    if (isNaN(f.value) || f.value <= 0) { toast('Valor inválido.', 'error'); return; }
    const totalParts = f.parts.reduce(function (a, b) { return a + b; }, 0);
    if (totalParts <= 0) { toast('Defina ao menos uma parte.', 'error'); return; }

    if (state.editingExpenseId) {
      Store.updateExpense(trip.id, state.editingExpenseId, {
        date: f.date, value: f.value, payer: f.payer, parts: f.parts, desc: f.desc
      });
      toast('Despesa atualizada.', 'success');
    } else {
      Store.addExpense(trip.id, {
        date: f.date, value: f.value, payer: f.payer, parts: f.parts, desc: f.desc
      });
      toast('Despesa adicionada.', 'success');
    }
    syncPush(Store.getTrip(trip.id));
    closeModal($('#expenseModal'));
    render();
  }

  // ---------- Modal de sincronização ----------
  function openSyncModal() {
    const cfg = Sync.getConfig();
    $('#syncToken').value = cfg.token || '';
    $('#syncToken').type = 'password';
    const st = $('#syncStatus');
    st.hidden = true; st.className = 'sync-status';
    $('#syncModal').hidden = false;
  }

  function readSyncForm() {
    return {
      token: $('#syncToken').value.trim()
    };
  }

  function setSyncStatus(msg, kind) {
    const st = $('#syncStatus');
    st.textContent = msg;
    st.className = 'sync-status' + (kind ? ' ' + kind : '');
    st.hidden = false;
  }

  // Testa o token informado sem persistir um token inválido. Só mantém o token
  // no armazenamento se o teste passar; caso contrário, restaura o anterior.
  function verifySync(shouldSave) {
    const token = readSyncForm().token;
    if (!token) {
      Sync.setConfig({ token: '' });
      setSyncStatus('Não existe token registrado.', '');
      updateSyncBadge();
      applyEditability();
      return Promise.resolve();
    }
    const prevToken = Sync.getConfig().token || '';
    Sync.setConfig({ token: token });
    setSyncStatus('Testando conexão…', '');
    return Sync.test().then(function (r) {
      setSyncStatus(r.message, r.ok ? 'ok' : 'error');
      if (r.ok) {
        if (shouldSave) {
          toast('Sincronização salva.', 'success');
          closeModal($('#syncModal'));
          pullAndRefresh(false);
        }
      } else {
        Sync.setConfig({ token: prevToken });
      }
      applyEditability();
    }).catch(function (e) {
      setSyncStatus('Erro: ' + (e && e.message ? e.message : 'falha'), 'error');
      Sync.setConfig({ token: prevToken });
      applyEditability();
    });
  }

  function testSync() {
    verifySync(false);
  }

  function saveSync(ev) {
    if (ev) ev.preventDefault();
    verifySync(true);
  }

  // ---------- Confirmação ----------
  function confirmAction(message, cb) {
    $('#confirmMessage').textContent = message;
    state.confirmCb = cb;
    $('#confirmModal').hidden = false;
  }

  // Senha de deleção (placa do Konan).
  const DELETE_PASSWORD = 'SCW9F77';
  function confirmWithPassword(message, cb) {
    $('#deletePassMessage').textContent = message;
    $('#deletePassInput').value = '';
    $('#deletePassError').hidden = true;
    state.deletePassCb = cb;
    $('#deletePassModal').hidden = false;
    setTimeout(function () { $('#deletePassInput').focus(); }, 40);
  }

  // ---------- Modais util ----------
  function closeModal(modal) { modal.hidden = true; }
  function closeAllMenus() {
    $('#menuDropdown').hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  }

  // ---------- Eventos ----------
  function bindEvents() {
    var newTripBtn = $('#newTripBtn');
    if (newTripBtn) newTripBtn.addEventListener('click', function () { openTripModal(null); });

    // Clicar no cofrinho volta para a página inicial.
    var brandMark = $('.brand-mark');
    if (brandMark) brandMark.addEventListener('click', function () { showGate(); });
    document.addEventListener('click', function (e) {
      const act = e.target.closest('[data-action]');
      if (act && act.dataset.action === 'new-trip') openTripModal(null);
      if (act && act.dataset.action === 'sync') openSyncModal();
    });

    // Gate (abrir por código)
    setupCodeInput($('#gateCode'));
    setupCodeInput($('#tripCode'));
    $('#gateForm').addEventListener('submit', submitGate);

    // Roteamento por URL (#CODIGO)
    window.addEventListener('hashchange', handleRoute);

    // Chips de navegação (Despesas / Resumo)
    $$('.fn-chip[data-view]').forEach(function (chip) {
      chip.addEventListener('click', function () { setView(chip.getAttribute('data-view')); });
    });

    // menu
    $('#menuBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      const dd = $('#menuDropdown');
      const willOpen = dd.hidden;
      dd.hidden = !willOpen;
      $('#menuBtn').setAttribute('aria-expanded', String(willOpen));
    });
    $('#menuDropdown').addEventListener('click', function (e) {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      const action = item.dataset.action;
      closeAllMenus();
      switch (action) {
        case 'edit-trip': if (currentTrip()) openTripModal(state.tripId); break;
        case 'sync': openSyncModal(); break;
        case 'sync-now': pullAndRefresh(false); break;
      }
    });
    document.addEventListener('click', function () { closeAllMenus(); });

    // Trip modal
    $('#familyCount').addEventListener('input', function () {
      const cur = readFamilyInputs();
      buildFamilyNameInputs(cur.names, cur.colors);
    });
    $('#familyNames').addEventListener('input', function (e) {
      const row = e.target.closest('.family-name-input');
      if (!row) return;
      if (e.target.matches('.fam-color-bg, .fam-color-fg, .fam-color-border')) {
        updateFamilyPreview(row);
      } else if (e.target.matches('.fam-name-field')) {
        const idx = parseInt(row.dataset.index, 10) || 0;
        row.querySelector('.fam-preview').textContent = initials(e.target.value) || (idx + 1);
      }
    });
    $('#currencyPreset').addEventListener('change', function (e) {
      $('#customCurrencyRow').hidden = e.target.value !== '__custom__';
    });
    $('#tripForm').addEventListener('submit', submitTripForm);
    $('#tripDeleteBtn').addEventListener('click', function () {
      const editId = $('#tripModal').dataset.editId || '';
      if (!editId) return;
      if (!requireEdit()) return;
      const trip = Store.getTrip(editId);
      confirmWithPassword('Excluir a caixinha "' + (trip && trip.name ? trip.name : 'sem nome') + '"? Esta ação não pode ser desfeita.', function () {
        Store.deleteTrip(editId);
        syncDelete(editId);
        toast('Caixinha excluída.');
        closeModal($('#tripModal'));
        showGate();
      });
    });

    // Sync modal
    $('#syncForm').addEventListener('submit', saveSync);
    $('#syncTestBtn').addEventListener('click', testSync);
    $('#syncClearBtn').addEventListener('click', function () {
      $('#syncToken').value = '';
      $('#syncToken').focus();
    });

    // Expense modal
    $('.fn-chip[data-action="add-expense"]').addEventListener('click', function () { openExpenseModal(null); });
    $('#expenseForm').addEventListener('submit', submitExpenseForm);
    $('#expValue').addEventListener('input', updateExpensePreview);
    $('#expParts').addEventListener('input', updateExpensePreview);
    $('#expParts').addEventListener('focusout', updateExpensePreview);
    $('#expenseDeleteBtn').addEventListener('click', function () {
      const trip = currentTrip();
      const id = state.editingExpenseId;
      if (!trip || !id) return;
      if (!requireEdit()) return;
      const exp = trip.expenses.find(function (x) { return x.id === id; });
      confirmAction('Excluir a despesa "' + (exp && exp.desc ? exp.desc : 'sem descrição') + '"?', function () {
        Store.deleteExpense(trip.id, id);
        toast('Despesa excluída.');
        syncPush(Store.getTrip(trip.id));
        closeModal($('#expenseModal'));
        render();
      });
    });

    // Expense table actions
    $('#expensesTable').addEventListener('click', function (e) {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-del]');
      if (editBtn) { openExpenseModal(editBtn.dataset.edit); return; }
      if (delBtn) {
        const trip = currentTrip();
        const exp = trip.expenses.find(function (x) { return x.id === delBtn.dataset.del; });
        confirmAction('Excluir a despesa "' + (exp && exp.desc ? exp.desc : 'sem descrição') + '"?', function () {
          Store.deleteExpense(trip.id, delBtn.dataset.del);
          toast('Despesa excluída.');
          syncPush(Store.getTrip(trip.id));
          render();
        });
      }
    });

    $('#expenseSearch').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderExpenses(currentTrip());
    });

    // Confirm modal
    $('#confirmOkBtn').addEventListener('click', function () {
      const cb = state.confirmCb;
      state.confirmCb = null;
      closeModal($('#confirmModal'));
      if (cb) cb();
    });

    // Confirmação por senha (deleção)
    function submitDeletePassword() {
      const val = ($('#deletePassInput').value || '').trim().toUpperCase();
      if (val !== DELETE_PASSWORD) {
        $('#deletePassError').hidden = false;
        $('#deletePassInput').focus();
        $('#deletePassInput').select();
        return;
      }
      const cb = state.deletePassCb;
      state.deletePassCb = null;
      closeModal($('#deletePassModal'));
      if (cb) cb();
    }
    $('#deletePassOkBtn').addEventListener('click', submitDeletePassword);
    $('#deletePassInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitDeletePassword(); }
    });

    // Fechar modais (botões [data-close] e clique no overlay)
    $$('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-close]')) {
          closeModal(overlay);
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $$('.modal-overlay').forEach(function (m) { if (!m.hidden) closeModal(m); });
        closeAllMenus();
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    bindEvents();
    await Store.seedFromFiles();

    // A viagem só é aberta via URL (#CODIGO) ou pelo gate; ao abrir o site
    // mostramos apenas o box de entrada.
    handleRoute();
    $('#app-loading').style.display = 'none';

    // Sincronização: busca o estado do repositório e mantém atualizado.
    setupSync();
  }

  function setupSync() {
    if (typeof Sync === 'undefined' || !Sync.hasRepo()) return;
    pullAndRefresh(true);
    // Atualiza periodicamente e ao voltar o foco (bom no Safari do iPhone).
    setInterval(function () {
      if (document.visibilityState === 'visible') pullAndRefresh(true);
    }, 25000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pullAndRefresh(true);
    });
    window.addEventListener('focus', function () { pullAndRefresh(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
