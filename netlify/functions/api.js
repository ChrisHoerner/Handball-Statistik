/**
 * Vermittler zwischen der PWA und Google Apps Script.
 *
 * Läuft auf Netlify's Server, nicht im Browser – deshalb gelten hier
 * keinerlei CORS-Regeln, keine Weiterleitungs-Eigenheiten, kein
 * geräteabhängiges Verhalten. Die PWA ruft nur noch diese eine,
 * eigene Adresse auf (/.netlify/functions/api), nie mehr direkt Google.
 *
 * EINRICHTUNG:
 * Netlify-Projekt -> Project configuration -> Environment variables
 * -> Variable "APPS_SCRIPT_URL" anlegen, Wert = Ihre .../exec-Adresse
 * aus Apps Script (Bereitstellen -> Bereitstellungen verwalten).
 * Nach dem Eintragen einmal "Trigger deploy" o. Ä. anstoßen, damit die
 * Variable aktiv wird.
 */
exports.handler = async function (event) {
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'APPS_SCRIPT_URL ist in den Netlify-Umgebungsvariablen nicht gesetzt.' })
    };
  }

  const params = new URLSearchParams(event.queryStringParameters || {}).toString();
  const targetUrl = APPS_SCRIPT_URL + (params ? '?' + params : '');

  const options = {
    method: event.httpMethod,
    headers: { 'Content-Type': 'text/plain' }
  };
  if (event.httpMethod === 'POST' && event.body) {
    options.body = event.body;
  }

  try {
    const response = await fetch(targetUrl, options);
    const text = await response.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy-Fehler: ' + err.message })
    };
  }
};
