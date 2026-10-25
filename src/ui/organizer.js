// @ts-check
// „Plattenschrank einrichten": Regale anlegen, umbenennen, sortieren, löschen
// und Platten einsortieren. Bedienung per Antippen (zuverlässiger als Ziehen
// auf dem iPad): Platten auswählen → unten das Ziel-Regal wählen.
//
// Jede Änderung wird sofort gespeichert; „Fertig" schließt nur.

import { h } from './dom.js';
import { createCover } from './cover-art.js';
import { addShelf, assign, moveShelf, removeShelf, renameShelf, recordsByUri } from '../state/shelves.js';

/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/shelves.js').ShelfConfig} ShelfConfig */
/** @typedef {import('../data/types.js').RecordItem} RecordItem */

/**
 * @param {{ store: AppStore, onDone: () => void }} deps
 */
export function createOrganizer({ store, onDone }) {
  const shelfList = h('ol', { class: 'organizer__shelves' });
  const recentToggle = h('input', { type: 'checkbox', class: 'organizer__check' });
  const sections = h('div', { class: 'organizer__sections' });
  const selectionLabel = h('span', { class: 'organizer__count' });
  const targets = h('div', { class: 'organizer__targets' });
  const actions = h('div', { class: 'organizer__actions', hidden: true },
    selectionLabel,
    h('span', { class: 'organizer__into' }, 'Einsortieren in:'),
    targets,
    h('button', { type: 'button', class: 'organizer__clear', onclick: () => clearSelection() }, 'Auswahl aufheben'),
  );

  const el = h('div', { class: 'organizer', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'organizer-title' },
    h('header', { class: 'organizer__header' },
      h('div', {},
        h('h2', { class: 'organizer__title', id: 'organizer-title' }, 'Plattenschrank einrichten'),
        h('p', { class: 'organizer__hint' },
          'Jede Zeile im Schrank ist ein Regal. Tippe Platten an und wähle unten, in welches Regal sie gehören.'),
      ),
      h('button', { type: 'button', class: 'button organizer__done', onclick: () => onDone() }, 'Fertig'),
    ),
    h('div', { class: 'organizer__body' },
      h('aside', { class: 'organizer__side' },
        h('h3', { class: 'organizer__side-title' }, 'Regale'),
        shelfList,
        h('button', { type: 'button', class: 'organizer__add', onclick: () => createShelf() }, '+ Neues Regal'),
        h('label', { class: 'organizer__option' }, recentToggle, h('span', {}, '„Zuletzt gehört" als oberste Zeile')),
      ),
      h('main', { class: 'organizer__main' }, sections),
    ),
    actions,
  );

  /** ausgewählte Platten (URIs) */
  const selected = new Set();
  /** Regal, dessen Name gerade bearbeitet wird */
  /** @type {string | null} */
  let editing = null;

  /** @returns {ShelfConfig} */
  const config = () => /** @type {ShelfConfig} */ (store.get().shelfConfig);
  /** @param {ShelfConfig} next */
  const save = (next) => store.set({ shelfConfig: next });

  recentToggle.addEventListener('change', () => save({ ...config(), showRecent: recentToggle.checked }));

  function createShelf() {
    const { config: next, id } = addShelf(config(), 'Neues Regal');
    editing = id;
    save(next);
  }

  function clearSelection() {
    selected.clear();
    render();
  }

  /** @param {string | null} shelfId */
  function moveSelection(shelfId) {
    if (!selected.size) return;
    save(assign(config(), [...selected], shelfId));
    selected.clear();
    render();
  }

  // ---------- Darstellung ----------

  function renderShelves() {
    const cfg = config();
    const items = cfg.shelves.map((shelf, i) => {
      const name = editing === shelf.id
        ? h('input', { class: 'organizer__name-input', value: shelf.name, maxlength: '40', 'aria-label': 'Name des Regals' })
        : h('button', { type: 'button', class: 'organizer__name', title: 'Umbenennen', onclick: () => { editing = shelf.id; renderShelves(); } }, shelf.name);
      if (name instanceof HTMLInputElement) {
        const commit = () => {
          if (editing !== shelf.id) return;
          editing = null;
          save(renameShelf(config(), shelf.id, name.value));
        };
        name.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') { editing = null; renderShelves(); }
        });
        name.addEventListener('blur', commit);
        queueMicrotask(() => { name.focus(); name.select(); });
      }
      return h('li', { class: 'organizer__shelf' },
        name,
        h('span', { class: 'organizer__shelf-count' }, String(shelf.uris.length)),
        h('button', { type: 'button', class: 'organizer__icon', 'aria-label': `${shelf.name} nach oben`, disabled: i === 0, onclick: () => save(moveShelf(config(), shelf.id, -1)) }, '↑'),
        h('button', { type: 'button', class: 'organizer__icon', 'aria-label': `${shelf.name} nach unten`, disabled: i === cfg.shelves.length - 1, onclick: () => save(moveShelf(config(), shelf.id, 1)) }, '↓'),
        h('button', { type: 'button', class: 'organizer__icon organizer__icon--danger', 'aria-label': `${shelf.name} entfernen (Platten werden nicht gelöscht)`, onclick: () => save(removeShelf(config(), shelf.id)) }, '✕'),
      );
    });
    shelfList.replaceChildren(...items);
    recentToggle.checked = cfg.showRecent;
  }

  /** @param {RecordItem} record */
  function tile(record) {
    const isSelected = selected.has(record.uri);
    const button = h('button', {
      type: 'button',
      class: `organizer__tile${isSelected ? ' is-selected' : ''}`,
      'aria-pressed': String(isSelected),
      'aria-label': `${record.title} – ${record.subtitle}`,
    },
      h('span', { class: 'organizer__cover' }, createCover(record)),
      h('span', { class: 'organizer__tile-title' }, record.title),
      h('span', { class: 'organizer__tile-sub' }, record.subtitle),
    );
    button.addEventListener('click', () => {
      if (selected.has(record.uri)) selected.delete(record.uri);
      else selected.add(record.uri);
      button.classList.toggle('is-selected', selected.has(record.uri));
      button.setAttribute('aria-pressed', String(selected.has(record.uri)));
      renderActions();
    });
    return button;
  }

  function renderSections() {
    const cfg = config();
    const { library } = store.get();
    const records = recordsByUri(library);
    const placed = new Set();
    /** @type {Array<{ name: string, records: RecordItem[], unsorted?: boolean }>} */
    const groups = cfg.shelves.map((shelf) => ({
      name: shelf.name,
      records: shelf.uris.flatMap((uri) => {
        const record = records.get(uri);
        if (!record || placed.has(uri)) return [];
        placed.add(uri);
        return [record];
      }),
    }));
    const unsorted = [...records.values()].filter((r) => !placed.has(r.uri));
    if (unsorted.length) groups.unshift({ name: 'Nicht einsortiert', records: unsorted, unsorted: true });

    sections.replaceChildren(...groups.map((group) =>
      h('section', { class: `organizer__section${group.unsorted ? ' is-unsorted' : ''}` },
        h('h3', { class: 'organizer__section-title' }, group.name, h('span', {}, ` · ${group.records.length}`)),
        group.records.length
          ? h('div', { class: 'organizer__grid' }, ...group.records.map(tile))
          : h('p', { class: 'organizer__empty' }, 'Noch leer – Platten auswählen und unten dieses Regal wählen.'),
      )));
  }

  function renderActions() {
    actions.hidden = selected.size === 0;
    selectionLabel.textContent = `${selected.size} ausgewählt`;
    targets.replaceChildren(
      ...config().shelves.map((shelf) =>
        h('button', { type: 'button', class: 'organizer__target', onclick: () => moveSelection(shelf.id) }, shelf.name)),
      h('button', { type: 'button', class: 'organizer__target organizer__target--plain', onclick: () => moveSelection(null) }, 'Nicht einsortiert'),
    );
  }

  function render() {
    if (el.hidden || !store.get().shelfConfig) return;
    renderShelves();
    renderSections();
    renderActions();
  }

  // Bei Änderungen (Regale, Bibliothek) neu zeichnen – Auswahl bleibt erhalten.
  store.subscribe((state, prev) => {
    if (state.shelfConfig !== prev.shelfConfig || state.library !== prev.library) render();
  });

  return {
    el,
    isOpen: () => !el.hidden,
    open() {
      selected.clear();
      editing = null;
      el.hidden = false;
      render();
    },
    close() {
      el.hidden = true;
      selected.clear();
    },
  };
}
