// Free Cloudflare Worker CORS proxy for Alight Motion share links (100k req/day free tier)
// Deploy at https://dash.cloudflare.com -> Workers -> Create Worker -> paste this file -> Deploy
// Then paste your worker URL (e.g. https://am-proxy.yourname.workers.dev) into Import Link -> Proxy URL.

const ALLOWED_HOSTS = new Set([
  'alightcreative.com',
  'www.alightcreative.com',
  'alightmotion.com',
  'www.alightmotion.com',
  'alight.link',
  'alight.page.link',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response('Missing url param', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response('Invalid url', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      },
    });

    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', 'X-Final-URL');
    headers.set('X-Final-URL', upstream.url);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
