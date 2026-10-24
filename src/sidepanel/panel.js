/**
 * Side Panel / Popup / Flyout controller — coordinates rendering, user actions,
 * and background sync. The same page runs in three modes:
 *   panel  — chrome.sidePanel
 *   popup  — toolbar action popup
 *   flyout — iframe opened from the optional on-page pill
 */

import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/constants.js';
import { sendBackgroundMessage } from '../shared/messages.js';
import { applyColorVars, nextUnusedColor } from '../shared/colors.js';
import { debounce, escapeHtml, pluralize } from '../shared/utils.js';
import { ICONS } from './components/icons.js';
import { renderWorkspaceCard } from './components/workspace-card.js';
import { describeWorkspace } from './components/tab-tree.js';
import { showMenu, showMenuForButton, isMenuOpen, onMenuClosed } from './components/context-menu.js';
import { LiveTabsView } from './components/live-tabs-view.js';
import { showNamePrompt, isNamePromptOpen } from './components/group-name-prompt.js';
import { openWorkspaceDialog, confirmDialog, openHistoryDialog } from './components/dialogs.js';
import { toast, toastError } from './components/toast.js';

const MODE = new URLSearchParams(location.search).get('mode') || document.documentElement.dataset.mode || 'panel';
document.documentElement.dataset.mode = MODE;
const IS_TRANSIENT = MODE === 'popup' || MODE === 'flyout';

const send = (type, payload) => sendBackgroundMessage(type, payload);

class SidePanelApp {
  constructor(root) {
    this.root = root;
    this.windowId = null;
    this.currentWorkspaceId = null;
    this.previousWorkspaceId = null;
    this.workspaces = {};
    this.workspaceOrder = [];
    this.bindings = {};
    this.settings = {};
    this.windowTabCount = 0;

    this.view = 'workspaces';
    this.query = '';
    this.expanded = new Set();
    this.groupExpanded = new Map(); // `${wsId}:${groupId}` -> boolean
    this.pendingRender = false;
    this.loaded = false;

    this.scheduleLoad = debounce(() => this.load(), 80);
  }

  async init() {
    try {
      const win = await chrome.windows.getCurrent();
      this.windowId = win?.id ?? null;
    } catch {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      this.windowId = win?.id ?? null;
    }

    this.renderShell();
    this.bindShell();
    onMenuClosed(() => {
      if (this.pendingRender) setTimeout(() => this.renderList(), 0);
    });

    this.liveView = new LiveTabsView(this.el.windowTabs, {
      windowId: this.windowId,
      onTabCountChange: (count) => {
        this.windowTabCount = count;
        this.el.countWindow.textContent = String(count);
        if (this.loaded) this.renderWindowBar();
      }
    });
    await this.liveView.loadAndRender();

    chrome.storage.onChanged.addListener((changes, area) => {
      const relevant = area === 'local'
        ? [STORAGE_KEYS.WORKSPACES, STORAGE_KEYS.WORKSPACE_ORDER, STORAGE_KEYS.SETTINGS].some((k) => k in changes)
        : [STORAGE_KEYS.WINDOW_BINDINGS, STORAGE_KEYS.ACTIVE_WORKSPACE_ID].some((k) => k in changes);
      if (relevant) this.scheduleLoad();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MESSAGE_TYPES.TRIGGER_NEW_WORKSPACE_MODAL) this.createWorkspaceFlow();
      else if (message?.type === MESSAGE_TYPES.STATE_CHANGED) this.scheduleLoad();
    });

