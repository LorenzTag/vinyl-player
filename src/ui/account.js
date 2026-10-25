// @ts-check
// Knopf in der Ecke: zeigt, wer angemeldet ist (bzw. Demo), und bietet die
// Einträge „Plattenschrank einrichten" und Abmelden / Demo beenden.

import { h } from './dom.js';

/**
 * @typedef {{ label: string, onAction: () => void, danger?: boolean }} MenuAction
 */

/**
 * @param {{ label: string, detail: string, actions: MenuAction[] }} options
 */
export function createAccountButton({ label, detail, actions }) {
  const initial = h('span', { class: 'account__initial', 'aria-hidden': 'true' }, (label.trim()[0] ?? '?').toUpperCase());
  const button = h('button', {
    type: 'button',
    class: 'account__button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-label': `Menü – ${label}`,
  }, initial);
  const name = h('div', { class: 'account__name' }, label);
  /** Einträge, die die App später hinzufügt (z. B. „Plattenschrank einrichten") */
  const list = h('div', { class: 'account__actions' });
  const menu = h('div', { class: 'account__menu tex-paper', hidden: true, role: 'menu' },
    name,
    h('div', { class: 'account__detail' }, detail),
    list,
  );
  const el = h('div', { class: 'account' }, button, menu);

  /** @type {MenuAction[]} */
  let current = actions;

  function renderActions() {
    list.replaceChildren(...current.map((action) =>
      h('button', {
        type: 'button',
        class: `account__action${action.danger ? ' account__action--quiet' : ''}`,
        role: 'menuitem',
        onclick: () => { close(); action.onAction(); },
      }, action.label)));
  }

  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!el.contains(/** @type {Node} */ (event.target))) close();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  renderActions();

  return {
    el,
    /** Anzeigenamen nachträglich setzen (Profil kommt asynchron) */
    setLabel(/** @type {string} */ text) {
      name.textContent = text;
      initial.textContent = (text.trim()[0] ?? '?').toUpperCase();
      button.setAttribute('aria-label', `Menü – ${text}`);
    },
    /** Einträge vorn ergänzen */
    prependActions(/** @type {MenuAction[]} */ extra) {
      current = [...extra, ...current];
      renderActions();
    },
  };
}

/** @typedef {ReturnType<typeof createAccountButton>} AccountButton */
