/**
 * Options Page Controller
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { sendBackgroundMessage } from '../shared/messages.js';
import { pluralize, timeAgo, escapeHtml } from '../shared/utils.js';
import { encryptPayload, decryptPayload, FORMAT as ENCRYPTED_FORMAT } from '../shared/crypto.js';
import { SYNC_MIN_PASSPHRASE_LENGTH } from '../shared/constants.js';
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
    this.secretInputs = [...document.querySelectorAll('[data-secret]')];
    this.settings = {};
  }

  async init() {
    document.querySelector('[data-logo]').innerHTML = `${ICONS.logo}<span>Tabroost</span>`;
    document.getElementById('version').textContent = `Tabroost ${chrome.runtime.getManifest().version}`;

    await this.loadSettings();
    this.bindEvents();
    this.renderShortcuts();
    this.renderBackups();
    await this.renderSyncStatus();
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
        input.value = this.settings[key] || (key === 'pillPosition' ? 'top-left' : key === 'pillSize' ? 'medium' : '');
      }
    }
  }

  async save(partial) {
    try {
      this.settings = await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: partial });
      toast('Saved', { type: 'success', duration: 1500 });
      await this.renderSyncStatus();
    } catch (err) {
      toastError(err, 'Could not save settings');
    }
  }

  bindEvents() {
    for (const input of this.secretInputs) {
      input.addEventListener('change', async () => {
        const field = input.dataset.secret;
        const value = input.value;
        if (!value) return;
        try {
          await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_SYNC_CONFIG, { secrets: { [field]: value } });
          input.value = '';
          toast('Saved', { type: 'success', duration: 1500 });
          await this.renderSyncStatus();
        } catch (err) {
          toastError(err, 'Could not save');
        }
      });
    }

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

    document.getElementById('btn-reset-handle')?.addEventListener('click', () => this.save({ pillOffsetY: null }));
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

    document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync-now');
      const statusEl = document.getElementById('sync-status');
      try {
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        statusEl.textContent = 'Connecting and syncing…';
        const res = await sendBackgroundMessage(MESSAGE_TYPES.START_SYNC);
        toast(`Synced ${pluralize(res.workspaceCount, 'workspace')}`, { type: 'success' });
        await this.loadSettings();
        await this.renderSyncStatus();
      } catch (err) {
        toastError(err, 'Sync failed');
        statusEl.textContent = `Error: ${err.message || err}`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sync now';
      }
    });

    chrome.runtime.onMessage?.addListener((msg) => {
      if (msg?.type === MESSAGE_TYPES.STATE_CHANGED && msg.lastSyncedAt) {
        this.renderSyncStatus();
      }
    });
  }

  async renderSyncStatus() {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl) return;
    try {
      const status = await sendBackgroundMessage(MESSAGE_TYPES.GET_SYNC_STATUS);
      for (const input of this.secretInputs) {
        const has = input.dataset.secret === 'token' ? status.hasToken : status.hasPassphrase;
        input.placeholder = has ? '•••••••• saved. Type to replace' : input.dataset.secret === 'token' ? 'ghp_...' : 'At least 8 characters';
      }
      if (!status.enabled) {
        statusEl.textContent = 'Sync is currently off';
      } else if (!status.hasPassphrase || !status.hasToken) {
        statusEl.textContent = !status.hasPassphrase ? 'Locked: enter your passphrase to sync' : 'Add a GitHub token to sync';
      } else if (status.retryAt) {
        statusEl.textContent = `Rate limited or failing. Next automatic retry ${new Date(status.retryAt).toLocaleTimeString()}`;
      } else if (status.lastSyncedAt) {
        statusEl.textContent = `Last synced ${timeAgo(status.lastSyncedAt)}`;
      } else {
        statusEl.textContent = 'Ready to sync';
      }
    } catch {
      statusEl.textContent = 'Sync service offline';
    }
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
    let items = [];
    try {
      items = (await sendBackgroundMessage(MESSAGE_TYPES.LIST_BACKUPS)) || [];
    } catch {
      list.innerHTML = '<li class="muted">Could not load backups</li>';
      return;
    }

    if (!items.length) {
      list.innerHTML = '<li class="muted">No backups yet. Tabroost creates one automatically every few hours.</li>';
      return;
    }

    list.innerHTML = items
      .map((b) => {
        const time = new Date(b.createdAt).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const reason = REASONS[b.reason] || b.reason;
        const count = pluralize(b.workspaceCount, 'workspace');
        return `
          <li class="backup-row" data-id="${b.id}">
            <span class="backup-meta">
              <span class="backup-time">${escapeHtml(time)}</span>
              <span class="backup-reason">${escapeHtml(reason)} · ${count}</span>
            </span>
            <button type="button" class="btn is-sm" data-restore="${b.id}">Restore</button>
          </li>`;
      })
      .join('');

    list.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', () => this.restoreBackup(btn.dataset.restore));
    });
  }

  async restoreBackup(id) {
    const { confirmed } = await confirmDialog({
      title: 'Restore this backup?',
      message: 'Your current workspaces will be replaced with this snapshot. A backup of the current state will be taken first.',
      confirmLabel: 'Restore'
    });
    if (!confirmed) return;

    try {
      await sendBackgroundMessage(MESSAGE_TYPES.RESTORE_BACKUP, { id });
      toast('Backup restored', { type: 'success' });
      this.renderBackups();
    } catch (err) {
      toastError(err, 'Could not restore backup');
    }
  }

  async exportJson() {
    try {
      let data = await sendBackgroundMessage(MESSAGE_TYPES.EXPORT);
      const passphrase = document.getElementById('transfer-passphrase')?.value || '';
      if (passphrase && passphrase.length < SYNC_MIN_PASSPHRASE_LENGTH) {
        toast(`Passphrase must be at least ${SYNC_MIN_PASSPHRASE_LENGTH} characters`, { type: 'info' });
        return;
      }
      if (passphrase) data = await encryptPayload(data, passphrase);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const filename = `tabroost-workspaces-${date}${passphrase ? '.encrypted' : ''}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toastError(err, 'Export failed');
    }
  }

  async importJson(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let payload = JSON.parse(text);
      if (payload?.format === ENCRYPTED_FORMAT) {
        const passphrase = document.getElementById('transfer-passphrase')?.value || '';
        if (!passphrase) {
          toast('This file is encrypted. Enter its passphrase above, then choose the file again.', { type: 'info' });
          return;
        }
        payload = await decryptPayload(payload, passphrase);
      }
      const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';

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
