// Source « Qlik Cloud » : client JSON-RPC minimal du moteur associatif (QIX) via le proxy du serveur Vite.
// Chaque visuel est un objet de session (ListObject, HyperCube, SelectionObject) : le moteur calcule tout,
// signale les objets invalidés après chaque sélection (champ `change`), et on relit leurs layouts.
//
// Spécifications acceptées :
//   dimension : { lib: '<id maître>' } | { field: 'Nom' }            (+ label facultatif)
//   mesure    : { lib: '<id maître>' } | { expr: 'Sum(Sales)' }      (+ label facultatif)

class Qix {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.changed = new Set();
    this.onClose = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.url));
      ws.onerror = () => reject(new Error('WebSocket Qlik indisponible (proxy /qlik non configuré ?)'));
      ws.onclose = (e) => {
        for (const p of this.pending.values()) p.reject(new Error('connexion fermée'));
        this.pending.clear();
        this.onClose?.(e);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.method === 'OnConnected') return resolve();
        if (m.method === 'OnAuthenticationInformation' && m.params?.mustAuthenticate) return reject(new Error('authentification refusée par Qlik Cloud'));
        if (m.change?.length || m.close?.length) this.notify(m.change ?? []);
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? p.reject(Object.assign(new Error(`${p.method} : ${m.error.message} ${m.error.parameter ?? ''}`), { qix: m.error })) : p.resolve(m.result);
        }
      };
    });
  }
  call(handle, method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, handle, method, params }));
    });
  }
  notify(handles) {
    for (const h of handles) this.changed.add(h);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const set = this.changed;
      this.changed = new Set();
      for (const l of this.listeners) l(set);
    }, 20);
  }
}

const dimDef = (d) => (d.lib
  ? { qLibraryId: d.lib, qNullSuppression: true }
  : { qDef: { qFieldDefs: [d.field], qFieldLabels: [d.label ?? d.field] }, qNullSuppression: true });
const measDef = (m) => (m.lib ? { qLibraryId: m.lib } : { qDef: { qDef: m.expr, qLabel: m.label ?? m.expr } });
const cell = (c) => ({ text: c.qText ?? '', num: typeof c.qNum === 'number' ? c.qNum : NaN, elem: c.qElemNumber, state: c.qState });

