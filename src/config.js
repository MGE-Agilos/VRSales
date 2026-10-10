// Ce que la pièce affiche pour une app : volets de filtres, KPI, et les quatre visualisations immersives.
//   filters : volets de filtres (listbox)            kpis   : indicateurs en haut
//   matrix  : « ville de barres » dim1 × dim2         ring   : anneau du temps qui entoure la pièce
//   globe   : globe des lieux (lat/lon)               cloud  : nuage de points 3D (3 mesures) où l'on entre
// Une app connue a un préréglage (éléments maîtres) ; sinon la configuration est déduite des champs.

import { DEMO_MEASURES, SNAPSHOT_MEASURES } from './demo.js';

const PRESETS = {
  // Sales Analysis — tenant beyond-data-group-training
  '771eef89-203b-47ab-a617-d5f9df6dccad': {
    filters: [{ lib: 'CFJJTgE' }, { lib: 'HrxfBXc' }, { lib: 'Tagmk' }, { lib: 'NWVtRsu' }, { lib: 'GGcgEd' }, { lib: 'CXedNZd' }],
    kpis: [{ lib: 'TQDpN' }, { lib: 'BqDxCP' }, { lib: 'snkTTwF' }, { lib: 'hWgjTsf' }],
    matrix: {
      dims: [{ lib: 'Tagmk' }, { lib: 'CFJJTgE' }],
      measure: { lib: 'TQDpN' },
      choices: [{ lib: 'Tagmk', label: 'Category' }, { lib: 'NWVtRsu', label: 'Country' }, { lib: 'GGcgEd', label: 'Employee' }, { lib: 'CXedNZd', label: 'Supplier' }, { field: 'Shipper', label: 'Shipper' }],
    },
    ring: { dim: { lib: 'Dezygw' }, measure: { lib: 'TQDpN' }, color: { lib: 'snkTTwF' } },
    globe: { dim: { field: 'City', label: 'City' }, lat: { expr: 'Only(Latitude)', label: 'Latitude' }, lon: { expr: 'Only(Longitude)', label: 'Longitude' }, measure: { lib: 'TQDpN' }, color: { lib: 'snkTTwF' } },
    cloud: { dim: { lib: 'KdwHfh' }, x: { lib: 'TQDpN' }, y: { lib: 'snkTTwF' }, z: { lib: 'hWgjTsf' } },
  },
};

const dm = (key) => ({ key, label: DEMO_MEASURES[key].label });
const df = (field) => ({ field, label: field });
export const DEMO_CONFIG = {
  filters: ['Année', 'Mois', 'Région', 'Catégorie', 'Canal', 'Vendeur'].map(df),
  kpis: [dm('ventes'), dm('marge'), dm('margePct'), dm('commandes')],
  matrix: { dims: [df('Catégorie'), df('Année')], measure: dm('ventes'), choices: ['Catégorie', 'Région', 'Vendeur', 'Canal', 'Produit'].map(df) },
  ring: { dim: df('Année-Mois'), measure: dm('ventes'), color: dm('margePct') },
  globe: { dim: df('Ville'), lat: dm('lat'), lon: dm('lon'), measure: dm('ventes'), color: dm('margePct') },
  cloud: { dim: df('Client'), x: dm('ventes'), y: dm('margePct'), z: dm('commandes') },
};

// copie publique de Sales Analysis : même pièce que le préréglage de l'app, sur les champs exportés
const sm = (key) => ({ key, label: SNAPSHOT_MEASURES[key].label });
export const SNAPSHOT_CONFIG = {
  filters: [df('Year'), df('Quarter'), df('Category'), df('Country'), { field: 'EmployeeName', label: 'Employee' }, df('Supplier')],
  kpis: [sm('revenue'), sm('margin'), sm('marginPct'), sm('orders')],
  matrix: {
    dims: [df('Category'), df('Year')], measure: sm('revenue'),
    choices: [df('Category'), df('Country'), { field: 'EmployeeName', label: 'Employee' }, df('Supplier'), df('Shipper')],
  },
  ring: { dim: { field: 'YearMonth', label: 'Year-Month' }, measure: sm('revenue'), color: sm('marginPct') },
  globe: { dim: df('City'), lat: sm('lat'), lon: sm('lon'), measure: sm('revenue'), color: sm('marginPct') },
  cloud: { dim: df('Customer'), x: sm('revenue'), y: sm('marginPct'), z: sm('orders') },
};

// configuration déduite pour une app sans préréglage : champs texte peu nombreux en filtres, Sum() des champs numériques
async function autoConfig(source) {
  const { fields } = await source.model();
  const has = (f, t) => f.tags.includes(t);
  const usable = fields.filter((f) => !has(f, '$key') && !has(f, '$hidden') && f.cardinal > 1);
  const cats = usable.filter((f) => (has(f, '$text') || (has(f, '$integer') && f.cardinal <= 12)) && f.cardinal <= 300).sort((a, b) => a.cardinal - b.cardinal);
  const nums = usable.filter((f) => has(f, '$numeric') && !has(f, '$date') && !has(f, '$timestamp') && f.cardinal > 20);
  const key = fields.find((f) => has(f, '$key'));
  const meas = nums.slice(0, 3).map((f) => ({ expr: `Sum([${f.name}])`, label: `Somme ${f.name}` }));
  if (key) meas.push({ expr: `Count(DISTINCT [${key.name}])`, label: `Nb ${key.name}` });
  while (meas.length < 3) meas.push({ expr: 'Count(1)', label: 'Lignes' });
  const dim = (f) => (f ? { field: f.name, label: f.name } : null);
  const filters = cats.slice(0, 6).map(dim);
  const d1 = cats.find((f) => f.cardinal >= 4 && f.cardinal <= 20) ?? cats[0];
  const d2 = cats.find((f) => f !== d1 && f.cardinal >= 2 && f.cardinal <= 6);
  const time = usable.find((f) => /month|mois|period|yearmonth/i.test(f.name) && f.cardinal >= 6 && f.cardinal <= 120)
    ?? usable.find((f) => (has(f, '$date') || has(f, '$timestamp')) && f.cardinal <= 120);
  const lat = fields.find((f) => /^lat(itude)?$/i.test(f.name));
  const lon = fields.find((f) => /^(lon|lng|long|longitude)$/i.test(f.name));
  const place = lat && usable.find((f) => has(f, '$text') && f.cardinal === lat.cardinal);
  const big = [...usable].filter((f) => has(f, '$text') && f.cardinal >= 20 && f.cardinal <= 2000).sort((a, b) => b.cardinal - a.cardinal)[0];
  return {
    filters,
    kpis: meas.slice(0, 4),
    matrix: d1 ? { dims: [dim(d1), dim(d2)].filter(Boolean), measure: meas[0], choices: cats.filter((f) => f !== d2 && f.cardinal <= 40).slice(0, 5).map(dim) } : null,
    ring: time ? { dim: dim(time), measure: meas[0], color: meas[1] } : null,
    globe: place && lon ? { dim: dim(place), lat: { expr: `Only([${lat.name}])` }, lon: { expr: `Only([${lon.name}])` }, measure: meas[0], color: meas[1] } : null,
    cloud: big ? { dim: dim(big), x: meas[0], y: meas[1], z: meas[2] } : null,
  };
}

export async function configFor(source) {
  if (source.kind === 'demo') return DEMO_CONFIG;
  if (source.kind === 'snapshot') return SNAPSHOT_CONFIG;
  return PRESETS[source.appId] ?? autoConfig(source);
}
