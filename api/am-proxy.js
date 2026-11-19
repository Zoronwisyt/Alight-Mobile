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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Final-URL');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const target = req.query?.url;
  if (!target || typeof target !== 'string') {
    res.status(400).send('Missing url query parameter');
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).send('Invalid url');
    return;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).send('Host not allowed');
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      },
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('X-Final-URL', upstream.url);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).send(err instanceof Error ? err.message : 'Proxy fetch failed');
  }
}
