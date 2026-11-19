import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ALLOWED_PROXY_HOSTS = new Set([
  'alightcreative.com',
  'www.alightcreative.com',
  'alight.link',
  'alight.page.link',
  'firebasestorage.googleapis.com',
]);

function alightShareProxyPlugin(): Plugin {
  return {
    name: 'alight-share-proxy',
    configureServer(server) {
      server.middlewares.use('/api/am-proxy', async (req, res) => {
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
          const upstream = await fetch(targetUrl.toString(), { redirect: 'follow' });
          res.statusCode = upstream.status;
          const ct = upstream.headers.get('content-type');
          if (ct) res.setHeader('Content-Type', ct);
          res.setHeader('Access-Control-Allow-Origin', '*');
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.statusCode = 502;
          res.end(err instanceof Error ? err.message : 'Proxy fetch failed');
        }
      });
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
