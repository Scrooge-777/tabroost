/**
 * Options Page Controller
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { sendBackgroundMessage } from '../shared/messages.js';

class OptionsApp {
  constructor() {
    this.settingRestoreStartup = document.getElementById('setting-restore-startup');
    this.settingCloseOnSwitch = document.getElementById('setting-close-on-switch');
    this.settingConfirmDelete = document.getElementById('setting-confirm-delete');
    this.settingAutoSyncTabs = document.getElementById('setting-auto-sync-tabs');
    this.settingDragGroupTabs = document.getElementById('setting-drag-group-tabs');

    this.btnExportJson = document.getElementById('btn-export-json');
    this.fileImportJson = document.getElementById('file-import-json');
    this.importStatus = document.getElementById('import-status');
    this.btnResetAll = document.getElementById('btn-reset-all');
  }

  async init() {
    await this.loadSettings();
    this.bindEvents();
  }

  async loadSettings() {
    try {
      const settings = await sendBackgroundMessage(MESSAGE_TYPES.GET_SETTINGS);
      if (settings) {
        this.settingRestoreStartup.checked = Boolean(settings.restoreOnStartup);
        this.settingCloseOnSwitch.checked = Boolean(settings.closeWindowOnWorkspaceSwitch);
        this.settingConfirmDelete.checked = settings.confirmDelete !== false;
        if (this.settingAutoSyncTabs) {
          this.settingAutoSyncTabs.checked = settings.autoSyncNewTabs !== false;
        }
        if (this.settingDragGroupTabs) {
          this.settingDragGroupTabs.checked = settings.dragToGroupTabs !== false;
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  bindEvents() {
    // Settings toggles
    const onSettingChange = async () => {
      const updated = {
        restoreOnStartup: this.settingRestoreStartup.checked,
        closeWindowOnWorkspaceSwitch: this.settingCloseOnSwitch.checked,
        confirmDelete: this.settingConfirmDelete.checked,
        autoSyncNewTabs: this.settingAutoSyncTabs ? this.settingAutoSyncTabs.checked : true,
        dragToGroupTabs: this.settingDragGroupTabs ? this.settingDragGroupTabs.checked : true,
        accentBorder: false
      };

      try {
        await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: updated });
      } catch (err) {
        alert(`Failed to save settings: ${err.message}`);
      }
    };

    this.settingRestoreStartup.addEventListener('change', onSettingChange);
    this.settingCloseOnSwitch.addEventListener('change', onSettingChange);
    this.settingConfirmDelete.addEventListener('change', onSettingChange);
    if (this.settingAutoSyncTabs) this.settingAutoSyncTabs.addEventListener('change', onSettingChange);
    if (this.settingDragGroupTabs) this.settingDragGroupTabs.addEventListener('change', onSettingChange);

    // Export JSON
    this.btnExportJson.addEventListener('click', async () => {
      try {
        const data = await sendBackgroundMessage(MESSAGE_TYPES.EXPORT);
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toISOString().split('T')[0];
        const a = document.createElement('a');
        a.href = url;
        a.download = `workspaces-backup-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(`Export failed: ${err.message}`);
      }
    });

    // Import JSON
    this.fileImportJson.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      this.showImportStatus('Reading file...', '');

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const res = await sendBackgroundMessage(MESSAGE_TYPES.IMPORT, { payload });

        this.showImportStatus(`Successfully imported ${res.count} workspace(s)!`, 'success');
        this.fileImportJson.value = '';
      } catch (err) {
        this.showImportStatus(`Import failed: ${err.message}`, 'error');
        this.fileImportJson.value = '';
      }
    });

    // Reset All Data
    this.btnResetAll.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Are you absolutely sure? This will delete all your workspaces, saved tabs, and custom settings. This action cannot be undone.'
      );

      if (!confirmed) return;

      try {
        await sendBackgroundMessage(MESSAGE_TYPES.RESET_ALL);
        await this.loadSettings();
        alert('All workspace data has been reset to defaults.');
      } catch (err) {
        alert(`Reset failed: ${err.message}`);
      }
    });
  }

  showImportStatus(message, type = '') {
    this.importStatus.textContent = message;
    this.importStatus.className = `status-msg ${type}`;
    if (!message) {
      this.importStatus.classList.add('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new OptionsApp();
  app.init();
});
