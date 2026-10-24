/**
 * Dialogs — workspace create/edit form and confirmation prompts, built on <dialog>
 * (native focus trapping, Escape to cancel, ::backdrop).
 */

import { renderColorPicker } from './color-picker.js';
import { ICONS } from './icons.js';
import { escapeHtml, pluralize, timeAgo } from '../../shared/utils.js';
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
  notes = '',
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

      <div class="field">
        <label for="dlg-ws-notes">Notes <span class="muted">(optional)</span></label>
        <textarea id="dlg-ws-notes" name="notes" class="notes-input" rows="2" maxlength="500" placeholder="What is this workspace for? Next steps, links to remember…" spellcheck="true">${escapeHtml(notes)}</textarea>
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
        notes: form.elements.notes?.value || '',
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

const REASON_LABELS = {
  auto: 'Automatic',
  manual: 'Saved by you',
  closed: 'Window closed',
  'before-restore': 'Before a restore',
  'sync-conflict': 'Replaced by sync'
};

/**
 * Version history of one workspace.
 * Resolves to { action: 'restore', versionId } | { action: 'save' } | null when closed.
 */
export function openHistoryDialog({ name, versions }) {
  const rows = versions.map((v) => {
    const change = v.first ? '' : ` · +${v.added} −${v.removed}`;
    return `
      <li class="history-row">
        <div class="history-main">
          <span class="history-time">${escapeHtml(timeAgo(v.at))}</span>
          <span class="history-meta">${escapeHtml(pluralize(v.tabCount, 'tab'))}${change} · ${escapeHtml(REASON_LABELS[v.reason] || v.reason)}</span>
        </div>
        <button type="button" class="btn is-sm" data-restore="${escapeHtml(v.id)}">Restore</button>
      </li>`;
  }).join('');

  const dialog = mountDialog(`
    <form method="dialog" class="dialog-body">
      <header class="dialog-head">
        <h2>History · ${escapeHtml(name)}</h2>
        <button type="button" class="icon-btn" data-cancel aria-label="Close">${ICONS.close}</button>
      </header>
      <p class="dialog-text">Versions are saved as you work (at most every 10 minutes), when the window closes, and before a restore. The newest 20 are kept.</p>
      ${versions.length ? `<ul class="history-list">${rows}</ul>` : '<p class="muted">No versions yet. Use "Save version now" to create one.</p>'}
      <footer class="dialog-actions">
        <button type="button" class="btn" data-save>Save version now</button>
        <button type="submit" value="done" class="btn is-primary">Done</button>
      </footer>
    </form>
  `);

  return new Promise((resolve) => {
    let result = null;
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
    dialog.querySelector('[data-save]').addEventListener('click', () => {
      result = { action: 'save' };
      dialog.close('save');
    });
    dialog.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', () => {
        result = { action: 'restore', versionId: btn.dataset.restore };
        dialog.close('restore');
      });
    });
    dialog.addEventListener('close', () => resolve(result));
    dialog.showModal();
  });
}
