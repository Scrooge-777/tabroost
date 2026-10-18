/**
 * Options Page Controller
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { sendBackgroundMessage } from '../shared/messages.js';
import { pluralize, timeAgo, escapeHtml } from '../shared/utils.js';
import { ICONS } from '../sidepanel/components/icons.js';
import { confirmDialog } from '../sidepanel/components/dialogs.js';
import { toast, toastError } from '../sidepanel/components/toast.js';

const SITE_ORIGINS = ['http://*/*', 'https://*/*'];

const REASONS = {
  auto: 'Automatic',
  manual: 'Manual',
  'before-import': 'Before import',
  'before-reset': 'Before reset',
  'before-restore': 'Before restoring a backup'
};

const COMMAND_LABELS = {
  _execute_action: 'Open the toolbar popup',
  'open-switcher': 'Open workspace switcher',
  'new-workspace': 'New workspace',
  'switch-to-last-workspace': 'Switch to the previous workspace'
};

class OptionsApp {
  constructor() {
    this.inputs = [...document.querySelectorAll('[data-setting]')];
    this.settings = {};
  }

  async init() {
    document.querySelector('[data-logo]').innerHTML = `${ICONS.logo}<span>Tabroost</span>`;
    document.getElementById('version').textContent = `Tabroost ${chrome.runtime.getManifest().version}`;

    await this.loadSettings();
    this.bindEvents();
    this.renderShortcuts();
    this.renderBackups();
  }

  async loadSettings() {
    try {
      this.settings = await sendBackgroundMessage(MESSAGE_TYPES.GET_SETTINGS) || {};
    } catch (err) {
      toastError(err, 'Could not load settings');
      return;
    }

    // Site features only count as on when the permission is actually granted
    const hasSites = await chrome.permissions.contains({ origins: SITE_ORIGINS }).catch(() => false);
    for (const input of this.inputs) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') {
        input.checked = Boolean(this.settings[key]) && (!input.hasAttribute('data-needs-sites') || hasSites);
      } else {
        input.value = this.settings[key];
      }
    }
  }

  async save(partial) {
    try {
      this.settings = await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: partial });
      toast('Saved', { type: 'success', duration: 1500 });
    } catch (err) {
      toastError(err, 'Could not save settings');
    }
  }

  bindEvents() {
    for (const input of this.inputs) {
      input.addEventListener('change', async () => {
        const key = input.dataset.setting;
        const value = input.type === 'checkbox' ? input.checked : input.value;

        if (input.hasAttribute('data-needs-sites') && value) {
          // Must run directly in the click handler's user gesture
          const granted = await chrome.permissions.request({ origins: SITE_ORIGINS }).catch(() => false);
          if (!granted) {
            input.checked = false;
            toast('Permission to run on websites is needed for this feature.', { type: 'info' });
            return;
          }
        }

        await this.save({ [key]: value });

        // Drop the site permission once no feature needs it
        if (input.hasAttribute('data-needs-sites') && !value && !this.settings.showPagePill && !this.settings.accentBorder) {
          await chrome.permissions.remove({ origins: SITE_ORIGINS }).catch(() => {});
          await sendBackgroundMessage(MESSAGE_TYPES.SYNC_PAGE_FEATURES).catch(() => {});
        }
      });
    }

    document.getElementById('btn-export').addEventListener('click', () => this.exportJson());
    document.getElementById('file-import').addEventListener('change', (e) => this.importJson(e));
    document.getElementById('btn-reset').addEventListener('click', () => this.resetAll());
    document.getElementById('btn-backup-now').addEventListener('click', async () => {
      try {
        await sendBackgroundMessage(MESSAGE_TYPES.CREATE_BACKUP);
        toast('Backup saved', { type: 'success' });
        this.renderBackups();
      } catch (err) {
        toastError(err, 'Backup failed');
      }
    });
    document.getElementById('btn-shortcuts').addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  async renderShortcuts() {
    const list = document.getElementById('shortcut-list');
    const commands = await chrome.commands.getAll().catch(() => []);
    list.innerHTML = commands
      .filter((c) => COMMAND_LABELS[c.name])
      .map((c) => `
        <li>
          <span>${escapeHtml(COMMAND_LABELS[c.name])}</span>
          ${c.shortcut ? `<kbd>${escapeHtml(c.shortcut)}</kbd>` : '<span class="unset">Not set</span>'}
        </li>`)
      .join('');
  }

  async renderBackups() {
    const list = document.getElementById('backup-list');
    let backups = [];
    try {
      backups = await sendBackgroundMessage(MESSAGE_TYPES.LIST_BACKUPS) || [];
    } catch (err) {
      list.innerHTML = `<li class="muted">Could not load backups: ${escapeHtml(err.message)}</li>`;
      return;
    }
    if (!backups.length) {
      list.innerHTML = '<li class="muted">No backups yet.</li>';
      return;
    }
    list.innerHTML = backups.map((b) => `
      <li>
        <span class="backup-meta">
          <span class="backup-when" title="${escapeHtml(new Date(b.createdAt).toLocaleString())}">${escapeHtml(timeAgo(b.createdAt))} · ${escapeHtml(REASONS[b.reason] || b.reason)}</span>
          <span class="backup-what">${pluralize(b.workspaceCount, 'workspace')}, ${pluralize(b.tabCount, 'tab')}</span>
        </span>
        <button type="button" class="btn is-sm" data-restore="${escapeHtml(b.id)}">Restore</button>
      </li>
    `).join('');

    list.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { confirmed } = await confirmDialog({
          title: 'Restore this backup?',
          message: 'Your current workspaces will be replaced. A backup of them is taken first.',
          confirmLabel: 'Restore'
        });
        if (!confirmed) return;
        try {
          const res = await sendBackgroundMessage(MESSAGE_TYPES.RESTORE_BACKUP, { id: btn.dataset.restore });
          toast(`Restored ${pluralize(res.count, 'workspace')}`, { type: 'success' });
          this.renderBackups();
        } catch (err) {
          toastError(err, 'Restore failed');
        }
      });
    });
  }

  async exportJson() {
    try {
      const data = await sendBackgroundMessage(MESSAGE_TYPES.EXPORT);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspaces-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${pluralize(Object.keys(data.workspaces || {}).length, 'workspace')}`, { type: 'success' });
    } catch (err) {
      toastError(err, 'Export failed');
    }
  }

  async importJson(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';

    try {
      const payload = JSON.parse(await file.text());
      if (mode === 'replace') {
        const { confirmed } = await confirmDialog({
          title: 'Replace all workspaces?',
          message: 'Every current workspace is replaced by the file contents. A backup is taken first.',
          confirmLabel: 'Replace',
          danger: true
        });
        if (!confirmed) return;
      }
      const res = await sendBackgroundMessage(MESSAGE_TYPES.IMPORT, { payload, mode });
      toast(`Imported ${pluralize(res.count, 'workspace')}`, { type: 'success' });
      await this.loadSettings();
      this.renderBackups();
    } catch (err) {
      toastError(err, err instanceof SyntaxError ? 'That file is not valid JSON' : 'Import failed');
    } finally {
      input.value = '';
    }
  }

  async resetAll() {
    const { confirmed } = await confirmDialog({
      title: 'Reset everything?',
      message: 'All workspaces and settings are deleted. You can bring them back from Backups.',
      confirmLabel: 'Reset',
      danger: true
    });
    if (!confirmed) return;
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.RESET_ALL);
      await this.loadSettings();
      this.renderBackups();
      toast('Everything was reset', { type: 'success' });
    } catch (err) {
      toastError(err, 'Reset failed');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsApp().init();
});
