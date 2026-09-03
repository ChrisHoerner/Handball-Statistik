/* ---------- Konfiguration ---------- */
const WURF_ZONEN = ['9m', '6m', 'Außen', 'Kreis', 'Konter', '7m'];
const BALLGEWINN = ['Techn. Fehler provoziert', 'Pass abgefangen', 'Rausprellen', 'Block'];
const FEHLER = ['Fehlpass', 'Schritte', 'Stürmerfoul', 'Kreisfehler', 'Doppeltipp', 'Ballverlust'];
const EINZEL = ['Assist', '7m geholt', '7m verursacht', '2min geholt', '2min verursacht'];

/* ---------- Kleine ID-Hilfe ---------- */
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}

/* ---------- IndexedDB ---------- */
let dbPromise = new Promise(function (resolve, reject) {
  const req = indexedDB.open('spielstatistik', 1);
  req.onupgradeneeded = function () {
    const db = req.result;
    if (!db.objectStoreNames.contains('roster')) db.createObjectStore('roster', { keyPath: 'SpielerinID' });
    if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'SpielID' });
    if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'AktionID' });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
  };
  req.onsuccess = function () { resolve(req.result); };
  req.onerror = function () { reject(req.error); };
});

function store(name, mode) {
  return dbPromise.then(function (db) { return db.transaction(name, mode || 'readonly').objectStore(name); });
}
function idbGetAll(name) {
  return store(name).then(function (s) {
    return new Promise(function (res, rej) {
      const r = s.getAll();
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  });
}
function idbGet(name, key) {
  return store(name).then(function (s) {
    return new Promise(function (res, rej) {
      const r = s.get(key);
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  });
}
function idbPut(name, value) {
  return store(name, 'readwrite').then(function (s) {
    return new Promise(function (res, rej) {
      const r = s.put(value);
      r.onsuccess = function () { res(value); };
      r.onerror = function () { rej(r.error); };
    });
  });
}
function idbDelete(name, key) {
  return store(name, 'readwrite').then(function (s) {
    return new Promise(function (res, rej) {
      const r = s.delete(key);
      r.onsuccess = function () { res(); };
      r.onerror = function () { rej(r.error); };
    });
  });
}
function idbClear(name) {
  return store(name, 'readwrite').then(function (s) {
    return new Promise(function (res, rej) {
      const r = s.clear();
      r.onsuccess = function () { res(); };
      r.onerror = function () { rej(r.error); };
    });
  });
}

/* ---------- Feste Adresse der eigenen Vercel-Vermittlerfunktion ---------- */
const API_BASE = '/api/proxy';

/* ---------- App-Zustand (nur im Speicher) ---------- */
const state = {
  roster: [],
  currentGameId: null,
  currentHalbzeit: '1',
  selectedPlayerId: null,
  runde: '',
  activeRosterNames: null,
  syncing: false
};

/* ---------- Initialisierung ---------- */
window.addEventListener('load', init);

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW-Fehler', e); });
  }

  const s2 = await idbGet('settings', 'runde');
  const s3 = await idbGet('settings', 'currentGameId');
  state.runde = s2 ? s2.value : '';
  state.currentGameId = s3 ? s3.value : null;

  document.getElementById('rundeSelect').value = state.runde;
  document.getElementById('gRunde').value = state.runde;

  state.roster = await idbGetAll('roster');
  updateRosterStatus();

  bindUI();
  await renderGameList();
  if (state.currentGameId) {
    const currentGame = await idbGet('games', state.currentGameId);
    state.activeRosterNames = (currentGame && currentGame.AktiveSpielerinnen && currentGame.AktiveSpielerinnen.length)
      ? currentGame.AktiveSpielerinnen : null;
    renderLiveScreen();
  }
  updateStatusBar();
  setInterval(updateStatusBar, 5000);
  setInterval(trySync, 15000);
  window.addEventListener('online', trySync);
  window.addEventListener('offline', updateStatusBar);
}

/* ---------- UI-Verdrahtung ---------- */
function bindUI() {
  document.querySelectorAll('nav.tabbar .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showScreen(btn.dataset.screen);
      if (btn.dataset.screen === 'auswertung') populateAuswertungSelects();
    });
  });

  document.getElementById('btnSaveSettings').addEventListener('click', async function () {
    state.runde = document.getElementById('rundeSelect').value.trim();
    await idbPut('settings', { key: 'runde', value: state.runde });
    document.getElementById('gRunde').value = state.runde;
    alert('Gespeichert.');
  });

  document.getElementById('btnLoadRoster').addEventListener('click', loadRosterFromBackend);

  document.getElementById('btnForceUpdate').addEventListener('click', async function () {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
      location.reload();
    } catch (e) {
      alert('Fehler beim Aktualisieren: ' + e.message);
    }
  });

  document.getElementById('btnStartGame').addEventListener('click', startNewGame);
  document.getElementById('btnEndGame').addEventListener('click', endCurrentGame);

  document.getElementById('btnSquadConfirm').addEventListener('click', async function () {
    const selection = getSquadSelection();
    const game = await idbGet('games', state.currentGameId);
    if (game) {
      game.AktiveSpielerinnen = selection;
      await idbPut('games', game);
    }
    state.activeRosterNames = selection.length ? selection : null;
    renderLiveScreen();
    showScreen('live');
  });

  document.getElementById('btnEditSquad').addEventListener('click', async function () {
    if (!state.currentGameId) { alert('Erst ein Spiel starten.'); return; }
    const game = await idbGet('games', state.currentGameId);
    renderSquadScreen(game && game.AktiveSpielerinnen && game.AktiveSpielerinnen.length ? game.AktiveSpielerinnen : null);
    showScreen('squad');
  });

  document.getElementById('btnAuswertungAnzeigen').addEventListener('click', showAuswertung);
  document.getElementById('btnExportAuswertung').addEventListener('click', exportAuswertungCSV);
  document.getElementById('btnExportAktionen').addEventListener('click', exportAktionenCSV);

  document.getElementById('importFile').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) importAktionenCSV(file);
    e.target.value = '';
  });

  document.getElementById('syncBtn').addEventListener('click', function () { trySync(true); });

  document.querySelectorAll('#halbzeitToggle button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#halbzeitToggle button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.currentHalbzeit = btn.dataset.hz;
    });
  });
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('nav.tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.dataset.screen === name); });
}

