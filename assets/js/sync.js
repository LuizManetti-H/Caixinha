/* Caixinha · Sincronização via GitHub
 *
 * Usa o próprio repositório do GitHub como armazenamento compartilhado.
 * - Leitura (pull): busca data/trips.json e os arquivos de cada caixinha.
 *   Em repositório público funciona sem token (via raw.githubusercontent).
 * - Escrita (push): grava o .json da caixinha via GitHub Contents API,
 *   criando um commit. Exige um token pessoal com permissão de escrita
 *   no repositório. O token fica SÓ no navegador (localStorage), nunca é
 *   commitado.
 */
(function (global) {
  'use strict';

  const LS_SYNC = 'caixinha.sync.v1';

  // Repositório padrão (usado quando não dá para detectar pela URL, ex.: file://).
  const DEFAULTS = { owner: 'LuizManetti-H', repo: 'caixinha', branch: 'main' };

  let pushing = 0; // >0 enquanto há um push em andamento (pausa o pull periódico)

  function readCfg() {
    try { return JSON.parse(localStorage.getItem(LS_SYNC)) || {}; }
    catch (e) { return {}; }
  }
  function writeCfg(cfg) { localStorage.setItem(LS_SYNC, JSON.stringify(cfg)); }

  // Detecta owner/repo quando servido pelo GitHub Pages: owner.github.io/repo/
  function autoDetect() {
    const host = (global.location && global.location.hostname) || '';
    const m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return null;
    const owner = m[1];
    const seg = (global.location.pathname || '').split('/').filter(Boolean)[0];
    return { owner: owner, repo: seg || (owner + '.github.io'), branch: 'main' };
  }

  function getConfig() {
    const cfg = readCfg();
    const auto = autoDetect();
    cfg.owner = cfg.owner || (auto && auto.owner) || DEFAULTS.owner;
    cfg.repo = cfg.repo || (auto && auto.repo) || DEFAULTS.repo;
    cfg.branch = cfg.branch || (auto && auto.branch) || DEFAULTS.branch;
    cfg.token = cfg.token || '';
    return cfg;
  }
  function setConfig(patch) {
    const cfg = Object.assign(readCfg(), patch || {});
    // Normaliza
    if (cfg.owner) cfg.owner = String(cfg.owner).trim();
    if (cfg.repo) cfg.repo = String(cfg.repo).trim().replace(/\.git$/i, '');
    if (cfg.branch) cfg.branch = String(cfg.branch).trim();
    if (cfg.token) cfg.token = String(cfg.token).trim();
    writeCfg(cfg);
    return getConfig();
  }
  function hasRepo() { const c = getConfig(); return !!(c.owner && c.repo); }
  function isConfigured() { const c = getConfig(); return !!(c.owner && c.repo && c.token); }

  // ---- Codificação base64 <-> UTF-8 ----
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ''))));
  }

  // Hash de conteúdo (FNV-1a de 32 bits) para gerar a "rev" e detectar mudanças.
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // ---- GitHub REST API ----
  function apiHeaders(cfg) {
    const h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    return h;
  }

  async function apiGetContent(cfg, path) {
    const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo +
      '/contents/' + path + '?ref=' + encodeURIComponent(cfg.branch) + '&_=' + Date.now();
    const res = await fetch(url, { headers: apiHeaders(cfg), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = new Error('GitHub GET ' + path + ' → ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function apiPutContent(cfg, path, contentStr, sha, message) {
    const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path;
    const body = {
      message: message || ('Caixinha: atualiza ' + path),
      content: utf8ToBase64(contentStr),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, apiHeaders(cfg)),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.text().catch(function () { return ''; });
      const err = new Error('GitHub PUT ' + path + ' → ' + res.status);
      err.status = res.status; err.detail = detail;
      throw err;
    }
    return res.json();
  }

  async function apiDeleteContent(cfg, path, sha, message) {
    const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path;
    const body = { message: message || ('Caixinha: remove ' + path), sha: sha, branch: cfg.branch };
    const res = await fetch(url, {
      method: 'DELETE',
      headers: Object.assign({ 'Content-Type': 'application/json' }, apiHeaders(cfg)),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.text().catch(function () { return ''; });
      const err = new Error('GitHub DELETE ' + path + ' → ' + res.status);
      err.status = res.status; err.detail = detail;
      throw err;
    }
    return res.json();
  }

  // Leitura de texto: com token usa a API; sem token usa raw (repo público).
  async function getText(cfg, path) {
    if (cfg.token) {
      const j = await apiGetContent(cfg, path);
      return j ? base64ToUtf8(j.content) : null;
    }
    const url = 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/' +
      cfg.branch + '/' + path + '?_=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = new Error('raw GET ' + path + ' → ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  function fileFor(item) {
    return item.file || ((item.id || 'viagem') + '.json');
  }

  // Busca o repositório e aplica no Store. Retorna { count, firstId }.
  async function pull() {
    const cfg = getConfig();
    if (!cfg.owner || !cfg.repo) return { count: 0, firstId: null };
    if (pushing > 0) return { count: 0, firstId: null };

    const manifestText = await getText(cfg, 'data/trips.json');
    if (!manifestText) return { count: 0, firstId: null };

    let manifest;
    try { manifest = JSON.parse(manifestText); } catch (e) { return { count: 0, firstId: null }; }
    const list = (manifest && manifest.trips) || [];

    const trips = [];
    for (const item of list) {
      const file = fileFor(item);
      let text;
      try { text = await getText(cfg, 'data/' + file); }
      catch (e) { text = null; }
      if (!text) continue;
      let trip;
      try { trip = JSON.parse(text); } catch (e) { continue; }
      trip.rev = 'gh-' + hashStr(text);
      trips.push(trip);
    }
    if (!trips.length) return { count: 0, firstId: null };

    const firstId = (global.Store && Store.reconcile) ? Store.reconcile(trips) : null;
    return { count: trips.length, firstId: firstId };
  }

  // Grava uma caixinha no repositório (arquivo + manifesto).
  async function pushTrip(trip) {
    const cfg = getConfig();
    if (!isConfigured()) {
      const err = new Error('Sincronização não configurada (falta o token).');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    if (!trip || !trip.id) throw new Error('Caixinha inválida.');

    const fileName = trip.id + '.json';
    const path = 'data/' + fileName;
    const clean = Object.assign({}, trip);
    delete clean.rev;
    const contentStr = JSON.stringify(clean, null, 2) + '\n';

    pushing++;
    try {
      // Grava o arquivo da caixinha (com o sha atual, se existir).
      let existing = await apiGetContent(cfg, path);
      try {
        await apiPutContent(cfg, path, contentStr, existing ? existing.sha : null,
          'Caixinha: atualiza ' + (trip.name || trip.id));
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          existing = await apiGetContent(cfg, path);
          await apiPutContent(cfg, path, contentStr, existing ? existing.sha : null,
            'Caixinha: atualiza ' + (trip.name || trip.id));
        } else { throw e; }
      }

      // Garante que a caixinha está listada no manifesto.
      await ensureManifest(cfg, trip.id, fileName);

      // Marca a rev local para o pull não reverter o que acabamos de gravar.
      if (global.Store && Store.setRev) Store.setRev(trip.id, 'gh-' + hashStr(contentStr));
    } finally {
      pushing--;
    }
  }

  async function ensureManifest(cfg, id, fileName) {
    const m = await apiGetContent(cfg, 'data/trips.json');
    let manifest = { trips: [] };
    let sha = null;
    if (m) {
      sha = m.sha;
      try { manifest = JSON.parse(base64ToUtf8(m.content)); } catch (e) { manifest = { trips: [] }; }
    }
    manifest.trips = manifest.trips || [];
    if (manifest.trips.some(function (t) { return t.id === id; })) return;
    manifest.trips.push({ id: id, file: fileName });
    const body = JSON.stringify(manifest, null, 2) + '\n';
    try {
      await apiPutContent(cfg, 'data/trips.json', body, sha, 'Caixinha: registra ' + id);
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        const m2 = await apiGetContent(cfg, 'data/trips.json');
        let man2 = { trips: [] };
        if (m2) { try { man2 = JSON.parse(base64ToUtf8(m2.content)); } catch (er) {} }
        man2.trips = man2.trips || [];
        if (!man2.trips.some(function (t) { return t.id === id; })) {
          man2.trips.push({ id: id, file: fileName });
          await apiPutContent(cfg, 'data/trips.json', JSON.stringify(man2, null, 2) + '\n',
            m2 ? m2.sha : null, 'Caixinha: registra ' + id);
        }
      } else { throw e; }
    }
  }

  // Remove uma caixinha do repositório (arquivo + manifesto).
  async function deleteTrip(id) {
    const cfg = getConfig();
    if (!isConfigured()) {
      const err = new Error('Sincronização não configurada (falta o token).');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    if (!id) throw new Error('Caixinha inválida.');

    pushing++;
    try {
      const m = await apiGetContent(cfg, 'data/trips.json');
      let manifest = { trips: [] };
      let manSha = null;
      if (m) {
        manSha = m.sha;
        try { manifest = JSON.parse(base64ToUtf8(m.content)); } catch (e) { manifest = { trips: [] }; }
      }
      manifest.trips = manifest.trips || [];
      const item = manifest.trips.find(function (t) { return t.id === id; });
      const fileName = (item && item.file) || (id + '.json');
      const path = 'data/' + fileName;

      // Remove o arquivo da caixinha, se existir.
      const existing = await apiGetContent(cfg, path);
      if (existing) {
        await apiDeleteContent(cfg, path, existing.sha, 'Caixinha: remove ' + id);
      }

      // Remove a entrada do manifesto.
      if (item) {
        manifest.trips = manifest.trips.filter(function (t) { return t.id !== id; });
        await apiPutContent(cfg, 'data/trips.json', JSON.stringify(manifest, null, 2) + '\n',
          manSha, 'Caixinha: remove ' + id + ' do índice');
      }
    } finally {
      pushing--;
    }
  }

  // Testa a configuração: valida repositório e (se houver token) a permissão de escrita.
  async function test() {
    const cfg = getConfig();
    if (!cfg.owner || !cfg.repo) return { ok: false, message: 'Informe usuário e repositório.' };
    const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;
    let res;
    try {
      res = await fetch(url, { headers: apiHeaders(cfg), cache: 'no-store' });
    } catch (e) {
      return { ok: false, message: 'Sem conexão com o GitHub.' };
    }
    if (res.status === 404) {
      return { ok: false, message: 'Repositório não encontrado (verifique usuário/repo ou o acesso do token).' };
    }
    if (res.status === 401) {
      return { ok: false, message: 'Token inválido ou expirado.' };
    }
    if (!res.ok) {
      return { ok: false, message: 'Erro do GitHub: ' + res.status + '.' };
    }
    const info = await res.json();
    if (cfg.token) {
      const canPush = info && info.permissions && info.permissions.push;
      if (!canPush) {
        return { ok: false, message: 'Conectado, mas o token não tem permissão de escrita neste repositório.' };
      }
      return { ok: true, message: 'Tudo certo! Você pode ler e gravar.' };
    }
    return { ok: true, message: 'Repositório acessível para leitura. Adicione um token para poder gravar.' };
  }

  global.Sync = {
    getConfig: getConfig,
    setConfig: setConfig,
    hasRepo: hasRepo,
    isConfigured: isConfigured,
    pull: pull,
    pushTrip: pushTrip,
    deleteTrip: deleteTrip,
    test: test
  };
})(window);
