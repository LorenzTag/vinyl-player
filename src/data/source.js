// @ts-check
// Datenquelle für die Demo. Die Spotify-Quelle (src/spotify/spotify-source.js)
// wählt main.js nach der Anmeldung – UI und Zustand sind für beide gleich.

import { createMockSource } from './mock-source.js';

/** @typedef {import('./types.js').LibrarySource} LibrarySource */

/**
 * @param {URLSearchParams} params
 * @returns {LibrarySource}
 */
export function createLibrarySource(params) {
  return createMockSource(params.get('mock') ?? '');
}
