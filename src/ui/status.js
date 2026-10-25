// @ts-check
// Lade-, Fehler- und Leer-Anzeige über der aktuellen Ansicht.

import { h } from './dom.js';

/** @typedef {import('../state/app-state.js').Resource} Resource */

/**
 * @param {{ onRetry: () => void, onLogin?: () => void }} handlers
 */
export function createStatus({ onRetry, onLogin }) {
  const el = h('div', { class: 'status', hidden: true, role: 'status', 'aria-live': 'polite' });

  /** Zuletzt gezeigter Zustand – unverändert heißt: DOM nicht anfassen. */
  let shown = '';

  /**
   * @param {Resource} resource
   * @param {string} emptyText  Hinweis, wenn nichts da ist
   */
  function show(resource, emptyText) {
    const empty = resource.status === 'ready' && resource.items.length === 0;
    const key = resource.status === 'error'
      ? `error:${resource.error?.message}`
      : empty ? `empty:${emptyText}` : resource.status === 'loading' && resource.items.length === 0 ? 'loading' : '';
    if (key === shown) return;
    shown = key;

    el.replaceChildren();
    el.removeAttribute('data-state');
    el.hidden = key === '';
    if (key === '') return;

    if (key === 'loading') {
      el.dataset.state = 'loading';
      el.append(
        h('div', { class: 'status__spinner', 'aria-hidden': 'true' }),
        h('p', { class: 'status__text' }, 'Sammlung wird geladen …'),
      );
    } else if (resource.status === 'error') {
      el.dataset.state = 'error';
      el.append(
        h('h2', { class: 'status__title' }, 'Die Sammlung ließ sich nicht laden'),
        h('p', { class: 'status__text' }, resource.error?.message ?? ''),
        resource.error?.kind === 'auth' && onLogin
          ? h('button', { type: 'button', class: 'button', onclick: onLogin }, 'Bei Spotify anmelden')
          : h('button', { type: 'button', class: 'button', onclick: onRetry }, 'Erneut versuchen'),
      );
    } else {
      el.dataset.state = 'empty';
      el.append(
        h('h2', { class: 'status__title' }, 'Hier ist noch Platz'),
        h('p', { class: 'status__text' }, emptyText),
      );
    }
  }

  return { el, show };
}
