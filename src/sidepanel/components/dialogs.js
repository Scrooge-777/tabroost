/**
 * Dialogs — workspace create/edit form and confirmation prompts, built on <dialog>
 * (native focus trapping, Escape to cancel, ::backdrop).
 */

import { renderColorPicker } from './color-picker.js';
import { ICONS } from './icons.js';
import { escapeHtml, pluralize } from '../../shared/utils.js';
import { applyColorVars } from '../../shared/colors.js';

const EMOJI_PRESETS = ['💼', '📚', '🎓', '💻', '🚀', '🎨', '🏠', '🛒', '💰', '✈️', '🎮', '🎵', '🧪', '📝', '❤️', '⭐'];

function mountDialog(html, className = '') {
  const dialog = document.createElement('dialog');
  dialog.className = `dialog ${className}`;
  dialog.innerHTML = html;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 0));
  // Click on the backdrop cancels
  dialog.addEventListener('pointerdown', (e) => {
    if (e.target === dialog) dialog.close('cancel');
  });
  return dialog;
}

/**
 * Create / edit a workspace.
 * Resolves to { name, color, icon, includeTabs } or null when cancelled.
 */
export function openWorkspaceDialog({
  mode = 'create',
  name = '',
  color = 'blue',
  icon = '',
  includeTabs = false,
  tabCount = 0,
  canIncludeTabs = true
} = {}) {
  const isCreate = mode === 'create';
  const dialog = mountDialog(`
    <form method="dialog" class="dialog-body">
      <header class="dialog-head">
        <h2>${isCreate ? 'New workspace' : 'Edit workspace'}</h2>
        <button type="button" class="icon-btn" data-cancel aria-label="Close">${ICONS.close}</button>
      </header>

      <div class="ws-preview">
        <span class="ws-avatar is-lg" data-preview-avatar></span>
        <div class="field grow">
          <label for="dlg-ws-name">Name</label>
          <input id="dlg-ws-name" name="name" type="text" maxlength="60" required autocomplete="off" spellcheck="false" value="${escapeHtml(name)}">
        </div>
      </div>

      <div class="field">
        <span class="label">Color</span>
        <div data-colors></div>
      </div>

      <div class="field">
        <span class="label">Icon <span class="muted">(optional)</span></span>
        <div class="emoji-row" role="radiogroup" aria-label="Icon">
          <button type="button" class="emoji-btn" data-emoji="" aria-label="No icon" title="Use the first letter">Aa</button>
          ${EMOJI_PRESETS.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}
        </div>
      </div>

      ${isCreate && canIncludeTabs ? `
        <label class="check">
          <input type="checkbox" name="includeTabs" ${includeTabs ? 'checked' : ''}>
          <span>Move this window's ${pluralize(tabCount, 'tab')} into the workspace</span>
        </label>` : ''}

      <footer class="dialog-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" class="btn is-primary">${isCreate ? 'Create' : 'Save'}</button>
      </footer>
    </form>
  `);

  const form = dialog.querySelector('form');
  const nameInput = dialog.querySelector('#dlg-ws-name');
  const avatar = dialog.querySelector('[data-preview-avatar]');
  let selectedIcon = icon || '';

  const picker = renderColorPicker({ selectedColor: color, onSelect: () => updatePreview(), label: 'Workspace color' });
  dialog.querySelector('[data-colors]').appendChild(picker.element);

  const emojiButtons = [...dialog.querySelectorAll('.emoji-btn')];
  const syncEmoji = () => {
    emojiButtons.forEach((b) => {
      const on = b.dataset.emoji === selectedIcon;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  emojiButtons.forEach((b) => b.addEventListener('click', () => {
    selectedIcon = b.dataset.emoji;
    syncEmoji();
    updatePreview();
  }));

  function updatePreview() {
    applyColorVars(avatar, picker.getSelected());
    avatar.textContent = selectedIcon || (nameInput.value.trim().charAt(0).toUpperCase() || 'W');
  }
  nameInput.addEventListener('input', updatePreview);
  syncEmoji();
  updatePreview();

  return new Promise((resolve) => {
    let result = null;
    dialog.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => dialog.close('cancel')));
    form.addEventListener('submit', (e) => {
      const value = nameInput.value.trim();
      if (!value) {
        e.preventDefault();
        nameInput.focus();
        return;
      }
      result = {
        name: value,
        color: picker.getSelected(),
        icon: selectedIcon,
        includeTabs: Boolean(form.elements.includeTabs?.checked)
      };
    });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'cancel' ? null : result));
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  });
}

/**
 * Confirmation prompt. Resolves to { confirmed, checked }.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  checkboxLabel = null
}) {
  const dialog = mountDialog(`
    <form method="dialog" class="dialog-body">
      <header class="dialog-head"><h2>${escapeHtml(title)}</h2></header>
      <p class="dialog-text">${escapeHtml(message)}</p>
      ${checkboxLabel ? `<label class="check"><input type="checkbox" name="extra"><span>${escapeHtml(checkboxLabel)}</span></label>` : ''}
      <footer class="dialog-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" value="confirm" class="btn ${danger ? 'is-danger' : 'is-primary'}">${escapeHtml(confirmLabel)}</button>
      </footer>
    </form>
  `, 'is-compact');

  return new Promise((resolve) => {
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('close', () => {
      resolve({
        confirmed: dialog.returnValue === 'confirm',
        checked: Boolean(dialog.querySelector('input[name="extra"]')?.checked)
      });
    });
    dialog.showModal();
    dialog.querySelector('button[type="submit"]').focus();
  });
}
