/**
 * Toast notifications with an optional action (e.g. Undo)
 */

import { escapeHtml } from '../../shared/utils.js';
import { ICONS } from './icons.js';

let root = null;

function ensureRoot() {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.className = 'toast-root';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  document.body.appendChild(root);
  return root;
}

export function toast(message, { action = null, type = 'info', duration = 4000 } = {}) {
  const container = ensureRoot();
  const el = document.createElement('div');
  el.className = `toast is-${type}`;
  el.innerHTML = `
    <span class="toast-msg">${escapeHtml(message)}</span>
    ${action ? `<button type="button" class="toast-action">${action.icon ? ICONS[action.icon] : ''}<span>${escapeHtml(action.label)}</span></button>` : ''}
    <button type="button" class="toast-close" aria-label="Dismiss">${ICONS.close}</button>
  `;

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  };

  el.querySelector('.toast-close').addEventListener('click', dismiss);
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', async () => {
      dismiss();
      await action.onClick?.();
    });
  }

  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => {
    timer = setTimeout(dismiss, 1500);
  });

  // Keep at most three toasts on screen
  while (container.children.length >= 3) container.firstElementChild.remove();
  container.appendChild(el);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function toastError(err, prefix = 'Something went wrong') {
  const message = err?.message ? `${prefix}: ${err.message}` : prefix;
  return toast(message, { type: 'error', duration: 6000 });
}
