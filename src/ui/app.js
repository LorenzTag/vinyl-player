// @ts-check
// Verdrahtet Zustand und Oberfläche: Kopfleiste, aktuelle Ansicht (Regal oder
// Stapel), Statusanzeige und Plattenteller-Ebene. Die UI liest nur den Zustand
// und meldet Absichten zurück – woher die Daten kommen, weiß sie nicht.

import { h, svg } from './dom.js';
import { createSegmented } from './segmented.js';
import { createStatus } from './status.js';
import { createShelfView } from './shelf-view.js';
import { createCrateView } from './crate-view.js';
import { createRecordPlayer } from './record-player.js';
import { createMiniPlayer } from './mini-player.js';

/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/app-state.js').TabId} TabId */
/** @typedef {import('../state/app-state.js').LayoutId} LayoutId */
/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('./view-types.js').View} View */
/** @typedef {import('../state/playback.js').PlaybackController} PlaybackController */

const ICON_SHELF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="4.5" height="5.5" rx="0.6"/><rect x="9.8" y="4" width="4.5" height="5.5" rx="0.6"/><rect x="16" y="4" width="4.5" height="5.5" rx="0.6"/><path d="M2 11.5h20"/><rect x="3.5" y="13.5" width="4.5" height="5.5" rx="0.6"/><rect x="9.8" y="13.5" width="4.5" height="5.5" rx="0.6"/><path d="M2 21h20"/></svg>';
const ICON_CRATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="7.5" y="6.5" width="9" height="11" rx="0.8"/><path d="M5.3 8.2 2.5 9.3v5.4l2.8 1.1z"/><path d="M18.7 8.2l2.8 1.1v5.4l-2.8 1.1z"/></svg>';

/** Rückfall, falls der Browser auf history.back() nicht reagiert. */
const HISTORY_FALLBACK_MS = 600;

/**
 * @param {HTMLElement} root
 * @param {{
 *   store: AppStore,
 *   library: { load: (tab: TabId, opts?: { force?: boolean }) => Promise<void> },
 *   playback: PlaybackController,
 *   account?: HTMLElement,
 *   onLogin?: () => void,
 * }} deps
 */
