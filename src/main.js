import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { connectQlik, listApps } from './qlik.js';
import { HOSTED, login, completeLogin, accessToken, websocketUrl, rest } from './qlik-oauth.js';
import { connectDemo } from './demo.js';
import { configFor } from './config.js';
import { ListBox, SelectionBar, Kpi, Tooltip, Toasts } from './ui.js';
import { Matrix, TimeRing, Globe, Cloud } from './viz.js';
import { label } from './panel.js';
import { Q, FONT } from './theme.js';
import { Presence } from './presence.js';
import { ScreenNav, VIEWS } from './screen.js';

// « Qlik en VR » : une pièce où l'on est dans ses données. Le moteur associatif de Qlik Cloud calcule tout ;
// chaque sélection (gâchette sur une valeur, une barre, une tour, un point) se propage instantanément à tous
// les visuels, en vert / blanc / gris comme dans Qlik Sense.
//   ?app=<id d'app Qlik>   (par défaut : QLIK_APP_ID de .env.local)      ?app=demo   données d'exemple hors ligne
//
// Deux façons de joindre Qlik Cloud :
//   - serveur local (npm run dev) : proxy /qlik avec la clé API de .env.local, session partagée, présence des autres
//   - page hébergée sans serveur (GitHub Pages) : chaque visiteur se connecte avec son compte Qlik (qlik-oauth.js),
//     a sa propre session et ses propres sélections ; pas de présence (?auth=oauth force ce mode en local)
//
// Disposition (vous êtes au centre, face à −Z) :
//   devant   sélections, KPI, « ville de barres » sur une table      à gauche   volets de filtres en arc
//   à droite globe des lieux                                        derrière   nuage de points 3D
//   tout autour, l'anneau du temps
//
// Plusieurs personnes peuvent être dans la pièce en même temps (casque, PC, téléphone) : chacune voit les autres
// (presence.js) et leurs sélections s'appliquent partout, puisque tous partagent la session du moteur Qlik.

const params = new URLSearchParams(location.search);
const ui = {
  vr: document.getElementById('enter-vr'),
  ar: document.getElementById('enter-ar'),
  status: document.getElementById('status'),
  app: document.getElementById('app'),
  panel: document.getElementById('panel'),
  name: document.getElementById('name'),
  people: document.getElementById('people'),
  views: document.getElementById('views'),
  joystick: document.getElementById('joystick'),
  gyro: document.getElementById('gyro'),
  toasts: document.getElementById('toasts'),
  login: document.getElementById('login'),
  room: document.getElementById('room'),
  home: document.getElementById('home-link'),
};
let hosted = false;
const coarse = matchMedia('(pointer: coarse)').matches;
const send = (t) => { if (import.meta.env.DEV) fetch('/__log', { method: 'POST', body: `[dataviz] ${t}` }).catch(() => {}); };
const setStatus = (t, error = false) => {
  ui.status.textContent = t;
  ui.status.classList.toggle('error', error);
  if (bar) { bar.status = t; bar.draw(); }
  if (error) send(`ERREUR ${t}`);
};
addEventListener('error', (e) => send(`ERREUR ${e.message}`));
addEventListener('unhandledrejection', (e) => send(`ERREUR ${e.reason?.message ?? e.reason}`));

// --- rendu & pièce ----------------------------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; // garde les teintes Qlik fidèles
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);

const scene = new THREE.Scene();
const background = new THREE.Color(Q.room);
scene.background = background;
scene.fog = new THREE.Fog(Q.room, 9, 22);
scene.add(new THREE.HemisphereLight('#ffffff', '#d5dbe2', 2.3));
const sun = new THREE.DirectionalLight('#ffffff', 1.3);
sun.position.set(2, 5, 3);
scene.add(sun);

