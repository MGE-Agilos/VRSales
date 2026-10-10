import { Panel, card, text, rrect } from './panel.js';
import { Q, stateStyle, compact } from './theme.js';

// --- Volet de filtre (listbox) : vert = sélectionné, blanc = possible, gris clair = alternatif, gris = exclu ----
export class ListBox extends Panel {
  constructor(model) {
    super(0.5, 1.15);
    this.model = model;
    this.data = { title: '…', rows: [], total: 0, selected: 0 };
    this.scrollY = 0;
    this.rowH = 56;
    this.head = 118;
    this.draw();
  }
  get visible() { return (this.h - this.head - 18) / this.rowH; }
  apply(d) {
    this.data = d;
    this.scrollY = Math.min(this.scrollY, Math.max(0, d.rows.length - this.visible));
    this.draw();
  }
  paint(g) {
    const { w, h, rowH, head } = this;
    const d = this.data;
    card(g, 3, 3, w - 6, h - 6, { r: 18, stroke: d.selected ? Q.green : Q.line });
    text(g, d.title, 26, 50, { size: 36, weight: 600, max: w - 120 });
    text(g, d.selected ? `${d.selected} sur ${d.total} sélectionné${d.selected > 1 ? 's' : ''}` : `${d.total} valeurs`, 26, 92, { size: 23, color: d.selected ? Q.greenDark : Q.inkMuted });
    if (d.selected) {
      const x = w - 84, y = 24, s = 58;
      rrect(g, x, y, s, s, 12);
      g.fillStyle = this.hoverId === 'clear' ? '#e8e9eb' : '#f3f4f5';
      g.fill();
      g.strokeStyle = Q.ink;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + 19, y + 19); g.lineTo(x + s - 19, y + s - 19);
      g.moveTo(x + s - 19, y + 19); g.lineTo(x + 19, y + s - 19);
      g.stroke();
      this.region('clear', x - 6, y - 6, s + 12, s + 12);
    }
    g.save();
    g.beginPath();
    g.rect(14, head, w - 28, h - head - 16);
    g.clip();
    const first = Math.floor(this.scrollY);
    for (let i = first; i < Math.min(d.rows.length, first + Math.ceil(this.visible) + 1); i++) {
      const r = d.rows[i];
      const y = head + (i - this.scrollY) * rowH;
      const st = stateStyle(r.state);
      g.fillStyle = st.bg;
      g.fillRect(14, y, w - 50, rowH - 2);
      if (this.hoverId === `row${i}`) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(14, y, w - 50, rowH - 2); }
      g.fillStyle = Q.line;
      g.fillRect(14, y + rowH - 2, w - 50, 2);
      text(g, r.text || '–', 32, y + rowH / 2, { size: 27, color: st.fg, max: w - 130 });
      if (r.state === 'S' || r.state === 'L') {
        g.strokeStyle = '#fff';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(w - 78, y + rowH / 2); g.lineTo(w - 69, y + rowH / 2 + 9); g.lineTo(w - 54, y + rowH / 2 - 10);
        g.stroke();
      }
      this.region(`row${i}`, 14, Math.max(y, head), w - 50, rowH - 2, { elem: r.elem, text: r.text, state: r.state });
    }
    g.restore();
    if (d.rows.length > this.visible) {
      const track = h - head - 24;
      const th = Math.max(50, (track * this.visible) / d.rows.length);
      const ty = head + ((track - th) * this.scrollY) / (d.rows.length - this.visible);
      rrect(g, w - 30, ty, 10, th, 5);
      g.fillStyle = '#c4c8cd';
      g.fill();
    }
  }
  select(hit) {
    const r = hit.region;
    if (!r) return;
    if (r.id === 'clear') return this.model.clear();
    if (r.elem !== undefined) return this.model.select(r.elem);
  }
  stick(_x, y, dt) { this.scroll(-y * dt * 14); }
  scroll(dy) {
    const s = Math.min(Math.max(0, this.scrollY + dy), Math.max(0, this.data.rows.length - this.visible));
    if (s !== this.scrollY) { this.scrollY = s; this.draw(); }
  }
  tooltip(hit) {
    const r = hit.region;
    if (!r || r.elem === undefined) return null;
    const label = { S: 'sélectionné', L: 'verrouillé', O: 'possible', A: 'alternatif', X: 'exclu', XS: 'exclu', XL: 'exclu' }[r.state] ?? '';
    return { title: r.text, lines: [[this.data.title, label]], hint: 'Gâchette : sélectionner · Joystick : défiler' };
  }
}