/* ---------- Kader laden (braucht Internet, i. d. R. vor dem Spiel zu Hause) ---------- */
async function loadRosterFromBackend() {
  const runde = document.getElementById('rundeSelect').value.trim();
  document.getElementById('rosterStatus').textContent = 'Lade …';
  try {
    const res = await fetch(API_BASE + '?action=roster&runde=' + encodeURIComponent(runde));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await idbClear('roster');
    for (const p of data) { await idbPut('roster', p); }
    state.roster = data;
    updateRosterStatus();
    renderPlayerStrip();
  } catch (e) {
    document.getElementById('rosterStatus').textContent = 'Fehler beim Laden – kein Netz? (' + e.message + ')';
  }
}

function updateRosterStatus() {
  const el = document.getElementById('rosterStatus');
  el.textContent = state.roster.length
    ? state.roster.length + ' Spielerinnen im lokalen Kader gespeichert (steht auch offline zur Verfügung).'
    : 'Noch kein Kader geladen.';
}

/* ---------- Spiel anlegen ---------- */
async function startNewGame() {
  const datum = document.getElementById('gDatum').value || new Date().toISOString().slice(0, 10);
  const gegner = document.getElementById('gGegner').value.trim();
  const runde = document.getElementById('gRunde').value.trim() || state.runde;
  if (!gegner) { alert('Bitte Gegner eintragen.'); return; }

  const spiel = { SpielID: uid(), Datum: datum, Gegner: gegner, Runde: runde, Tore_eigene: '', Tore_gegner: '', Status: 'läuft', synced: false };
  await idbPut('games', spiel);
  state.currentGameId = spiel.SpielID;
  await idbPut('settings', { key: 'currentGameId', value: spiel.SpielID });

  await renderGameList();
  renderSquadScreen(null);
  showScreen('squad');
  trySync();
}

