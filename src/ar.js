import * as THREE from 'three';
import { Q } from './theme.js';

// Augmented reality (Quest 3 passthrough, Android Chrome). Two modes:
//   'table' — the whole room as a miniature (≈ 1:12) that you place on a real table or on the floor, then move,
//             rotate and scale; selections work on the miniature as in VR
//   'room'  — the room at full size around you, in your real surroundings
// The room content lives in `world`: AR only moves and scales that group, the visualisations don't know about it.

const TABLE_SCALE = 1 / 12;

export class ARMode {
  constructor({ renderer, scene, world, overlay }) {
    this.renderer = renderer;
    this.world = world;
    this.overlay = overlay;
    this.active = false;
    this.placed = true;
    this.mode = null;
    this.hitSource = null;
    // reticle: a Qlik-green ring lying on the detected surface
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: Q.green, toneMapped: false }));
    this.reticle.visible = false;
    scene.add(this.reticle);
    this.tmp = { v: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Matrix4() };
    // screen buttons (DOM overlay on phones)
    overlay?.addEventListener('beforexrselect', (e) => e.preventDefault()); // a tap on a button must not select in the room
    overlay?.querySelectorAll('[data-ar]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.ar;
      if (a === 'move') this.place(false);
      if (a === 'smaller') this.scaleBy(1 / 1.25);
      if (a === 'bigger') this.scaleBy(1.25);
      if (a === 'left') this.world.rotation.y += Math.PI / 8;
      if (a === 'right') this.world.rotation.y -= Math.PI / 8;
      if (a === 'exit') this.renderer.xr.getSession()?.end();
    }));
  }

  async start(session, mode) {
    this.active = true;
    this.mode = mode;
    this.world.rotation.set(0, 0, 0);
    if (mode === 'room') {
      this.world.position.set(0, 0, 0);
      this.world.scale.setScalar(1);
      this.placed = true;
    } else {
      this.world.scale.setScalar(TABLE_SCALE);
      this.placed = false;
      if (session.enabledFeatures?.includes('hit-test') ?? true) {
        try {
          const viewer = await session.requestReferenceSpace('viewer');
          this.hitSource = await session.requestHitTestSource({ space: viewer });
        } catch { this.hitSource = null; }
      }
    }
    this.overlay?.classList.toggle('placing', !this.placed);
    session.addEventListener('end', () => this.stop());
  }

  stop() {
    this.active = false;
    this.hitSource?.cancel?.();
    this.hitSource = null;
    this.reticle.visible = false;
    this.world.position.set(0, 0, 0);
    this.world.rotation.set(0, 0, 0);
    this.world.scale.setScalar(1);
    this.placed = true;
  }

  // placed = false: the miniature follows the surface you look at until the next tap / trigger
  place(done = true) {
    this.placed = done;
    this.reticle.visible = !done;
    this.overlay?.classList.toggle('placing', !done);
  }
  scaleBy(k) {
    const s = THREE.MathUtils.clamp(this.world.scale.x * k, 1 / 40, 1);
    this.world.scale.setScalar(s);
  }
  // Quest controllers: left stick turns (x) and scales (y) the miniature
  stick(x, y, dt) {
    if (this.mode !== 'table') return;
    this.world.rotation.y -= x * dt * 1.5;
    this.scaleBy(Math.exp(-y * dt * 1.2));
  }

  update(frame, xrCam) {
    if (!this.active || this.placed) return;
    const { v, d } = this.tmp;
    let found = false;
    const ref = this.renderer.xr.getReferenceSpace();
    if (this.hitSource && frame) {
      const hit = frame.getHitTestResults(this.hitSource)[0];
      const pose = hit?.getPose(ref);
      if (pose) {
        const p = pose.transform.position;
        v.set(p.x, p.y, p.z);
        found = true;
      }
    }
    if (!found) {
      // no surface detected (or no hit-test): hover 1 m in front of you, half a metre below your eyes
      xrCam.getWorldPosition(v);
      xrCam.getWorldDirection(d);
      d.y = 0;
      d.normalize();
      v.addScaledVector(d, 1).y -= 0.5;
    }
    this.reticle.position.copy(v);
    this.reticle.visible = true;
    this.world.position.copy(v);
    // the +Z side faces you: you look across the room towards the KPIs and the bar city, whose panels face +Z
    xrCam.getWorldPosition(d);
    this.world.rotation.y = Math.atan2(d.x - v.x, d.z - v.z);
  }
}
