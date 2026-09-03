/**
 * Vermittler zwischen der PWA und Google Apps Script – Vercel-Variante.
 *
 * Läuft auf Vercels Server, nicht im Browser – keine CORS-Regeln,
 * keine Weiterleitungs-Eigenheiten, kein geräteabhängiges Verhalten.
 * Die PWA ruft nur noch /api/proxy auf, nie mehr direkt Google.
 *
 * EINRICHTUNG bei Vercel:
 * Projekt -> Settings -> Environment Variables
 * -> Name "APPS_SCRIPT_URL", Wert = Ihre .../exec-Adresse aus Apps Script.
 * Danach einmal "Redeploy" anstoßen, damit die Variable aktiv wird.
 *
 * Kein vercel.json nötig – Vercel erkennt jede Datei unter /api/
 * automatisch als eigene Funktion.
 */
export default async function handler(req, res) {
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    res.status(500).json({ error: 'APPS_SCRIPT_URL ist in den Vercel-Umgebungsvariablen nicht gesetzt.' });
    return;
  }

  const params = new URLSearchParams(req.query || {}).toString();
  const targetUrl = APPS_SCRIPT_URL + (params ? '?' + params : '');

  const options = {
    method: req.method,
    headers: { 'Content-Type': 'text/plain' }
  };
  if (req.method === 'POST') {
    options.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const response = await fetch(targetUrl, options);
    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Proxy-Fehler: ' + err.message });
  }
}
