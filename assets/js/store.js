/* Caixinha · Camada de dados
 * Fonte de verdade: localStorage. Na primeira execução, semeia a partir de data/trips.json.
 * Cada viagem é um objeto independente e pode ser exportada/importada como .json.
 */
(function (global) {
  'use strict';

  const LS_TRIPS = 'caixinha.trips.v1';
  const LS_CURRENT = 'caixinha.currentTrip.v1';
  const LS_THEME = 'caixinha.theme.v1';
  const LS_SEEDED = 'caixinha.seeded.v1';
  const LS_SEEDREVS = 'caixinha.seedRevs.v1';

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function slugify(str) {
    return String(str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'viagem';
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getTrips() {
    const trips = readJSON(LS_TRIPS, []);
    return Array.isArray(trips) ? trips : [];
  }
  function saveTrips(trips) { writeJSON(LS_TRIPS, trips); }

  function getTrip(id) {
    return getTrips().find(function (t) { return t.id === id; }) || null;
  }

  function ensureUniqueId(baseId) {
    const trips = getTrips();
    let id = baseId, i = 2;
    while (trips.some(function (t) { return t.id === id; })) {
      id = baseId + '-' + i; i++;
    }
    return id;
  }

  // Código da caixinha: até 10 caracteres alfanuméricos, maiúsculos.
  function sanitizeCode(code) {
    return String(code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10);
  }

  function getTripByCode(code) {
    const c = sanitizeCode(code);
    if (!c) return null;
    return getTrips().find(function (t) { return sanitizeCode(t.code) === c; }) || null;
  }

  function normalizeTrip(trip) {
    const t = Object.assign({}, trip);
    t.id = t.id || ensureUniqueId(slugify(t.name));
    t.code = sanitizeCode(t.code);
    t.families = (t.families || []).map(function (f) { return String(f).trim(); }).filter(Boolean);
    t.currency = t.currency || { code: 'USD', symbol: '$' };
    // Cores por família (borda, interior, letra). Mantém alinhado ao nº de famílias.
    const inColors = Array.isArray(t.colors) ? t.colors : [];
    t.colors = t.families.map(function (_, i) {
      const c = inColors[i] || {};
      return {
        bg: c.bg || null,
        fg: c.fg || null,
        border: c.border || null
      };
    });
    t.expenses = (t.expenses || []).map(function (e) {
      const parts = (e.parts || []).slice(0, t.families.length);
      while (parts.length < t.families.length) parts.push(0);
      return {
        id: e.id || uid('exp'),
        date: e.date || new Date().toISOString().slice(0, 10),
        value: Number(e.value) || 0,
        payer: e.payer,
        parts: parts.map(function (p) { return Number(p) || 0; }),
        desc: e.desc || ''
      };
    });
    t.createdAt = t.createdAt || new Date().toISOString().slice(0, 10);
    return t;
  }

  function createTrip(data) {
    const trips = getTrips();
    const id = ensureUniqueId(slugify(data.name));
    const trip = normalizeTrip({
      id: id,
      code: data.code,
      name: data.name,
      currency: data.currency,
      families: data.families,
      colors: data.colors,
      expenses: [],
      createdAt: new Date().toISOString().slice(0, 10)
    });
    trips.push(trip);
    saveTrips(trips);
    setCurrent(trip.id);
    return trip;
  }

  function updateTrip(id, patch) {
    const trips = getTrips();
    const i = trips.findIndex(function (t) { return t.id === id; });
    if (i === -1) return null;
    trips[i] = normalizeTrip(Object.assign({}, trips[i], patch, { id: id }));
    saveTrips(trips);
    return trips[i];
  }

  function deleteTrip(id) {
    let trips = getTrips().filter(function (t) { return t.id !== id; });
    saveTrips(trips);
    if (getCurrent() === id) {
      setCurrent(trips.length ? trips[0].id : null);
    }
    return trips;
  }

  function importTrip(trip) {
    const trips = getTrips();
    let incoming = normalizeTrip(trip);
    // Evita colisão de id ao importar
    if (trips.some(function (t) { return t.id === incoming.id; })) {
      incoming.id = ensureUniqueId(incoming.id);
    }
    trips.push(incoming);
    saveTrips(trips);
    setCurrent(incoming.id);
    return incoming;
  }

  // ---- Despesas ----
  function addExpense(tripId, expense) {
    const trips = getTrips();
    const t = trips.find(function (x) { return x.id === tripId; });
    if (!t) return null;
    const exp = {
      id: uid('exp'),
      date: expense.date,
      value: Number(expense.value) || 0,
      payer: expense.payer,
      parts: expense.parts.map(function (p) { return Number(p) || 0; }),
      desc: expense.desc || ''
    };
    t.expenses.push(exp);
    saveTrips(trips);
    return exp;
  }

  function updateExpense(tripId, expenseId, patch) {
    const trips = getTrips();
    const t = trips.find(function (x) { return x.id === tripId; });
    if (!t) return null;
    const i = t.expenses.findIndex(function (e) { return e.id === expenseId; });
    if (i === -1) return null;
    t.expenses[i] = Object.assign({}, t.expenses[i], patch, {
      value: Number(patch.value != null ? patch.value : t.expenses[i].value) || 0,
      parts: (patch.parts || t.expenses[i].parts).map(function (p) { return Number(p) || 0; })
    });
    saveTrips(trips);
    return t.expenses[i];
  }

  function deleteExpense(tripId, expenseId) {
    const trips = getTrips();
    const t = trips.find(function (x) { return x.id === tripId; });
    if (!t) return;
    t.expenses = t.expenses.filter(function (e) { return e.id !== expenseId; });
    saveTrips(trips);
  }

  // ---- Corrente / tema ----
  function getCurrent() { return localStorage.getItem(LS_CURRENT); }
  function setCurrent(id) {
    if (id) localStorage.setItem(LS_CURRENT, id);
    else localStorage.removeItem(LS_CURRENT);
  }
  function getTheme() { return localStorage.getItem(LS_THEME) || 'light'; }
  function setTheme(t) { localStorage.setItem(LS_THEME, t); }

  // ---- Semeadura a partir dos arquivos em /data ----
  //
  // Cada viagem-semente traz uma "rev" (hash do conteúdo). Guardamos a rev já
  // aplicada por viagem; quando ela muda no repositório, a cópia local é
  // re-sincronizada automaticamente. Viagens criadas no app (sem rev) não são
  // afetadas.
  function getSeedRevs() { return readJSON(LS_SEEDREVS, {}) || {}; }
  function saveSeedRevs(r) { writeJSON(LS_SEEDREVS, r); }

  function reconcileSeeds(seeds) {
    const trips = getTrips();
    const revs = getSeedRevs();
    let changed = false;
    let firstId = null;
    (seeds || []).forEach(function (seed) {
      const normalized = normalizeTrip(seed);
      if (!firstId) firstId = normalized.id;
      const rev = String(seed.rev == null ? '' : seed.rev);
      const idx = trips.findIndex(function (t) { return t.id === normalized.id; });
      if (idx === -1) {
        trips.push(normalized);
        revs[normalized.id] = rev;
        changed = true;
      } else if (revs[normalized.id] !== rev) {
        // Conteúdo da semente mudou no repositório: atualiza a cópia local.
        trips[idx] = normalized;
        revs[normalized.id] = rev;
        changed = true;
      }
    });
    if (changed) { saveTrips(trips); saveSeedRevs(revs); }
    return firstId;
  }

  async function seedFromFiles() {
    // 1) Seed embutido (data/seeds.js) — funciona também via file:// (sem servidor).
    if (Array.isArray(global.CAIXINHA_SEEDS) && global.CAIXINHA_SEEDS.length) {
      const firstId = reconcileSeeds(global.CAIXINHA_SEEDS);
      if (!getCurrent() && firstId) setCurrent(firstId);
      localStorage.setItem(LS_SEEDED, '1');
      return;
    }

    // 2) Fallback via fetch (quando servido por http/https, ex.: GitHub Pages).
    try {
      const manRes = await fetch('data/trips.json', { cache: 'no-store' });
      if (!manRes.ok) throw new Error('manifest');
      const manifest = await manRes.json();
      const list = (manifest && manifest.trips) || [];
      const loaded = [];
      for (const item of list) {
        try {
          const res = await fetch('data/' + item.file, { cache: 'no-store' });
          if (!res.ok) continue;
          loaded.push(await res.json());
        } catch (e) { /* ignora arquivo com problema */ }
      }
      if (loaded.length) {
        const firstId = reconcileSeeds(loaded);
        if (!getCurrent() && firstId) setCurrent(firstId);
      }
    } catch (e) {
      // Sem servidor/arquivos: segue vazio (usuário cria manualmente).
    } finally {
      localStorage.setItem(LS_SEEDED, '1');
    }
  }

  global.Store = {
    uid: uid,
    slugify: slugify,
    sanitizeCode: sanitizeCode,
    getTrips: getTrips,
    getTrip: getTrip,
    getTripByCode: getTripByCode,
    createTrip: createTrip,
    updateTrip: updateTrip,
    deleteTrip: deleteTrip,
    importTrip: importTrip,
    normalizeTrip: normalizeTrip,
    addExpense: addExpense,
    updateExpense: updateExpense,
    deleteExpense: deleteExpense,
    getCurrent: getCurrent,
    setCurrent: setCurrent,
    getTheme: getTheme,
    setTheme: setTheme,
    seedFromFiles: seedFromFiles
  };
})(window);
