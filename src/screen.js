import * as THREE from 'three';

// Explorer la pièce sans casque (PC ou téléphone) :
//   points de vue en un clic, joystick tactile, ZQSD/WASD, gyroscope du téléphone, « suivre » quelqu'un.
// La caméra reste en vue subjective : OrbitControls tourne autour d'un point situé 10 cm devant l'œil.

export const VIEWS = {
  centre: { label: 'Centre', pos: [0, 1.6, 0], look: [0, 1.6, -3] },
  tableau: { label: 'Bar city', pos: [0, 1.85, 0.3], look: [0, 1.75, -3.2] },
  filtres: { label: 'Filters', pos: [0.2, 1.45, 0.1], look: [-2.3, 1.35, -0.9] },
  globe: { label: 'Globe', pos: [1.05, 1.55, -0.55], look: [2.17, 1.35, -1.25] },
  nuage: { label: 'Cloud', pos: [0, 1.6, 1.3], look: [0, 1.45, 3.4] },
  temps: { label: 'Overview', pos: [0, 6.5, 7.5], look: [0, 0.8, -1] },
};

const UP = new THREE.Vector3(0, 1, 0);

export class ScreenNav {
  constructor({ camera, controls, canvas }) {
    this.camera = camera;
    this.controls = controls;
    this.canvas = canvas;
    this.fly = null; // animation vers un point de vue
    this.lateral = 0; // décalage latéral (m) propre à chaque personne, pour ne pas arriver tous au même endroit
    this.followPose = null; // () → { pos, quat } de la personne suivie
    this.gyro = null;
    this.stick = { x: 0, y: 0 };
    this.keys = new Set();
    addEventListener('keydown', (e) => { if (!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  // champ de vision adapté au portrait (téléphone) : on garde ≈ 75° en horizontal
  resize(w, h) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    const hfov = THREE.MathUtils.degToRad(aspect < 1 ? 80 : 90);
    this.camera.fov = Math.min(100, Math.max(55, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect))));
    this.camera.updateProjectionMatrix();
  }

  goTo(name) {
    const v = VIEWS[name];
    if (!v) return;
    this.follow(null);
    const dir = new THREE.Vector3(...v.look).sub(new THREE.Vector3(...v.pos)).normalize();
    const to = new THREE.Vector3(...v.pos).addScaledVector(new THREE.Vector3().crossVectors(dir, UP).normalize(), this.lateral);
    this.fly = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: to, toTarget: to.clone().addScaledVector(dir, 0.1) };
  }

  follow(getPose) {
    this.followPose = getPose;
    this.controls.enabled = !getPose && !this.gyro;
    if (!getPose) this.syncTarget();
  }

  // remet la cible d'OrbitControls 10 cm devant l'œil, dans la direction du regard actuel
  syncTarget() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.controls.target.copy(this.camera.position).addScaledVector(d, 0.1);
    this.controls.update();
  }

  // joystick tactile (élément #joystick contenant .knob)
  bindJoystick(el) {
    const knob = el.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const R = 46;
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      el.setPointerCapture(id);
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    const move = (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R;
      this.stick.y = dy / R;
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.stick.x = this.stick.y = 0;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // gyroscope : le téléphone devient une fenêtre sur la pièce
  async toggleGyro() {
    if (this.gyro) {
      removeEventListener('deviceorientation', this.gyro.handler);
      this.gyro = null;
      this.controls.enabled = !this.followPose;
      this.syncTarget();
      return false;
    }
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('gyroscope access denied');
    }
    const euler = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const zee = new THREE.Vector3(0, 0, 1);
    const g = { q: null, offset: null };
    g.handler = (e) => {
      if (e.alpha == null) return;
      const d = THREE.MathUtils.degToRad;
      const orient = d(screen.orientation?.angle ?? window.orientation ?? 0);
      const q = new THREE.Quaternion().setFromEuler(euler.set(d(e.beta), d(e.alpha), -d(e.gamma), 'YXZ')).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
      if (g.offset === null) {
        // garde le cap actuel au moment où l'on active le gyroscope
        const yaw = (qq) => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(qq); return Math.atan2(f.x, f.z); };
        g.offset = new THREE.Quaternion().setFromAxisAngle(UP, yaw(this.camera.quaternion) - yaw(q));
      }
      g.q = g.offset.clone().multiply(q);
    };
    addEventListener('deviceorientation', g.handler);
    this.gyro = g;
    this.controls.enabled = false;
    return true;
  }

  update(dt) {
    const cam = this.camera;
    if (this.followPose) {
      const p = this.followPose();
      if (p) {
        const k = 1 - Math.exp(-dt * 8);
        cam.position.lerp(p.pos, k);
        cam.quaternion.slerp(p.quat, k);
      }
      return;
    }
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
      cam.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (f.t >= 1) this.fly = null;
    }
    // déplacement : clavier + joystick, à plat dans la direction du regard
    const k = this.keys;
    const fwdIn = (k.has('z') || k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - this.stick.y;
    const rightIn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('q') || k.has('a') || k.has('arrowleft') ? 1 : 0) + this.stick.x;
    const upIn = (k.has('e') || k.has('pageup') ? 1 : 0) - (k.has('c') || k.has('pagedown') ? 1 : 0);
    if (fwdIn || rightIn || upIn) {
      this.fly = null;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP);
      const move = fwd.multiplyScalar(fwdIn * 2.2 * dt).addScaledVector(right, rightIn * 2.2 * dt).addScaledVector(UP, upIn * 1.5 * dt);
      cam.position.add(move);
      this.controls.target.add(move);
    }
    if (this.gyro?.q) {
      cam.quaternion.copy(this.gyro.q);
      return;
    }
    if (this.controls.enabled) this.controls.update();
  }
}
