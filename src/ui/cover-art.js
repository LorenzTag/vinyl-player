// @ts-check
// Plattenhüllen. Hat eine Platte ein echtes Cover (imageUrl), wird es gezeigt;
// sonst – oder wenn das Bild nicht lädt – ein generiertes Cover im Stil
// alter Plattenhüllen. Das Muster ergibt sich fest aus der ID, sieht also bei
// jedem Start gleich aus.

import { h, svg } from './dom.js';
import { hashString, seededRandom } from '../lib/seeded.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */

/**
 * @typedef {Object} Palette
 * @property {string} bg  Grundfarbe
 * @property {string} a   Akzent 1
 * @property {string} b   Akzent 2
 * @property {string} ink Schriftfarbe auf bg
 */

/** @type {Palette[]} */
const PALETTES = [
  { bg: '#e9dcc0', a: '#c4572e', b: '#2f4b53', ink: '#2a2018' },
  { bg: '#1f3b4d', a: '#e3a857', b: '#f3ead9', ink: '#f3ead9' },
  { bg: '#7d2e2a', a: '#f0c987', b: '#1d1612', ink: '#f6ead2' },
  { bg: '#2d4a3a', a: '#d98f4e', b: '#e9dcc0', ink: '#f3ead9' },
  { bg: '#d9b26f', a: '#2b2a3d', b: '#b5462f', ink: '#2b2a3d' },
  { bg: '#161412', a: '#e7d9bd', b: '#c7883a', ink: '#e7d9bd' },
  { bg: '#b9c4bf', a: '#33433f', b: '#d2643c', ink: '#22302c' },
  { bg: '#5b3f6b', a: '#efb36b', b: '#f4e6d0', ink: '#f4e6d0' },
  { bg: '#c9d6d9', a: '#1c3f5e', b: '#e07a3f', ink: '#1c3f5e' },
  { bg: '#3a2a1e', a: '#d8a35d', b: '#8fb0a0', ink: '#f2e6d0' },
];

/**
 * Jedes Muster lässt oben oder unten Platz für die Schrift.
 * @type {Array<{ text: 'top' | 'bottom', draw: (p: Palette, r: () => number) => string }>}
 */
const PATTERNS = [
  // Sonnenuntergang mit Horizontstreifen
  {
    text: 'top',
    draw(p, r) {
      const cy = 66 + r() * 4;
      const rad = 22 + r() * 5;
      let s = `<circle cx="50" cy="${n(cy)}" r="${n(rad)}" fill="${p.a}"/>`;
      for (let k = 0; k < 6; k++) {
        s += `<rect y="${n(cy - rad * 0.15 + k * rad * 0.19)}" width="100" height="${n(0.9 + k * 0.7)}" fill="${p.bg}"/>`;
      }
      return s + `<rect y="${n(cy + rad * 0.9)}" width="100" height="40" fill="${p.b}"/>`;
    },
  },
  // konzentrische Ringe
  {
    text: 'bottom',
    draw(p, r) {
      const cx = 50 + (r() - 0.5) * 18;
      const fills = [p.a, p.bg, p.b, p.bg, p.a, p.bg];
      let s = '';
      for (let k = 0; k < fills.length; k++) {
        s += `<circle cx="${n(cx)}" cy="38" r="${n(32 - k * 5.6)}" fill="${fills[k]}"/>`;
      }
      return s;
    },
  },
  // Bauhaus-Raster
  {
    text: 'bottom',
    draw(p, r) {
      let s = '';
      const size = 25;
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const x = 12.5 + col * size;
          const y = 8 + row * size;
          const fill = r() < 0.5 ? p.a : p.b;
          const kind = Math.floor(r() * 5);
          if (kind === 0) s += `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${fill}"/>`;
          else if (kind === 1) s += `<path d="M${x} ${y + size}V${y}A${size} ${size} 0 0 1 ${x + size} ${y + size}Z" fill="${fill}"/>`;
          else if (kind === 2) s += `<path d="M${x} ${y + size / 2}A${size / 2} ${size / 2} 0 0 1 ${x + size} ${y + size / 2}Z" fill="${fill}"/>`;
          else if (kind === 3) s += `<rect x="${x + 2}" y="${y + 2}" width="${size - 4}" height="${size - 4}" fill="${fill}"/>`;
        }
      }
      return s;
    },
  },
  // Diagonale Streifen
  {
    text: 'top',
    draw(p, r) {
      let s = `<g transform="rotate(${n(-24 - r() * 12)} 50 70)">`;
      const colors = [p.a, p.bg, p.b, p.bg];
      let x = -60;
      for (let k = 0; x < 160; k++) {
        const w = 4 + r() * 9;
        s += `<rect x="${n(x)}" y="20" width="${n(w)}" height="120" fill="${colors[k % colors.length]}"/>`;
        x += w;
      }
      return s + `</g><rect width="100" height="44" fill="${p.bg}"/><rect y="44" width="100" height="1.2" fill="${p.a}"/>`;
    },
  },
  // Bögen aus einer unteren Ecke
  {
    text: 'top',
    draw(p, r) {
      const right = r() < 0.5;
      const cx = right ? 100 : 0;
      let s = '';
      for (let k = 0; k < 7; k++) {
        const rad = 18 + k * 8.5;
        const start = right ? `${100 - rad} 100` : `${rad} 100`;
        const end = `${cx} ${n(100 - rad)}`;
        s += `<path d="M${start}A${n(rad)} ${n(rad)} 0 0 ${right ? 1 : 0} ${end}" fill="none" stroke="${k % 2 ? p.b : p.a}" stroke-width="4.6"/>`;
      }
      return s;
    },
  },
  // Punktraster
  {
    text: 'bottom',
    draw(p, r) {
      const phase = r() * 6;
      let s = '';
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 6; col++) {
          const rad = 1.6 + 4.2 * (0.5 + 0.5 * Math.sin(col * 0.9 + row * 1.3 + phase));
          s += `<circle cx="${n(12 + col * 15.2)}" cy="${n(10 + row * 12.5)}" r="${n(rad)}" fill="${(row + col) % 4 === 0 ? p.b : p.a}"/>`;
        }
      }
      return s;
    },
  },
  // Wellen
  {
    text: 'top',
    draw(p, r) {
      const fills = [p.a, p.b, p.a, p.bg];
      let s = '';
      for (let k = 0; k < fills.length; k++) {
        const y = 48 + k * 12;
        const amp = 5 + r() * 6;
        s += `<path d="M0 ${y}C30 ${n(y - amp)} 70 ${n(y + amp)} 100 ${y}V100H0Z" fill="${fills[k]}"/>`;
      }
      return s;
    },
  },
];