const rig = new THREE.Group(); // l'utilisateur (tête + manettes) : on le déplace pour marcher dans les données
scene.add(rig);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 60);
camera.position.set(0, 1.6, 0);
rig.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.6, -0.1);
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = coarse ? -0.5 : -0.35; // glisser = regarder autour de soi
controls.update();
const nav = new ScreenNav({ camera, controls, canvas });
nav.resize(innerWidth, innerHeight);

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = Q.floor;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#e3e7eb';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.anisotropy = 8;
  return t;
}
const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 96), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const spot = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.36, 64), new THREE.MeshBasicMaterial({ color: Q.green, toneMapped: false }));
spot.rotation.x = -Math.PI / 2;
spot.position.y = 0.003;
scene.add(spot);

// --- source de données ---------------------------------------------------------------------------------------------
let source, cfg, bar;
const widgets = []; // tout ce qui s'anime
const targets = []; // tout ce que le rayon peut viser
const bindings = []; // { widget, model, apply }
const fontReady = Promise.race([document.fonts.load(`600 40px ${FONT}`), new Promise((r) => setTimeout(r, 2500))]);

async function chooseSource() {
  const status = await fetch('/qlik-status').then((r) => (r.ok ? r.json() : null)).catch(() => null) ?? { configured: false };
  hosted = !status.configured || params.get('auth') === 'oauth';
  const wanted = params.get('app') ?? (hosted ? HOSTED.appId : status.appId);
  ui.app.innerHTML = '';
  ui.app.add(new Option('Démo hors ligne (données d\'exemple)', 'demo'));
  if (hosted) return chooseHosted(wanted);
  presence.start();
  ui.room.hidden = false;
  if (status.configured) {
    listApps().then((apps) => {
      for (const a of apps) ui.app.add(new Option(a.name, a.id));
      ui.app.value = wanted;
    }).catch((e) => setStatus(e.message, true));
  }
  ui.app.value = wanted;
  ui.app.addEventListener('change', () => { location.search = `?app=${ui.app.value}`; });
  if (!wanted || wanted === 'demo') return connectDemo();
  setStatus(`Connexion au moteur Qlik (${status.tenant})…`);
  if (!status.configured) throw new Error('proxy Qlik non configuré : ajoutez QLIK_API_KEY dans .env.local (voir README)');
  return connectQlik(wanted);
}

// page hébergée : connexion Qlik du visiteur (redirection vers Qlik Cloud, puis retour ici)
async function chooseHosted(wanted) {
  ui.home.hidden = true;
  ui.app.value = wanted;
  ui.app.addEventListener('change', () => { location.search = `?app=${ui.app.value}`; });
  if (wanted === 'demo') return connectDemo();
  ui.login.addEventListener('click', () => login());
  await completeLogin();
  if (!accessToken()) {
    ui.login.hidden = false;
    ui.panel.classList.remove('collapsed');
    throw Object.assign(new Error(`Connectez-vous avec votre compte Qlik Cloud (${HOSTED.tenant}) pour charger les données — ou choisissez la démo.`), { quiet: true });
  }
  listApps(rest).then((apps) => {
    for (const a of apps) ui.app.add(new Option(a.name, a.id));
    ui.app.value = wanted;
  }).catch((e) => setStatus(e.message, true));
  setStatus(`Connexion au moteur Qlik (${HOSTED.tenant})…`);
  return connectQlik(wanted, await websocketUrl(wanted));
}

