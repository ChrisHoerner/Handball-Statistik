export async function onRequest(context) {
  const { request, env } = context;
  const APPS_SCRIPT_URL = env.APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    return new Response(
      JSON.stringify({ error: 'APPS_SCRIPT_URL ist in den Cloudflare-Umgebungsvariablen nicht gesetzt.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const targetUrl = APPS_SCRIPT_URL + (url.search || '');

  const options = {
    method: request.method,
    headers: { 'Content-Type': 'text/plain' }
  };

  if (request.method === 'POST') {
    options.body = await request.text();
  }

  try {
    const response = await fetch(targetUrl, options);
    const text = await response.text();
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Proxy-Fehler: ' + err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}