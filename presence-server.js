// Présence en direct pour le serveur Vite : qui est dans la pièce, où, et ce qu'il vise.
//   POST /presence          { id, name, color, device, head, hand?, aim?, event? }   (≈ 15 fois/s par appareil)
//   POST /presence/leave    { id }                                                  (fermeture de la page)
//   GET  /presence/stream   flux SSE : { people: [...], events: [...] } ≈ 15 fois/s
// Les sélections, elles, n'ont pas besoin de passer par ici : tous les appareils partagent la même session
// du moteur Qlik, qui notifie chacun à chaque changement.

export function presence() {
  const people = new Map();
  const clients = new Set();
  let events = [];
  let timer = null;

  const tick = () => {
    const now = Date.now();
    for (const [id, p] of people) if (now - p.t > 6000) people.delete(id);
    const msg = `data: ${JSON.stringify({ people: [...people.values()], events })}\n\n`;
    events = [];
    for (const res of clients) res.write(msg);
    if (!clients.size) { clearInterval(timer); timer = null; }
  };

  const body = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
  });

  const handler = async (req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      timer ??= setInterval(tick, 66);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const msg = await body(req);
    res.statusCode = 204;
    res.end();
    if (!msg || typeof msg.id !== 'string') return;
    if (url === '/leave') { people.delete(msg.id); return; }
    const { event, ...state } = msg;
    people.set(msg.id, { ...state, t: Date.now() });
    if (event) events.push({ ...event, id: msg.id, name: msg.name, color: msg.color, device: msg.device });
  };

  return {
    name: 'presence',
    configureServer(server) { server.middlewares.use('/presence', handler); },
    configurePreviewServer(server) { server.middlewares.use('/presence', handler); },
  };
}