function renderSquadScreen(preselected) {
  const el = document.getElementById('squadList');
  el.innerHTML = '';
  state.roster.forEach(function (p) {
    const checked = preselected ? preselected.indexOf(p.Name) !== -1 : true;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0;border-bottom:1px solid #333a46;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.name = p.Name;
    box.checked = checked;
    box.style.cssText = 'width:1.3rem;height:1.3rem;flex-shrink:0;';
    const label = document.createElement('span');
    label.textContent = (p.Rückennummer ? '#' + p.Rückennummer + ' ' : '') + p.Name + (p.Position === 'TW' ? ' (TW)' : '');
    row.appendChild(box);
    row.appendChild(label);
    el.appendChild(row);
  });
}

function getSquadSelection() {
  return Array.from(document.querySelectorAll('#squadList input[type=checkbox]:checked')).map(function (cb) { return cb.dataset.name; });
}

async function endCurrentGame() {
  if (!state.currentGameId) return;
  const game = await idbGet('games', state.currentGameId);
  if (!game) return;
  game.Tore_eigene = document.getElementById('eTore').value.trim();
  game.Tore_gegner = document.getElementById('eGegentore').value.trim();
  game.Status = 'beendet';
  game.synced = false;
  await idbPut('games', game);

  state.currentGameId = null;
  await idbPut('settings', { key: 'currentGameId', value: null });

  await renderGameList();
  showScreen('game');
  trySync();
}

async function renderGameList() {
  const games = (await idbGetAll('games')).sort(function (a, b) { return (b.Datum || '').localeCompare(a.Datum || ''); });
  const el = document.getElementById('gameList');
  el.innerHTML = '';
  games.forEach(function (g) {
    const row = document.createElement('div');
    row.className = 'action-group';
    row.style.marginBottom = '0.5rem';
    const status = g.Status === 'beendet' ? ('beendet · ' + (g.Tore_eigene || '?') + ':' + (g.Tore_gegner || '?')) : 'läuft';
    row.innerHTML = '<strong>' + g.Gegner + '</strong> · ' + g.Datum + ' · ' + status + ' · ' + (g.synced ? 'synchronisiert' : 'noch nicht synchronisiert');
    const btn = document.createElement('button');
    btn.className = 'secondary-btn';
    btn.style.marginTop = '0.5rem';
    btn.textContent = g.SpielID === state.currentGameId ? 'Aktuell ausgewählt' : 'Fortsetzen';
    btn.addEventListener('click', async function () {
      state.currentGameId = g.SpielID;
      await idbPut('settings', { key: 'currentGameId', value: g.SpielID });
      state.activeRosterNames = (g.AktiveSpielerinnen && g.AktiveSpielerinnen.length) ? g.AktiveSpielerinnen : null;
      renderLiveScreen();
      renderEndGameSection();
      showScreen('live');
    });
    row.appendChild(btn);
    el.appendChild(row);
  });
  renderEndGameSection();
}

function renderEndGameSection() {
  const section = document.getElementById('endGameSection');
  section.style.display = state.currentGameId ? '' : 'none';
}

/* ---------- Live-Erfassung ---------- */
function renderLiveScreen() {
  renderPlayerStrip();
  renderWurfRows();
  renderGrid('ballgewinnGrid', BALLGEWINN);
  renderGrid('fehlerGrid', FEHLER);
  renderGrid('einzelGrid', EINZEL);
  renderEventList();
  const selected = state.roster.find(function (r) { return r.SpielerinID === state.selectedPlayerId; });
  toggleTwView(selected ? selected.Position === 'TW' : false);
}

