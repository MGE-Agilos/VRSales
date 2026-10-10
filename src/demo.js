// Source « démo » : petit moteur associatif local (mêmes états S/O/A/X que Qlik) sur des ventes générées.
// Sert quand le proxy Qlik n'est pas configuré (?app=demo). Les mesures sont des fonctions JS : { label, fn(rows) }.

const CITIES = [
  ['Bruxelles', 'Belgique', 'Europe', 50.85, 4.35], ['Anvers', 'Belgique', 'Europe', 51.22, 4.4], ['Liège', 'Belgique', 'Europe', 50.63, 5.57],
  ['Paris', 'France', 'Europe', 48.86, 2.35], ['Lyon', 'France', 'Europe', 45.76, 4.84], ['Berlin', 'Allemagne', 'Europe', 52.52, 13.4],
  ['Munich', 'Allemagne', 'Europe', 48.14, 11.58], ['Madrid', 'Espagne', 'Europe', 40.42, -3.7], ['Londres', 'Royaume-Uni', 'Europe', 51.51, -0.13],
  ['Stockholm', 'Suède', 'Europe', 59.33, 18.07], ['New York', 'États-Unis', 'Amériques', 40.71, -74.0], ['Chicago', 'États-Unis', 'Amériques', 41.88, -87.63],
  ['San Francisco', 'États-Unis', 'Amériques', 37.77, -122.42], ['Montréal', 'Canada', 'Amériques', 45.5, -73.57], ['São Paulo', 'Brésil', 'Amériques', -23.55, -46.63],
  ['Mexico', 'Mexique', 'Amériques', 19.43, -99.13], ['Tokyo', 'Japon', 'Asie-Pacifique', 35.68, 139.69], ['Singapour', 'Singapour', 'Asie-Pacifique', 1.35, 103.82],
  ['Sydney', 'Australie', 'Asie-Pacifique', -33.87, 151.21], ['Shanghai', 'Chine', 'Asie-Pacifique', 31.23, 121.47], ['Dubaï', 'Émirats', 'Moyen-Orient & Afrique', 25.2, 55.27],
  ['Le Cap', 'Afrique du Sud', 'Moyen-Orient & Afrique', -33.92, 18.42], ['Casablanca', 'Maroc', 'Moyen-Orient & Afrique', 33.57, -7.59],
];
const CATS = { Vélos: ['Route', 'VTT', 'Gravel', 'Urbain'], Accessoires: ['Casque', 'Lampe', 'Antivol'], Vêtements: ['Maillot', 'Veste', 'Gants'], Composants: ['Roue', 'Selle', 'Chaîne'], Électrique: ['VAE ville', 'VAE trekking'] };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SELLERS = ['Amina', 'Bruno', 'Chloé', 'David', 'Elif', 'Farid', 'Greta', 'Hugo'];
const CHANNELS = ['Magasin', 'Web', 'Revendeur'];

function generate() {
  let s = 42;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a, w) => (w ? a[w(rnd())] : a[Math.floor(rnd() * a.length)]);
  const customers = Array.from({ length: 120 }, (_, i) => {
    const c = CITIES[Math.floor(Math.pow(rnd(), 1.4) * CITIES.length)];
    return { name: `${['Cycles', 'Atelier', 'Roue', 'Vélo', 'Sport', 'Pignon'][i % 6]} ${['Nord', 'Sud', 'Central', 'Express', 'Plus', 'Pro', 'Club', 'Libre'][Math.floor(i / 6) % 8]} ${i + 1}`, city: c, size: 0.3 + rnd() * 2.5 };
  });
  const rows = [];
  for (const year of [2023, 2024, 2025]) {
    for (let m = 0; m < 12; m++) {
      const season = 1 + 0.5 * Math.sin(((m - 2) / 12) * Math.PI * 2) + (year - 2023) * 0.18;
      const n = Math.round(70 * season);
      for (let k = 0; k < n; k++) {
        const cu = customers[Math.floor(Math.pow(rnd(), 1.6) * customers.length)];
        const cat = pick(Object.keys(CATS));
        const price = { Vélos: 1400, Accessoires: 60, Vêtements: 90, Composants: 180, Électrique: 2600 }[cat] * (0.6 + rnd() * 0.9);
        const qty = 1 + Math.floor(rnd() * 4 * cu.size);
        const sales = price * qty;
        rows.push({
          Région: cu.city[2], Pays: cu.city[1], Ville: cu.city[0], Latitude: cu.city[3], Longitude: cu.city[4],
          Catégorie: cat, Produit: pick(CATS[cat]), Année: String(year), Mois: MONTHS[m], 'Année-Mois': `${year} ${MONTHS[m]}`,
          Client: cu.name, Vendeur: pick(SELLERS), Canal: pick(CHANNELS),
          Ventes: sales, Marge: sales * (0.08 + rnd() * 0.3 + (cat === 'Accessoires' ? 0.15 : 0)), Quantité: qty, Commande: rows.length,
        });
      }
    }
  }
  return rows;
}

const money = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const sum = (k) => (rows) => rows.reduce((a, r) => a + r[k], 0);
export const DEMO_MEASURES = {
  ventes: { label: 'Ventes €', fn: sum('Ventes'), fmt: (n) => `${money.format(n)} €` },
  marge: { label: 'Marge €', fn: sum('Marge'), fmt: (n) => `${money.format(n)} €` },
  margePct: { label: 'Marge %', fn: (r) => sum('Marge')(r) / (sum('Ventes')(r) || 1), fmt: (n) => `${(n * 100).toFixed(1)} %` },
  commandes: { label: 'Commandes', fn: (r) => r.length, fmt: (n) => money.format(n) },
  quantite: { label: 'Quantité', fn: sum('Quantité'), fmt: (n) => money.format(n) },
  lat: { label: 'Latitude', fn: (r) => r[0]?.Latitude ?? NaN, fmt: String },
  lon: { label: 'Longitude', fn: (r) => r[0]?.Longitude ?? NaN, fmt: String },
};

export function connectDemo() {
  const rows = generate();
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
  const measure = (m) => DEMO_MEASURES[m.key];
  const fmtCell = (m, n) => ({ text: m.fmt(n), num: n, elem: 0 });

  return {
    kind: 'demo',
    title: 'Démo — ventes de vélos',
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
          }).sort((a, b) => rank[a.state] - rank[b.state] || a.text.localeCompare(b.text, 'fr', { numeric: true }));
          return { title: dim.label ?? f, rows: out, total: values[f].length, selected: own?.size ?? 0 };
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
              text: set.size <= 3 ? [...set].map((e) => values[f][e]).join(', ') : `${set.size} sur ${values[f].length}`,
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