// --- Barre de sélections (retour, avancer, tout effacer + une puce par champ filtré) ------------------------------
export class SelectionBar extends Panel {
  constructor(source) {
    super(3.0, 0.24);
    this.source = source;
    this.data = { back: false, forward: false, items: [] };
    this.status = '';
    this.draw();
  }
  apply(d) { this.data = d; this.draw(); }
  paint(g) {
    const { w, h } = this;
    const d = this.data;
    card(g, 3, 3, w - 6, h - 6, { r: 20 });
    const tools = [
      ['back', 'Retour', d.back, (x, y) => { g.moveTo(x + 14, y - 14); g.lineTo(x - 2, y); g.lineTo(x + 14, y + 14); g.moveTo(x - 2, y); g.lineTo(x + 30, y); }],
      ['forward', 'Avancer', d.forward, (x, y) => { g.moveTo(x + 14, y - 14); g.lineTo(x + 30, y); g.lineTo(x + 14, y + 14); g.moveTo(x - 2, y); g.lineTo(x + 30, y); }],
      ['clearAll', 'Tout effacer', d.items.length > 0, (x, y) => { g.moveTo(x, y - 14); g.lineTo(x + 28, y + 14); g.moveTo(x + 28, y - 14); g.lineTo(x, y + 14); }],
    ];
    tools.forEach(([id, name, enabled, icon], i) => {
      const x = 16 + i * 150, y = 16, bw = 140, bh = h - 32;
      if (enabled && this.hoverId === id) { rrect(g, x, y, bw, bh, 12); g.fillStyle = '#eef0f2'; g.fill(); }
      g.strokeStyle = enabled ? Q.ink : '#c9cdd2';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      icon(x + bw / 2 - 14, y + 58);
      g.stroke();
      text(g, name, x + bw / 2, y + 136, { size: 26, color: enabled ? Q.inkSoft : '#c0c4c9', align: 'center' });
      if (enabled) this.region(id, x, y, bw, bh, { tool: id });
    });
    g.fillStyle = Q.line;
    g.fillRect(476, 26, 2, h - 52);
    const x0 = 500, cw = 460, gap = 14, room = Math.floor((w - x0 - 20 + gap) / (cw + gap));
    if (!d.items.length) {
      text(g, 'Aucune sélection — visez une valeur, une barre, une tour ou un point et appuyez sur la gâchette', x0 + 10, h / 2 - 16, { size: 28, color: Q.inkSoft, max: w - x0 - 40 });
      text(g, this.status, x0 + 10, h / 2 + 26, { size: 22, color: Q.inkMuted, max: w - x0 - 40 });
    }
    d.items.slice(0, room).forEach((it, i) => {
      const x = x0 + i * (cw + gap), y = 18, ch = h - 36;
      const more = i === room - 1 && d.items.length > room ? d.items.length - room + 1 : 0;
      card(g, x, y, cw, ch, { r: 10, fill: this.hoverId === `chip${i}` ? '#f5f6f7' : '#ffffff' });
      if (more) {
        text(g, `+ ${more} autres champs`, x + 24, y + ch / 2, { size: 28, color: Q.inkSoft });
        return;
      }
      text(g, it.field, x + 22, y + 40, { size: 27, color: Q.inkMuted, max: cw - 90 });
      text(g, it.text, x + 22, y + 94, { size: 38, weight: 600, max: cw - 90 });
      // jauge Qlik : part des valeurs sélectionnées
      g.fillStyle = '#e4e4e4';
      g.fillRect(x + 2, y + ch - 12, cw - 4, 10);
      g.fillStyle = Q.green;
      g.fillRect(x + 2, y + ch - 12, Math.max(10, ((cw - 4) * it.count) / Math.max(1, it.total)), 10);
      const bx = x + cw - 62, by = y + 22;
      g.strokeStyle = this.hoverId === `chip${i}` ? Q.ink : Q.inkMuted;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(bx + 14, by + 14); g.lineTo(bx + 36, by + 36); g.moveTo(bx + 36, by + 14); g.lineTo(bx + 14, by + 36);
      g.stroke();
      this.region(`chip${i}`, x, y, cw, ch, { field: it.field, text: it.text });
    });
  }
  select(hit) {
    const r = hit.region;
    if (!r) return;
    if (r.tool === 'back') return this.source.back();
    if (r.tool === 'forward') return this.source.forward();
    if (r.tool === 'clearAll') return this.source.clearAll();
    if (r.field) return this.source.clearField(r.field);
  }
  tooltip(hit) {
    const r = hit.region;
    if (r?.field) return { title: r.field, lines: [['Sélection', r.text]], hint: 'Gâchette : effacer ce champ' };
    if (r?.tool) return { title: { back: 'Retour (bouton B)', forward: 'Avancer (bouton A)', clearAll: 'Tout effacer (bouton Y)' }[r.tool], lines: [] };
    return null;
  }
}