function renderPlayerStrip() {
  const elFeld = document.getElementById('playerStripFeld');
  const elTW = document.getElementById('playerStripTW');
  elFeld.innerHTML = '';
  elTW.innerHTML = '';
  const list = state.activeRosterNames
    ? state.roster.filter(function (p) { return state.activeRosterNames.indexOf(p.Name) !== -1; })
    : state.roster;
  const byNummer = function (a, b) { return (Number(a.Rückennummer) || 0) - (Number(b.Rückennummer) || 0); };
  const feld = list.filter(function (p) { return p.Position !== 'TW'; }).sort(byNummer);
  const tw = list.filter(function (p) { return p.Position === 'TW'; }).sort(byNummer);

  function buildChip(p) {
    const chip = document.createElement('button');
    chip.className = 'player-chip' + (p.SpielerinID === state.selectedPlayerId ? ' selected' : '');
    chip.innerHTML = (p.Rückennummer ? '<span class="num">#' + p.Rückennummer + '</span>' : '') + p.Name;
    chip.addEventListener('click', function () {
      state.selectedPlayerId = p.SpielerinID;
      renderPlayerStrip();
      toggleTwView(p.Position === 'TW');
    });
    return chip;
  }

  const half = Math.ceil(feld.length / 2);
  const row1 = document.createElement('div');
  row1.className = 'player-row';
  feld.slice(0, half).forEach(function (p) { row1.appendChild(buildChip(p)); });
  elFeld.appendChild(row1);
  if (feld.length > half) {
    const row2 = document.createElement('div');
    row2.className = 'player-row';
    feld.slice(half).forEach(function (p) { row2.appendChild(buildChip(p)); });
    elFeld.appendChild(row2);
  }

  tw.forEach(function (p) { elTW.appendChild(buildChip(p)); });
}

function toggleTwView(isTw) {
  document.getElementById('wurfGroup').style.display = isTw ? 'none' : '';
  document.getElementById('twGroup').style.display = isTw ? '' : 'none';
  document.getElementById('ballgewinnGrid').closest('.action-group').style.display = isTw ? 'none' : '';
  document.getElementById('fehlerGrid').closest('.action-group').style.display = isTw ? 'none' : '';
  document.getElementById('einzelGrid').closest('.action-group').style.display = isTw ? 'none' : '';
  if (isTw) renderTwRows();
}

function renderWurfRows() {
  const el = document.getElementById('wurfRows');
  el.innerHTML = '';
  WURF_ZONEN.forEach(function (zone) {
    const row = document.createElement('div');
    row.className = 'wurf-row';
    row.innerHTML = '<span class="zone">' + zone + '</span>' +
      '<button class="btn-fehlwurf">Fehlwurf</button>' +
      '<button class="btn-treffer">Treffer</button>';
    row.querySelector('.btn-treffer').addEventListener('click', function () { addEvent(zone, 'Treffer'); });
    row.querySelector('.btn-fehlwurf').addEventListener('click', function () { addEvent(zone, 'Fehlwurf'); });
    el.appendChild(row);
  });
}

function renderTwRows() {
  const el = document.getElementById('twRows');
  el.innerHTML = '';
  WURF_ZONEN.forEach(function (zone) {
    const row = document.createElement('div');
    row.className = 'wurf-row';
    row.innerHTML = '<span class="zone">' + zone + '</span>' +
      '<button class="btn-fehlwurf">Gegentor</button>' +
      '<button class="btn-treffer">Parade</button>';
    row.querySelector('.btn-treffer').addEventListener('click', function () { addEvent(zone, 'Parade'); });
    row.querySelector('.btn-fehlwurf').addEventListener('click', function () { addEvent(zone, 'Gegentor'); });
    el.appendChild(row);
  });
  const extra = document.createElement('div');
  extra.className = 'btn-grid';
  extra.style.marginTop = '0.6rem';
  ['Assist', 'Fehlpass'].forEach(function (typ) {
    const btn = document.createElement('button');
    btn.textContent = typ;
    btn.addEventListener('click', function () { addEvent(typ, ''); });
    extra.appendChild(btn);
  });
  el.appendChild(extra);
}

