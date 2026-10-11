import * as THREE from 'three';
import { Panel, card, text, label, rrect } from './panel.js';
import { Q, PALETTE, seqColor, SEQ_CSS, compact } from './theme.js';
import landUrl from '../assets/land-110m.json?url';

// Les quatre visualisations immersives. Chacune expose :
//   group           l'objet 3D à placer dans la pièce
//   bind(source)    crée ses objets dans le moteur, renvoie le modèle à rafraîchir
//   apply(layout)   reçoit les données recalculées après chaque sélection (et anime la transition)
//   update(dt)      animation par image
//   targets         ce que le rayon peut viser : { intersect, hover, leave, select, tooltip, stick?, grab? }

const ease = (dt, speed = 7) => 1 - Math.exp(-dt * speed);
const keyOf = (d) => d.lib ?? d.field ?? d.key;
const GREEN = new THREE.Color(Q.green);

// --- barres animées (création, croissance, disparition, survol, éclair vert à la sélection) -------------------
class BarSet {
  constructor(parent, geometry) {
    this.parent = parent;
    this.geo = geometry;
    this.items = new Map();
    this.hovered = null;
  }
  sync(entries) {
    const seen = new Set();
    for (const e of entries) {
      seen.add(e.key);
      let it = this.items.get(e.key);
      if (!it) {
        const mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: e.color, roughness: 0.5, metalness: 0 }));
        mesh.position.copy(e.pos);
        mesh.scale.set(e.w, 1e-4, e.d);
        this.parent.add(mesh);
        it = { key: e.key, mesh, h: 0, flash: 0 };
        mesh.userData.item = it;
        this.items.set(e.key, it);
      }
      Object.assign(it, { dying: false, th: e.h, tpos: e.pos.clone(), tw: e.w, td: e.d, tcolor: new THREE.Color(e.color), data: e.data });
      if (e.quat) it.mesh.quaternion.copy(e.quat);
      if (e.rotY !== undefined) it.mesh.rotation.y = e.rotY;
    }
    for (const it of this.items.values()) if (!seen.has(it.key)) { it.dying = true; it.th = 0; }
  }
  update(dt) {
    const a = ease(dt);
    for (const it of this.items.values()) {
      const m = it.mesh;
      it.h += (it.th - it.h) * a;
      m.position.lerp(it.tpos, a);
      m.scale.set(m.scale.x + (it.tw - m.scale.x) * a, Math.max(it.h, 1e-4), m.scale.z + (it.td - m.scale.z) * a);
      m.material.color.lerp(it.tcolor, a);
      it.flash = Math.max(0, it.flash - dt * 2);
      const hov = it === this.hovered ? 0.2 : 0;
      m.material.emissive.setRGB(hov, hov, hov).lerp(GREEN, it.flash);
      m.visible = it.h > 0.002;
      if (it.dying && it.h < 0.002) {
        this.parent.remove(m);
        m.material.dispose();
        this.items.delete(it.key);
        if (this.hovered === it) this.hovered = null;
      }
    }
  }
  intersect(raycaster) {
    const meshes = [];
    for (const it of this.items.values()) if (!it.dying && it.mesh.visible) meshes.push(it.mesh);
    const h = raycaster.intersectObjects(meshes, false)[0];
    return h ? { distance: h.distance, point: h.point, item: h.object.userData.item } : null;
  }
}

// cible générique sur un BarSet
function barTarget(bars, { select, tooltip, stick, grab }) {
  return {
    intersect: (r) => bars.intersect(r),
    hover: (hit) => { bars.hovered = hit?.item ?? null; },
    leave: () => { bars.hovered = null; },
    select: (hit) => { hit.item.flash = 1; select(hit.item.data); },
    tooltip: (hit) => tooltip(hit.item.data),
    stick, grab,
  };
}

// cible sur des étiquettes (sprites) cliquables
function labelTarget(getSprites, select, tooltip) {
  return {
    intersect(r) {
      const h = r.intersectObjects(getSprites(), false)[0];
      return h ? { distance: h.distance, point: h.point, sprite: h.object } : null;
    },
    hover(hit) { for (const s of getSprites()) s.material.opacity = s === hit?.sprite ? 0.65 : 1; },
    leave() { for (const s of getSprites()) s.material.opacity = 1; },
    select: (hit) => select(hit.sprite.userData),
    tooltip: (hit) => tooltip?.(hit.sprite.userData),
  };
}

