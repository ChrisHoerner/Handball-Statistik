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

/* ---------- App-Zustand (nur im Speicher) ---------- */
const state = {
  roster: [],
  currentGameId: null,
  currentHalbzeit: '1',
  selectedPlayerId: null,
  scriptUrl: '',
  runde: ''
};

/* ---------- Initialisierung ---------- */
window.addEventListener('load', init);

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW-Fehler', e); });
  }

  const s1 = await idbGet('settings', 'scriptUrl');
  const s2 = await idbGet('settings', 'runde');
  const s3 = await idbGet('settings', 'currentGameId');
  state.scriptUrl = s1 ? s1.value : '';
  state.runde = s2 ? s2.value : '';
  state.currentGameId = s3 ? s3.value : null;

  document.getElementById('scriptUrl').value = state.scriptUrl;
  document.getElementById('rundeSelect').value = state.runde;
  document.getElementById('gRunde').value = state.runde;

  state.roster = await idbGetAll('roster');
  updateRosterStatus();

  bindUI();
  await renderGameList();
  if (state.currentGameId) {
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
    btn.addEventListener('click', function () { showScreen(btn.dataset.screen); });
  });

  document.getElementById('btnSaveSettings').addEventListener('click', async function () {
    state.scriptUrl = document.getElementById('scriptUrl').value.trim();
    state.runde = document.getElementById('rundeSelect').value.trim();
    await idbPut('settings', { key: 'scriptUrl', value: state.scriptUrl });
    await idbPut('settings', { key: 'runde', value: state.runde });
    document.getElementById('gRunde').value = state.runde;
    alert('Gespeichert.');
  });

  document.getElementById('btnLoadRoster').addEventListener('click', loadRosterFromBackend);

  document.getElementById('btnStartGame').addEventListener('click', startNewGame);

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
  const url = document.getElementById('scriptUrl').value.trim();
  const runde = document.getElementById('rundeSelect').value.trim();
  if (!url) { alert('Bitte zuerst die Apps-Script-URL eintragen und speichern.'); return; }
  document.getElementById('rosterStatus').textContent = 'Lade …';
  try {
    const res = await fetch(url + '?action=roster&runde=' + encodeURIComponent(runde));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await idbClear('roster');
    for (const p of data) { await idbPut('roster', p); }
    state.roster = data;
    updateRosterStatus();
    renderPlayerStrip();
  } catch (e) {
    document.getElementById('rosterStatus').textContent = 'Fehler beim Laden – kein Netz oder falsche URL? (' + e.message + ')';
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

  const spiel = { SpielID: uid(), Datum: datum, Gegner: gegner, Runde: runde, Tore_eigene: '', Tore_gegner: '', synced: false };
  await idbPut('games', spiel);
  state.currentGameId = spiel.SpielID;
  await idbPut('settings', { key: 'currentGameId', value: spiel.SpielID });

  await renderGameList();
  renderLiveScreen();
  showScreen('live');
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
    row.innerHTML = '<strong>' + g.Gegner + '</strong> · ' + g.Datum + ' · ' + (g.synced ? 'synchronisiert' : 'noch nicht synchronisiert');
    const btn = document.createElement('button');
    btn.className = 'secondary-btn';
    btn.style.marginTop = '0.5rem';
    btn.textContent = g.SpielID === state.currentGameId ? 'Aktuell ausgewählt' : 'Fortsetzen';
    btn.addEventListener('click', async function () {
      state.currentGameId = g.SpielID;
      await idbPut('settings', { key: 'currentGameId', value: g.SpielID });
      renderLiveScreen();
      showScreen('live');
    });
    row.appendChild(btn);
    el.appendChild(row);
  });
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
  const el = document.getElementById('playerStrip');
  el.innerHTML = '';
  state.roster.forEach(function (p) {
    const chip = document.createElement('button');
    chip.className = 'player-chip' + (p.SpielerinID === state.selectedPlayerId ? ' selected' : '');
    chip.innerHTML = (p.Rückennummer ? '<span class="num">#' + p.Rückennummer + '</span>' : '') + p.Name;
    chip.addEventListener('click', function () {
      state.selectedPlayerId = p.SpielerinID;
      renderPlayerStrip();
      toggleTwView(p.Position === 'TW');
    });
    el.appendChild(chip);
  });
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
  const dot = document.getElementById('statusDot');
  if (!navigator.onLine) { updateStatusBar(); if (manual) alert('Kein Netz gerade.'); return; }
  if (!state.scriptUrl) { updateStatusBar(); if (manual) alert('Keine Apps-Script-URL hinterlegt (Tab Einstellungen).'); return; }

  const games = (await idbGetAll('games')).filter(function (g) { return !g.synced; });
  const events = (await idbGetAll('events')).filter(function (e) { return !e.synced; });
  if (!games.length && !events.length) { updateStatusBar(); if (manual) alert('Alles schon synchron.'); return; }

  try {
    const res = await fetch(state.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // vermeidet CORS-Preflight bei Apps Script
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
