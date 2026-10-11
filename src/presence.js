import * as THREE from 'three';
import { label } from './panel.js';
import { PALETTE } from './theme.js';

// Les autres personnes dans la pièce (casque, PC, téléphone) : une tête avec son nom, et un rayon vers ce
// qu'elle vise. Chaque appareil publie sa pose ≈ 15 fois/s (POST /presence) et reçoit celle des autres (SSE).
// Les sélections ne passent pas par ici : elles sont partagées par la session du moteur Qlik.

const RATE = 1000 / 15;
const store = (() => { try { return localStorage; } catch { return null; } })();

export class Presence {
  constructor(scene) {
    this.scene = scene;
    this.id = (() => {
      try { return sessionStorage.getItem('vr-id') ?? (sessionStorage.setItem('vr-id', crypto.randomUUID()), sessionStorage.getItem('vr-id')); } catch { return crypto.randomUUID(); }
    })();
    this.name = store?.getItem('vr-name') || `Guest ${Math.floor(Math.random() * 90 + 10)}`;
    let h = 0;
    for (const c of this.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    this.color = PALETTE[h % PALETTE.length];
    this.avatars = new Map();
    this.people = [];
    this.onPeople = null; // (liste) → interface
    this.onEvent = null; // ({ name, text, … }) → notifications
    this.last = 0;
    this.pending = null;
    this.enabled = false; // pas de serveur de présence sur une page hébergée (GitHub Pages)
  }
  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();
    addEventListener('pagehide', () => navigator.sendBeacon('/presence/leave', JSON.stringify({ id: this.id })));
  }
  setName(n) {
    this.name = n.trim().slice(0, 24) || this.name;
    store?.setItem('vr-name', this.name);
    for (const a of this.avatars.values()) a.labelKey = null;
  }
  connect() {
    const es = new EventSource('/presence/stream');
    es.onmessage = (e) => {
      const { people, events } = JSON.parse(e.data);
      this.people = people;
      this.sync(people.filter((p) => p.id !== this.id));
      this.onPeople?.(people, this.id);
      for (const ev of events) this.onEvent?.(ev, ev.id === this.id);
    };
  }
  // annonce une action (sélection…) à tout le monde ; part avec la prochaine pose
  event(ev) { if (this.enabled) { this.pending = ev; this.last = 0; } }

  // pose = { device, head: Object3D (caméra), hand?: Vector3, aim?: Vector3 }, exprimée dans le repère de `space`
  publish(now, space, pose) {
    if (!this.enabled || now - this.last < RATE) return;
    this.last = now;
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    pose.head.getWorldPosition(p);
    pose.head.getWorldQuaternion(q);
    space.worldToLocal(p);
    q.premultiply(space.getWorldQuaternion(new THREE.Quaternion()).invert());
    const local = (v) => (v ? space.worldToLocal(v.clone()) : null);
    const r = (v) => Math.round(v * 1000) / 1000;
    const msg = {
      id: this.id, name: this.name, color: this.color, device: pose.device,
      head: [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map(r),
      hand: pose.hand ? local(pose.hand).toArray().map(r) : null,
      aim: pose.aim ? local(pose.aim).toArray().map(r) : null,
    };
    if (this.pending) { msg.event = this.pending; this.pending = null; }
    fetch('/presence', { method: 'POST', body: JSON.stringify(msg), keepalive: true }).catch(() => {});
  }

  // --- avatars ---------------------------------------------------------------------------------------------------
  makeAvatar(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), mat);
    head.scale.set(1, 1.08, 1);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), new THREE.MeshStandardMaterial({ color: '#1f2430', roughness: 0.2, metalness: 0.3 }));
    visor.position.set(0, 0.015, -0.11);
    g.add(head, visor);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    ray.frustumCulled = false;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.scene.add(g, ray, dot);
    return { g, ray, dot, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tpos: new THREE.Vector3(), tquat: new THREE.Quaternion(), hand: null, aim: null, fresh: true };
  }
  sync(others) {
    const seen = new Set();
    for (const o of others) {
      seen.add(o.id);
      let a = this.avatars.get(o.id);
      if (!a) { a = this.makeAvatar(o.color); this.avatars.set(o.id, a); }
      a.tpos.fromArray(o.head);
      a.tquat.fromArray(o.head, 3);
      if (a.fresh) { a.pos.copy(a.tpos); a.quat.copy(a.tquat); a.fresh = false; }
      a.hand = o.hand ? new THREE.Vector3().fromArray(o.hand) : null;
      a.aim = o.aim ? new THREE.Vector3().fromArray(o.aim) : null;
      const key = `${o.name}|${o.device}`;
      if (a.labelKey !== key) {
        a.labelKey = key;
        if (a.tag) a.g.remove(a.tag);
        a.tag = label(`${o.name} · ${o.device}`, { size: 0.07, color: '#ffffff', bg: o.color });
        a.tag.position.y = 0.27;
        a.g.add(a.tag);
      }
      a.data = o;
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(a.g, a.ray, a.dot);
      this.avatars.delete(id);
    }
  }
  update(dt, eye) {
    const k = 1 - Math.exp(-dt * 12);
    for (const a of this.avatars.values()) {
      a.pos.lerp(a.tpos, k);
      a.quat.slerp(a.tquat, k);
      a.g.position.copy(a.pos);
      // on ne voit pas la tête de la personne que l'on suit, ni celle de quelqu'un qui se tient « dans » notre tête
      a.g.visible = this.hidden !== a.data?.id && !(eye && a.pos.distanceTo(eye) < 0.8);
      a.g.quaternion.copy(a.quat);
      a.ray.visible = a.dot.visible = !!a.aim && a.g.visible;
      if (a.aim) {
        const from = a.hand ?? a.pos.clone().add(new THREE.Vector3(0, -0.15, 0));
        a.ray.geometry.attributes.position.setXYZ(0, from.x, from.y, from.z);
        a.ray.geometry.attributes.position.setXYZ(1, a.aim.x, a.aim.y, a.aim.z);
        a.ray.geometry.attributes.position.needsUpdate = true;
        a.dot.position.lerp(a.aim, 0.5);
      }
    }
  }
  // pose lissée de quelqu'un (pour « suivre » ce qu'il voit)
  poseOf(id) {
    const a = this.avatars.get(id);
    return a ? { pos: a.pos, quat: a.quat } : null;
  }
}
