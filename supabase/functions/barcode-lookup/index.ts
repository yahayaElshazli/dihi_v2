const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST for barcode lookups.' }, 405);

  let barcode = '';
  try {
    const body = await request.json();
    barcode = String(body?.barcode || '').trim();
  } catch (_) {
    return jsonResponse({ error: 'The barcode request was not valid JSON.' }, 400);
  }

  if (!/^\d{8,14}$/.test(barcode)) return jsonResponse({ error: 'Enter a valid UPC or EAN barcode.' }, 400);

  try {
    const url = new URL('https://api.upcitemdb.com/prod/trial/lookup');
    url.searchParams.set('upc', barcode);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    let result: any;
    try { result = await response.json(); }
    catch (_) { return jsonResponse({ error: 'The barcode provider returned an unreadable response.' }, 502); }

    if (response.status === 429) return jsonResponse({ error: 'The free barcode lookup limit has been reached. Try again later.' });
    if (!response.ok) return jsonResponse({ error: 'The barcode provider is temporarily unavailable.' });
    return jsonResponse({ items: Array.isArray(result?.items) ? result.items : [] });
  } catch (_) {
    return jsonResponse({ error: 'Could not reach the barcode provider. Try again or enter the film title manually.' });
  }
});
