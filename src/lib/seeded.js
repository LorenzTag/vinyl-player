// @ts-check
// Stabile Pseudo-Zufallswerte: gleiche Eingabe → gleiches Ergebnis bei jedem Start.

/** FNV-1a: stabiler 32-Bit-Hash einer Zeichenkette. */
export function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Kleiner deterministischer Zufallsgenerator (mulberry32), Werte in [0, 1). */
export function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