function renderGrid(elementId, items) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  items.forEach(function (typ) {
    const btn = document.createElement('button');
    btn.textContent = typ;
    btn.addEventListener('click', function () { addEvent(typ, ''); });
    el.appendChild(btn);
  });
}

const recentEvents = [];

async function addEvent(aktionstyp, ergebnis) {
  if (!state.currentGameId) { alert('Erst ein Spiel starten (Tab "Spiel").'); return; }
  if (!state.selectedPlayerId) { alert('Erst eine Spielerin oben auswählen.'); return; }
  const event = {
    AktionID: uid(),
    SpielID: state.currentGameId,
    SpielerinID: state.selectedPlayerId,
    Halbzeit: state.currentHalbzeit,
    Aktionstyp: aktionstyp,
    Ergebnis: ergebnis,
    Quelle: 'manuell',
    Zeitstempel: new Date().toISOString(),
    synced: false
  };
  await idbPut('events', event);
  recentEvents.unshift(event);
  if (recentEvents.length > 8) recentEvents.pop();
  renderEventList();
  updateStatusBar();
  trySync();
}

function playerName(id) {
  const p = state.roster.find(function (r) { return r.SpielerinID === id; });
  return p ? p.Name : id;
}

function renderEventList() {
  const ul = document.getElementById('eventList');
  ul.innerHTML = '';
  recentEvents.forEach(function (ev) {
    const li = document.createElement('li');
    const label = playerName(ev.SpielerinID) + ' · ' + ev.Aktionstyp + (ev.Ergebnis ? ' (' + ev.Ergebnis + ')' : '') + ' · HZ' + ev.Halbzeit;
    li.innerHTML = '<span>' + label + '</span>';
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = '↩ Rückgängig';
    undoBtn.addEventListener('click', async function () {
      await idbDelete('events', ev.AktionID);
      const idx = recentEvents.indexOf(ev);
      if (idx !== -1) recentEvents.splice(idx, 1);
      renderEventList();
      updateStatusBar();
      if (ev.synced) alert('Achtung: Diese Aktion war schon synchronisiert und muss im Google Sheet manuell gelöscht werden.');
    });
    li.appendChild(undoBtn);
    ul.appendChild(li);
  });
}

/* ---------- Sync ---------- */
async function trySync(manual) {
  if (state.syncing) { if (manual) alert('Synchronisierung läuft schon.'); return; }
  state.syncing = true;
  try {
    await trySyncInner(manual);
  } finally {
    state.syncing = false;
  }
}

async function trySyncInner(manual) {
  if (!navigator.onLine) { updateStatusBar(); if (manual) alert('Kein Netz gerade.'); return; }

  const games = (await idbGetAll('games')).filter(function (g) { return !g.synced; });
  const events = (await idbGetAll('events')).filter(function (e) { return !e.synced; });
  if (!games.length && !events.length) { updateStatusBar(); if (manual) alert('Alles schon synchron.'); return; }

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ spiele: games, aktionen: events })
    });
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Backend meldet Fehler');

    for (const g of games) { g.synced = true; await idbPut('games', g); }
    for (const e of events) {
      e.synced = true; await idbPut('events', e);
      const r = recentEvents.find(function (r) { return r.AktionID === e.AktionID; });
      if (r) r.synced = true;
    }
    await renderGameList();
    updateStatusBar();
    if (manual) alert('Synchronisiert.');
  } catch (e) {
    updateStatusBar();
    if (manual) alert('Sync fehlgeschlagen: ' + e.message);
  }
}

async function updateStatusBar() {
  const dot = document.getElementById('statusDot');
  const online = navigator.onLine;
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);

  const games = (await idbGetAll('games')).filter(function (g) { return !g.synced; }).length;
  const events = (await idbGetAll('events')).filter(function (e) { return !e.synced; }).length;
  const pending = games + events;
  document.getElementById('pending').textContent = online
    ? (pending ? pending + ' Einträge warten auf Sync' : 'Alles synchron')
    : (pending ? pending + ' Einträge lokal gespeichert (offline)' : 'Offline · keine ausstehenden Einträge');
}