// petit en-tête (titre + sous-titre + légende de couleur facultative)
class Header extends Panel {
  constructor(w, h) {
    super(w, h);
    this.title = '';
    this.sub = '';
    this.legend = null; // { label, min, max }
  }
  set(title, sub, legend = null) {
    const key = JSON.stringify([title, sub, legend]);
    if (key === this.key) return;
    this.key = key;
    Object.assign(this, { title, sub, legend });
    this.draw();
  }
  paint(g) {
    card(g, 3, 3, this.w - 6, this.h - 6, { r: 18 });
    text(g, this.title, 32, 50, { size: 40, weight: 600, max: this.w - 64 });
    text(g, this.sub, 32, 98, { size: 28, color: Q.inkSoft, max: this.w - 64 });
    if (this.legend && this.h > 160) {
      const y = 138, x = 32, w = Math.min(420, this.w - 64);
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      SEQ_CSS.forEach((c, i) => grad.addColorStop(i / (SEQ_CSS.length - 1), c));
      rrect(g, x, y, w, 16, 8);
      g.fillStyle = grad;
      g.fill();
      text(g, this.legend.min, x, y + 44, { size: 26, color: Q.inkSoft });
      text(g, this.legend.max, x + w, y + 44, { size: 26, color: Q.inkSoft, align: 'right' });
      text(g, this.legend.label, x + w + 24, y + 9, { size: 26, color: Q.inkSoft, max: this.w - w - 100 });
    }
  }
}

const range = (vals) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return lo === Infinity ? [0, 1] : [lo, hi === lo ? lo + 1 : hi];
};
// texte formaté par le moteur pour la valeur la plus proche de n (min/max des légendes)
const textNear = (rows, mi, n) => rows.find((r) => r.m[mi].num === n)?.m[mi].text ?? compact(n);

// =============================================================================================================
// 1. « Ville de barres » : dim1 (colonnes) × dim2 (rangées) sur une table ; on tourne autour, on se penche dessus
// =============================================================================================================
const TABLE_W = 2.6, TABLE_D = 1.4, TABLE_Y = 0.62, BAR_MAX = 1.15;

class Tabs extends Panel {
  constructor(matrix) {
    super(TABLE_W, 0.2);
    this.m = matrix;
  }
  paint(g) {
    card(g, 3, 3, this.w - 6, this.h - 6, { r: 16 });
    const m = this.m;
    text(g, m.title, 30, 56, { size: 34, weight: 600, max: 900 });
    text(g, 'Columns:', 30, 140, { size: 24, color: Q.inkMuted });
    let x = 170;
    for (const [i, c] of m.cfg.choices.entries()) {
      const active = keyOf(c) === keyOf(m.d1);
      const w = text(g, c.label ?? '…', 0, -100, { size: 28, weight: active ? 600 : 400 }) + 48;
      if (x + w > this.w - 20) break;
      if (this.hoverId === `tab${i}` && !active) { rrect(g, x, 104, w, 64, 10); g.fillStyle = '#f0f1f3'; g.fill(); }
      text(g, c.label, x + 24, 137, { size: 28, weight: active ? 600 : 400, color: active ? Q.ink : Q.inkSoft });
      if (active) { g.fillStyle = Q.blue; g.fillRect(x + 12, 166, w - 24, 6); }
      this.region(`tab${i}`, x, 100, w, 76, { choice: c });
      x += w + 8;
    }
    if (m.d2) {
      const sx = 1000;
      text(g, `Rows: ${m.d2Title}`, sx, 56, { size: 26, color: Q.inkSoft, max: this.w - sx - 30 });
    }
  }
}