export function createApp(root, { store, library, playback, account, onLogin }) {
  const initial = store.get();

  // ---------- Kopfleiste ----------

  const tabs = createSegmented({
    className: 'tabs',
    role: 'tablist',
    label: 'Bibliothek',
    idPrefix: 'tab',
    options: [
      { value: /** @type {TabId} */ ('playlists'), label: 'Playlists' },
      { value: /** @type {TabId} */ ('albums'), label: 'Alben' },
      { value: /** @type {TabId} */ ('recent'), label: 'Zuletzt gehört' },
    ],
    value: initial.tab,
    onChange: (tab) => store.set({ tab }),
  });

  const layoutSwitch = createSegmented({
    className: 'layout-switch',
    role: 'radiogroup',
    label: 'Darstellung',
    idPrefix: 'layout',
    options: [
      { value: /** @type {LayoutId} */ ('crate'), label: 'Stapel', icon: ICON_CRATE },
      { value: /** @type {LayoutId} */ ('shelf'), label: 'Regal', icon: ICON_SHELF },
    ],
    value: initial.layout,
    onChange: (layout) => store.set({ layout }),
  });

  const brand = h('div', { class: 'brand' },
    h('div', { class: 'brand__mark', 'aria-hidden': 'true' }),
    h('div', { class: 'brand__text' },
      h('h1', { class: 'brand__title' }, 'Vinyl'),
      h('span', { class: 'brand__subtitle' }, 'Plattensammlung'),
    ),
  );

  const topbar = h('header', { class: 'topbar' },
    brand,
    tabs.el,
    h('div', { class: 'topbar__end' }, layoutSwitch.el, account ?? null),
  );

  // ---------- Bühne ----------

  const status = createStatus({ onRetry: () => library.load(store.get().tab, { force: true }), onLogin });
  const stage = h('main', { class: 'stage', id: 'collection', role: 'tabpanel' }, status.el);
  const mini = createMiniPlayer({ store, playback, onOpen });
  const menu = h('div', { class: 'menu' }, topbar, stage, mini.el);

  const player = createRecordPlayer({ store, playback, onRequestClose: requestClose });
  root.replaceChildren(menu, player.el);

  // Platz für den Mini-Player schaffen, solange eine Platte läuft.
  store.subscribe((state) => root.classList.toggle('has-mini', state.playback.context !== null));

  /** @type {View | null} */
  let view = null;
  /** @type {LayoutId | null} */
  let viewLayout = null;
  /** @type {TabId | null} */
  let viewTab = null;
  /** @type {DisplayItem[] | null} */
  let viewItems = null;
  /** Je Tab die zuletzt „vorne" stehende Platte */
  /** @type {Map<TabId, string | null>} */
  const anchors = new Map();

  /** @param {AppState} state */
  function sync(state) {
    tabs.setValue(state.tab);
    layoutSwitch.setValue(state.layout);
    stage.setAttribute('aria-labelledby', tabs.idFor(state.tab));

    if (view && viewTab && (state.layout !== viewLayout || state.tab !== viewTab)) {
      anchors.set(viewTab, view.getAnchorKey());
    }

    if (state.layout !== viewLayout) {
      view?.destroy();
      view = state.layout === 'shelf' ? createShelfView({ onOpen }) : createCrateView({ onOpen });
      if (viewLayout !== null) {
        view.el.classList.add('view--entering');
        view.el.addEventListener('animationend', () => view?.el.classList.remove('view--entering'), { once: true });
      }
      stage.prepend(view.el);
      viewLayout = state.layout;
      viewItems = null;
    }

    if (state.tab !== viewTab) {
      viewTab = state.tab;
      viewItems = null;
    }

    const resource = state.library[state.tab];
    if (view && resource.items !== viewItems) {
      view.setItems(resource.items, { anchorKey: anchors.get(state.tab) ?? null });
      viewItems = resource.items;
    }

    status.show(resource, state.tab);

    // Laden nie direkt aus einem Abonnenten heraus (verschachtelte Updates vermeiden).
    if (resource.status === 'idle') queueMicrotask(() => library.load(state.tab));
  }

  store.subscribe(sync);
  sync(initial);

  // ---------- Platte öffnen / schließen ----------

  /**
   * @param {DisplayItem} item
   * @param {HTMLElement} sleeve   sichtbare Hülle (Startpunkt der Animation)
   * @param {HTMLElement} button   wird während der Animation ausgeblendet
   */
  function onOpen(item, sleeve, button) {
    if (player.isOpen()) return;
    store.set({ openRecord: item.record });
    menu.inert = true;
    try {
      history.pushState({ vinyl: 'player' }, '');
    } catch {
      // Ohne History funktioniert „Zurück" trotzdem über den Button.
    }
    player.open(item, sleeve, button);
  }

  /** Wohin die Platte beim Schließen zurückfliegt: Hülle in der Ansicht, sonst Mini-Player. */
  function returnTarget(/** @type {string | null} */ key) {
    const sleeve = key && view ? view.findSleeve(key) : null;
    if (sleeve && isOnScreen(sleeve)) return sleeve;
    const thumb = mini.thumb();
    // Läuft die Platte weiter, erscheint der Mini-Player – dorthin fliegt sie.
    return store.get().playback.context?.id === key && !closeOptions.putAway ? thumb : sleeve;
  }

  /** @param {Element} el */
  function isOnScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  let closing = false;
  let backRequested = false;
  /** @type {{ putAway?: boolean }} */
  let closeOptions = {};

  async function closePlayer() {
    if (closing || !player.isOpen()) return;
    closing = true;
    const record = player.currentRecord();
    const key = player.currentKey();
    try {
      // Platte eingepackt → Wiedergabe beenden. „Sammlung" lässt sie weiterlaufen.
      if (closeOptions.putAway && record && playback.isContext(record)) playback.stop();
      // Mini-Player vor dem Rückflug einblenden, damit er als Ziel bereitsteht.
      root.classList.toggle('has-mini', store.get().playback.context !== null && !closeOptions.putAway);
      await player.close(returnTarget(key));
    } finally {
      menu.inert = false;
      store.set({ openRecord: null });
      const sleeve = key && view ? view.findSleeve(key) : null;
      const focusTarget = sleeve?.closest('button') ?? sleeve;
      focusTarget?.focus({ preventScroll: true });
      closing = false;
      backRequested = false;
      closeOptions = {};
    }
  }

  /** @param {{ putAway?: boolean }} [opts] */
  function requestClose(opts = {}) {
    // Doppeltes Tippen auf „Zurück" darf nicht zweimal history.back() auslösen.
    if (closing || backRequested || !player.isOpen()) return;
    closeOptions = opts;
    if (history.state?.vinyl === 'player') {
      backRequested = true;
      history.back();
      // Sicherheitsnetz: falls popstate ausbleibt, trotzdem schließen.
      setTimeout(() => { if (player.isOpen()) closePlayer(); }, HISTORY_FALLBACK_MS);
    } else {
      closePlayer();
    }
  }

  window.addEventListener('popstate', () => {
    if (player.isOpen()) closePlayer();
  });

  // Nach einem Neuladen nicht in einem „Player"-History-Eintrag hängen bleiben.
  if (history.state?.vinyl === 'player') history.replaceState(null, '');
}
