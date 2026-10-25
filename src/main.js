// @ts-check
// Einstiegspunkt: Datenquelle → Zustand → Oberfläche.

import { createLibrarySource } from './data/source.js';
import { createAppStore } from './state/app-state.js';
import { createLibrary } from './state/library.js';
import { createPlayback } from './state/playback.js';
import { createPlaybackDevice } from './playback/device.js';
import { createApp } from './ui/app.js';

// iOS wendet :active-Stile nur an, wenn irgendwo ein touchstart-Listener hängt.
document.addEventListener('touchstart', () => {}, { passive: true });

window.addEventListener('error', (event) => console.error('[app] Fehler', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => console.error('[app] Unbehandelte Promise', event.reason));

const root = document.getElementById('app');
if (!root) throw new Error('#app fehlt in index.html');

const params = new URLSearchParams(location.search);
const store = createAppStore();
const source = createLibrarySource(params);
const library = createLibrary(store, source);
const playback = createPlayback(store, source, createPlaybackDevice(params));

createApp(root, { store, library, playback });