/* ---------- Auswertung ---------- */

async function populateAuswertungSelects() {
  const spielerinSelect = document.getElementById('ausSpielerin');
  spielerinSelect.innerHTML = '';
  state.roster.forEach(function (p) {
    const opt = document.createElement('option');
    opt.value = p.Name;
    opt.textContent = p.Name;
    spielerinSelect.appendChild(opt);
  });

  const zeitraumSelect = document.getElementById('ausZeitraum');
  zeitraumSelect.innerHTML = '<option value="runde">Ganze Runde (' + (state.runde || '–') + ')</option>';

  try {
    const res = await fetch(API_BASE + '?action=spiele');
    const spiele = await res.json();
    spiele
      .filter(function (s) { return s.Runde === state.runde; })
      .sort(function (a, b) { return (a.Datum || '').localeCompare(b.Datum || ''); })
      .forEach(function (s) {
        const opt = document.createElement('option');
        opt.value = s.SpielID;
        opt.textContent = s.Datum + ' · ' + s.Gegner;
        zeitraumSelect.appendChild(opt);
      });
  } catch (e) {
    // Kein Netz gerade -> nur "Ganze Runde" bleibt wählbar, kein harter Fehler.
  }
}

let lastAuswertungExport = null;

async function showAuswertung() {
  const el = document.getElementById('ausErgebnis');
  const zeitraum = document.getElementById('ausZeitraum').value;
  const name = document.getElementById('ausSpielerin').value;
  const teamGesamt = document.getElementById('ausTeamGesamt').checked;
  el.innerHTML = '<p class="aus-empty">Lade …</p>';

  if (teamGesamt) {
    if (zeitraum === 'runde') {
      el.innerHTML = '<p class="aus-empty">Team gesamt geht nur bei einem einzelnen Spiel – bitte oben ein Spiel statt „Ganze Runde" wählen.</p>';
      lastAuswertungExport = null;
      return;
    }
    try {
      const res = await fetch(API_BASE + '?action=auswertungSpielTeam&spielId=' + encodeURIComponent(zeitraum));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      lastAuswertungExport = { type: 'team', data: data };
      renderTeamAuswertung(el, data);
    } catch (e) {
      el.innerHTML = '<p class="aus-empty">Fehler beim Laden – kein Netz? (' + e.message + ')</p>';
      lastAuswertungExport = null;
    }
    return;
  }

  try {
    let row = null;
    if (zeitraum === 'runde') {
      const res = await fetch(API_BASE + '?action=auswertungSpielerin');
      const rows = await res.json();
      row = rows.find(function (r) { return r.Name === name && r.Runde === state.runde; });
    } else {
      const res = await fetch(API_BASE + '?action=auswertungSpiel');
      const rows = await res.json();
      row = rows.find(function (r) { return r.Name === name && r.SpielID === zeitraum; });
    }
    lastAuswertungExport = { type: 'spielerin', row: row };
    renderAuswertung(el, row);
  } catch (e) {
    el.innerHTML = '<p class="aus-empty">Fehler beim Laden – kein Netz? (' + e.message + ')</p>';
    lastAuswertungExport = null;
  }
}