async function build() {
  await fontReady;
  source = await chooseSource();
  cfg = await configFor(source);
  source.onDisconnect = () => setStatus('Connexion au moteur Qlik perdue — rechargez la page.', true);
  setStatus(`${source.title} · création des objets…`);

  const title = label(`${source.title}  ·  ${source.kind === 'qlik' ? 'Qlik Cloud' : 'démo'}`, { size: 0.13, color: Q.ink });
  title.position.set(0, 3.26, -3.45);
  scene.add(title);

  // sélections + KPI, au-dessus de la table
  bar = new SelectionBar(source);
  bar.mesh.position.set(0, 2.82, -3.4);
  bar.mesh.scale.setScalar(1.25);
  bar.mesh.rotation.x = 0.14;
  scene.add(bar.mesh);
  targets.push(bar);
  bindings.push({ widget: bar, model: await source.selections(), apply: (l) => bar.apply(l) });

  if (cfg.kpis?.length) {
    const kpis = cfg.kpis.map(() => new Kpi());
    kpis.forEach((k, i) => {
      k.mesh.position.set((i - (kpis.length - 1) / 2) * 0.88, 2.26, -3.42);
      k.mesh.scale.setScalar(1.25);
      k.mesh.rotation.x = 0.1;
      scene.add(k.mesh);
      widgets.push(k);
    });
    const model = await source.cube({ measures: cfg.kpis });
    bindings.push({ model, apply: (l) => kpis.forEach((k, i) => k.apply(l.measures[i], l.rows[0]?.m[i] ?? { text: '–', num: NaN })) });
  }

  // volets de filtres en arc, à gauche
  const R = 2.3;
  for (const [i, dim] of (cfg.filters ?? []).entries()) {
    const model = await source.list(dim);
    const lb = new ListBox(model);
    const a = THREE.MathUtils.degToRad(-42 - i * 17);
    lb.mesh.position.set(Math.sin(a) * R, 1.32, -Math.cos(a) * R);
    lb.mesh.lookAt(0, 1.32, 0);
    lb.mesh.scale.setScalar(1.15);
    scene.add(lb.mesh);
    targets.push(lb);
    bindings.push({ model, apply: (l) => lb.apply(l) });
  }

  const add = async (widget, place) => {
    place(widget.group);
    scene.add(widget.group);
    widgets.push(widget);
    targets.push(...widget.targets);
    bindings.push({ widget, model: await widget.bind(source), apply: (l) => widget.apply(l) });
    return widget;
  };
  if (cfg.matrix) await add(new Matrix(cfg.matrix, refresh), (g) => g.position.set(0, 0, -2.45));
  if (cfg.ring) await add(new TimeRing(cfg.ring), () => {});
  if (cfg.globe) {
    const globe = await add(new Globe(cfg.globe), (g) => {
      const a = THREE.MathUtils.degToRad(60);
      g.position.set(Math.sin(a) * 2.5, 1.35, -Math.cos(a) * 2.5);
      g.lookAt(0, 1.35, 0);
    });
    globe.faceToward(new THREE.Vector3(0, 1.6, 0));
  }
  if (cfg.cloud) {
    await add(new Cloud(cfg.cloud), (g) => {
      g.position.set(0, 1.45, 3.4);
      g.lookAt(0, 1.45, 0);
    });
  }

  source.onChange(refresh);
  await refresh();
  setStatus(`${source.title} · ${source.kind === 'qlik' ? 'connecté au moteur Qlik Cloud' : 'données de démonstration'} — sélectionnez !`);
  send(`app ${source.title} prête`);
}

// Après chaque sélection, le moteur invalide les objets : on relit tous les layouts et chaque visuel s'anime
// vers ses nouvelles valeurs. Les sélections rapprochées sont regroupées.
let busy = false, dirty = false;
async function refresh() {
  if (busy) { dirty = true; return; }
  busy = true;
  try {
    do {
      dirty = false;
      for (const b of bindings) if (b.widget?.rebind) b.model = await b.widget.bind(source);
      const layouts = await Promise.all(bindings.map((b) => b.model.layout().catch((e) => { setStatus(e.message, true); return null; })));
      layouts.forEach((l, i) => l && bindings[i].apply(l));
    } while (dirty);
  } finally {
    busy = false;
  }
}