export class Matrix {
  constructor(cfg, refresh) {
    this.cfg = cfg;
    this.refresh = refresh;
    this.d1 = cfg.dims[0];
    this.d2 = cfg.dims[1] ?? null;
    this.title = '';
    this.d2Title = '';
    this.group = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W + 0.3, 0.05, TABLE_D + 0.3), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }));
    table.position.y = TABLE_Y - 0.025;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, TABLE_Y - 0.05, TABLE_D), new THREE.MeshStandardMaterial({ color: '#e6e9ed', roughness: 0.9 }));
    foot.position.y = (TABLE_Y - 0.05) / 2;
    this.group.add(table, foot);
    this.barsGroup = new THREE.Group();
    this.barsGroup.position.y = TABLE_Y;
    this.labels = new THREE.Group();
    this.grid = new THREE.Group();
    this.group.add(this.barsGroup, this.labels, this.grid);
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.bars = new BarSet(this.barsGroup, geo);
    this.tabs = new Tabs(this);
    this.tabs.mesh.position.set(0, TABLE_Y - 0.16, TABLE_D / 2 + 0.17);
    this.tabs.mesh.rotation.x = -0.35;
    this.group.add(this.tabs.mesh);
    this.tabs.draw();
    this.colLabels = [];
    this.rowLabels = [];
    const tip = (d) => ({ title: d.text1 + (d.text2 ? ` · ${d.text2}` : ''), lines: [[this.title, d.value]], hint: 'Trigger: select' });
    this.targets = [
      barTarget(this.bars, { select: (d) => this.model.select(0, d.elem1), tooltip: tip }),
      labelTarget(() => this.colLabels, (u) => this.model.select(0, u.elem), (u) => ({ title: u.text, lines: [], hint: 'Trigger: select' })),
      labelTarget(() => this.rowLabels, (u) => this.model.select(1, u.elem), (u) => ({ title: u.text, lines: [], hint: 'Trigger: select' })),
      Object.assign(this.tabs, {
        select: (hit) => {
          const c = hit.region?.choice;
          if (!c || keyOf(c) === keyOf(this.d1)) return;
          this.d1 = c;
          this.rebind = true;
          this.tabs.draw();
          this.refresh();
        },
        tooltip: () => null,
      }),
    ];
  }
  async bind(source) {
    this.source = source;
    this.model?.destroy();
    const dims = [this.d1, this.d2].filter(Boolean);
    this.model = await source.cube({ dims, measures: [this.cfg.measure], max: 3000 });
    this.rebind = false;
    return this.model;
  }
  apply(L) {
    this.title = `${L.measures[0]} by ${L.dims[0]}`;
    this.d2Title = L.dims[1] ?? '';
    const totals = new Map();
    const rowsTot = new Map();
    for (const r of L.rows) {
      const v = r.m[0].num;
      if (!Number.isFinite(v)) continue;
      const c = totals.get(r.d[0].elem) ?? { text: r.d[0].text, elem: r.d[0].elem, total: 0 };
      c.total += v;
      totals.set(r.d[0].elem, c);
      if (this.d2) {
        const w = rowsTot.get(r.d[1].elem) ?? { text: r.d[1].text, elem: r.d[1].elem, total: 0 };
        w.total += v;
        rowsTot.set(r.d[1].elem, w);
      }
    }
    const cols = [...totals.values()].sort((a, b) => b.total - a.total).slice(0, 14);
    const rows = this.d2 ? [...rowsTot.values()].sort((a, b) => b.total - a.total).slice(0, 6).sort((a, b) => a.elem - b.elem) : [{ elem: -1 }];
    const ci = new Map(cols.map((c, i) => [c.elem, i]));
    const ri = new Map(rows.map((r, i) => [r.elem, i]));
    const n1 = Math.max(1, cols.length), n2 = rows.length;
    const colW = TABLE_W / n1, rowD = TABLE_D / n2;
    const max = Math.max(...L.rows.map((r) => r.m[0].num).filter(Number.isFinite), 1e-9);
    const entries = [];
    for (const r of L.rows) {
      const v = r.m[0].num;
      const i = ci.get(r.d[0].elem), j = this.d2 ? ri.get(r.d[1].elem) : 0;
      if (i === undefined || j === undefined || !Number.isFinite(v) || v <= 0) continue;
      entries.push({
        key: `${keyOf(this.d1)}|${r.d[0].elem}|${this.d2 ? r.d[1].elem : ''}`,
        pos: new THREE.Vector3(-TABLE_W / 2 + colW * (i + 0.5), 0, TABLE_D / 2 - rowD * (j + 0.5)),
        w: Math.min(colW * 0.62, 0.2), d: Math.min(rowD * 0.62, 0.2), h: (v / max) * BAR_MAX,
        color: this.d2 ? PALETTE[r.d[1].elem % PALETTE.length] : Q.blue,
        data: { elem1: r.d[0].elem, text1: r.d[0].text, text2: this.d2 ? r.d[1].text : '', value: r.m[0].text },
      });
    }
    this.bars.sync(entries);

    // étiquettes : colonnes devant la table (en quinconce si serrées), rangées à gauche avec leur couleur
    this.labels.clear();
    this.colLabels = cols.map((c, i) => {
      const s = label(c.text.length > 16 ? `${c.text.slice(0, 15)}…` : c.text, { size: 0.05 });
      const maxW = colW * (n1 > 6 ? 1.9 : 0.95);
      if (s.scale.x > maxW) s.scale.multiplyScalar(maxW / s.scale.x);
      s.position.set(-TABLE_W / 2 + colW * (i + 0.5), TABLE_Y + 0.05 - (n1 > 6 && i % 2 ? s.scale.y * 1.05 : 0), TABLE_D / 2 + 0.06);
      s.userData = { elem: c.elem, text: c.text };
      this.labels.add(s);
      return s;
    });
    this.rowLabels = this.d2 ? rows.map((r, j) => {
      const z = TABLE_D / 2 - rowD * (j + 0.5);
      const s = label(r.text, { size: 0.055 });
      s.position.set(-TABLE_W / 2 - 0.12 - s.scale.x / 2, TABLE_Y + 0.06, z);
      s.userData = { elem: r.elem, text: r.text };
      const chip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: PALETTE[r.elem % PALETTE.length] }));
      chip.position.set(-TABLE_W / 2 - 0.06, TABLE_Y + 0.03, z);
      this.labels.add(s, chip);
      return s;
    }) : [];

    // repères de valeur sur un fond translucide derrière la table
    this.grid.clear();
    const pts = [];
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const y = TABLE_Y + f * BAR_MAX;
      pts.push(new THREE.Vector3(-TABLE_W / 2, y, -TABLE_D / 2 - 0.1), new THREE.Vector3(TABLE_W / 2, y, -TABLE_D / 2 - 0.1));
      const s = label(compact(max * f), { size: 0.045, color: Q.inkMuted, weight: 400 });
      s.position.set(-TABLE_W / 2 - 0.05 - s.scale.x / 2, y, -TABLE_D / 2 - 0.1);
      this.grid.add(s);
    }
    this.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#c9ced4' })));
    this.tabs.draw();
  }
  update(dt) { this.bars.update(dt); }
}

