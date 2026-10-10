import * as THREE from 'three';

// Couleurs « à la Qlik Sense » : l'état d'une valeur (sélectionnée, possible, alternative, exclue) se lit
// toujours par la même couleur, partout dans la pièce.
export const Q = {
  green: '#009845', // sélectionné
  greenDark: '#007a37',
  possible: '#ffffff',
  alternative: '#e4e4e4',
  excluded: '#a9a9a9',
  ink: '#404040',
  inkSoft: '#6e6e6e',
  inkMuted: '#8c8c8c',
  line: '#e0e2e5',
  card: '#ffffff',
  room: '#eef0f3',
  floor: '#f7f8f9',
  blue: '#2f6db5', // couleur unique des graphiques (une seule série)
};

// Palette catégorielle (ordre fixe, vérifiée daltonisme ; le vert reste réservé à la sélection)
export const PALETTE = ['#2f6db5', '#d0546a', '#d99a1e', '#14998a', '#9a46b0', '#3e9be0', '#8a2346', '#8b9a1a'];

// Rampe séquentielle (une teinte, clair → foncé) pour les mesures de couleur
const SEQ = ['#cfe1f2', '#93bde3', '#5596d0', '#2f6db5', '#174a87', '#0b2f5c'].map((c) => new THREE.Color(c));
export function seqColor(t, out = new THREE.Color()) {
  t = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (SEQ.length - 1);
  const i = Math.min(SEQ.length - 2, Math.floor(t));
  return out.copy(SEQ[i]).lerp(SEQ[i + 1], t - i);
}
export const SEQ_CSS = SEQ.map((c) => `#${c.getHexString()}`);

export const FONT = '"Source Sans 3", "Source Sans Pro", "Segoe UI", system-ui, sans-serif';

// états des valeurs d'un champ, tels que renvoyés par le moteur (qState)
export function stateStyle(state) {
  switch (state) {
    case 'S': case 'L': return { bg: Q.green, fg: '#ffffff' };
    case 'A': return { bg: Q.alternative, fg: Q.ink };
    case 'X': case 'XS': case 'XL': return { bg: Q.excluded, fg: '#ffffff' };
    default: return { bg: Q.possible, fg: Q.ink };
  }
}

const compactFmt = new Intl.NumberFormat('fr-BE', { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (n) => (Number.isFinite(n) ? compactFmt.format(n) : '–');