// --- KPI : la valeur « roule » jusqu'au nouveau total après chaque sélection -----------------------------------
export class Kpi extends Panel {
  constructor() {
    super(0.66, 0.34);
    this.label = '…';
    this.cur = NaN;
    this.target = NaN;
    this.final = '';
    this.shown = '';
    this.draw();
  }
  apply(label, cell) {
    this.label = label;
    this.final = cell.text;
    this.target = cell.num;
    if (!Number.isFinite(this.cur)) this.cur = Number.isFinite(cell.num) ? cell.num * 0.6 : NaN;
    this.draw();
  }
  update(dt) {
    if (!Number.isFinite(this.target)) { if (this.shown !== this.final) this.draw(); return; }
    const near = Math.abs(this.target - this.cur) <= Math.abs(this.target) * 0.002 + 1e-9;
    if (!near) this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * 5));
    else this.cur = this.target;
    const s = near ? this.final : this.final.includes('%') ? `${(this.cur * 100).toFixed(1)}%` : compact(this.cur);
    if (s !== this.shown) this.draw();
  }
  paint(g) {
    card(g, 3, 3, this.w - 6, this.h - 6, { r: 18 });
    text(g, this.label, this.w / 2, 62, { size: 36, color: Q.inkSoft, align: 'center', max: this.w - 40 });
    const near = !Number.isFinite(this.target) || this.cur === this.target;
    this.shown = near ? this.final : this.final.includes('%') ? `${(this.cur * 100).toFixed(1)}%` : compact(this.cur);
    text(g, this.shown, this.w / 2, 205, { size: 112, weight: 600, align: 'center', max: this.w - 40 });
  }
}

// --- Info-bulle (sombre, comme dans Qlik Sense), qui garde la même taille apparente quelle que soit la distance ---
export class Tooltip extends Panel {
  constructor() {
    super(0.6, 0.27);
    this.mesh.material.depthTest = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.content = null;
  }
  show(content, point, eye) {
    if (!content) return this.hide();
    const key = JSON.stringify(content);
    if (key !== this.key) { this.key = key; this.content = content; this.draw(); }
    const dist = point.distanceTo(eye);
    const toEye = eye.clone().sub(point).normalize();
    this.mesh.position.copy(point).addScaledVector(toEye, Math.min(0.15, dist * 0.08));
    this.mesh.position.y += 0.06 * Math.max(0.6, dist / 2) + 0.07;
    this.mesh.scale.setScalar(Math.max(0.45, dist / 2.4));
    this.mesh.lookAt(eye);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
  paint(g) {
    const c = this.content;
    if (!c) return;
    const lines = (c.lines ?? []).slice(0, 3);
    const hh = 70 + lines.length * 46 + (c.hint ? 44 : 0) + 10;
    rrect(g, 0, 0, this.w, Math.min(this.h, hh), 18);
    g.fillStyle = 'rgba(52,54,58,0.95)';
    g.fill();
    text(g, c.title, 26, 42, { size: 32, weight: 600, color: '#fff', max: this.w - 52 });
    lines.forEach(([k, v], i) => {
      const y = 92 + i * 46;
      text(g, k, 26, y, { size: 25, color: '#c9ccd1', max: this.w * 0.55 });
      text(g, v, this.w - 26, y, { size: 27, weight: 600, color: '#fff', align: 'right', max: this.w * 0.4 });
    });
    if (c.hint) text(g, c.hint, 26, 92 + lines.length * 46 + 4, { size: 21, color: '#9fdcb8', max: this.w - 52 });
  }
}


// --- Notifications « untel a sélectionné… » : petit bandeau devant les yeux en VR (attaché à la caméra) ---------------
export class Toasts extends Panel {
  constructor() {
    super(0.7, 0.2);
    this.mesh.material.depthTest = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.items = [];
  }
  push(text, color) {
    this.items.unshift({ text, color, ttl: 4 });
    this.items.length = Math.min(this.items.length, 3);
    this.draw();
  }
  update(dt, show) {
    const n = this.items.length;
    for (const it of this.items) it.ttl -= dt;
    this.items = this.items.filter((it) => it.ttl > 0);
    if (this.items.length !== n) this.draw();
    this.mesh.visible = show && this.items.length > 0;
  }
  paint(g) {
    this.items.forEach((it, i) => {
      const y = 6 + i * 64;
      rrect(g, 0, y, this.w, 56, 14);
      g.fillStyle = 'rgba(30,32,40,0.88)';
      g.fill();
      g.fillStyle = it.color;
      g.fillRect(0, y + 10, 8, 36);
      text(g, it.text, 24, y + 29, { size: 28, weight: 600, color: '#fff', max: this.w - 40 });
    });
  }
}