// =============================================================================================================
// 2. Anneau du temps : chaque période est une tour posée en cercle autour de vous — le temps vous entoure
// =============================================================================================================
const RING_R = 6.6, RING_H = 3.2, RING_GAP = 0.5; // rad laissés libres derrière pour la légende

export class TimeRing {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.barsGroup = new THREE.Group();
    this.labels = new THREE.Group();
    this.group.add(this.barsGroup, this.labels);
    this.bars = new BarSet(this.barsGroup, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    this.header = new Header(1.5, 0.25);
    const a = Math.PI;
    this.header.mesh.position.set(Math.sin(a) * (RING_R - 0.2), 5.0, -Math.cos(a) * (RING_R - 0.2)); // au-dessus de l'en-tête du nuage
    this.header.mesh.scale.setScalar(2.4);
    this.header.mesh.lookAt(0, 1.6, 0);
    this.group.add(this.header.mesh);
    this.title = '';
    this.targets = [
      barTarget(this.bars, {
        select: (d) => this.model.select(0, d.elem),
        tooltip: (d) => ({ title: d.text, lines: d.lines, hint: 'Trigger: select this period' }),
      }),
      labelTarget(() => this.labels.children, (u) => this.model.select(0, u.elem)),
    ];
  }
  async bind(source) {
    const c = this.cfg;
    this.model = await source.cube({ dims: [c.dim], measures: [c.measure, c.color].filter(Boolean), max: 400 });
    return this.model;
  }
  apply(L) {
    // les périodes restent à leur place sur l'anneau (index = numéro d'élément) : une sélection n'y déplace rien
    const all = (this.slots ??= new Map());
    for (const r of L.rows) if (!all.has(r.d[0].elem)) all.set(r.d[0].elem, r.d[0].text);
    const order = [...all.keys()].sort((a, b) => a - b);
    const idx = new Map(order.map((e, i) => [e, i]));
    const n = Math.max(order.length, 12);
    const step = (Math.PI * 2 - RING_GAP) / n;
    const vals = L.rows.map((r) => r.m[0].num);
    const max = Math.max(...vals.filter(Number.isFinite), 1e-9);
    const hasColor = L.measures.length > 1;
    const [lo, hi] = hasColor ? range(L.rows.map((r) => r.m[1].num)) : [0, 1];
    const w = Math.min(0.6, step * RING_R * 0.72);
    const entries = [];
    for (const r of L.rows) {
      const v = r.m[0].num;
      if (!Number.isFinite(v) || v <= 0) continue;
      const a = Math.PI + RING_GAP / 2 + step * (idx.get(r.d[0].elem) + 0.5);
      entries.push({
        key: r.d[0].elem,
        pos: new THREE.Vector3(Math.sin(a) * RING_R, 0, -Math.cos(a) * RING_R),
        rotY: -a, w, d: 0.3, h: 0.04 + (v / max) * RING_H,
        color: hasColor ? seqColor((r.m[1].num - lo) / (hi - lo)) : Q.blue,
        data: { elem: r.d[0].elem, text: r.d[0].text, lines: L.measures.map((m, k) => [m, r.m[k].text]) },
      });
    }
    this.bars.sync(entries);
    if (this.labelCount !== order.length) {
      this.labelCount = order.length;
      this.labels.clear();
      for (const e of order) {
        const a = Math.PI + RING_GAP / 2 + step * (idx.get(e) + 0.5);
        const s = label(all.get(e), { size: 0.12, color: Q.inkSoft });
        s.position.set(Math.sin(a) * (RING_R - 0.45), 0.14, -Math.cos(a) * (RING_R - 0.45));
        s.userData = { elem: e, text: all.get(e) };
        this.labels.add(s);
      }
    }
    this.header.set(`${L.measures[0]} by ${L.dims[0]}`, `Time surrounds you: ${order.length} periods in a circle${hasColor ? ` · colour: ${L.measures[1]}` : ''}`,
      hasColor ? { label: L.measures[1], min: textNear(L.rows, 1, lo), max: textNear(L.rows, 1, hi) } : null);
  }
  update(dt) { this.bars.update(dt); }
}