function statsBlockHtml(row, isTW) {
  const versucheLabel = isTW ? 'Würfe aufs Tor' : 'Versuche';
  const erfolgLabel = isTW ? 'Paraden' : 'Treffer';
  const quoteLabel = isTW ? 'Paradenquote' : 'Quote';
  const sectionTitle = isTW ? 'Paraden' : 'Wurf';
  let html = '<div class="aus-section-title">' + sectionTitle + '</div><table class="aus-table"><tr><th>Zone</th><th>' + versucheLabel + '</th><th>' + erfolgLabel + '</th><th>' + quoteLabel + '</th></tr>';
  WURF_ZONEN.forEach(function (z) {
    const quoteRaw = row[z + ' Quote'];
    const quoteDisplay = (quoteRaw === '' || quoteRaw === undefined || quoteRaw === null)
      ? ''
      : (Math.round(quoteRaw * 1000) / 10) + '%';
    html += '<tr><td>' + z + '</td><td>' + (row[z + ' Versuche'] || 0) + '</td><td>' + (row[z + ' Erfolg'] || 0) + '</td><td>' + quoteDisplay + '</td></tr>';
  });
  html += '</table>';
  if (isTW) {
    html += simpleTableHtml('Einzelereignisse', ['Assist', 'Fehlpass'], row);
  } else {
    html += simpleTableHtml('Ballgewinn', BALLGEWINN, row);
    html += simpleTableHtml('Eigener Fehler', FEHLER, row);
    html += simpleTableHtml('Einzelereignisse', EINZEL, row);
  }
  return html;
}

function simpleTableHtml(title, items, row) {
  let t = '<div class="aus-section-title">' + title + '</div><table class="aus-table">';
  items.forEach(function (k) { t += '<tr><td>' + k + '</td><td>' + (row[k] || 0) + '</td></tr>'; });
  t += '</table>';
  return t;
}

function renderAuswertung(el, row) {
  if (!row) {
    el.innerHTML = '<p class="aus-empty">Keine Daten für diese Auswahl.</p>';
    return;
  }
  el.innerHTML = statsBlockHtml(row, row.Position === 'TW');
}

function renderTeamAuswertung(el, data) {
  function block(titel, teil, isTW) {
    return '<h2 style="margin-top:1.2rem">' + titel + '</h2>' +
      '<div class="aus-section-title">1. Halbzeit</div>' + statsBlockHtml(teil.HZ1, isTW) +
      '<div class="aus-section-title">2. Halbzeit</div>' + statsBlockHtml(teil.HZ2, isTW) +
      '<div class="aus-section-title">Gesamtes Spiel</div>' + statsBlockHtml(teil.Gesamt, isTW);
  }
  el.innerHTML = block('Angriff (Feldspielerinnen)', data.Feld, false) + block('Abwehr / Torwart', data.TW, true);
}

/* ---------- CSV-Export ---------- */

function toCSVValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(function (row) { return row.map(toCSVValue).join(';'); }).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function statsRowsForCSV(row, isTW) {
  const out = [];
  out.push(['Zone', isTW ? 'Würfe aufs Tor' : 'Versuche', isTW ? 'Paraden' : 'Treffer', isTW ? 'Paradenquote' : 'Quote']);
  WURF_ZONEN.forEach(function (z) {
    const qr = row[z + ' Quote'];
    const q = (qr === '' || qr === undefined || qr === null) ? '' : (Math.round(qr * 1000) / 10) + '%';
    out.push([z, row[z + ' Versuche'] || 0, row[z + ' Erfolg'] || 0, q]);
  });
  out.push([]);
  if (isTW) {
    out.push(['Einzelereignisse']);
    ['Assist', 'Fehlpass'].forEach(function (k) { out.push([k, row[k] || 0]); });
  } else {
    out.push(['Ballgewinn']);
    BALLGEWINN.forEach(function (k) { out.push([k, row[k] || 0]); });
    out.push([]);
    out.push(['Eigener Fehler']);
    FEHLER.forEach(function (k) { out.push([k, row[k] || 0]); });
    out.push([]);
    out.push(['Einzelereignisse']);
    EINZEL.forEach(function (k) { out.push([k, row[k] || 0]); });
  }
  return out;
}

