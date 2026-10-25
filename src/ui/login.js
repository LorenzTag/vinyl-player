// @ts-check
// Startbildschirm ohne Anmeldung: „Mit Spotify verbinden" oder Demo ansehen.
// Erklärt verständlich, warum es nicht klappt (fehlende Client ID, kein HTTPS).
// Unter „Eigene Spotify-App verwenden" lässt sich die Client ID einer selbst
// angelegten Spotify-App eintragen (gilt nur auf diesem Gerät).

import { h } from './dom.js';
import { isValidClientId } from '../config.js';

/**
 * @param {{
 *   canLogin: boolean,
 *   hasClientId: boolean,
 *   customClientId: string | null,
 *   redirectUri: string,
 *   message: string | null,
 *   onLogin: () => Promise<void>,
 *   onClientIdChange: (id: string | null) => void,
 *   onDemo: () => void,
 * }} options
 */
export function createLoginScreen({ canLogin, hasClientId, customClientId, redirectUri, message, onLogin, onClientIdChange, onDemo }) {
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
    hint = 'Es fehlt noch eine Client ID. Trage unten die Client ID deiner Spotify-App ein.';
  } else if (!canLogin) {
    hint = `Die Anmeldung bei Spotify geht nur über HTTPS oder http://127.0.0.1. Diese Adresse (${window.location.host}) ist dafür nicht zugelassen.`;
  }

  return h('main', { class: 'login' },
    h('div', { class: 'login__card' },
      h('div', { class: 'login__record', 'aria-hidden': 'true' }),
      h('h1', { class: 'login__title' }, 'Vinyl'),
      h('p', { class: 'login__lead' }, 'Deine Spotify-Bibliothek als Plattensammlung. Lege eine Platte auf, und die Spotify-App auf diesem Gerät spielt sie.'),
      loginButton,
      customClientId ? h('p', { class: 'login__using' }, `Mit deiner eigenen Spotify-App (Client ID …${customClientId.slice(-4)})`) : null,
      hint ? h('p', { class: 'login__hint' }, hint) : null,
      error,
      h('button', { type: 'button', class: 'button button--ghost', onclick: onDemo }, 'Demo ohne Spotify ansehen'),
      h('p', { class: 'login__note' }, 'Benötigt Spotify Premium und die Spotify-App auf diesem Gerät.'),
      createOwnApp({ customClientId, redirectUri, open: !hasClientId, onClientIdChange }),
    ),
  );
}

/**
 * Aufklappbarer Bereich: eigene Spotify-App einrichten und Client ID eintragen.
 * @param {{
 *   customClientId: string | null,
 *   redirectUri: string,
 *   open: boolean,
 *   onClientIdChange: (id: string | null) => void,
 * }} options
 */
function createOwnApp({ customClientId, redirectUri, open, onClientIdChange }) {
  const input = h('input', {
    class: 'login__input',
    id: 'client-id',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    maxlength: '64',
    placeholder: '32 Zeichen, z. B. 1a2b3c…',
    'aria-describedby': 'client-id-error',
  });
  input.value = customClientId ?? '';
  const invalid = h('p', { class: 'login__invalid', id: 'client-id-error', role: 'alert', hidden: true },
    'Das ist keine Client ID. Sie besteht aus 32 Zeichen (0–9 und a–f) und steht in deiner App im Spotify-Dashboard unter „Basic Information“.');

  const save = h('button', { type: 'submit', class: 'button login__save' }, 'Speichern');
  const form = h('form', { class: 'login__form', novalidate: true },
    h('label', { class: 'login__label', for: 'client-id' }, 'Client ID deiner Spotify-App'),
    h('div', { class: 'login__row' }, input, save),
    invalid,
    customClientId
      ? h('button', {
          type: 'button',
          class: 'login__reset',
          onclick: () => onClientIdChange(null),
        }, 'Eigene Client ID entfernen')
      : null,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Beim Kopieren rutschen gern Leerzeichen oder Zeilenumbrüche mit.
    const id = input.value.replace(/\s+/g, '').toLowerCase();
    if (!isValidClientId(id)) {
      invalid.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    onClientIdChange(id);
  });
  input.addEventListener('input', () => {
    invalid.hidden = true;
    input.removeAttribute('aria-invalid');
  });

  // Redirect URI zum Kopieren (muss exakt so im Spotify-Dashboard stehen).
  const uri = h('code', { class: 'login__uri' }, redirectUri);
  const copy = h('button', { type: 'button', class: 'login__copy' }, 'Kopieren');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      copy.textContent = 'Kopiert';
    } catch {
      // Zwischenablage gesperrt: Text markieren, damit man ihn selbst kopieren kann.
      const range = document.createRange();
      range.selectNodeContents(uri);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      copy.textContent = 'Markiert';
    }
    setTimeout(() => { copy.textContent = 'Kopieren'; }, 2000);
  });

  return h('details', { class: 'login__own', open: open || !!customClientId },
    h('summary', { class: 'login__summary' }, 'Eigene Spotify-App verwenden'),
    h('div', { class: 'login__own-body' },
      h('p', {}, 'Spotify lässt pro App nur 5 freigeschaltete Konten zu. Mit einer eigenen, kostenlosen Spotify-App kannst du Vinyl trotzdem nutzen – du brauchst nur Spotify Premium:'),
      h('ol', { class: 'login__steps' },
        h('li', {}, 'Auf ', h('strong', {}, 'developer.spotify.com/dashboard'), ' anmelden und „Create app“ wählen. Name und Beschreibung sind egal, bei „Which API/SDKs“ ', h('strong', {}, 'Web API'), ' ankreuzen.'),
        h('li', {}, 'Bei „Redirect URIs“ genau diese Adresse eintragen und hinzufügen:',
          h('span', { class: 'login__uri-row' }, uri, copy)),
        h('li', {}, 'Speichern, dann in den Einstellungen der App die ', h('strong', {}, 'Client ID'), ' kopieren und hier einfügen. Das Client Secret wird nie gebraucht.'),
      ),
      form,
    ),
  );
}
