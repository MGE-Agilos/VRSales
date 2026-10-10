// Connexion Qlik Cloud depuis une page statique (GitHub Pages) : chaque visiteur se connecte avec son propre
// compte Qlik (OAuth 2 « single-page app » + PKCE), donc a sa propre session moteur et ses propres sélections.
// Aucun secret dans le code : le Client ID est public, le tenant n'accepte que les adresses enregistrées.
//
// Client OAuth « Qlik en VR (GitHub Pages VRSales) », sur le tenant (Administration → OAuth) :
//   redirections : https://mge-agilos.github.io/VRSales/  et  https://localhost:5173/dataviz/
//   origines     : https://mge-agilos.github.io           et  https://localhost:5173

export const HOSTED = {
  tenant: 'beyond-data-group-training.de.qlikcloud.com',
  clientId: '01a12827d4d1101388669edde306afd7',
  appId: '771eef89-203b-47ab-a617-d5f9df6dccad', // Sales Analysis
};

const base = `https://${HOSTED.tenant}`;
const KEY = 'qlik-oauth';
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
const store = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(`${KEY}:${k}`)); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(`${KEY}:${k}`) : sessionStorage.setItem(`${KEY}:${k}`, JSON.stringify(v)); } catch { /* navigation privée */ } },
};

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// redirige vers la page de connexion Qlik ; on revient ensuite sur la même page avec ?code=…
export async function login(returnTo = location.href) {
  const verifier = random(64);
  const state = random(24);
  store.set('verifier', verifier);
  store.set('state', state);
  store.set('return', returnTo);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    response_type: 'code', client_id: HOSTED.clientId, redirect_uri: redirectUri(), scope: 'user_default',
    state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.assign(`${base}/oauth/authorize?${q}`);
}

export function logout() { store.set('token', null); }

// au retour de la page de connexion : échange le code contre un jeton, puis nettoie l'adresse
export async function completeLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code')) return false;
  const back = store.get('return') ?? redirectUri();
  if (q.get('state') !== store.get('state')) throw new Error('connexion Qlik : réponse inattendue (state), réessayez');
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: store.get('verifier'), redirect_uri: redirectUri(), client_id: HOSTED.clientId, scope: 'user_default' }),
  });
  const data = await res.json().catch(() => ({}));
  store.set('verifier', null);
  store.set('state', null);
  if (!res.ok || !data.access_token) throw new Error(`connexion Qlik refusée : ${data.errors?.[0]?.detail ?? data.error_description ?? res.status}`);
  store.set('token', { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000 });
  history.replaceState(null, '', back);
  return true;
}

export function accessToken() {
  const t = store.get('token');
  return t && t.expires > Date.now() ? t.value : null;
}

// la WebSocket du moteur ne peut pas porter d'en-tête : on échange le jeton contre un jeton temporaire dédié
export async function websocketUrl(appId) {
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject_token: accessToken(), subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', purpose: 'websocket',
      redirect_uri: location.href, client_id: HOSTED.clientId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('session Qlik expirée — reconnectez-vous'); }
  if (!res.ok || !data.access_token) throw new Error(`jeton moteur refusé : ${data.errors?.[0]?.detail ?? res.status}`);
  return `wss://${HOSTED.tenant}/app/${appId}?accessToken=${encodeURIComponent(data.access_token)}`;
}

export async function rest(path) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${accessToken()}` } });
  if (res.status === 401) { logout(); throw new Error('session Qlik expirée — reconnectez-vous'); }
  if (!res.ok) throw new Error(`Qlik ${path} : HTTP ${res.status}`);
  return res.json();
}
