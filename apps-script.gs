/**
 * Backend für die Handball-Statistik-PWA.
 *
 * EINRICHTUNG:
 * 1. Google Sheet anlegen mit folgenden Tabs (Tab-Namen exakt so):
 *    - Kader:        Name | Rückennummer | Position
 *    - Kader_Runde:  Name | Runde | Status
 *    - Spiele:       SpielID | Datum | Gegner | Runde | Tore_eigene | Tore_gegner
 *    - Aktionen:     AktionID | SpielID | SpielerinID | Halbzeit | Aktionstyp | Ergebnis | Quelle | Zeitstempel
 *    - Einsatz:      SpielID | SpielerinID | Start | Ende
 *
 *    Keine Spielerinnen-ID nötig – die Verknüpfung läuft direkt über den Namen
 *    aus "Kader". In "Aktionen"/"Einsatz" landet dieser Name dann in der Spalte
 *    "SpielerinID" (Spaltenname aus historischen Gründen so belassen, Inhalt
 *    ist schlicht der Name).
 *
 * 2. Extensions -> Apps Script öffnen, diesen Code einfügen.
 * 3. Deploy -> New deployment -> Type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone (die URL bleibt geheim, das reicht für dieses Vorhaben)
 * 4. Die erzeugte Web-App-URL in der PWA unter "Einstellungen" eintragen.
 */

const SHEET_KADER = 'Kader';
const SHEET_KADER_RUNDE = 'Kader_Runde';
const SHEET_SPIELE = 'Spiele';
const SHEET_AKTIONEN = 'Aktionen';
const SHEET_EINSATZ = 'Einsatz';

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'roster';
  if (action === 'roster') {
    return jsonResponse(getRoster(params.runde));
  }
  if (action === 'debug') {
    return jsonResponse({
      spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
      kaderZeilen: readTable(SHEET_KADER),
      kaderRundeZeilen: readTable(SHEET_KADER_RUNDE)
    });
  }
  return jsonResponse({ error: 'Unbekannte Aktion: ' + action });
}

function doPost(e) {
  if (!e || !e.postData) {
    return jsonResponse({ error: 'Kein POST-Body – diese Funktion braucht eine echte Web-Anfrage, kein Editor-"Ausführen".' });
  }
  const body = JSON.parse(e.postData.contents);
  const results = { spiele: [], aktionen: [], einsatz: [] };

  if (body.spiele) {
    body.spiele.forEach(function (spiel) {
      upsertSpiel(spiel);
      results.spiele.push(spiel.SpielID);
    });
  }
  if (body.aktionen) {
    const sheet = getSheet(SHEET_AKTIONEN);
    body.aktionen.forEach(function (a) {
      sheet.appendRow([a.AktionID, a.SpielID, a.SpielerinID, a.Halbzeit, a.Aktionstyp, a.Ergebnis, a.Quelle, a.Zeitstempel]);
      results.aktionen.push(a.AktionID);
    });
  }
  if (body.einsatz) {
    const sheet = getSheet(SHEET_EINSATZ);
    body.einsatz.forEach(function (ei) {
      sheet.appendRow([ei.SpielID, ei.SpielerinID, ei.Start, ei.Ende || '']);
      results.einsatz.push(ei.SpielID + '_' + ei.SpielerinID + '_' + ei.Start);
    });
  }
  return jsonResponse({ status: 'ok', results: results });
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Tab fehlt: ' + name);
  return sheet;
}

function readTable(name) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(function (row) { return row.some(function (c) { return c !== ''; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function getRoster(runde) {
  const kader = readTable(SHEET_KADER); // Spalten: Name | Rückennummer | Position
  const rundeNorm = (runde || '').toString().trim();
  const kaderRunde = readTable(SHEET_KADER_RUNDE).filter(function (r) { // Spalten: Name | Runde | Status
    const statusOk = (r.Status || '').toString().trim().toLowerCase() === 'aktiv';
    const rundeOk = !rundeNorm || (r.Runde || '').toString().trim() === rundeNorm;
    return statusOk && rundeOk;
  });
  const aktiveNamen = kaderRunde.map(function (r) { return (r.Name || '').toString().trim(); });
  return kader
    .filter(function (s) { return aktiveNamen.indexOf((s.Name || '').toString().trim()) !== -1; })
    .map(function (s) {
      return { SpielerinID: s.Name, Name: s.Name, Rückennummer: s.Rückennummer, Position: s.Position };
    });
}

function upsertSpiel(spiel) {
  const sheet = getSheet(SHEET_SPIELE);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === spiel.SpielID) {
      sheet.getRange(i + 1, 1, 1, 6).setValues([[
        spiel.SpielID, spiel.Datum, spiel.Gegner, spiel.Runde,
        spiel.Tore_eigene || '', spiel.Tore_gegner || ''
      ]]);
      return;
    }
  }
  sheet.appendRow([spiel.SpielID, spiel.Datum, spiel.Gegner, spiel.Runde, spiel.Tore_eigene || '', spiel.Tore_gegner || '']);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