// url : adresse WebSocket du moteur ; par défaut le proxy du serveur Vite (clé API), sinon celle fournie par la
// connexion OAuth (qlik-oauth.js) quand la page est hébergée sans serveur (GitHub Pages)
export async function connectQlik(appId, url) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const qix = new Qix(url ?? `${proto}://${location.host}/qlik/app/${appId}`);
  await qix.open();
  const doc = (await qix.call(-1, 'OpenDoc', { qDocName: appId })).qReturn.qHandle;
  const title = (await qix.call(doc, 'GetAppLayout')).qLayout.qTitle;
  const heartbeat = setInterval(() => qix.call(-1, 'EngineVersion').catch(() => {}), 45000);
  qix.onClose = () => { clearInterval(heartbeat); source.onDisconnect?.(); };

  const create = async (qProp) => (await qix.call(doc, 'CreateSessionObject', { qProp })).qReturn.qHandle;
  const layout = async (h) => (await qix.call(h, 'GetLayout')).qLayout;
  const destroy = (h) => qix.call(h, 'GetLayout').then((l) => qix.call(doc, 'DestroySessionObject', { qId: l.qInfo.qId })).catch(() => {});

  const source = {
    kind: 'qlik',
    title,
    appId,
    onDisconnect: null,
    onChange(cb) { qix.listeners.add(() => cb()); },

    async list(dim) {
      const h = await create({
        qInfo: { qType: 'vr-listbox' },
        qListObjectDef: {
          ...dimDef(dim),
          qDef: { ...(dim.lib ? {} : dimDef(dim).qDef), qSortCriterias: [{ qSortByState: 1, qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1 }] },
          qShowAlternatives: true,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: 1000 }],
        },
      });
      return {
        async layout() {
          const lo = (await layout(h)).qListObject;
          const rows = (lo.qDataPages[0]?.qMatrix ?? []).map((r) => cell(r[0]));
          const sel = rows.filter((r) => r.state === 'S' || r.state === 'L').length;
          return { title: lo.qDimensionInfo.qFallbackTitle, rows, total: lo.qSize.qcy, selected: sel };
        },
        select: (elem) => qix.call(h, 'SelectListObjectValues', { qPath: '/qListObjectDef', qValues: [elem], qToggleMode: true }),
        clear: () => qix.call(h, 'ClearSelections', { qPath: '/qListObjectDef' }),
        destroy: () => destroy(h),
      };
    },

    async cube({ dims = [], measures = [], max = 3000 }) {
      const width = dims.length + measures.length;
      const h = await create({
        qInfo: { qType: 'vr-cube' },
        qHyperCubeDef: {
          qDimensions: dims.map(dimDef),
          qMeasures: measures.map(measDef),
          qSuppressZero: true,
          qSuppressMissing: true,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: width, qHeight: Math.min(max, Math.floor(10000 / width)) }],
        },
      });
      return {
        async layout() {
          const hc = (await layout(h)).qHyperCube;
          const nd = dims.length;
          return {
            dims: hc.qDimensionInfo.map((d) => d.qFallbackTitle),
            measures: hc.qMeasureInfo.map((m) => m.qFallbackTitle),
            rows: (hc.qDataPages[0]?.qMatrix ?? []).map((r) => ({ d: r.slice(0, nd).map(cell), m: r.slice(nd).map(cell) })),
          };
        },
        select: (dimNo, elem) => (elem < 0 ? Promise.resolve() : qix.call(h, 'SelectHyperCubeValues', { qPath: '/qHyperCubeDef', qDimNo: dimNo, qValues: [elem], qToggleMode: true })),
        destroy: () => destroy(h),
      };
    },

    async selections() {
      const h = await create({ qInfo: { qType: 'vr-selections' }, qSelectionObjectDef: {} });
      return {
        async layout() {
          const so = (await layout(h)).qSelectionObject;
          return {
            back: so.qBackCount > 0,
            forward: so.qForwardCount > 0,
            items: so.qSelections.map((s) => ({ field: s.qField, text: s.qSelected, count: s.qSelectedCount, total: s.qTotal })),
          };
        },
        destroy: () => destroy(h),
      };
    },

    back: () => qix.call(doc, 'Back'),
    forward: () => qix.call(doc, 'Forward'),
    clearAll: () => qix.call(doc, 'ClearAll', { qLockedAlso: false }),
    async clearField(name) {
      const f = (await qix.call(doc, 'GetField', { qFieldName: name })).qReturn.qHandle;
      return qix.call(f, 'Clear');
    },
    // liste des champs et éléments maîtres, pour configurer automatiquement une app inconnue
    async model() {
      const fl = await layout(await create({ qInfo: { qType: 'FieldList' }, qFieldListDef: { qShowSemantic: true } }));
      const ml = await layout(await create({ qInfo: { qType: 'MeasureList' }, qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title' } } }));
      return {
        fields: fl.qFieldList.qItems.map((f) => ({ name: f.qName, cardinal: f.qCardinal, tags: f.qTags ?? [] })),
        measures: ml.qMeasureList.qItems.map((m) => ({ lib: m.qInfo.qId, label: m.qMeta.title })),
      };
    },
  };
  return source;
}

// get(path) : appel REST authentifié ; par défaut via le proxy du serveur Vite
export async function listApps(get = async (p) => { const r = await fetch(`/qlik${p}`); if (!r.ok) throw new Error(`liste des apps : HTTP ${r.status}`); return r.json(); }) {
  return (await get('/api/v1/items?resourceType=app&limit=100')).data.map((it) => ({ id: it.resourceId, name: it.name })).sort((a, b) => a.name.localeCompare(b.name));
}
