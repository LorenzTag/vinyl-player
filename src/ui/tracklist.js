// @ts-check
// Titelliste als Beiblatt der Platte: gleitet herein (Querformat von rechts,
// Hochformat von unten). Ein Titel antippen spielt genau diesen. Schließen per
// ✕, Tippen daneben oder Wischen nach rechts/unten.

import { h, clamp } from './dom.js';
import { formatDuration } from './format.js';

/** @typedef {import('../data/types.js').Track} Track */

const CLOSE_DISTANCE = 90; // px Wischweg zum Schließen

/**
 * @param {{ onSelect: (index: number) => void, onClose: () => void }} handlers
 */
export function createTracklist({ onSelect, onClose }) {
  const list = h('ol', { class: 'tracklist__list' });
  const subtitle = h('div', { class: 'tracklist__subtitle' });
  const message = h('p', { class: 'tracklist__message', hidden: true });
  const closeButton = h('button', { type: 'button', class: 'tracklist__close', 'aria-label': 'Titelliste schließen', onclick: onClose }, '✕');
  const header = h('div', { class: 'tracklist__header' },
    h('div', { class: 'tracklist__grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'tracklist__heading' },
      h('h3', { class: 'tracklist__title' }, 'Titelliste'),
      subtitle,
    ),
    closeButton,
  );
  const sheet = h('div', { class: 'tracklist__sheet tex-paper', role: 'dialog', 'aria-label': 'Titelliste' }, header, message, list);
  const scrim = h('div', { class: 'tracklist__scrim', onclick: onClose });
  const el = h('div', { class: 'tracklist', hidden: true }, scrim, sheet);

  /** @type {Track[] | null} */
  let shownTracks = null;
  let shownIndex = -1;
  let hideTimer = 0;

  list.addEventListener('click', (event) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.tracklist__item'));
    if (row) onSelect(Number(row.dataset.index));
  });

  // ---------- Wischen zum Schließen (am Kopf des Blatts) ----------

  /** @type {{ id: number, x: number, y: number, d: number } | null} */
  let swipe = null;
  const horizontal = () => getComputedStyle(el).getPropertyValue('--sheet-axis').trim() === 'x';

  header.addEventListener('pointerdown', (event) => {
    if (/** @type {Element} */ (event.target).closest('button')) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, d: 0 };
    sheet.classList.add('is-dragging');
  });

  window.addEventListener('pointermove', onSwipeMove, true);
  window.addEventListener('pointerup', onSwipeEnd, true);
  window.addEventListener('pointercancel', onSwipeEnd, true);

  /** @param {PointerEvent} event */
  function onSwipeMove(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    swipe.d = Math.max(0, horizontal() ? event.clientX - swipe.x : event.clientY - swipe.y);
    sheet.style.transform = horizontal() ? `translateX(${swipe.d}px)` : `translateY(${swipe.d}px)`;
  }

  /** @param {PointerEvent} event */
  function onSwipeEnd(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const { d } = swipe;
    swipe = null;
    sheet.classList.remove('is-dragging');
    sheet.style.transform = '';
    if (d > CLOSE_DISTANCE) onClose();
  }

  // ---------- Darstellung ----------

  /**
   * @param {{ recordTitle: string, tracks: Track[], current: number, playing: boolean, status: 'idle' | 'loading' | 'ready' | 'error', error?: string }} view
   */
  function render(view) {
    subtitle.textContent = view.recordTitle;
    message.hidden = view.status === 'ready' && view.tracks.length > 0;
    message.textContent = view.status === 'error'
      ? `Die Titelliste ließ sich nicht laden. ${view.error ?? ''}`
      : view.status === 'ready' ? 'Auf dieser Platte sind keine Titel.' : 'Titel werden geladen …';

    if (view.tracks !== shownTracks) {
      shownTracks = view.tracks;
      shownIndex = -1;
      list.replaceChildren(...view.tracks.map((track, i) =>
        h('li', {},
          h('button', { type: 'button', class: 'tracklist__item', dataset: { index: String(i) } },
            h('span', { class: 'tracklist__no' }, String(i + 1)),
            h('span', { class: 'tracklist__text' },
              h('span', { class: 'tracklist__name' }, track.title),
              h('span', { class: 'tracklist__artist' }, track.artists),
            ),
            h('span', { class: 'tracklist__time' }, formatDuration(track.durationMs)),
          ),
        ),
      ));
    }

    const items = list.querySelectorAll('.tracklist__item');
    if (shownIndex !== view.current) {
      items[shownIndex]?.classList.remove('is-current');
      items[shownIndex]?.removeAttribute('aria-current');
      shownIndex = view.current;
    }
    const currentItem = items[view.current];
    if (currentItem) {
      currentItem.classList.add('is-current');
      currentItem.setAttribute('aria-current', 'true');
      currentItem.classList.toggle('is-playing', view.playing);
    }
  }

  return {
    el,
    render,
    isOpen: () => el.classList.contains('is-open'),

    open() {
      clearTimeout(hideTimer);
      el.hidden = false;
      void el.offsetWidth; // Startzustand übernehmen, damit die Transition läuft
      el.classList.add('is-open');
      const current = list.querySelector('.tracklist__item.is-current');
      const target = /** @type {HTMLElement | null} */ (current ?? list.querySelector('.tracklist__item'));
      if (current) list.scrollTop = clamp(/** @type {HTMLElement} */ (current).offsetTop - 80, 0, list.scrollHeight);
      target?.focus({ preventScroll: true });
    },

    close() {
      el.classList.remove('is-open');
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { el.hidden = true; }, 360);
    },

    destroy() {
      clearTimeout(hideTimer);
      window.removeEventListener('pointermove', onSwipeMove, true);
      window.removeEventListener('pointerup', onSwipeEnd, true);
      window.removeEventListener('pointercancel', onSwipeEnd, true);
    },
  };
}