// --- pointeurs : deux manettes (ou mains) + la souris pour l'aperçu sur écran -------------------------------------
const raycaster = new THREE.Raycaster();
const tooltip = new Tooltip();
scene.add(tooltip.mesh);
const pointers = [];
const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
const modelFactory = new XRControllerModelFactory();

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: '#9aa3ad', transparent: true, opacity: 0.85 }));
  laser.scale.z = 3;
  ctrl.add(laser);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: Q.green, toneMapped: false }));
  dot.visible = false;
  scene.add(dot);
  rig.add(ctrl);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(modelFactory.createControllerModel(grip));
  rig.add(grip);
  const p = { id: i, ctrl, laser, dot, current: null, input: null, buttons: [], turnLatch: false };
  ctrl.addEventListener('connected', (e) => { p.input = e.data; laser.visible = e.data.targetRayMode === 'tracked-pointer'; });
  ctrl.addEventListener('disconnected', () => { p.input = null; });
  ctrl.addEventListener('selectstart', () => activate(p));
  ctrl.addEventListener('squeezestart', () => p.current?.t.grab?.(ctrl));
  ctrl.addEventListener('squeezeend', () => widgets.forEach((w) => w.grabbed === ctrl && w.release()));
  pointers.push(p);
}
const mouse = { id: 'mouse', ndc: new THREE.Vector2(9, 9), current: null };

function activate(p) {
  const cur = p.current;
  if (!cur?.t.select) return;
  const what = describe(cur.t, cur.hit);
  Promise.resolve(cur.t.select(cur.hit)).catch((e) => setStatus(e.message, true));
  p.input?.gamepad?.hapticActuators?.[0]?.pulse?.(0.5, 35);
  if (what) presence.event({ type: 'select', text: what });
}

// phrase courte décrivant une action, pour les notifications des autres participants
function describe(t, hit) {
  const r = hit.region;
  if (t === bar && r?.tool) return { back: 'Retour', forward: 'Avancer', clearAll: 'Tout effacer' }[r.tool];
  if (t === bar && r?.field) return `Effacer « ${r.field} »`;
  if (r?.choice) return `Colonnes : ${r.choice.label}`;
  const tip = t.tooltip?.(hit);
  if (!tip?.title) return null;
  return t.data?.title ? `${tip.title} (${t.data.title})` : tip.title;
}
const announce = (text) => presence.event({ type: 'select', text });

function pick() {
  let best = null;
  for (const t of targets) {
    const hit = t.intersect(raycaster);
    if (hit && (!best || hit.distance < best.hit.distance)) best = { t, hit };
  }
  return best;
}

