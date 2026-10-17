/**
 * Group Name Prompt — inline popover for naming and coloring a tab group.
 * Appears right below the group header it edits; Enter or clicking away saves,
 * Escape cancels.
 */

import { COLOR_KEYS, getColor, applyColorVars, isValidColor } from '../../shared/colors.js';
import { ICONS } from './icons.js';

let active = null;

export function showNamePrompt({ anchor = null, title = '', color = 'blue', onCommit }) {
  dismissNamePrompt();

  let selectedColor = isValidColor(color) ? color : 'blue';
  const el = document.createElement('div');
  el.className = 'group-prompt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Name tab group');
  el.innerHTML = `
    <div class="group-prompt-row">
      <span class="group-prompt-dot"></span>
      <input type="text" class="group-prompt-input" placeholder="Name this group" maxlength="50" autocomplete="off" spellcheck="false">
      <button type="button" class="icon-btn is-sm" data-done title="Done (Enter)" aria-label="Done">${ICONS.check}</button>
    </div>
    <div class="swatch-row is-sm" role="radiogroup" aria-label="Group color"></div>
  `;

  const input = el.querySelector('input');
  input.value = title || '';
  const dot = el.querySelector('.group-prompt-dot');
  const row = el.querySelector('.swatch-row');

  const paint = () => {
    applyColorVars(dot, selectedColor);
    row.querySelectorAll('.swatch').forEach((s) => {
      const on = s.dataset.color === selectedColor;
      s.classList.toggle('is-selected', on);
      s.setAttribute('aria-checked', String(on));
    });
  };

  for (const key of COLOR_KEYS) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.dataset.color = key;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-label', getColor(key).name);
    s.title = getColor(key).name;
    applyColorVars(s, key);
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedColor = key;
      paint();
      input.focus();
    });
    row.appendChild(s);
  }
  paint();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    dismissNamePrompt();
    onCommit?.({ title: value, color: selectedColor });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      done = true;
      dismissNamePrompt();
    }
  });
  el.querySelector('[data-done]').addEventListener('click', (e) => {
    e.stopPropagation();
    commit();
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (anchor?.parentNode) {
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
  } else {
    (document.querySelector('.scroll:not(.hidden)') || document.body).prepend(el);
  }

  const onOutside = (e) => {
    if (!el.contains(e.target)) commit();
  };
  const timer = setTimeout(() => document.addEventListener('pointerdown', onOutside), 50);

  active = {
    el,
    cleanup() {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onOutside);
    }
  };

  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    input.focus();
    input.select();
  });
  return el;
}

export function isNamePromptOpen() {
  return Boolean(active);
}

export function dismissNamePrompt() {
  if (!active) return;
  const { el, cleanup } = active;
  active = null;
  cleanup();
  el.remove();
}
