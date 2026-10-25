// @ts-check
// Titelliste als Seite rechts neben dem Plattenteller. Ein- und Ausfahren
// (per Wischgeste, dem Finger folgend) steuert der Plattenspieler; diese
// Komponente zeichnet nur die Liste. Ein Titel antippen spielt genau diesen.

import { h, clamp } from './dom.js';
import { formatDuration } from './format.js';

/** @typedef {import('../data/types.js').Track} Track */

/**
 * @param {{ onSelect: (index: number) => void, onClose: () => void }} handlers
 */
export function createTracklist({ onSelect, onClose }) {
  const list = h('ol', { class: 'tracklist__list' });
  const subtitle = h('div', { class: 'tracklist__subtitle' });
  const message = h('p', { class: 'tracklist__message', hidden: true });
  const el = h('aside', { class: 'tracklist tex-paper', 'aria-label': 'Titelliste', inert: true },
    h('div', { class: 'tracklist__header' },
      h('div', { class: 'tracklist__heading' },
        h('h3', { class: 'tracklist__title' }, 'Titelliste'),
        subtitle,
      ),
      h('button', { type: 'button', class: 'tracklist__close', 'aria-label': 'Titelliste schließen', onclick: onClose }, '›'),
    ),
    message,
    list,
  );

  /** @type {Track[] | null} */
  let shownTracks = null;
  let shownIndex = -1;

  list.addEventListener('click', (event) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.tracklist__item'));
    if (row) onSelect(Number(row.dataset.index));
  });

  /**
   * @param {{ recordTitle: string, tracks: Track[], current: number, playing: boolean, status: 'idle' | 'loading' | 'ready' | 'error', error?: string }} view
   */
  function render(view) {
    subtitle.textContent = view.recordTitle;
    message.hidden = view.tracks.length > 0;
    message.textContent = view.status === 'error'
      ? view.error ?? 'Die Titelliste ließ sich nicht laden.'
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
      items[shownIndex]?.classList.remove('is-current', 'is-playing');
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

    /** Sichtbar/bedienbar schalten (Bewegung macht der Plattenspieler). */
    setOpen(/** @type {boolean} */ open) {
      el.inert = !open;
      el.classList.toggle('is-open', open);
    },

    /** Zum laufenden Titel scrollen. */
    revealCurrent() {
      const current = /** @type {HTMLElement | null} */ (list.querySelector('.tracklist__item.is-current'));
      if (current) list.scrollTop = clamp(current.offsetTop - list.clientHeight / 3, 0, list.scrollHeight);
    },
  };
}