let hovered = new Map();
function updatePointers(xrCam) {
  raycaster.camera = xrCam;
  const now = new Map();
  let tip = null;
  const m = new THREE.Matrix4();
  if (renderer.xr.isPresenting) {
    for (const p of pointers) {
      if (!p.input) { p.current = null; p.dot.visible = false; continue; }
      m.identity().extractRotation(p.ctrl.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
      p.current = pick();
      p.laser.scale.z = p.current ? p.current.hit.distance : 3;
      p.laser.material.color.set(p.current?.t.select ? Q.green : '#9aa3ad');
      p.dot.visible = !!p.current;
      if (p.current) {
        p.dot.position.copy(p.current.hit.point);
        now.set(p.current.t, p.current.hit);
        tip ??= p.current;
      }
    }
  } else {
    raycaster.setFromCamera(mouse.ndc, camera);
    mouse.current = pick();
    if (mouse.current) { now.set(mouse.current.t, mouse.current.hit); tip = mouse.current; }
    canvas.style.cursor = mouse.current?.t.select ? 'pointer' : '';
  }
  for (const [t] of hovered) if (!now.has(t)) t.leave();
  for (const [t, hit] of now) t.hover(hit);
  hovered = now;
  const eye = new THREE.Vector3();
  xrCam.getWorldPosition(eye);
  tip ? tooltip.show(tip.t.tooltip?.(tip.hit), tip.hit.point, eye) : tooltip.hide();
}

// --- manettes : joysticks, boutons ----------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
function updateGamepads(dt, xrCam) {
  for (const p of pointers) {
    const gp = p.input?.gamepad;
    if (!gp) continue;
    const x = gp.axes[2] ?? 0, y = gp.axes[3] ?? 0;
    const hand = p.input.handedness;
    const pressed = gp.buttons.map((b) => b.pressed);
    const edge = (i) => pressed[i] && !p.buttons[i];
    if (hand === 'right') {
      if (edge(4)) { source?.forward(); announce('Avancer'); }
      if (edge(5)) { source?.back(); announce('Retour'); }
    } else {
      if (edge(5)) { source?.clearAll(); announce('Tout effacer'); }
      if (edge(4)) rig.position.set(0, 0, 0), (rig.rotation.y = 0);
    }
    p.buttons = pressed;
    const active = Math.abs(x) > 0.15 || Math.abs(y) > 0.15;
    if (!active) { p.turnLatch = false; continue; }
    if (p.current?.t.stick) { p.current.t.stick(x, y, dt); continue; }
    if (hand === 'left') {
      // marcher : direction du regard, à plat
      const fwd = new THREE.Vector3();
      xrCam.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP);
      rig.position.addScaledVector(fwd, -y * 1.6 * dt).addScaledVector(right, x * 1.6 * dt);
    } else if (Math.abs(x) > 0.6 && !p.turnLatch) {
      // rotation par crans de 30° autour de la tête
      p.turnLatch = true;
      const head = new THREE.Vector3();
      xrCam.getWorldPosition(head);
      const a = -Math.sign(x) * (Math.PI / 6);
      rig.position.sub(head).applyAxisAngle(UP, a).add(head);
      rig.rotation.y += a;
    }
  }
}

// --- souris & tactile (sur écran) ----------------------------------------------------------------------------------
// clic / tap = sélectionner ; glisser = regarder ; glisser sur un volet = le faire défiler ; molette sur un volet = défiler
let down = null;
const setNdc = (e) => mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
canvas.addEventListener('pointermove', (e) => {
  setNdc(e);
  if (down?.scroll && e.pointerId === down.id) {
    down.scroll.scroll((down.y - e.clientY) / 28);
    down.y = e.clientY;
    down.moved = true;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  setNdc(e);
  raycaster.camera = camera;
  raycaster.setFromCamera(mouse.ndc, camera);
  mouse.current = pick();
  const t = mouse.current?.t;
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, scroll: t?.scroll && e.pointerType !== 'mouse' ? t : null };
  if (down.scroll) controls.enabled = false;
});
canvas.addEventListener('pointerup', (e) => {
  if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) activate(mouse);
  if (down?.scroll) controls.enabled = !nav.followPose && !nav.gyro;
  down = null;
  if (e.pointerType !== 'mouse') mouse.ndc.set(9, 9); // pas de survol fantôme après un tap
});
canvas.addEventListener('wheel', (e) => {
  const t = mouse.current?.t;
  if (t?.scroll) t.scroll(e.deltaY / 56);
  else if (t?.stick) t.stick(Math.sign(e.deltaY), 0, 0.15);
}, { passive: true });
addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'Backspace') { source?.back(); announce('Retour'); }
});

