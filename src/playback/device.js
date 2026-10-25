// @ts-check
// Einziger Ort, der entscheidet, welches Abspielgerät gesteuert wird.
// Schritt 2: hier Spotify Connect einhängen – Zustand und UI bleiben unverändert.

import { createMockDevice } from './mock-device.js';

/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */

/**
 * @param {URLSearchParams} params
 * @returns {PlaybackDevice}
 */
export function createPlaybackDevice(params) {
  return createMockDevice(params.get('mock') ?? '');
}