/** @param {number} v */
function n(v) {
  return Math.round(v * 100) / 100;
}

/** @param {RecordItem} record */
function styleFor(record) {
  const hash = hashString(record.id);
  return {
    hash,
    palette: PALETTES[hash % PALETTES.length],
    pattern: PATTERNS[(hash >>> 8) % PATTERNS.length],
  };
}

/**
 * Farbpalette des generierten Covers (Grundlage für Platte und Hintergrund).
 * @param {RecordItem} record
 * @returns {Palette}
 */
export function coverPalette(record) {
  return styleFor(record).palette;
}

/**
 * Leichte, aber stabile Zufallswerte je Platte (z. B. Neigung im Regal), Bereich -1…1.
 * @param {RecordItem} record
 * @param {number} salt
 */
export function jitter(record, salt) {
  return seededRandom(hashString(record.id) ^ salt)() * 2 - 1;
}

/**
 * @param {RecordItem} record
 * @param {{ eager?: boolean }} [opts]  eager: Bild sofort laden (Plattenspieler)
 * @returns {HTMLDivElement}
 */
export function createCover(record, { eager = false } = {}) {
  const { hash, palette, pattern } = styleFor(record);
  const random = seededRandom(hash);

  const cover = h('div', {
    class: 'cover',
    'aria-hidden': 'true',
    style: { '--cover-bg': palette.bg, '--cover-ink': palette.ink },
  });

  const art = h('div', { class: 'cover__art' });
  art.append(svg(
    `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100" height="100" fill="${palette.bg}"/>${pattern.draw(palette, random)}</svg>`,
  ));

  const type = h('div', { class: 'cover__type', dataset: { pos: pattern.text } },
    h('div', { class: 'cover__title' }, record.title),
    h('div', { class: 'cover__artist' }, record.kind === 'album' ? record.subtitle : 'Playlist'),
  );
  const wear = h('div', { class: 'cover__wear' });

  cover.append(art);
  if (record.imageUrl) {
    const img = h('img', {
      class: 'cover__img',
      // Gleicher Abrufmodus wie beim Farben-Auslesen → nur ein Download, gemeinsamer Cache.
      // (vor src setzen, sonst startet der Abruf zweimal)
      crossorigin: 'anonymous',
      alt: '',
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async',
      draggable: 'false',
      src: record.imageUrl,
    });
    // Bild nicht ladbar (offline, abgelaufene URL): Platzhalter mit Titel zeigen.
    img.addEventListener('error', () => {
      img.remove();
      wear.before(type);
    }, { once: true });
    cover.append(img);
  } else {
    cover.append(type);
  }
  cover.append(wear);
  return cover;
}