// =============================================================================================================
// 3. Globe : les lieux en tours sur une Terre que l'on fait tourner à la main
// =============================================================================================================
const GLOBE_R = 0.55;

async function landTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f8fa';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e1e5ea';
  g.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = ((90 - lat) / 180) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  try {
    const topo = await fetch(landUrl).then((r) => r.json());
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
    g.fillStyle = '#d3d9e0';
    for (const geom of topo.objects.land.geometries) {
      const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
      for (const poly of polys) {
        g.beginPath();
        for (const ring of poly) {
          let first = true;
          for (const ai of ring) {
            const pts = ai >= 0 ? arcs[ai] : [...arcs[~ai]].reverse();
            for (let k = first ? 0 : 1; k < pts.length; k++) {
              const x = ((pts[k][0] + 180) / 360) * W, y = ((90 - pts[k][1]) / 180) * H;
              first && k === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
            }
            first = false;
          }
          g.closePath();
        }
        g.fill('evenodd');
      }
    }
  } catch (e) {
    console.warn('fond de carte indisponible', e);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// direction locale d'un point (même convention que l'UV de SphereGeometry : lon 0 → +X, lon 90°E → −Z)
const geoDir = (lat, lon) => {
  const p = THREE.MathUtils.degToRad(lat), l = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
};

export class Globe {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.spin = new THREE.Group();
    this.group.add(this.spin);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    landTexture().then((t) => { mat.map = t; mat.needsUpdate = true; });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R, 96, 64), mat);
    this.spin.add(this.sphere);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 0.75, 32), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }));
    stand.position.y = -GLOBE_R - 0.75 / 2 - 0.05;
    this.group.add(stand);
    this.bars = new BarSet(this.spin, new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0));
    this.header = new Header(1.3, 0.25);
    this.header.mesh.position.set(0, GLOBE_R + 0.36, 0);
    this.group.add(this.header.mesh);
    this.idle = 0;
    this.grabbed = null;
    const spinBy = (x, dt) => { this.spin.rotation.y += x * dt * 1.6; this.idle = 0; };
    const target = barTarget(this.bars, {
      select: (d) => this.model.select(0, d.elem),
      tooltip: (d) => ({ title: d.text, lines: d.lines, hint: 'Trigger: select · Grip: rotate' }),
      stick: (x, _y, dt) => spinBy(x, dt),
    });
    const ball = {
      intersect: (r) => { const h = r.intersectObject(this.sphere, false)[0]; return h ? { distance: h.distance + 0.01, point: h.point } : null; },
      hover() {}, leave() {}, select() {},
      tooltip: () => ({ title: 'Globe', lines: [], hint: 'Grip or stick: rotate' }),
      stick: (x, _y, dt) => spinBy(x, dt),
    };
    target.grab = ball.grab = (ctrl) => { this.grabbed = ctrl; this.grabAngle = null; };
    this.targets = [target, ball];
  }
  faceToward(worldPoint) {
    // l'Europe (≈ 10°E, 45°N) tournée vers le point donné
    this.group.updateWorldMatrix(true, false);
    const t = this.group.worldToLocal(worldPoint.clone());
    const d = geoDir(0, 10);
    this.spin.rotation.y = Math.atan2(t.x, t.z) - Math.atan2(d.x, d.z);
    this.spin.rotation.x = 0;
  }
  async bind(source) {
    const c = this.cfg;
    this.model = await source.cube({ dims: [c.dim], measures: [c.lat, c.lon, c.measure, c.color].filter(Boolean), max: 2000 });
    return this.model;
  }
  apply(L) {
    const rows = L.rows.filter((r) => Number.isFinite(r.m[0].num) && Number.isFinite(r.m[1].num) && Number.isFinite(r.m[2].num) && r.m[2].num > 0);
    const max = Math.max(...rows.map((r) => r.m[2].num), 1e-9);
    const hasColor = L.measures.length > 3;
    const [lo, hi] = hasColor ? range(rows.map((r) => r.m[3].num)) : [0, 1];
    const up = new THREE.Vector3(0, 1, 0);
    this.bars.sync(rows.map((r) => {
      const dir = geoDir(r.m[0].num, r.m[1].num);
      return {
        key: r.d[0].elem,
        pos: dir.clone().multiplyScalar(GLOBE_R * 0.995),
        quat: new THREE.Quaternion().setFromUnitVectors(up, dir),
        w: 0.013, d: 0.013, h: 0.012 + Math.sqrt(r.m[2].num / max) * 0.24,
        color: hasColor ? seqColor((r.m[3].num - lo) / (hi - lo)) : Q.blue,
        data: { elem: r.d[0].elem, text: r.d[0].text, lines: L.measures.slice(2).map((m, k) => [m, r.m[k + 2].text]) },
      };
    }));
    this.header.set(`${L.measures[2]} by ${L.dims[0]}`, `${rows.length} places · height ∝ √value${hasColor ? ` · colour: ${L.measures[3]}` : ''}`,
      hasColor ? { label: L.measures[3], min: textNear(rows, 3, lo), max: textNear(rows, 3, hi) } : null);
  }
  update(dt) {
    this.bars.update(dt);
    if (this.grabbed) {
      // on « attrape » la Terre : elle suit l'angle de la manette autour de son axe
      const c = new THREE.Vector3(), p = new THREE.Vector3();
      this.group.getWorldPosition(c);
      this.grabbed.getWorldPosition(p);
      const a = Math.atan2(p.x - c.x, p.z - c.z);
      if (this.grabAngle !== null) {
        let d = a - this.grabAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        this.spin.rotation.y += d * 2.5;
      }
      this.grabAngle = a;
      this.idle = 0;
    } else {
      this.idle += dt;
      if (this.idle > 6) this.spin.rotation.y += dt * 0.05;
    }
  }
  release() { this.grabbed = null; }
}

