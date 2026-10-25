// @ts-check
// Farben des Plattenspieler-Bildschirms aus dem Cover: Hintergrund, Vinyl
// (farbig, marmoriert) und Etikett.
//
// Generierte Cover liefern ihre Palette direkt. Für echte Cover (Spotify)
// werden die Farben per Canvas aus dem Bild gelesen; klappt das nicht (z. B.
// fehlende CORS-Freigabe), bleibt es bei der Palette des Platzhalters.

import { coverPalette } from './cover-art.js';
import { hashString } from '../lib/seeded.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {{ bg: string, ink: string }} Tone  Fläche + lesbare Schrift darauf */
/**
 * @typedef {{ bg: string, a: string, b: string, ink: string, left?: Tone, right?: Tone }} Palette
 * left/right: Farbe an der linken/rechten Cover-Kante (für die Hüllen-Rücken)
 */
/** @typedef {[number, number, number]} RGB */

/** @param {string} hex @returns {RGB} */
function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** @param {RGB} c */
function hex([r, g, b]) {
  return `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
}

/** @param {string} a @param {string} b @param {number} t  Anteil von b */
function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** @param {string} c @param {number} alpha */
function rgba(c, alpha) {
  const [r, g, b] = rgb(c);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** relative Helligkeit 0…1 */
function luminance(c) {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Marmorierung des Vinyls als SVG-Rauschen (selbst erzeugt, keine Bilddatei). */
function marble(vinyl, seed) {
  const dark = rgb(mix(vinyl, '#000000', 0.55)).map((v) => (v / 255).toFixed(3));
  const light = rgb(mix(vinyl, '#ffffff', 0.45)).map((v) => (v / 255).toFixed(3));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'>` +
    `<filter id='d' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.008 0.018' numOctaves='4' seed='${seed % 997}'/>` +
    `<feColorMatrix values='0 0 0 0 ${dark[0]}  0 0 0 0 ${dark[1]}  0 0 0 0 ${dark[2]}  2.8 0 0 0 -1.45'/></filter>` +
    `<filter id='l' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.014 0.006' numOctaves='3' seed='${(seed >> 4) % 997}'/>` +
    `<feColorMatrix values='0 0 0 0 ${light[0]}  0 0 0 0 ${light[1]}  0 0 0 0 ${light[2]}  0 2.4 0 0 -1.3'/></filter>` +
    `<rect width='320' height='320' filter='url(#d)'/><rect width='320' height='320' filter='url(#l)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * CSS-Variablen für den Plattenspieler-Bildschirm.
 * @param {RecordItem} record
 * @param {Palette} [palette]
 * @returns {Record<string, string>}
 */
export function playerTheme(record, palette = coverPalette(record)) {
  const { bg, a, b, ink } = palette;
  // Vinyl in der Akzentfarbe; ist die zu nah an der Grundfarbe, die zweite nehmen.
  const vinyl = Math.abs(luminance(a) - luminance(bg)) < 0.04 ? b : a;
  const deepVinyl = luminance(vinyl) < 0.03;
  return {
    '--theme-top': mix(bg, '#0c0907', 0.55),
    '--theme-bottom': mix(bg, '#060403', 0.86),
    '--theme-glow-a': rgba(a, 0.32),
    '--theme-glow-b': rgba(b, 0.2),
    '--vinyl': deepVinyl ? '#0c0a09' : mix(vinyl, '#000000', 0.12),
    '--vinyl-rim': deepVinyl ? '#1c1916' : mix(vinyl, '#000000', 0.35),
    '--vinyl-runout': deepVinyl ? '#0d0b0a' : mix(vinyl, '#000000', 0.22),
    '--vinyl-marble': deepVinyl ? 'none' : marble(vinyl, hashString(record.id)),
    '--label-color': bg,
    '--label-ink': ink,
    '--label-ring': mix(a, '#000000', 0.25),
  };
}

const IMAGE_TIMEOUT_MS = 8000;
/** @type {Map<string, Promise<HTMLImageElement | null>>} */
const images = new Map();
/** @type {Map<string, Promise<Palette | null>>} */
const palettes = new Map();
/** bereits gelesene Paletten – sofort verfügbar, ohne zu warten */
/** @type {Map<string, Palette>} */
const resolvedPalettes = new Map();

/** Palette, falls schon gelesen (sonst null). @param {string} url */
export function cachedPalette(url) {
  return resolvedPalettes.get(url) ?? null;
}

/**
 * Neutrale Farben (Nussholz, schwarzes Vinyl) – solange die echten Cover-Farben
 * noch nicht gelesen sind. Besser als zufällige Ersatzfarben, die gleich wieder
 * umspringen.
 * @param {RecordItem} record
 */
export function neutralTheme(record) {
  return playerTheme(record, { bg: '#5a4030', a: '#141110', b: '#c9a063', ink: '#f2e6d0' });
}

/**
 * Bild laden und dekodieren (einmal je URL, danach aus dem Cache).
 * @param {string} url
 * @returns {Promise<HTMLImageElement | null>}
 */
export function loadImage(url) {
  let task = images.get(url);
  if (!task) {
    task = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const done = (/** @type {HTMLImageElement | null} */ result) => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (!result) images.delete(url); // später erneut versuchen
        resolve(result);
      };
      // Feste Zeitgrenze: ein hängender Abruf darf den Cache nie blockieren.
      const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS);
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
    });
    images.set(url, task);
  }
  return task;
}

/**
 * Auf ein Ergebnis höchstens `ms` warten, danach null (die Oberfläche wartet nie ewig).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | null>}
 */
export function within(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Palette aus einem echten Cover lesen (zwischengespeichert): Durchschnitt als
 * Grundfarbe, die kräftigsten Farben als Akzente.
 * @param {string} url
 * @returns {Promise<Palette | null>}
 */
export function paletteFromImage(url) {
  let task = palettes.get(url);
  if (!task) {
    task = readPalette(url);
    palettes.set(url, task);
    task.then((p) => {
      if (p) resolvedPalettes.set(url, p);
      else palettes.delete(url);
    });
  }
  return task;
}

/**
 * @param {string} url
 * @returns {Promise<Palette | null>}
 */
async function readPalette(url) {
  try {
    const img = await loadImage(url);
    if (!img) return null;
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data; // wirft bei fehlender CORS-Freigabe

    let sum = [0, 0, 0];
    /** @type {Array<{ c: RGB, score: number }>} */
    const vivid = [];
    for (let i = 0; i < data.length; i += 4) {
      const c = /** @type {RGB} */ ([data[i], data[i + 1], data[i + 2]]);
      sum = [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]];
      const max = Math.max(...c);
      const min = Math.min(...c);
      vivid.push({ c, score: (max - min) * (0.4 + max / 255) });
    }
    const count = data.length / 4;
    const bg = hex([sum[0] / count, sum[1] / count, sum[2] / count]);
    vivid.sort((x, y) => y.score - x.score);
    const a = hex(vivid[0].c);
    const b = hex(vivid[Math.min(vivid.length - 1, Math.floor(vivid.length * 0.15))].c);
    const edge = Math.max(2, Math.round(size / 8));
    return {
      bg, a, b,
      ink: luminance(bg) > 0.35 ? '#2a2018' : '#f6ead2',
      left: tone(dominant(data, size, 0, edge)),
      right: tone(dominant(data, size, size - edge, size)),
    };
  } catch {
    return null;
  }
}

/**
 * Häufigste Farbe in einem senkrechten Streifen (Spalten from…to-1) – wie das
 * Cover an dieser Kante aussieht. Gruppiert grob nach Farbton, damit es eine
 * klare Farbe wird statt eines Mittelwerts aus allem.
 * @param {Uint8ClampedArray} data
 * @param {number} size
 * @param {number} from
 * @param {number} to
 */
function dominant(data, size, from, to) {
  /** @type {Map<number, { n: number, sum: RGB }>} */
  const groups = new Map();
  let best = null;
  for (let y = 0; y < size; y++) {
    for (let x = from; x < to; x++) {
      const i = (y * size + x) * 4;
      const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { n: 0, sum: [0, 0, 0] }));
      group.n++;
      group.sum[0] += data[i];
      group.sum[1] += data[i + 1];
      group.sum[2] += data[i + 2];
      if (!best || group.n > best.n) best = group;
    }
  }
  const { n, sum } = /** @type {{ n: number, sum: RGB }} */ (best);
  return hex([sum[0] / n, sum[1] / n, sum[2] / n]);
}

/** @param {string} bg @returns {Tone} */
function tone(bg) {
  return { bg, ink: luminance(bg) > 0.3 ? '#1f1812' : '#f6ead2' };
}
