// Exporte une copie figée de l'app Sales Analysis pour la version publique (sans compte Qlik).
//   node dataviz/tools/export-snapshot.mjs      (clé API lue dans ../.env.local)  →  dataviz/assets/sales-snapshot.json
// Une ligne par ligne de commande, avec seulement les champs utiles à la pièce ; le moteur associatif local
// (src/demo.js) recalcule ensuite les sélections dans le navigateur.
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const env = Object.fromEntries(fs.readFileSync(path.join(here, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const APP = env.QLIK_APP_ID;

// champs exportés (dimensions) et mesures par ligne
const DIMS = ['OrderID', 'Product', 'Year', 'Quarter', 'YearMonth', 'Category', 'Country', 'City', 'Customer', 'EmployeeName', 'Supplier', 'Shipper'];
const MEAS = ['Sum(Sales)', 'Sum(Costs)', 'Sum(Quantity)', 'Only(Latitude)', 'Only(Longitude)'];

const ws = new WebSocket(`wss://${env.QLIK_TENANT}/app/${APP}`, { headers: { Authorization: `Bearer ${env.QLIK_API_KEY}` } });
let id = 0;
const pending = new Map();
const call = (handle, method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, handle, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('connexion au moteur impossible')); });

const doc = (await call(-1, 'OpenDoc', { qDocName: APP })).qReturn.qHandle;
const title = (await call(doc, 'GetAppLayout')).qLayout.qTitle;
// session isolée des sélections : on part de l'état « tout » (sans toucher aux sélections de la session partagée)
await call(doc, 'AddAlternateState', { qStateName: 'export' }).catch(() => {});
const W = DIMS.length + MEAS.length;
const cube = (await call(doc, 'CreateSessionObject', { qProp: {
  qInfo: { qType: 'export' }, qStateName: 'export',
  qHyperCubeDef: {
    qDimensions: DIMS.map((f) => ({ qDef: { qFieldDefs: [f] }, qNullSuppression: false })),
    qMeasures: MEAS.map((m) => ({ qDef: { qDef: m } })),
    qSuppressZero: false, qSuppressMissing: true,
  },
} })).qReturn.qHandle;
const size = (await call(cube, 'GetLayout')).qLayout.qHyperCube.qSize;
const rows = [];
const page = Math.floor(10000 / W);
for (let top = 0; top < size.qcy; top += page) {
  const data = (await call(cube, 'GetHyperCubeData', { qPath: '/qHyperCubeDef', qPages: [{ qTop: top, qLeft: 0, qWidth: W, qHeight: page }] })).qDataPages[0];
  for (const r of data.qMatrix) rows.push(r);
}
ws.close();

// format colonnaire compact : pour chaque champ, la liste de ses valeurs + un index par ligne
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (t) => { const [y, m] = String(t).split(' '); return +y * 12 + MONTHS.indexOf(m); };
rows.sort((a, b) => ym(a[4].qText) - ym(b[4].qText)); // ordre chronologique = ordre de chargement des périodes
const fields = {};
for (const [k, f] of DIMS.entries()) {
  const values = [];
  const map = new Map();
  const idx = rows.map((r) => {
    const t = r[k].qIsNull ? '' : r[k].qText;
    if (!map.has(t)) { map.set(t, values.length); values.push(t); }
    return map.get(t);
  });
  fields[f] = { values, idx };
}
const num = (c) => (typeof c.qNum === 'number' && Number.isFinite(c.qNum) ? Math.round(c.qNum * 100) / 100 : null);
const measures = Object.fromEntries(['Sales', 'Costs', 'Quantity', 'Latitude', 'Longitude'].map((n, i) => [n, rows.map((r) => num(r[DIMS.length + i]))]));
const out = { title, exported: new Date().toLocaleDateString('sv-SE'), rows: rows.length, fields, measures };
const file = path.join(here, '..', 'assets', 'sales-snapshot.json');
fs.writeFileSync(file, JSON.stringify(out));
const total = measures.Sales.reduce((a, b) => a + (b ?? 0), 0);
console.log(`${title} : ${rows.length} lignes, CA total ${Math.round(total).toLocaleString('en')} → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} ko)`);
for (const f of DIMS) console.log(`  ${f.padEnd(13)} ${fields[f].values.length} valeurs`);
