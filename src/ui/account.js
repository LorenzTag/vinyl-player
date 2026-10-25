// @ts-check
// Konto-Knopf in der Kopfleiste: zeigt, wer angemeldet ist (bzw. Demo), und
// bietet Abmelden / Demo beenden an.

import { h } from './dom.js';

/**
 * @param {{ label: string, detail: string, actionLabel: string, onAction: () => void }} options
 */
export function createAccountButton({ label, detail, actionLabel, onAction }) {
  const initial = h('span', { class: 'account__initial', 'aria-hidden': 'true' }, (label.trim()[0] ?? '?').toUpperCase());
  const button = h('button', {
    type: 'button',
    class: 'account__button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-label': `Konto: ${label}`,
  }, initial);
  const name = h('div', { class: 'account__name' }, label);
  const menu = h('div', { class: 'account__menu tex-paper', hidden: true, role: 'menu' },
    name,
    h('div', { class: 'account__detail' }, detail),
    h('button', { type: 'button', class: 'account__action', role: 'menuitem', onclick: () => { close(); onAction(); } }, actionLabel),
  );
  const el = h('div', { class: 'account' }, button, menu);

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

  return {
    el,
    /** Anzeigenamen nachträglich setzen (Profil kommt asynchron) */
    setLabel(/** @type {string} */ text) {
      name.textContent = text;
      initial.textContent = (text.trim()[0] ?? '?').toUpperCase();
      button.setAttribute('aria-label', `Konto: ${text}`);
    },
  };
}
