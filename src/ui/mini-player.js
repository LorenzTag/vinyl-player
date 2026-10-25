// @ts-check
// Mini-Player in der Sammlung: erscheint, solange eine Platte läuft (auch
// pausiert). Antippen öffnet den Plattenspieler wieder, dazu Pause/Weiter.

import { h, svg, clamp } from './dom.js';
import { createCover } from './cover-art.js';

/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('../state/playback.js').PlaybackController} PlaybackController */

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.8" y="6" width="2.2" height="12" rx="1" fill="currentColor"/><path d="M5 6.2v11.6L15 12z" fill="currentColor"/></svg>';

/**
 * @param {{
 *   store: AppStore,
 *   playback: PlaybackController,
 *   onOpen: (item: DisplayItem, thumb: HTMLElement, origin: HTMLElement) => void,
 * }} deps
 */
export function createMiniPlayer({ store, playback, onOpen }) {
  const thumb = h('div', { class: 'mini__thumb' });
  const title = h('div', { class: 'mini__title' });
  const subtitle = h('div', { class: 'mini__subtitle' });
  const openButton = h('button', { type: 'button', class: 'mini__open' },
    thumb,
    h('span', { class: 'mini__text' }, title, subtitle),
  );
  const toggle = h('button', { type: 'button', class: 'mini__btn mini__btn--main' });
  const next = h('button', { type: 'button', class: 'mini__btn', 'aria-label': 'Nächster Titel' });
  next.append(svg(ICON_NEXT));
  const fill = h('div', { class: 'mini__progress-fill' });
  const el = h('div', { class: 'mini', hidden: true, role: 'region', 'aria-label': 'Läuft gerade' },
    openButton, toggle, next,
    h('div', { class: 'mini__progress', 'aria-hidden': 'true' }, fill),
  );

  /** @type {string | null} */
  let shownContext = null;
  let ticker = 0;

  openButton.addEventListener('click', () => {
    const { context } = store.get().playback;
    if (context) onOpen({ key: context.id, record: context, playedAt: null }, thumb, el);
  });
  toggle.addEventListener('click', () => {
    const { playback: pb } = store.get();
    if (pb.playing) playback.pause();
    else playback.resume();
  });
  next.addEventListener('click', () => playback.next());

  function tick() {
    const pb = store.get().playback;
    const track = pb.tracks[pb.index] ?? pb.track;
    if (!track?.durationMs) return;
    const pos = pb.playing ? pb.positionMs + (Date.now() - pb.at) : pb.positionMs;
    fill.style.transform = `scaleX(${clamp(pos / track.durationMs, 0, 1).toFixed(4)})`;
  }

  /** @param {AppState} state */
  function render(state) {
    const pb = state.playback;
    const context = pb.context;
    el.hidden = !context;
    if (!context) {
      shownContext = null;
      clearInterval(ticker);
      ticker = 0;
      return;
    }
    if (shownContext !== context.id) {
      shownContext = context.id;
      thumb.replaceChildren(createCover(context));
    }
    const track = pb.tracks[pb.index] ?? pb.track;
    title.textContent = track?.title ?? context.title;
    subtitle.textContent = track ? `${track.artists} · ${context.title}` : context.subtitle;
    openButton.setAttribute('aria-label', `Plattenspieler öffnen: ${title.textContent}`);
    toggle.replaceChildren(svg(pb.playing ? ICON_PAUSE : ICON_PLAY));
    toggle.setAttribute('aria-label', pb.playing ? 'Pause' : 'Abspielen');
    el.classList.toggle('is-playing', pb.playing);
    if (!ticker) ticker = window.setInterval(tick, 1000);
    tick();
  }

  store.subscribe(render);
  render(store.get());

  return { el, thumb: () => thumb };
}
