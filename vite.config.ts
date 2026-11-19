import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ALLOWED_PROXY_HOSTS = new Set([
  'alightcreative.com',
  'www.alightcreative.com',
  'alightmotion.com',
  'www.alightmotion.com',
  'alight.link',
  'alight.page.link',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

async function handleProxyMiddleware(
  req: { url?: string },
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string | Buffer) => void;
  }
) {
  try {
    const parsedReq = new URL(req.url || '/', 'http://localhost');
    const target = parsedReq.searchParams.get('url');
    if (!target) {
      res.statusCode = 400;
      res.end('Missing url param');
      return;
    }
    const targetUrl = new URL(target);
    if (!ALLOWED_PROXY_HOSTS.has(targetUrl.hostname)) {
      res.statusCode = 403;
      res.end('Host not allowed');
      return;
    }
    const upstream = await fetch(targetUrl.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      },
    });
    res.statusCode = upstream.status;
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Final-URL');
    res.setHeader('X-Final-URL', upstream.url);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.end(err instanceof Error ? err.message : 'Proxy fetch failed');
  }
}

function alightShareProxyPlugin(): Plugin {
  return {
    name: 'alight-share-proxy',
    configureServer(server) {
      server.middlewares.use('/api/am-proxy', handleProxyMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/am-proxy', handleProxyMiddleware);
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Alight-Mobile/' : './',
  plugins: [react(), alightShareProxyPlugin()],
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