// =============================================================================================================
// 4. Nuage de points 3D : trois mesures, une par axe ; on marche dedans
// =============================================================================================================
const CLOUD = 2.6, PT = 0.032;

export class Cloud {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.spin = new THREE.Group();
    this.group.add(this.spin);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CLOUD, CLOUD, CLOUD)), new THREE.LineBasicMaterial({ color: '#c3c9d0' }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD, CLOUD), new THREE.MeshBasicMaterial({ color: '#e9edf1', transparent: true, opacity: 0.6, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -CLOUD / 2 + 0.001;
    this.spin.add(box, floor);
    this.MAX = 2500;
    this.points = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ roughness: 0.4 }), this.MAX);
    this.points.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.points.count = 0;
    this.points.frustumCulled = false;
    this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9aa3ad', transparent: true, opacity: 0.35, depthWrite: false }), this.MAX);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.dropGeo = new THREE.BufferGeometry();
    this.dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.drops = new THREE.LineSegments(this.dropGeo, new THREE.LineBasicMaterial({ color: '#b4bcc6', transparent: true, opacity: 0.55 }));
    this.drops.frustumCulled = false;
    this.axes = new THREE.Group();
    this.spin.add(this.points, this.shadows, this.drops, this.axes);
    this.items = new Map();
    this.list = [];
    this.hovered = null;
    this.header = new Header(1.6, 0.3);
    this.header.mesh.position.set(0, CLOUD / 2 + 0.3, 0);
    this.group.add(this.header.mesh);
    this.grabbed = null;
    const inv = new THREE.Matrix4(), ray = new THREE.Ray(), tmp = new THREE.Vector3();
    this.targets = [{
      intersect: (r) => {
        inv.copy(this.spin.matrixWorld).invert();
        ray.copy(r.ray).applyMatrix4(inv);
        let best = null, bestT = Infinity;
        for (const it of this.list) {
          if (it.dying) continue;
          if (ray.distanceSqToPoint(it.pos) > (PT * 2.2) ** 2) continue; // cible plus large que le point
          const t = tmp.copy(it.pos).sub(ray.origin).dot(ray.direction);
          if (t > 0 && t < bestT) { bestT = t; best = it; }
        }
        if (!best) return null;
        const point = best.pos.clone().applyMatrix4(this.spin.matrixWorld);
        return { distance: point.distanceTo(r.ray.origin), point, item: best };
      },
      hover: (hit) => { this.hovered = hit?.item ?? null; },
      leave: () => { this.hovered = null; },
      select: (hit) => { hit.item.flash = 1; this.model.select(0, hit.item.elem); },
      tooltip: (hit) => ({ title: hit.item.text, lines: hit.item.lines, hint: 'Trigger: select · Grip: rotate' }),
      stick: (x, _y, dt) => { this.spin.rotation.y += x * dt * 1.2; },
      grab: (ctrl) => { this.grabbed = ctrl; this.grabAngle = null; },
    }];
  }
  async bind(source) {
    const c = this.cfg;
    this.model = await source.cube({ dims: [c.dim], measures: [c.x, c.y, c.z], max: this.MAX });
    return this.model;
  }
  apply(L) {
    const rows = L.rows.filter((r) => r.m.every((m) => Number.isFinite(m.num)));
    const rx = range(rows.map((r) => r.m[0].num)), ry = range(rows.map((r) => r.m[1].num)), rz = range(rows.map((r) => r.m[2].num));
    const norm = ([lo, hi], v) => ((v - lo) / (hi - lo) - 0.5) * CLOUD * 0.92;
    const seen = new Set();
    for (const r of rows) {
      const e = r.d[0].elem;
      seen.add(e);
      let it = this.items.get(e);
      const tpos = new THREE.Vector3(norm(rx, r.m[0].num), norm(ry, r.m[1].num), -norm(rz, r.m[2].num));
      if (!it) {
        it = { elem: e, pos: tpos.clone(), s: 0, color: new THREE.Color(), flash: 0 };
        this.items.set(e, it);
      }
      Object.assign(it, {
        dying: false, tpos, ts: 1, text: r.d[0].text,
        tcolor: seqColor(0.3 + 0.7 * ((r.m[2].num - rz[0]) / (rz[1] - rz[0]))), // la profondeur est redoublée par la couleur
        lines: L.measures.map((m, k) => [`${['X', 'Y', 'Z'][k]} · ${m}`, r.m[k].text]),
      });
    }
    for (const it of this.items.values()) if (!seen.has(it.elem)) { it.dying = true; it.ts = 0; }
    this.list = [...this.items.values()];

    // axes : nom de la mesure + bornes, le long de trois arêtes de la boîte
    this.axes.clear();
    const h = CLOUD / 2;
    const put = (s, x, y, z) => { s.position.set(x, y, z); this.axes.add(s); };
    const fmt = (mi, n) => textNear(rows, mi, n);
    put(label(`X → ${L.measures[0]}`, { size: 0.07 }), 0, -h - 0.1, h + 0.05);
    put(label(fmt(0, rx[0]), { size: 0.05, color: Q.inkMuted, weight: 400 }), -h * 0.92, -h - 0.08, h + 0.05);
    put(label(fmt(0, rx[1]), { size: 0.05, color: Q.inkMuted, weight: 400 }), h * 0.92, -h - 0.08, h + 0.05);
    put(label(`Y ↑ ${L.measures[1]}`, { size: 0.07 }), -h - 0.05, h + 0.08, h);
    put(label(fmt(1, ry[0]), { size: 0.05, color: Q.inkMuted, weight: 400 }), -h - 0.12, -h * 0.92, h);
    put(label(fmt(1, ry[1]), { size: 0.05, color: Q.inkMuted, weight: 400 }), -h - 0.12, h * 0.92, h);
    put(label(`Z ↗ ${L.measures[2]}`, { size: 0.07 }), -h - 0.1, -h - 0.1, 0);
    put(label(fmt(2, rz[0]), { size: 0.05, color: Q.inkMuted, weight: 400 }), -h - 0.1, -h - 0.04, h * 0.92);
    put(label(fmt(2, rz[1]), { size: 0.05, color: Q.inkMuted, weight: 400 }), -h - 0.1, -h - 0.04, -h * 0.92);
    this.header.set(`${L.dims[0]}: ${rows.length} points in space`, 'Come closer, step into the cloud · colour = Z axis');
  }
  update(dt) {
    const a = ease(dt, 5);
    const { m, q, s, p, c } = (this.tmp ??= { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color() });
    const pos = this.dropGeo.attributes.position.array;
    let n = 0;
    for (const it of this.list) {
      it.pos.lerp(it.tpos, a);
      it.s += (it.ts - it.s) * a;
      it.color.lerp(it.tcolor, a);
      it.flash = Math.max(0, it.flash - dt * 2);
      if (it.dying && it.s < 0.01) { this.items.delete(it.elem); continue; }
      if (n >= this.MAX) continue;
      const hov = it === this.hovered;
      const r = PT * it.s * (hov ? 1.6 : 1);
      this.points.setMatrixAt(n, m.compose(it.pos, q, s.setScalar(r)));
      this.points.setColorAt(n, c.copy(it.color).lerp(GREEN, it.flash).offsetHSL(0, 0, hov ? 0.12 : 0));
      this.shadows.setMatrixAt(n, m.compose(p.set(it.pos.x, -CLOUD / 2 + 0.002, it.pos.z), q, s.set(r * 0.9, 1, r * 0.9)));
      pos.set([it.pos.x, it.pos.y, it.pos.z, it.pos.x, -CLOUD / 2, it.pos.z], n * 6);
      n++;
    }
    if (this.items.size !== this.list.length) this.list = [...this.items.values()];
    this.points.count = this.shadows.count = n;
    this.points.instanceMatrix.needsUpdate = true;
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.dropGeo.setDrawRange(0, n * 2);
    this.dropGeo.attributes.position.needsUpdate = true;
    if (this.grabbed) {
      const c = new THREE.Vector3(), p = new THREE.Vector3();
      this.group.getWorldPosition(c);
      this.grabbed.getWorldPosition(p);
      const ang = Math.atan2(p.x - c.x, p.z - c.z);
      if (this.grabAngle !== null) {
        let d = ang - this.grabAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        this.spin.rotation.y += d * 2;
      }
      this.grabAngle = ang;
    }
  }
  release() { this.grabbed = null; }
}