// --- présence : les autres personnes, leurs actions, « suivre » -----------------------------------------------------
const presence = new Presence(scene);
nav.lateral = ((parseInt(presence.id.slice(0, 4), 16) % 100) / 100 - 0.5) * 1.0;
const toasts = new Toasts();
camera.add(toasts.mesh);
toasts.mesh.position.set(0, -0.3, -1.1);
ui.name.value = presence.name;
ui.name.addEventListener('change', () => { presence.setName(ui.name.value); ui.name.value = presence.name; });
let following = null;
function follow(id) {
  following = id;
  presence.hidden = id;
  nav.follow(id ? () => presence.poseOf(id) : null);
  renderPeople(presence.people, presence.id);
}
function renderPeople(people, me) {
  if (following && !people.some((p) => p.id === following)) return follow(null);
  ui.people.replaceChildren(...people.map((p) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    li.append(dot, `${p.name}${p.id === me ? ' (vous)' : ''} · ${p.device}`);
    if (p.id !== me && !renderer.xr.isPresenting) {
      const b = document.createElement('button');
      b.className = 'mini';
      b.textContent = following === p.id ? 'Arrêter' : 'Suivre';
      b.addEventListener('click', () => follow(following === p.id ? null : p.id));
      li.append(b);
    }
    return li;
  }));
}
presence.onPeople = renderPeople;
presence.onEvent = (ev, mine) => {
  if (mine) return;
  const text = `${ev.name} → ${ev.text}`;
  toasts.push(text, ev.color);
  const div = document.createElement('div');
  div.className = 'toast';
  div.style.borderColor = ev.color;
  div.textContent = text;
  ui.toasts.prepend(div);
  setTimeout(() => div.classList.add('out'), 3500);
  setTimeout(() => div.remove(), 4200);
};

// points de vue, joystick, gyroscope, panneau repliable
for (const [key, v] of Object.entries(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = v.label;
  b.addEventListener('click', () => { follow(null); nav.goTo(key); });
  ui.views.append(b);
}
if (coarse) {
  document.body.classList.add('touch');
  nav.bindJoystick(ui.joystick);
  ui.gyro.addEventListener('click', () => nav.toggleGyro().then((on) => ui.gyro.classList.toggle('on', on)).catch((e) => setStatus(e.message, true)));
  ui.panel.classList.add('collapsed');
}
document.getElementById('panel-toggle').addEventListener('click', () => ui.panel.classList.toggle('collapsed'));

// --- WebXR ------------------------------------------------------------------------------------------------------
async function enter(mode) {
  const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'layers'] });
  const ar = mode === 'immersive-ar';
  scene.background = ar ? null : background;
  scene.fog = ar ? null : new THREE.Fog(Q.room, 9, 22);
  floor.visible = !ar;
  follow(null);
  session.addEventListener('end', () => { scene.background = background; scene.fog = new THREE.Fog(Q.room, 9, 22); floor.visible = true; nav.syncTarget(); });
  await renderer.xr.setSession(session);
  send(`session ${mode}`);
}
ui.vr.addEventListener('click', () => enter('immersive-vr').catch((e) => setStatus(e.message, true)));
ui.ar.addEventListener('click', () => enter('immersive-ar').catch((e) => setStatus(e.message, true)));
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { ui.vr.disabled = !ok; });
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => { ui.ar.disabled = !ok; });
}
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  nav.resize(innerWidth, innerHeight);
  renderer.setSize(innerWidth, innerHeight, false);
});

if (import.meta.env.DEV) window.__vr = { camera, controls, nav, presence, refresh, get source() { return source; } }; // inspection depuis la console

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  if (renderer.xr.isPresenting) updateGamepads(dt, xrCam);
  else nav.update(dt);
  for (const w of widgets) w.update(dt);
  presence.update(dt, xrCam.getWorldPosition(new THREE.Vector3()));
  toasts.update(dt, renderer.xr.isPresenting);
  scene.updateMatrixWorld();
  updatePointers(xrCam);
  const vr = renderer.xr.isPresenting;
  const aimer = vr ? pointers.find((p) => p.current) : mouse.current && mouse;
  presence.publish(performance.now(), {
    device: vr ? 'VR' : coarse ? 'Mobile' : 'PC',
    head: xrCam,
    hand: vr && aimer ? new THREE.Vector3().setFromMatrixPosition(aimer.ctrl.matrixWorld) : null,
    aim: aimer?.current?.hit.point ?? null,
  });
  renderer.render(scene, camera);
});

build().catch((e) => {
  if (!e.quiet) console.error(e);
  setStatus(e.message, !e.quiet);
});
