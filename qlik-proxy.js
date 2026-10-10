import { loadEnv } from 'vite';

// Proxy Qlik Cloud pour le serveur Vite : le casque parle à https://<PC>:5173/qlik/…, le PC ajoute la clé API
// (lue dans .env.local) et relaie vers le tenant — REST (/qlik/api/v1/…) comme WebSocket du moteur (/qlik/app/<id>).
// La clé ne quitte jamais le PC ; aucun « allowed origin » ni client OAuth n'est nécessaire côté tenant.
//   GET /qlik-status  →  { configured, tenant, appId }

export function qlikProxy() {
  let env = {};
  const status = (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ configured: !!env.QLIK_API_KEY, tenant: env.QLIK_TENANT ?? null, appId: env.QLIK_APP_ID ?? null }));
  };
  return {
    name: 'qlik-proxy',
    config(_config, { mode }) {
      env = loadEnv(mode, process.cwd(), 'QLIK_');
      if (!env.QLIK_API_KEY || !env.QLIK_TENANT) return;
      const auth = `Bearer ${env.QLIK_API_KEY}`;
      // le navigateur envoie Origin/Referer/cookies du serveur local : on les retire pour que le tenant ne voie que la clé
      const sign = (proxyReq) => {
        for (const h of ['origin', 'referer', 'cookie']) proxyReq.removeHeader(h);
        proxyReq.setHeader('authorization', auth);
      };
      const proxy = {
        '/qlik/': {
          target: `https://${env.QLIK_TENANT}`,
          changeOrigin: true,
          secure: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/qlik/, ''),
          configure(p) {
            p.on('proxyReq', sign);
            p.on('proxyReqWs', sign);
          },
        },
      };
      return { server: { proxy }, preview: { proxy } };
    },
    configureServer(server) {
      server.middlewares.use('/qlik-status', status);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/qlik-status', status);
    },
  };
}
