/**
 * Context Menu Component — floating, keyboard-navigable action menu.
 *
 * items: Array of
 *   { label, icon, danger, disabled, shortcut, onSelect }
 *   { separator: true }
 *   { header: 'Text' }
 *   { colors: { selected, onSelect } }   // swatch strip
 */

import { ICONS } from './icons.js';
import { COLOR_KEYS, getColor, applyColorVars } from '../../shared/colors.js';
import { escapeHtml } from '../../shared/utils.js';

let activeMenu = null;
const closeListeners = new Set();

export function isMenuOpen() {
  return Boolean(activeMenu);
}

/** Called after any menu closes (used to flush renders deferred while it was open) */
export function onMenuClosed(listener) {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

export function showMenu({ x, y, items, anchor = null, label = 'Actions' }) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);

  const focusables = [];
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
    } else if (item.header) {
      const head = document.createElement('div');
      head.className = 'menu-header';
      head.textContent = item.header;
      menu.appendChild(head);
    } else if (item.colors) {
      const strip = document.createElement('div');
      strip.className = 'menu-colors';
      for (const key of COLOR_KEYS) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `swatch${item.colors.selected === key ? ' is-selected' : ''}`;
        dot.setAttribute('role', 'menuitemradio');
        dot.setAttribute('aria-checked', String(item.colors.selected === key));
        dot.setAttribute('aria-label', getColor(key).name);
        dot.title = getColor(key).name;
        applyColorVars(dot, key);
        dot.addEventListener('click', () => {
          closeContextMenu();
          item.colors.onSelect(key);
        });
        strip.appendChild(dot);
        focusables.push(dot);
      }
      menu.appendChild(strip);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `menu-item${item.danger ? ' is-danger' : ''}`;
      btn.setAttribute('role', 'menuitem');
      btn.disabled = Boolean(item.disabled);
      btn.innerHTML = `
        <span class="menu-icon">${item.icon ? ICONS[item.icon] || '' : ''}</span>
        <span class="menu-label">${escapeHtml(item.label)}</span>
        ${item.shortcut ? `<kbd class="menu-kbd">${escapeHtml(item.shortcut)}</kbd>` : ''}
      `;
      btn.addEventListener('click', () => {
        closeContextMenu();
        item.onSelect?.();
      });
      menu.appendChild(btn);
      if (!btn.disabled) focusables.push(btn);
    }
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6));
  const top = y + rect.height > window.innerHeight - 6 ? Math.max(6, y - rect.height - (anchor ? anchor.getBoundingClientRect().height + 8 : 0)) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const previousFocus = document.activeElement;
  const onKey = (e) => {
    const idx = focusables.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    } else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && document.activeElement?.classList.contains('swatch'))) {
      e.preventDefault();
      focusables[(idx + 1) % focusables.length]?.focus();
    } else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && document.activeElement?.classList.contains('swatch'))) {
      e.preventDefault();
      focusables[(idx - 1 + focusables.length) % focusables.length]?.focus();
    } else if (e.key === 'Tab') {
      closeContextMenu();
    }
  };
  const onPointer = (e) => {
    if (!menu.contains(e.target)) closeContextMenu();
  };

  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onPointer, true), 0);
  window.addEventListener('blur', closeContextMenu, { once: true });

  activeMenu = {
    el: menu,
    cleanup() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus?.({ preventScroll: true });
    }
  };
  requestAnimationFrame(() => focusables[0]?.focus());
  return menu;
}

export function showMenuForButton(button, items, label) {
  const rect = button.getBoundingClientRect();
  return showMenu({ x: rect.right - 200, y: rect.bottom + 4, items, anchor: button, label });
}

export function closeContextMenu() {
  if (activeMenu) {
    const { el, cleanup } = activeMenu;
    activeMenu = null;
    el.remove();
    cleanup();
    closeListeners.forEach((fn) => fn());
  }
}