    await this.load();
    this.root.removeAttribute('aria-busy');
    try {
      if (localStorage.getItem('tabroost.view') === 'window') this.switchView('window');
    } catch {
      // Storage unavailable
    }
    if (MODE !== 'panel') this.el.search.focus();
  }

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------

  renderShell() {
    this.root.innerHTML = `
      <header class="topbar">
        <div class="brand">${ICONS.logo}<span>Tabroost</span></div>
        <div class="topbar-actions">
          <button type="button" class="icon-btn" data-act="new" title="New workspace (N)" aria-label="New workspace" aria-haspopup="menu">${ICONS.plus}</button>
          ${IS_TRANSIENT ? `<button type="button" class="icon-btn" data-act="dock" title="Open in side panel" aria-label="Open in side panel">${ICONS.panel}</button>` : ''}
          ${MODE === 'flyout' ? `<button type="button" class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>` : ''}
          <button type="button" class="icon-btn" data-act="settings" title="Settings" aria-label="Settings">${ICONS.settings}</button>
        </div>
      </header>

      <section class="window-bar" data-el="windowBar" aria-live="polite"></section>

      <nav class="segmented" role="tablist" aria-label="View">
        <button type="button" role="tab" id="tab-workspaces" aria-controls="view-workspaces" aria-selected="true" data-view="workspaces">
          Workspaces <span class="count" data-el="countWorkspaces">0</span>
        </button>
        <button type="button" role="tab" id="tab-window" aria-controls="view-window" aria-selected="false" data-view="window">
          This window <span class="count" data-el="countWindow">0</span>
        </button>
      </nav>

      <div class="view" id="view-workspaces" role="tabpanel" aria-labelledby="tab-workspaces" data-el="viewWorkspaces">
        <div class="search">
          ${ICONS.search}
          <input type="search" data-el="search" placeholder="Search workspaces and tabs" aria-label="Search workspaces and tabs" autocomplete="off" spellcheck="false">
          <kbd class="search-kbd" aria-hidden="true">/</kbd>
        </div>
        <div class="list-toolbar">
          <span class="muted" data-el="summary"></span>
          <button type="button" class="text-btn" data-act="sort" data-el="sortBtn">${ICONS.sort}<span></span></button>
        </div>
        <div class="scroll">
          <div class="ws-list" role="list" data-el="list"></div>
        </div>
      </div>

      <div class="view hidden" id="view-window" role="tabpanel" aria-labelledby="tab-window" data-el="viewWindow">
        <div class="list-toolbar">
          <span class="muted">Drag a tab onto another to group them</span>
          <button type="button" class="text-btn" data-act="organize" title="Group tabs by site category">${ICONS.sparkle}<span>Auto-group</span></button>
        </div>
        <div class="scroll"><div data-el="windowTabs"></div></div>
      </div>

      <footer class="footer" data-el="footer"></footer>
    `;

    this.el = {};
    this.root.querySelectorAll('[data-el]').forEach((node) => {
      this.el[node.dataset.el] = node;
    });
  }

  bindShell() {
    this.root.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (!actEl || actEl.closest('.ws-card, .tab-tree, .window-bar, .footer')) return;
      const act = actEl.dataset.act;
      if (act === 'new') this.newWorkspaceMenu(actEl);
      else if (act === 'dock') this.dockToSidePanel();
      else if (act === 'close') this.closeIfTransient();
      else if (act === 'settings') chrome.runtime.openOptionsPage();
      else if (act === 'sort') this.toggleSort();
      else if (act === 'organize') this.organizeCurrentWindow();
    });

    this.root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });

    this.el.search.addEventListener('input', () => {
      this.query = this.el.search.value.trim().toLowerCase();
      this.renderList();
    });
    this.el.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusRow(0);
      } else if (e.key === 'Enter') {
        const first = this.visibleIds()[0];
        if (first) this.openWorkspace(first);
      } else if (e.key === 'Escape' && this.el.search.value) {
        e.preventDefault();
        e.stopPropagation();
        this.el.search.value = '';
        this.query = '';
        this.renderList();
      }
    });

    this.el.windowBar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'save') this.createWorkspaceFlow({ fromWindow: true });
      else if (act === 'edit' && this.currentWorkspaceId) this.editWorkspace(this.workspaces[this.currentWorkspaceId]);
    });

    this.el.footer.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="last"]')) {
        try {
          await send(MESSAGE_TYPES.SWITCH_TO_LAST);
          this.closeIfTransient();
        } catch (err) {
          toastError(err, 'Could not switch');
        }
      }
    });

    document.addEventListener('keydown', (e) => this.onGlobalKey(e));
  }

  onGlobalKey(e) {
    const typing = e.target.matches?.('input, textarea, [contenteditable="true"]');
    if (document.querySelector('dialog[open]')) return;

    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      this.switchView('workspaces');
      this.el.search.focus();
      this.el.search.select();
      return;
    }

    if (e.key === '/' && !typing) {
      e.preventDefault();
      this.switchView('workspaces');
      this.el.search.focus();
    } else if ((e.key === 'n' || e.key === 'N') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.createWorkspaceFlow();
    } else if (e.key === 'Escape' && !typing && !isNamePromptOpen()) {
      this.closeIfTransient();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.classList?.contains('ws-row')) {
      e.preventDefault();
      const rows = [...this.el.list.querySelectorAll('.ws-row')];
      const idx = rows.indexOf(e.target);
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next < 0) this.el.search.focus();
      else this.focusRow(Math.min(next, rows.length - 1));
    }
  }

  focusRow(index) {
    const rows = this.el.list.querySelectorAll('.ws-row');
    rows[index]?.focus();
  }

  switchView(view) {
    this.view = view;
    try {
      localStorage.setItem('tabroost.view', view);
    } catch {
      // Storage unavailable: the choice just is not remembered
    }
    this.root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.view === view));
    });
    this.el.viewWorkspaces.classList.toggle('hidden', view !== 'workspaces');
    this.el.viewWindow.classList.toggle('hidden', view !== 'window');
    this.liveView.setActive(view === 'window');
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  async load() {
    try {
      const [state, status] = await Promise.all([
        send(MESSAGE_TYPES.LIST_WORKSPACES),
        send(MESSAGE_TYPES.GET_CURRENT_STATUS, { windowId: this.windowId })
      ]);
      this.workspaces = state?.workspaces || {};
      this.workspaceOrder = state?.workspaceOrder || [];
      this.settings = state?.settings || {};
      this.bindings = status?.bindings || {};
      this.currentWorkspaceId = status?.currentWorkspaceId || null;
      this.previousWorkspaceId = status?.previousWorkspaceId || null;
      this.loaded = true;
      this.render();
    } catch (err) {
      console.warn('load error:', err);
      if (!this.loaded) {
        this.el.list.innerHTML = `<div class="empty"><p class="empty-text">Could not reach the extension.<br><span class="muted">${escapeHtml(err?.message || '')}</span></p><button type="button" class="btn is-primary is-sm" data-act="retry">Retry</button></div>`;
        this.el.list.querySelector('[data-act="retry"]')?.addEventListener('click', () => this.load());
      }
    }
  }

  isOpen(id) {
    return Object.values(this.bindings).includes(id);
  }

  visibleIds() {
    let ids = this.workspaceOrder.filter((id) => this.workspaces[id]);
    if (this.query) {
      ids = ids.filter((id) => {
        const ws = this.workspaces[id];
        if (ws.name.toLowerCase().includes(this.query)) return true;
        return (ws.tabs || []).some(
          (t) => (t.title || '').toLowerCase().includes(this.query) || (t.url || '').toLowerCase().includes(this.query)
        );
      });
    }
    if (this.settings.sortOrder === 'recent') {
      ids.sort((a, b) => {
        if (a === this.currentWorkspaceId) return -1;
        if (b === this.currentWorkspaceId) return 1;
        return (this.workspaces[b].lastOpenedAt || 0) - (this.workspaces[a].lastOpenedAt || 0);
      });
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render() {
    this.renderWindowBar();
    this.renderFooter();
    const total = Object.keys(this.workspaces).length;
    this.el.countWorkspaces.textContent = String(total);
    const sortLabel = this.settings.sortOrder === 'recent' ? 'Recent' : 'Custom';
    this.el.sortBtn.querySelector('span').textContent = sortLabel;
    this.el.sortBtn.title = `Sorted: ${sortLabel.toLowerCase()} order. Click to change.`;
    this.renderList();
  }

  renderWindowBar() {
    const bar = this.el.windowBar;
    const ws = this.currentWorkspaceId ? this.workspaces[this.currentWorkspaceId] : null;
    if (ws) {
      bar.className = 'window-bar is-managed';
      applyColorVars(bar, ws.color);
      bar.innerHTML = `
        <span class="ws-avatar">${escapeHtml(ws.icon || ws.name.charAt(0).toUpperCase())}</span>
        <span class="wb-text">
          <span class="wb-title">${escapeHtml(ws.name)}</span>
          <span class="wb-sub">This window · ${escapeHtml(describeWorkspace(ws))} · saved automatically</span>
        </span>
        <button type="button" class="btn is-ghost is-sm" data-act="edit">${ICONS.edit}<span>Edit</span></button>
      `;
    } else {
      bar.className = 'window-bar is-unmanaged';
      bar.removeAttribute('style');
      bar.innerHTML = `
        <span class="wb-icon">${ICONS.window}</span>
        <span class="wb-text">
          <span class="wb-title">Unsaved window</span>
          <span class="wb-sub">${pluralize(this.windowTabCount, 'tab')} not in any workspace</span>
        </span>
        <button type="button" class="btn is-primary is-sm" data-act="save">${ICONS.save}<span>Save</span></button>
      `;
    }
  }

  renderFooter() {
    const prev = this.previousWorkspaceId && this.workspaces[this.previousWorkspaceId];
    const showPrev = prev && this.previousWorkspaceId !== this.currentWorkspaceId;
    this.el.footer.innerHTML = showPrev
      ? `<button type="button" class="chip" data-act="last" title="Switch to the previous workspace">${ICONS.switchLast}<span>Back to <strong>${escapeHtml(prev.name)}</strong></span></button>`
      : `<span class="muted">Press <kbd>/</kbd> to search · <kbd>N</kbd> for a new workspace</span>`;
  }

  renderList() {
    // Background syncs fire on every tab load; don't yank menus or prompts away mid-use
    if (isNamePromptOpen() || isMenuOpen()) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;

    const list = this.el.list;
    const scroller = list.parentElement;
    const scrollTop = scroller.scrollTop;
    const focusKey = document.activeElement?.closest?.('[data-focus-key]')?.dataset.focusKey;

    const ids = this.visibleIds();
    const total = Object.keys(this.workspaces).length;
    const openCount = Object.keys(this.workspaces).filter((id) => this.isOpen(id)).length;
    this.el.summary.textContent = total
      ? this.query
        ? `${pluralize(ids.length, 'match', 'matches')}`
        : `${pluralize(total, 'workspace')}${openCount ? ` · ${openCount} open` : ''}`
      : '';

    if (ids.length === 0) {
      list.replaceChildren(this.query ? this.renderNoResults() : this.renderEmptyState());
      return;
    }

    const draggable = this.settings.sortOrder !== 'recent' && !this.query;
    const fragment = document.createDocumentFragment();
    for (const id of ids) {
      fragment.appendChild(this.renderCard(this.workspaces[id], draggable));
    }
    list.replaceChildren(fragment);
    scroller.scrollTop = scrollTop;

    if (focusKey) {
      list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
  }

  renderCard(ws, draggable) {
    const id = ws.id;
    return renderWorkspaceCard({
      workspace: ws,
      isOpen: this.isOpen(id),
      isCurrentWindow: this.currentWorkspaceId === id,
      isExpanded: Boolean(this.query) || this.expanded.has(id),
      searchQuery: this.query,
      draggable,
      isGroupExpanded: (wsId, group) => {
        const key = `${wsId}:${group.id}`;
        return this.groupExpanded.has(key) ? this.groupExpanded.get(key) : !group.collapsed;
      },
      on: {
        open: (wsId) => this.openWorkspace(wsId),
        toggleExpand: (wsId) => this.toggleExpand(wsId),
        menu: (pos) => this.workspaceMenu(ws, pos),
        edit: () => this.editWorkspace(ws),
        remove: () => this.deleteWorkspace(ws),
        reorder: (sourceId, targetId, position) => this.reorder(sourceId, targetId, position),
        tabDrop: (data) => this.moveTab(data, id),
        tabs: this.tabHandlers(ws)
      }
    });
  }

  renderEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty';
    el.innerHTML = `
      <div class="empty-art" aria-hidden="true">
        <span class="empty-card c1"></span><span class="empty-card c2"></span><span class="empty-card c3"></span>
      </div>
      <h2 class="empty-title">Keep each project in its own window</h2>
      <p class="empty-text">A workspace remembers its tabs and tab groups. Close it when you're done and reopen it exactly as you left it.</p>
      <div class="empty-actions">
        ${this.currentWorkspaceId ? '' : `<button type="button" class="btn is-primary" data-empty="window">${ICONS.save}<span>Save this window (${pluralize(this.windowTabCount, 'tab')})</span></button>`}
        <button type="button" class="btn" data-empty="blank">${ICONS.plus}<span>Start a blank workspace</span></button>
      </div>
    `;
    el.querySelector('[data-empty="window"]')?.addEventListener('click', () => this.createWorkspaceFlow({ fromWindow: true }));
    el.querySelector('[data-empty="blank"]').addEventListener('click', () => this.createWorkspaceFlow({ fromWindow: false }));
    return el;
  }

  renderNoResults() {
    const el = document.createElement('div');
    el.className = 'empty is-compact';
    el.innerHTML = `<p class="empty-text">No workspace or tab matches “${escapeHtml(this.query)}”.</p>`;
    return el;
  }

  // ---------------------------------------------------------------------------
  // Workspace actions
  // ---------------------------------------------------------------------------

  toggleExpand(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.renderList();
    if (this.expanded.has(id)) {
      requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  }

  async openWorkspace(id) {
    if (id === this.currentWorkspaceId) {
      this.toggleExpand(id);
      return;
    }
    try {
      await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id });
      this.closeIfTransient();
    } catch (err) {
      toastError(err, 'Could not open workspace');
    }
  }

  async createWorkspaceFlow({ fromWindow = null } = {}) {
    const canIncludeTabs = !this.currentWorkspaceId;
    const usedNames = new Set(Object.values(this.workspaces).map((w) => w.name.toLowerCase()));
    let n = Object.keys(this.workspaces).length + 1;
    while (usedNames.has(`workspace ${n}`)) n++;

    const result = await openWorkspaceDialog({
      mode: 'create',
      name: `Workspace ${n}`,
      color: nextUnusedColor(Object.values(this.workspaces).map((w) => w.color), n),
      includeTabs: canIncludeTabs && (fromWindow ?? true),
      tabCount: this.windowTabCount,
      canIncludeTabs
    });
    if (!result) return;

    try {
      if (result.includeTabs && canIncludeTabs) {
        const ws = await send(MESSAGE_TYPES.CREATE_FROM_CURRENT_WINDOW, {
          windowId: this.windowId, name: result.name, color: result.color, icon: result.icon
        });
        toast(`Saved this window as “${ws.name}”`, { type: 'success' });
        await this.load();
      } else {
        const ws = await send(MESSAGE_TYPES.CREATE_WORKSPACE, { name: result.name, color: result.color, icon: result.icon });
        await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: ws.id });
        this.closeIfTransient();
      }
    } catch (err) {
      toastError(err, 'Could not create workspace');
    }
  }

  newWorkspaceMenu(button) {
    const canSave = !this.currentWorkspaceId;
    showMenuForButton(button, [
      canSave ? { label: `Save this window (${pluralize(this.windowTabCount, 'tab')})`, icon: 'save', onSelect: () => this.createWorkspaceFlow({ fromWindow: true }) } : null,
      { label: 'Blank workspace', icon: 'plus', shortcut: 'N', onSelect: () => this.createWorkspaceFlow({ fromWindow: false }) }
    ], 'New workspace');
  }

  async editWorkspace(ws) {
    if (!ws) return;
    const result = await openWorkspaceDialog({ mode: 'edit', name: ws.name, color: ws.color, icon: ws.icon });
    if (!result) return;
    try {
      await send(MESSAGE_TYPES.UPDATE_WORKSPACE, { id: ws.id, name: result.name, color: result.color, icon: result.icon });
    } catch (err) {
      toastError(err, 'Could not save changes');
    }
  }

  async deleteWorkspace(ws) {
    if (this.settings.confirmDelete) {
      const open = this.isOpen(ws.id);
      const { confirmed, checked } = await confirmDialog({
        title: `Delete “${ws.name}”?`,
        message: `${describeWorkspace(ws)} will be removed.${open ? ' Its window stays open but is no longer saved.' : ''} You can undo right after.`,
        confirmLabel: 'Delete',
        danger: true,
        checkboxLabel: "Don't ask again"
      });
      if (!confirmed) return;
      if (checked) send(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: { confirmDelete: false } }).catch(() => {});
    }

    try {
      const res = await send(MESSAGE_TYPES.DELETE_WORKSPACE, { id: ws.id });
      if (!res?.deleted) return;
      toast(`Deleted “${ws.name}”`, {
        duration: 7000,
        action: {
          label: 'Undo',
          icon: 'undo',
          onClick: async () => {
            try {
              await send(MESSAGE_TYPES.RESTORE_WORKSPACE, { workspace: res.workspace, index: res.index });
            } catch (err) {
              toastError(err, 'Could not restore');
            }
          }
        }
      });
    } catch (err) {
      toastError(err, 'Could not delete workspace');
    }
  }

  workspaceMenu(ws, { x, y, anchor }) {
    const open = this.isOpen(ws.id);
    const current = this.currentWorkspaceId === ws.id;
    const run = (type, payload, msg) => async () => {
      try {
        await send(type, payload);
        if (msg) toast(msg, { type: 'success' });
      } catch (err) {
        toastError(err);
      }
    };

    showMenu({
      x,
      y,
      anchor,
      label: `${ws.name} options`,
      items: [
        current ? null : { label: open ? 'Switch to window' : 'Open in new window', icon: 'open', shortcut: '↵', onSelect: () => this.openWorkspace(ws.id) },
        open ? { label: 'Close window', icon: 'windowClose', onSelect: run(MESSAGE_TYPES.CLOSE_WORKSPACE, { id: ws.id }) } : null,
        { label: 'Edit name, color, icon', icon: 'edit', shortcut: 'F2', onSelect: () => this.editWorkspace(ws) },
        { label: 'Duplicate', icon: 'duplicate', onSelect: run(MESSAGE_TYPES.DUPLICATE_WORKSPACE, { id: ws.id }, `Duplicated “${ws.name}”`) },
        { label: 'Version history…', icon: 'undo', onSelect: () => this.showHistory(ws) },
        { label: 'Auto-group tabs', icon: 'sparkle', onSelect: async () => {
          try {
            const res = await send(MESSAGE_TYPES.ORGANIZE_TABS, { workspaceId: ws.id });
            toast(res?.groupsCreated ? `Created ${pluralize(res.groupsCreated, 'group')}` : 'Nothing to group', { type: res?.groupsCreated ? 'success' : 'info' });
          } catch (err) {
            toastError(err);
          }
        } },
        { header: 'Color' },
        { colors: { selected: ws.color, onSelect: (color) => run(MESSAGE_TYPES.RECOLOR_WORKSPACE, { id: ws.id, color })() } },
        { separator: true },
        { label: 'Delete workspace', icon: 'trash', danger: true, shortcut: 'Del', onSelect: () => this.deleteWorkspace(ws) }
      ]
    });
  }

  async showHistory(ws) {
    for (;;) {
      let versions;
      try {
        ({ versions } = await send(MESSAGE_TYPES.LIST_HISTORY, { workspaceId: ws.id }));
      } catch (err) {
        toastError(err, 'Could not load history');
        return;
      }
      const choice = await openHistoryDialog({ name: ws.name, versions });
      if (!choice) return;

      if (choice.action === 'save') {
        try {
          const res = await send(MESSAGE_TYPES.CREATE_VERSION, { workspaceId: ws.id });
          toast(res?.created ? 'Version saved' : 'Nothing changed since the last version', { type: res?.created ? 'success' : 'info' });
        } catch (err) {
          toastError(err, 'Could not save version');
        }
        continue;
      }

      const open = this.isOpen(ws.id);
      const { confirmed } = await confirmDialog({
        title: 'Restore this version?',
        message: open
          ? 'The workspace window closes and reopens with the old tabs. The current tabs are kept as a version.'
          : 'The workspace goes back to the old tabs. The current tabs are kept as a version.',
        confirmLabel: 'Restore'
      });
      if (!confirmed) continue;
      try {
        await send(MESSAGE_TYPES.RESTORE_VERSION, { workspaceId: ws.id, versionId: choice.versionId });
        toast(`Restored “${ws.name}”`, { type: 'success' });
      } catch (err) {
        toastError(err, 'Could not restore');
      }
      return;
    }
  }

  async reorder(sourceId, targetId, position) {
    const order = this.workspaceOrder.filter((id) => id !== sourceId);
    let idx = order.indexOf(targetId);
    if (position === 'after') idx += 1;
    order.splice(idx, 0, sourceId);
    this.workspaceOrder = order;
    this.renderList();
    try {
      await send(MESSAGE_TYPES.REORDER_WORKSPACES, { order });
    } catch (err) {
      toastError(err, 'Could not reorder');
      this.load();
    }
  }

  async toggleSort() {
    const next = this.settings.sortOrder === 'recent' ? 'manual' : 'recent';
    this.settings.sortOrder = next;
    this.render();
    try {
      await send(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: { sortOrder: next } });
    } catch (err) {
      toastError(err);
    }
  }

  async organizeCurrentWindow() {
    try {
      const res = await send(MESSAGE_TYPES.ORGANIZE_TABS, { windowId: this.windowId });
      toast(res?.groupsCreated ? `Created ${pluralize(res.groupsCreated, 'group')}` : 'No tabs to group (needs 2+ tabs from similar sites)', { type: res?.groupsCreated ? 'success' : 'info' });
    } catch (err) {
      toastError(err, 'Could not group tabs');
    }
  }

  // ---------------------------------------------------------------------------
  // Tab actions inside workspace cards
  // ---------------------------------------------------------------------------

  tabHandlers(ws) {
    const wsId = ws.id;
    const call = async (type, payload) => {
      try {
        return await send(type, payload);
      } catch (err) {
        toastError(err);
        return null;
      }
    };

    return {
      activate: async (tab) => {
        const res = await call(MESSAGE_TYPES.OPEN_TAB_IN_WORKSPACE, { workspaceId: wsId, tabId: tab.id, url: tab.url });
        if (res) this.closeIfTransient();
      },
      close: (tab) => call(MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE, { workspaceId: wsId, tabId: tab.id }),
      ungroupTab: (tab) => call(MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP, { workspaceId: wsId, tabId: tab.id }),
      toggleGroup: (group, expanded) => this.groupExpanded.set(`${wsId}:${group.id}`, expanded),
      editGroup: (group, anchor) => this.promptGroup(wsId, group, anchor),
      ungroupAll: (group) => call(MESSAGE_TYPES.UNGROUP_TABS, { workspaceId: wsId, groupId: group.id }),
      dropOnGroup: (data, group) => call(MESSAGE_TYPES.ADD_TAB_TO_GROUP, {
        workspaceId: wsId, tabId: data.tabId, groupId: group.id, sourceWorkspaceId: data.sourceWorkspaceId
      }),
      dropUngroup: (data) => {
        if (data.sourceWorkspaceId === wsId) return call(MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP, { workspaceId: wsId, tabId: data.tabId });
        return this.moveTab(data, wsId);
      },
      dropOnTab: async (data, target, targetGroup) => {
        if (data.live) return;
        if (targetGroup) {
          return call(MESSAGE_TYPES.ADD_TAB_TO_GROUP, {
            workspaceId: wsId, tabId: data.tabId, groupId: targetGroup.id, sourceWorkspaceId: data.sourceWorkspaceId
          });
        }
        if (data.sourceWorkspaceId === wsId && data.groupId) {
          return call(MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP, { workspaceId: wsId, tabId: data.tabId });
        }
        const res = await call(MESSAGE_TYPES.MERGE_TABS_INTO_GROUP, {
          sourceWorkspaceId: data.sourceWorkspaceId, sourceTabId: data.tabId, targetWorkspaceId: wsId, targetTabId: target.id
        });
        if (res?.success && res.isNew) {
          this.expanded.add(wsId);
          this.groupExpanded.set(`${wsId}:${res.groupId}`, true);
          await this.load();
          const head = document.querySelector(`#card-${CSS.escape(wsId)} .group[data-group-id="${CSS.escape(String(res.groupId))}"] .group-head`);
          const group = this.workspaces[wsId]?.groups.find((g) => g.id === res.groupId) || { id: res.groupId, title: '', color: 'blue' };
          this.promptGroup(wsId, group, head);
        }
      },
      tabMenu: (tab, group, x, y) => this.tabMenu(ws, tab, group, x, y)
    };
  }

  promptGroup(wsId, group, anchor) {
    showNamePrompt({
      anchor,
      title: group.title,
      color: group.color,
      onCommit: async ({ title, color }) => {
        try {
          await send(MESSAGE_TYPES.UPDATE_TAB_GROUP, { workspaceId: wsId, groupId: group.id, title, color });
        } catch (err) {
          toastError(err, 'Could not rename group');
        }
        if (this.pendingRender) this.renderList();
      }
    });
  }

  async moveTab(data, targetWsId) {
    if (data.sourceWorkspaceId === targetWsId) return;
    try {
      await send(MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE, {
        tabId: data.tabId,
        targetWorkspaceId: targetWsId,
        sourceWorkspaceId: data.sourceWorkspaceId || null
      });
      toast(`Moved tab to “${this.workspaces[targetWsId]?.name || 'workspace'}”`, { type: 'success', duration: 2500 });
    } catch (err) {
      toastError(err, 'Could not move tab');
    }
  }

  tabMenu(ws, tab, group, x, y) {
    const others = this.workspaceOrder.filter((id) => id !== ws.id && this.workspaces[id]);
    showMenu({
      x,
      y,
      label: 'Tab actions',
      items: [
        { label: 'Open tab', icon: 'open', onSelect: () => this.tabHandlers(ws).activate(tab) },
        group ? { label: 'Remove from group', icon: 'popout', onSelect: () => this.tabHandlers(ws).ungroupTab(tab) } : null,
        others.length ? { header: 'Move to workspace' } : null,
        ...others.slice(0, 8).map((id) => ({
          label: `${this.workspaces[id].icon ? this.workspaces[id].icon + ' ' : ''}${this.workspaces[id].name}`,
          icon: 'bookmark',
          onSelect: () => this.moveTab({ tabId: tab.id, sourceWorkspaceId: ws.id }, id)
        })),
        { separator: true },
        { label: 'Close tab', icon: 'close', danger: true, onSelect: () => this.tabHandlers(ws).close(tab) }
      ]
    });
  }

  // ---------------------------------------------------------------------------
  // Mode helpers
  // ---------------------------------------------------------------------------

  async dockToSidePanel() {
    try {
      if (chrome.sidePanel?.open && this.windowId) await chrome.sidePanel.open({ windowId: this.windowId });
    } catch (err) {
      toastError(err, 'Could not open the side panel');
      return;
    }
    this.closeIfTransient();
  }

  closeIfTransient() {
    if (MODE === 'popup') {
      window.close();
    } else if (MODE === 'flyout') {
      window.parent.postMessage({ type: MESSAGE_TYPES.CLOSE_FLYOUT }, '*');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new SidePanelApp(document.getElementById('app'));
  app.init().catch((err) => console.error('Tabroost panel failed to start', err));
});
