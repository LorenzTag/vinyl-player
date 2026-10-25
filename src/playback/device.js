// @ts-check
// Abspielgerät für die Demo. Das Spotify-Gerät (src/spotify/spotify-device.js)
// wählt main.js nach der Anmeldung – Zustand und UI sind für beide gleich.

import { createMockDevice } from './mock-device.js';

/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */

/**
 * @param {URLSearchParams} params
 * @returns {PlaybackDevice}
 */
export function createPlaybackDevice(params) {
  return createMockDevice(params.get('mock') ?? '');
}
