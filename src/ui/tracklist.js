// @ts-check
// Titelliste als Seite rechts neben dem Plattenteller. Ein- und Ausfahren
// (per Wischgeste, dem Finger folgend) steuert der Plattenspieler; diese
// Komponente zeichnet nur die Liste. Ein Titel antippen spielt genau diesen.
//
// Bei Zufallswiedergabe zeigt sie zuerst „Als Nächstes" in Spotifys
// gemischter Reihenfolge (Warteschlange), darunter alle Titel der Platte.

import { h, clamp } from './dom.js';
import { formatDuration } from './format.js';

/** @typedef {import('../data/types.js').Track} Track */

/**
 * @typedef {Object} TracklistView
 * @property {string} recordTitle
 * @property {Track[]} tracks         alle Titel der Platte (Original-Reihenfolge)
 * @property {number} current         Index des laufenden Titels in `tracks`, -1 = keiner
 * @property {Track | null} nowPlaying
 * @property {boolean} playing
 * @property {boolean} shuffle
 * @property {Track[]} queue          als Nächstes (echte Reihenfolge)
 * @property {'idle' | 'loading' | 'ready' | 'error'} status
 * @property {string} [error]
 */

/**
 * @param {{ onSelect: (target: { index: number } | { uri: string }) => void, onClose: () => void }} handlers
 */
export function createTracklist({ onSelect, onClose }) {
  const list = h('ol', { class: 'tracklist__list' });
  const queueList = h('ol', { class: 'tracklist__list' });
  const nowList = h('ol', { class: 'tracklist__list' });
  const shuffleSection = h('section', { class: 'tracklist__section', hidden: true },
    h('h4', { class: 'tracklist__section-title' }, 'Läuft gerade'),
    nowList,
    h('h4', { class: 'tracklist__section-title' }, 'Als Nächstes · Zufallswiedergabe'),
    queueList,
  );
  const allTitle = h('h4', { class: 'tracklist__section-title', hidden: true }, 'Alle Titel');
  const subtitle = h('div', { class: 'tracklist__subtitle' });
  const badge = h('span', { class: 'tracklist__badge', hidden: true }, 'Zufall');
  const message = h('p', { class: 'tracklist__message', hidden: true });
  const scroller = h('div', { class: 'tracklist__scroll' }, shuffleSection, allTitle, message, list);
  const el = h('aside', { class: 'tracklist tex-paper', 'aria-label': 'Titelliste', inert: true },
    h('div', { class: 'tracklist__header' },
      h('div', { class: 'tracklist__heading' },
        h('h3', { class: 'tracklist__title' }, 'Titelliste', badge),
        subtitle,
      ),
      h('button', { type: 'button', class: 'tracklist__close', 'aria-label': 'Titelliste schließen', onclick: onClose }, '›'),
    ),
    scroller,
  );

  /** @type {Track[] | null} */
  let shownTracks = null;
  let shownIndex = -1;
  let shownQueueKey = '';

  scroller.addEventListener('click', (event) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.tracklist__item'));
    if (!row) return;
    if (row.dataset.uri) onSelect({ uri: row.dataset.uri });
    else onSelect({ index: Number(row.dataset.index) });
  });

  /**
   * @param {Track} track
   * @param {string} label  Nummer bzw. Zeichen links
   * @param {Record<string, string>} data
   */
  function row(track, label, data) {
    return h('li', {},
      h('button', { type: 'button', class: 'tracklist__item', dataset: data },
        h('span', { class: 'tracklist__no' }, label),
        h('span', { class: 'tracklist__text' },
          h('span', { class: 'tracklist__name' }, track.title),
          h('span', { class: 'tracklist__artist' }, track.artists),
        ),
        h('span', { class: 'tracklist__time' }, formatDuration(track.durationMs)),
      ),
    );
  }

  /** @param {TracklistView} view */
  function render(view) {
    subtitle.textContent = view.recordTitle;
    badge.hidden = !view.shuffle;
    message.hidden = view.tracks.length > 0;
    message.textContent = view.status === 'error'
      ? view.error ?? 'Die Titelliste ließ sich nicht laden.'
      : view.status === 'ready' ? 'Auf dieser Platte sind keine Titel.' : 'Titel werden geladen …';

    // Zufallswiedergabe: „Läuft gerade" + „Als Nächstes" in Spotifys Reihenfolge
    const showShuffle = view.shuffle && (view.queue.length > 0 || !!view.nowPlaying);
    shuffleSection.hidden = !showShuffle;
    allTitle.hidden = !showShuffle;
    if (showShuffle) {
      const key = `${view.nowPlaying?.uri ?? ''}|${view.queue.map((t) => t.uri).join(',')}|${view.playing}`;
      if (key !== shownQueueKey) {
        shownQueueKey = key;
        nowList.replaceChildren(...(view.nowPlaying ? [row(view.nowPlaying, '', { uri: view.nowPlaying.uri })] : []));
        nowList.querySelector('.tracklist__item')?.classList.add('is-current', ...(view.playing ? ['is-playing'] : []));
        queueList.replaceChildren(...view.queue.map((track, i) => row(track, String(i + 1), { uri: track.uri })));
      }
    } else {
      shownQueueKey = '';
    }

    // Alle Titel in Original-Reihenfolge
    if (view.tracks !== shownTracks) {
      shownTracks = view.tracks;
      shownIndex = -1;
      list.replaceChildren(...view.tracks.map((track, i) => row(track, String(i + 1), { index: String(i) })));
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

    /** Zum laufenden Titel scrollen (bei Shuffle: nach oben zu „Als Nächstes"). */
    revealCurrent() {
      if (!shuffleSection.hidden) {
        scroller.scrollTop = 0;
        return;
      }
      const current = /** @type {HTMLElement | null} */ (list.querySelector('.tracklist__item.is-current'));
      if (current) scroller.scrollTop = clamp(current.offsetTop - scroller.clientHeight / 3, 0, scroller.scrollHeight);
    },
  };
}
