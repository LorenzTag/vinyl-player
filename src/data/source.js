// @ts-check
// Einziger Ort, der entscheidet, woher die Daten kommen.
// Schritt 2: hier die Spotify-Quelle einhängen – UI und Zustand bleiben unverändert.

import { createMockSource } from './mock-source.js';

/** @typedef {import('./types.js').LibrarySource} LibrarySource */

/**
 * @param {URLSearchParams} params
 * @returns {LibrarySource}
 */
export function createLibrarySource(params) {
  return createMockSource(params.get('mock') ?? '');
}
