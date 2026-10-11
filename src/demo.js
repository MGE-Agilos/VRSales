// Moteur associatif local (mêmes états S/O/A/X que Qlik), pour jouer sans connexion au moteur Qlik :
//   connectDemo()          ventes de vélos générées (?app=demo)
//   connectSnapshot(url)   copie figée de Sales Analysis (?app=snapshot), exportée par tools/export-snapshot.mjs
// Les mesures sont des fonctions JS : { label, fn(rows), fmt(n) }.

const CITIES = [
  ['Brussels', 'Belgium', 'Europe', 50.85, 4.35], ['Antwerp', 'Belgium', 'Europe', 51.22, 4.4], ['Liège', 'Belgium', 'Europe', 50.63, 5.57],
  ['Paris', 'France', 'Europe', 48.86, 2.35], ['Lyon', 'France', 'Europe', 45.76, 4.84], ['Berlin', 'Germany', 'Europe', 52.52, 13.4],
  ['Munich', 'Germany', 'Europe', 48.14, 11.58], ['Madrid', 'Spain', 'Europe', 40.42, -3.7], ['London', 'United Kingdom', 'Europe', 51.51, -0.13],
  ['Stockholm', 'Sweden', 'Europe', 59.33, 18.07], ['New York', 'United States', 'Americas', 40.71, -74.0], ['Chicago', 'United States', 'Americas', 41.88, -87.63],
  ['San Francisco', 'United States', 'Americas', 37.77, -122.42], ['Montreal', 'Canada', 'Americas', 45.5, -73.57], ['São Paulo', 'Brazil', 'Americas', -23.55, -46.63],
  ['Mexico City', 'Mexico', 'Americas', 19.43, -99.13], ['Tokyo', 'Japan', 'Asia-Pacific', 35.68, 139.69], ['Singapore', 'Singapore', 'Asia-Pacific', 1.35, 103.82],
  ['Sydney', 'Australia', 'Asia-Pacific', -33.87, 151.21], ['Shanghai', 'China', 'Asia-Pacific', 31.23, 121.47], ['Dubai', 'UAE', 'Middle East & Africa', 25.2, 55.27],
  ['Cape Town', 'South Africa', 'Middle East & Africa', -33.92, 18.42], ['Casablanca', 'Morocco', 'Middle East & Africa', 33.57, -7.59],
];
const CATS = { Bikes: ['Road', 'Mountain', 'Gravel', 'City'], Accessories: ['Helmet', 'Light', 'Lock'], Clothing: ['Jersey', 'Jacket', 'Gloves'], Components: ['Wheel', 'Saddle', 'Chain'], Electric: ['City e-bike', 'Trekking e-bike'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SELLERS = ['Amina', 'Bruno', 'Chloé', 'David', 'Elif', 'Farid', 'Greta', 'Hugo'];
const CHANNELS = ['Store', 'Web', 'Reseller'];

function generate() {
  let s = 42;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a, w) => (w ? a[w(rnd())] : a[Math.floor(rnd() * a.length)]);
  const customers = Array.from({ length: 120 }, (_, i) => {
    const c = CITIES[Math.floor(Math.pow(rnd(), 1.4) * CITIES.length)];
    return { name: `${['Cycles', 'Workshop', 'Wheels', 'Bike', 'Sport', 'Gear'][i % 6]} ${['North', 'South', 'Central', 'Express', 'Plus', 'Pro', 'Club', 'Free'][Math.floor(i / 6) % 8]} ${i + 1}`, city: c, size: 0.3 + rnd() * 2.5 };
  });
  const rows = [];
  for (const year of [2023, 2024, 2025]) {
    for (let m = 0; m < 12; m++) {
      const season = 1 + 0.5 * Math.sin(((m - 2) / 12) * Math.PI * 2) + (year - 2023) * 0.18;
      const n = Math.round(70 * season);
      for (let k = 0; k < n; k++) {
        const cu = customers[Math.floor(Math.pow(rnd(), 1.6) * customers.length)];
        const cat = pick(Object.keys(CATS));
        const price = { Bikes: 1400, Accessories: 60, Clothing: 90, Components: 180, Electric: 2600 }[cat] * (0.6 + rnd() * 0.9);
        const qty = 1 + Math.floor(rnd() * 4 * cu.size);
        const sales = price * qty;
        rows.push({
          Region: cu.city[2], Country: cu.city[1], City: cu.city[0], Latitude: cu.city[3], Longitude: cu.city[4],
          Category: cat, Product: pick(CATS[cat]), Year: String(year), Month: MONTHS[m], 'Year-Month': `${year} ${MONTHS[m]}`,
          Customer: cu.name, Seller: pick(SELLERS), Channel: pick(CHANNELS),
          Sales: sales, Margin: sales * (0.08 + rnd() * 0.3 + (cat === 'Accessories' ? 0.15 : 0)), Quantity: qty, Order: rows.length,
        });
      }
    }
  }
  return rows;
}

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const sum = (k) => (rows) => rows.reduce((a, r) => a + r[k], 0);
export const DEMO_MEASURES = {
  sales: { label: 'Sales €', fn: sum('Sales'), fmt: (n) => `€${money.format(n)}` },
  margin: { label: 'Margin €', fn: sum('Margin'), fmt: (n) => `€${money.format(n)}` },
  marginPct: { label: 'Margin %', fn: (r) => sum('Margin')(r) / (sum('Sales')(r) || 1), fmt: (n) => `${(n * 100).toFixed(1)}%` },
  orders: { label: 'Orders', fn: (r) => r.length, fmt: (n) => money.format(n) },
  quantity: { label: 'Quantity', fn: sum('Quantity'), fmt: (n) => money.format(n) },
  lat: { label: 'Latitude', fn: (r) => r[0]?.Latitude ?? NaN, fmt: String },
  lon: { label: 'Longitude', fn: (r) => r[0]?.Longitude ?? NaN, fmt: String },
};

// mesures de la copie de Sales Analysis : mêmes définitions que les éléments maîtres de l'app
const qnum = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const first = (k) => (rows) => rows.find((r) => r[k] != null)?.[k] ?? NaN;
export const SNAPSHOT_MEASURES = {
  revenue: { label: 'Revenue $', fn: sum('Sales'), fmt: (n) => qnum.format(n) },
  margin: { label: 'Total Margin$', fn: (r) => sum('Sales')(r) - sum('Costs')(r), fmt: (n) => qnum.format(n) },
  marginPct: { label: 'Total Margin %', fn: (r) => (sum('Sales')(r) - sum('Costs')(r)) / (sum('Sales')(r) || NaN), fmt: (n) => `${(n * 100).toFixed(1)}%` },
  orders: { label: 'Total Orders', fn: (r) => new Set(r.map((x) => x.OrderID).filter(Boolean)).size, fmt: (n) => qnum.format(n) },
  lat: { label: 'Latitude', fn: first('Latitude'), fmt: String },
  lon: { label: 'Longitude', fn: first('Longitude'), fmt: String },
};

export function connectDemo() {
  return engine({ kind: 'demo', title: 'Demo — bike sales', rows: generate(), measures: DEMO_MEASURES });
}

export async function connectSnapshot(url) {
  const d = await fetch(url).then((r) => r.json());
  const rows = Array.from({ length: d.rows }, (_, i) => {
    const r = {};
    for (const [f, { values, idx }] of Object.entries(d.fields)) r[f] = values[idx[i]];
    for (const [m, col] of Object.entries(d.measures)) r[m] = col[i] ?? 0;
    r.Latitude = d.measures.Latitude[i];
    r.Longitude = d.measures.Longitude[i];
    return r;
  });
  return engine({ kind: 'snapshot', title: `${d.title} — public copy`, exported: d.exported, rows, measures: SNAPSHOT_MEASURES });
}

function engine({ kind, title, exported, rows, measures: MEASURES }) {
  const fields = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'string');
  // valeurs distinctes de chaque champ, dans l'ordre de chargement (comme Qlik) ; une ligne = indices d'éléments
  const values = {};
  const index = {};
  for (const f of fields) {
    const map = new Map();
    for (const r of rows) if (!map.has(r[f])) map.set(r[f], map.size);
    values[f] = [...map.keys()];
    index[f] = Int32Array.from(rows, (r) => map.get(r[f]));
  }
  let sel = new Map(); // champ → Set(éléments)
  const history = [new Map()];
  let pos = 0;
  const listeners = new Set();
  const commit = (next) => {
    sel = next;
    history.length = pos + 1;
    history.push(new Map([...sel].map(([k, v]) => [k, new Set(v)])));
    pos = history.length - 1;
    setTimeout(() => listeners.forEach((l) => l()), 0);
  };
  const restore = (p) => {
    pos = p;
    sel = new Map([...history[p]].map(([k, v]) => [k, new Set(v)]));
    setTimeout(() => listeners.forEach((l) => l()), 0);
  };
  const matching = (except) => {
    const out = [];
    outer: for (let i = 0; i < rows.length; i++) {
      for (const [f, set] of sel) if (f !== except && !set.has(index[f][i])) continue outer;
      out.push(i);
    }
    return out;
  };
  const toggle = (f, elem) => {
    const next = new Map([...sel].map(([k, v]) => [k, new Set(v)]));
    const set = next.get(f) ?? new Set();
    set.has(elem) ? set.delete(elem) : set.add(elem);
    set.size ? next.set(f, set) : next.delete(f);
    commit(next);
  };
  const dimField = (d) => d.field;
  const measure = (m) => MEASURES[m.key];
  const fmtCell = (m, n) => ({ text: m.fmt(n), num: n, elem: 0 });

  return {
    kind,
    title,
    exported,
    onChange(cb) { listeners.add(cb); },
    async list(dim) {
      const f = dimField(dim);
      return {
        async layout() {
          const all = new Set(matching(null).map((i) => index[f][i]));
          const own = sel.get(f);
          const ignoringSelf = own ? new Set(matching(f).map((i) => index[f][i])) : all;
          const rank = { S: 0, O: 1, A: 2, X: 3 };
          const out = values[f].map((text, elem) => {
            const state = own ? (own.has(elem) ? 'S' : ignoringSelf.has(elem) ? 'A' : 'X') : all.has(elem) ? 'O' : 'X';
            return { text, elem, state, num: NaN };
          }).filter((r) => r.text !== '').sort((a, b) => rank[a.state] - rank[b.state] || a.text.localeCompare(b.text, 'en', { numeric: true }));
          return { title: dim.label ?? f, rows: out, total: out.length, selected: own?.size ?? 0 };
        },
        select: async (elem) => toggle(f, elem),
        clear: async () => { const n = new Map(sel); n.delete(f); commit(n); },
        destroy() {},
      };
    },
    async cube({ dims = [], measures = [] }) {
      const fs = dims.map(dimField);
      const ms = measures.map(measure);
      return {
        async layout() {
          const groups = new Map();
          for (const i of matching(null)) {
            if (fs.some((f) => values[f][index[f][i]] === '')) continue;
            const key = fs.map((f) => index[f][i]).join('|');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(rows[i]);
          }
          const out = [...groups].map(([key, rs]) => ({
            d: key === '' ? [] : key.split('|').map((e, k) => ({ text: values[fs[k]][+e], elem: +e, num: NaN })),
            m: ms.map((m) => fmtCell(m, m.fn(rs))),
          }));
          out.sort((a, b) => { for (let k = 0; k < a.d.length; k++) if (a.d[k].elem !== b.d[k].elem) return a.d[k].elem - b.d[k].elem; return 0; });
          if (!fs.length && !out.length) out.push({ d: [], m: ms.map((m) => fmtCell(m, NaN)) });
          return { dims: dims.map((d) => d.label ?? d.field), measures: ms.map((m) => m.label), rows: out };
        },
        select: async (dimNo, elem) => toggle(fs[dimNo], elem),
        destroy() {},
      };
    },
    async selections() {
      return {
        async layout() {
          return {
            back: pos > 0,
            forward: pos < history.length - 1,
            items: [...sel].map(([f, set]) => ({
              field: f,
              count: set.size,
              total: values[f].length,
              text: set.size <= 3 ? [...set].map((e) => values[f][e]).join(', ') : `${set.size} of ${values[f].length}`,
            })),
          };
        },
        destroy() {},
      };
    },
    back: async () => pos > 0 && restore(pos - 1),
    forward: async () => pos < history.length - 1 && restore(pos + 1),
    clearAll: async () => sel.size && commit(new Map()),
    clearField: async (f) => { const n = new Map(sel); n.delete(f); commit(n); },
  };
}
