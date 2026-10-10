import * as THREE from 'three';
import { FONT, Q } from './theme.js';

// Panneau plat dessiné sur un canvas : on dessine en millimètres (1 unité = 1 mm du panneau dans la pièce),
// on déclare des zones cliquables, et le rayon de la manette retrouve la zone visée via les coordonnées UV.
export class Panel {
  constructor(width, height, { ppm = 900 } = {}) {
    this.w = width * 1000;
    this.h = height * 1000;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * ppm);
    this.canvas.height = Math.round(height * ppm);
    this.k = ppm / 1000;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false }),
    );
    this.regions = [];
    this.hoverId = null;
  }
  draw() {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.k, 0, 0, this.k, 0, 0);
    this.regions = [];
    this.paint(g);
    this.texture.needsUpdate = true;
  }
  paint() {}
  region(id, x, y, w, h, data = {}) {
    this.regions.push({ id, x, y, w, h, ...data });
  }
  regionAt(uv) {
    const x = uv.x * this.w, y = (1 - uv.y) * this.h;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  // --- interface « cible » utilisée par interact.js -------------------------------------------------------
  intersect(raycaster) {
    if (!this.mesh.visible) return null;
    const h = raycaster.intersectObject(this.mesh, false)[0];
    return h ? { distance: h.distance, point: h.point, region: this.regionAt(h.uv) } : null;
  }
  hover(hit) {
    const id = hit?.region?.id ?? null;
    if (id !== this.hoverId) { this.hoverId = id; this.draw(); }
  }
  leave() { this.hover(null); }
}

// --- petites aides de dessin ---------------------------------------------------------------------------------
export function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
export function card(g, x, y, w, h, { r = 14, fill = Q.card, stroke = Q.line } = {}) {
  rrect(g, x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
}
export function text(g, str, x, y, { size = 26, weight = 400, color = Q.ink, align = 'left', base = 'middle', max = 0 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  str = String(str ?? '');
  if (max && g.measureText(str).width > max) {
    while (str.length > 1 && g.measureText(`${str}…`).width > max) str = str.slice(0, -1);
    str += '…';
  }
  g.fillText(str, x, y);
  return g.measureText(str).width;
}

// Étiquette 3D toujours tournée vers l'œil (sprite) ; mise en cache par texte + style
const cache = new Map();
export function label(str, { size = 0.06, color = Q.ink, weight = 600, bg = null, pad = 14 } = {}) {
  const key = `${str}|${size}|${color}|${weight}|${bg}`;
  let mat = cache.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const px = 72;
    g.font = `${weight} ${px}px ${FONT}`;
    c.width = Math.ceil(g.measureText(str).width) + pad * 2;
    c.height = px + pad * 2;
    if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 22); g.fill(); }
    g.font = `${weight} ${px}px ${FONT}`;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(str, pad, c.height / 2 + 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = new THREE.SpriteMaterial({ map: tex, toneMapped: false, transparent: true });
    mat.userData.aspect = c.width / c.height;
    cache.set(key, mat);
  }
  const s = new THREE.Sprite(mat);
  s.scale.set(size * mat.userData.aspect, size, 1);
  return s;
}
