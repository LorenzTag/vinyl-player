// @ts-check
// Startbildschirm ohne Anmeldung: „Mit Spotify verbinden" oder Demo ansehen.
// Erklärt verständlich, warum es nicht klappt (fehlende Client ID, kein HTTPS).

import { h } from './dom.js';

/**
 * @param {{
 *   canLogin: boolean,
 *   hasClientId: boolean,
 *   message: string | null,
 *   onLogin: () => Promise<void>,
 *   onDemo: () => void,
 * }} options
 */
export function createLoginScreen({ canLogin, hasClientId, message, onLogin, onDemo }) {
  const error = h('p', { class: 'login__error', role: 'alert', hidden: !message }, message ?? '');
  const loginButton = h('button', {
    type: 'button',
    class: 'button login__primary',
    disabled: !canLogin || !hasClientId,
  }, 'Mit Spotify verbinden');

  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    error.hidden = true;
    try {
      await onLogin(); // wechselt zur Spotify-Seite
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Anmeldung nicht möglich.';
      error.hidden = false;
      loginButton.disabled = false;
    }
  });

  /** @type {string | null} */
  let hint = null;
  if (!hasClientId) {
    hint = 'Es fehlt noch die Client ID aus dem Spotify-Dashboard (src/config.js).';
  } else if (!canLogin) {
    hint = `Die Anmeldung bei Spotify geht nur über HTTPS oder http://127.0.0.1. Diese Adresse (${window.location.host}) ist dafür nicht zugelassen.`;
  }

  return h('main', { class: 'login' },
    h('div', { class: 'login__card' },
      h('div', { class: 'login__record', 'aria-hidden': 'true' }),
      h('h1', { class: 'login__title' }, 'Vinyl'),
      h('p', { class: 'login__lead' }, 'Deine Spotify-Bibliothek als Plattensammlung. Lege eine Platte auf, und die Spotify-App auf diesem Gerät spielt sie.'),
      loginButton,
      hint ? h('p', { class: 'login__hint' }, hint) : null,
      error,
      h('button', { type: 'button', class: 'button button--ghost', onclick: onDemo }, 'Demo ohne Spotify ansehen'),
      h('p', { class: 'login__note' }, 'Benötigt Spotify Premium und die Spotify-App auf diesem Gerät.'),
    ),
  );
}