function exportAuswertungCSV() {
  if (!lastAuswertungExport) { alert('Erst eine Auswertung anzeigen.'); return; }
  let rows = [];
  let filename = 'auswertung.csv';

  if (lastAuswertungExport.type === 'spielerin') {
    const row = lastAuswertungExport.row;
    if (!row) { alert('Keine Daten zum Exportieren.'); return; }
    rows.push([row.Name + (row.Position === 'TW' ? ' (TW)' : '')]);
    rows.push([]);
    rows = rows.concat(statsRowsForCSV(row, row.Position === 'TW'));
    filename = 'auswertung_' + row.Name.replace(/\s+/g, '_') + '.csv';
  } else if (lastAuswertungExport.type === 'team') {
    const data = lastAuswertungExport.data;
    ['Feld', 'TW'].forEach(function (gruppe) {
      const isTW = gruppe === 'TW';
      rows.push([isTW ? 'Abwehr / Torwart' : 'Angriff (Feldspielerinnen)']);
      ['HZ1', 'HZ2', 'Gesamt'].forEach(function (teil) {
        const label = teil === 'HZ1' ? '1. Halbzeit' : teil === 'HZ2' ? '2. Halbzeit' : 'Gesamtes Spiel';
        rows.push([label]);
        rows = rows.concat(statsRowsForCSV(data[gruppe][teil], isTW));
        rows.push([]);
      });
    });
    filename = 'team_auswertung.csv';
  }
  downloadCSV(filename, rows);
}

async function exportAktionenCSV() {
  const zeitraum = document.getElementById('ausZeitraum').value;
  if (zeitraum === 'runde') { alert('Bitte oben ein einzelnes Spiel auswählen (nicht „Ganze Runde"), um die Einzelaktionen zu exportieren.'); return; }
  try {
    const res = await fetch(API_BASE + '?action=aktionenSpiel&spielId=' + encodeURIComponent(zeitraum));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const rows = [['AktionID', 'SpielID', 'SpielerinID', 'Halbzeit', 'Aktionstyp', 'Ergebnis', 'Quelle', 'Zeitstempel']];
    data.forEach(function (a) {
      rows.push([a.AktionID, a.SpielID, a.SpielerinID, a.Halbzeit, a.Aktionstyp, a.Ergebnis, a.Quelle, a.Zeitstempel]);
    });
    downloadCSV('aktionen_spiel.csv', rows);
  } catch (e) {
    alert('Fehler beim Export: ' + e.message);
  }
}

/* ---------- CSV-Import (Gegenstück zum Aktionen-Export) ---------- */

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ';') { result.push(cur); cur = ''; }
      else { cur += c; }
    }
  }
  result.push(cur);
  return result;
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM entfernen
  const lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.length > 0; });
  return lines.map(parseCSVLine);
}

async function importAktionenCSV(file) {
  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) { alert('Datei ist leer.'); return; }

  const header = rows[0];
  const idx = {};
  header.forEach(function (h, i) { idx[h.trim()] = i; });
  const required = ['AktionID', 'SpielID', 'SpielerinID', 'Halbzeit', 'Aktionstyp', 'Ergebnis'];
  const missing = required.filter(function (r) { return idx[r] === undefined; });
  if (missing.length) {
    alert('Ungültiges Format – es fehlen Spalten: ' + missing.join(', ') + '. Bitte eine unveränderte Export-Datei dieser App verwenden.');
    return;
  }

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[idx['AktionID']]) continue;
    const event = {
      AktionID: r[idx['AktionID']],
      SpielID: r[idx['SpielID']],
      SpielerinID: r[idx['SpielerinID']],
      Halbzeit: r[idx['Halbzeit']],
      Aktionstyp: r[idx['Aktionstyp']],
      Ergebnis: r[idx['Ergebnis']],
      Quelle: idx['Quelle'] !== undefined && r[idx['Quelle']] ? r[idx['Quelle']] : 'import',
      Zeitstempel: idx['Zeitstempel'] !== undefined && r[idx['Zeitstempel']] ? r[idx['Zeitstempel']] : new Date().toISOString(),
      synced: false
    };
    await idbPut('events', event);
    count++;
  }
  updateStatusBar();
  alert(count + ' Aktionen aus der Datei übernommen. Werden jetzt synchronisiert.');
  trySync();
}
