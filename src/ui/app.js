// @ts-check
// Verdrahtet Zustand und Oberfläche: Plattenschrank (Regal-Zeilen), Einrichten,
// Statusanzeige, Mini-Player und Plattenspieler. Die UI liest nur den Zustand
// und meldet Absichten zurück – woher die Daten kommen, weiß sie nicht.

import { h } from './dom.js';
import { createStatus } from './status.js';
import { createCabinetView } from './cabinet-view.js';
import { createOrganizer } from './organizer.js';
import { createRecordPlayer } from './record-player.js';
import { createMiniPlayer } from './mini-player.js';
import { TABS } from '../state/app-state.js';
import { buildRows, defaultShelfConfig } from '../state/shelves.js';

/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/app-state.js').TabId} TabId */
/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('../state/app-state.js').Resource} Resource */
/** @typedef {import('../state/playback.js').PlaybackController} PlaybackController */
/** @typedef {import('./account.js').AccountButton} AccountButton */

/** Rückfall, falls der Browser auf history.back() nicht reagiert. */
const HISTORY_FALLBACK_MS = 600;

/**
 * @param {HTMLElement} root
 * @param {{
 *   store: AppStore,
 *   library: { load: (tab: TabId, opts?: { force?: boolean }) => Promise<void> },
 *   playback: PlaybackController,
 *   account?: AccountButton,
 *   onLogin?: () => void,
 * }} deps
 */
export function createApp(root, { store, library, playback, account, onLogin }) {
  // ---------- Plattenschrank ----------

  const cabinet = createCabinetView({
    onOpen,
    onFocusChange: (rowId) => store.set({ focusRow: rowId }),
    onSetup: () => openOrganizer(),
  });
  const status = createStatus({
    onRetry: () => TABS.forEach((tab) => library.load(tab, { force: true })),
    onLogin,
  });
  const stage = h('main', { class: 'stage', 'aria-label': 'Plattenschrank' }, cabinet.el, status.el);
  // Kein Balken oben – nur ein kleiner Knopf in der Ecke (Einrichten, Abmelden).
  const corner = h('div', { class: 'corner' }, account?.el ?? null);
  const mini = createMiniPlayer({ store, playback, onOpen });
  const menu = h('div', { class: 'menu' }, stage, corner, mini.el);

  const organizer = createOrganizer({ store, onDone: () => closeOrganizer() });
  const player = createRecordPlayer({ store, playback, onRequestClose: requestClose });
  root.replaceChildren(menu, organizer.el, player.el);
  account?.prependActions([{ label: 'Plattenschrank einrichten', onAction: () => openOrganizer() }]);

  // Platz für den Mini-Player schaffen, solange eine Platte läuft.
  store.subscribe((state) => root.classList.toggle('has-mini', state.playback.context !== null));

  function openOrganizer() {
    if (!store.get().shelfConfig) return; // erst wenn die Bibliothek geladen ist
    organizer.open();
    menu.inert = true;
  }

  function closeOrganizer() {
    organizer.close();
    menu.inert = player.isOpen();
    const config = store.get().shelfConfig;
    if (config && !config.setupDone) store.set({ shelfConfig: { ...config, setupDone: true } });
  }

  /** @type {AppState['shelfConfig'] | undefined} */
  let shownConfig;
  /** @type {AppState['library'] | undefined} */
  let shownLibrary;

  /** @param {AppState} state */
  function sync(state) {
    const lib = state.library;

    // Laden nie direkt aus einem Abonnenten heraus (verschachtelte Updates vermeiden).
    for (const tab of TABS) {
      if (lib[tab].status === 'idle') queueMicrotask(() => library.load(tab));
    }

    // Erster Start: Regale vorbelegen (Playlists / Alben) und Einrichten öffnen.
    if (!state.shelfConfig && lib.playlists.status === 'ready' && lib.albums.status === 'ready') {
      queueMicrotask(() => {
        if (store.get().shelfConfig) return;
        store.set({ shelfConfig: defaultShelfConfig(store.get().library) });
        if (lib.playlists.items.length + lib.albums.items.length > 0) openOrganizer();
      });
    }

    if (state.shelfConfig && (state.shelfConfig !== shownConfig || lib !== shownLibrary)) {
      shownConfig = state.shelfConfig;
      shownLibrary = lib;
      cabinet.setRows(buildRows(state.shelfConfig, lib), state.focusRow);
    }

    status.show(cabinetStatus(lib), 'Noch keine Playlists oder Alben in deiner Sammlung.');
  }

  /**
   * Gesamtstatus für die Anzeige: Laden, solange noch nichts da ist; Fehler nur,
   * wenn Playlists UND Alben fehlschlagen (sonst zeigt der Schrank, was da ist).
   * @param {AppState['library']} lib
   * @returns {Resource}
   */
  function cabinetStatus(lib) {
    const parts = [lib.playlists, lib.albums];
    const items = [...lib.playlists.items, ...lib.albums.items];
    if (items.length) return { status: 'ready', items, error: null };
    if (parts.every((r) => r.status === 'error')) return { status: 'error', items: [], error: lib.playlists.error };
    if (parts.some((r) => r.status === 'loading' || r.status === 'idle')) return { status: 'loading', items: [], error: null };
    return { status: 'ready', items: [], error: null };
  }

  store.subscribe(sync);
  sync(store.get());

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
    const sleeve = key ? cabinet.findSleeve(key) : null;
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
      const sleeve = key ? cabinet.findSleeve(key) : null;
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
