/**
 * Side Panel Main Controller — Coordinates UI rendering, user actions, and background sync
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { sendBackgroundMessage } from '../shared/messages.js';
import { renderWorkspaceCard } from './components/workspace-card.js';
import { showContextMenu } from './components/context-menu.js';
import { renderColorPicker } from './components/color-picker.js';
import { LiveTabsView } from './components/live-tabs-view.js';
import { showNamePrompt } from './components/group-name-prompt.js';

class SidePanelApp {
  constructor() {
    this.currentWindowId = null;
    this.currentWorkspaceId = null;
    this.activeWorkspaceId = null;
    this.workspaces = {};
    this.workspaceOrder = [];
    this.bindings = {};
    this.settings = {};
    this.expandedWorkspaceIds = new Set();
    this.searchQuery = '';
    this.pendingDeleteWorkspace = null;
    this.currentTabCount = 1;
    this.currentMode = 'workspaces'; // 'workspaces' | 'open-tabs'

    // DOM Elements
    this.listContainer = document.getElementById('workspace-list');
    this.searchInput = document.getElementById('workspace-search');
    this.searchSection = document.getElementById('search-section');
    this.navBtnWorkspaces = document.getElementById('nav-btn-workspaces');
    this.navBtnOpenTabs = document.getElementById('nav-btn-open-tabs');
    this.navOpenTabsCount = document.getElementById('nav-open-tabs-count');
    this.windowTabsSection = document.getElementById('window-tabs-section');
    this.windowTabsList = document.getElementById('window-tabs-list');

    this.windowStatusDot = document.getElementById('window-status-dot');
    this.windowStatusText = document.getElementById('window-status-text');
    this.btnSaveCurrentWindow = document.getElementById('btn-save-current-window');
    this.btnNewWorkspace = document.getElementById('btn-new-workspace');
    this.btnOpenOptions = document.getElementById('btn-open-options');

    // Modals
    this.modalNew = document.getElementById('modal-new-workspace');
    this.formNew = document.getElementById('form-new-workspace');
    this.newWsNameInput = document.getElementById('new-ws-name');
    this.newWsFromCurrent = document.getElementById('new-ws-from-current');
    this.newWsColorContainer = document.getElementById('new-ws-color-container');

    this.modalRename = document.getElementById('modal-rename-workspace');
    this.formRename = document.getElementById('form-rename-workspace');
    this.renameWsId = document.getElementById('rename-ws-id');
    this.renameWsName = document.getElementById('rename-ws-name');
    this.editWsColorContainer = document.getElementById('edit-ws-color-container');

    this.modalDelete = document.getElementById('modal-delete-workspace');
    this.deletePromptText = document.getElementById('delete-prompt-text');
    this.deleteDontAskAgain = document.getElementById('delete-dont-ask-again');
    this.btnConfirmDelete = document.getElementById('btn-confirm-delete');

    // Accordion elements (Edge-style New Workspace dropdown)
    this.btnNewAccordion = document.getElementById('btn-new-workspace-accordion');
    this.newDropdown = document.getElementById('new-workspace-dropdown');
    this.btnCreateWithTabs = document.getElementById('btn-create-with-tabs');
    this.btnCreateBlank = document.getElementById('btn-create-blank');
    this.lblCreateWithTabs = document.getElementById('lbl-create-with-tabs');

    // Initialize Color Picker for New Workspace modal
    this.colorPicker = renderColorPicker({ selectedColor: 'blue' });
    this.newWsColorContainer.appendChild(this.colorPicker.element);

    // Initialize Color Picker for Edit Workspace modal
    if (this.editWsColorContainer) {
      this.colorPickerEdit = renderColorPicker({ selectedColor: 'blue' });
      this.editWsColorContainer.appendChild(this.colorPickerEdit.element);
    }
  }

  async init() {
    // Determine current window ID (prefer getLastFocused for normal browser window in popups)
    try {
      if (chrome.windows?.getLastFocused) {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        this.currentWindowId = win ? win.id : (await chrome.windows?.getCurrent?.())?.id;
      }
    } catch (err) {
      console.warn('Could not determine current window:', err);
    }

    // Initialize Live Open Tabs View (drag-to-group surface)
    if (this.windowTabsList) {
      this.liveTabsView = new LiveTabsView(this.windowTabsList, {
        currentWindowId: this.currentWindowId,
        onTabCountChange: (count) => {
          if (this.navOpenTabsCount) {
            this.navOpenTabsCount.textContent = `Open Tabs (${count})`;
          }
        }
      });
    }

    // Attach DOM events
    this.bindEvents();

    // Listen for background updates
    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (
          message?.type === MESSAGE_TYPES.WORKSPACE_UPDATED ||
          message?.type === MESSAGE_TYPES.STATE_CHANGED
        ) {
          this.loadAndRender();
          if (this.currentMode === 'open-tabs' && this.liveTabsView) {
            this.liveTabsView.loadAndRender();
          }
        } else if (message?.type === 'TRIGGER_NEW_WORKSPACE_MODAL') {
          this.openNewWorkspaceModal();
        }
      });
    }

    // Step 5: Keep sidebar in sync with the real tabstrip & auto-prompt for newly created groups
    if (chrome.tabGroups?.onCreated) {
      chrome.tabGroups.onCreated.addListener((group) => {
        if (group.windowId && this.currentWindowId && group.windowId !== this.currentWindowId) {
          return;
        }
        if (!group.title) {
          showNamePrompt(group.id);
        }
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
      chrome.tabGroups.onUpdated?.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
      chrome.tabGroups.onRemoved?.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
    }

    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
      chrome.tabs.onMoved?.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
      chrome.tabs.onRemoved?.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
      chrome.tabs.onCreated?.addListener(() => {
        if (this.currentMode === 'open-tabs' && this.liveTabsView) {
          this.liveTabsView.loadAndRender();
        }
      });
    }

    // Initial load
    await this.loadAndRender();
    if (this.liveTabsView) {
      await this.liveTabsView.loadAndRender();
    }
  }

  bindEvents() {
    // Search input
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = (e.target.value || '').trim().toLowerCase();
      this.renderList();
    });

    // Header buttons
    const btnDock = document.getElementById('btn-dock-sidepanel');
    if (btnDock) {
      btnDock.addEventListener('click', async () => {
        try {
          if (chrome.sidePanel?.open) {
            const win = await chrome.windows?.getLastFocused?.({ windowTypes: ['normal'] });
            if (win) {
              await chrome.sidePanel.open({ windowId: win.id });
            }
          }
        } catch (err) {
          console.warn('Could not open side panel:', err);
        }

        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'CLOSE_WORKSPACES_FLYOUT' }, '*');
          } else {
            window.close();
          }
        } catch {}
      });
    }

    if (this.btnNewWorkspace) {
      this.btnNewWorkspace.addEventListener('click', () => {
        this.openNewWorkspaceModal();
      });
    }

    // Accordion: Toggle New Workspace dropdown
    if (this.btnNewAccordion && this.newDropdown) {
      this.btnNewAccordion.addEventListener('click', () => {
        const isHidden = this.newDropdown.classList.contains('hidden');
        this.newDropdown.classList.toggle('hidden');
        this.btnNewAccordion.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      });
    }

    if (this.btnCreateWithTabs) {
      this.btnCreateWithTabs.addEventListener('click', () => {
        if (this.newDropdown) this.newDropdown.classList.add('hidden');
        if (this.btnNewAccordion) this.btnNewAccordion.setAttribute('aria-expanded', 'false');
        this.openNewWorkspaceModal(true);
      });
    }

    if (this.btnCreateBlank) {
      this.btnCreateBlank.addEventListener('click', () => {
        if (this.newDropdown) this.newDropdown.classList.add('hidden');
        if (this.btnNewAccordion) this.btnNewAccordion.setAttribute('aria-expanded', 'false');
        this.openNewWorkspaceModal(false);
      });
    }

    if (this.btnOpenOptions) {
      this.btnOpenOptions.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }

    // View Navigation Switcher (Workspaces vs Open Tabs)
    if (this.navBtnWorkspaces && this.navBtnOpenTabs) {
      this.navBtnWorkspaces.addEventListener('click', () => {
        this.switchMode('workspaces');
      });
      this.navBtnOpenTabs.addEventListener('click', () => {
        this.switchMode('open-tabs');
      });
    }

    // Footer action (if present)
    if (this.btnSaveCurrentWindow) {
      this.btnSaveCurrentWindow.addEventListener('click', () => {
        this.openNewWorkspaceModal(true);
      });
    }

    // Modal Close Buttons (data-modal attribute)
    document.querySelectorAll('[data-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal');
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
      });
    });

    // Close modals or in-page flyout on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModals = Array.from(document.querySelectorAll('.modal-overlay')).filter(
          (m) => !m.classList.contains('hidden')
        );
        if (openModals.length > 0) {
          openModals.forEach((m) => m.classList.add('hidden'));
        } else {
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'CLOSE_WORKSPACES_FLYOUT' }, '*');
            }
          } catch {}
        }
      }
    });

    // Submit New Workspace
    this.formNew.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = this.newWsNameInput.value.trim();
      const color = this.colorPicker.getSelected();
      const fromCurrent = this.newWsFromCurrent.checked;

      this.modalNew.classList.add('hidden');

      try {
        if (fromCurrent && this.currentWindowId) {
          await sendBackgroundMessage(MESSAGE_TYPES.CREATE_FROM_CURRENT_WINDOW, {
            windowId: this.currentWindowId,
            name,
            color
          });
        } else {
          const newWs = await sendBackgroundMessage(MESSAGE_TYPES.CREATE_WORKSPACE, {
            name,
            color
          });
          // Open the new workspace window right away
          if (newWs && newWs.id) {
            await sendBackgroundMessage(MESSAGE_TYPES.OPEN_WORKSPACE, { id: newWs.id });
          }
        }
        await this.loadAndRender();
      } catch (err) {
        alert(`Error creating workspace: ${err.message}`);
      }
    });

    // Submit Edit Workspace (Rename + Color)
    this.formRename.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = this.renameWsId.value;
      const name = this.renameWsName.value.trim();
      const color = this.colorPickerEdit ? this.colorPickerEdit.getSelected() : null;
      this.modalRename.classList.add('hidden');

      try {
        await sendBackgroundMessage(MESSAGE_TYPES.RENAME_WORKSPACE, { id, name });
        if (color) {
          await sendBackgroundMessage(MESSAGE_TYPES.RECOLOR_WORKSPACE, { id, color });
        }
        await this.loadAndRender();
      } catch (err) {
        alert(`Error saving workspace: ${err.message}`);
      }
    });

    // Confirm Delete Workspace
    this.btnConfirmDelete.addEventListener('click', async () => {
      if (!this.pendingDeleteWorkspace) return;
      const ws = this.pendingDeleteWorkspace;
      this.modalDelete.classList.add('hidden');

      if (this.deleteDontAskAgain.checked) {
        await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
          settings: { confirmDelete: false }
        });
      }

      try {
        await sendBackgroundMessage(MESSAGE_TYPES.DELETE_WORKSPACE, { id: ws.id });
        this.pendingDeleteWorkspace = null;
        await this.loadAndRender();
      } catch (err) {
        alert(`Error deleting workspace: ${err.message}`);
      }
    });
  }


  async loadAndRender() {
    try {
      const [stateData, statusData] = await Promise.all([
        sendBackgroundMessage(MESSAGE_TYPES.LIST_WORKSPACES),
        sendBackgroundMessage(MESSAGE_TYPES.GET_CURRENT_STATUS, { windowId: this.currentWindowId })
      ]);

      if (stateData) {
        this.workspaces = stateData.workspaces || {};
        this.workspaceOrder = stateData.workspaceOrder || [];
        this.settings = stateData.settings || {};
      }

      if (statusData) {
        this.bindings = statusData.bindings || {};
        this.currentWorkspaceId = statusData.currentWorkspaceId || null;
        this.activeWorkspaceId = statusData.activeWorkspaceId || null;
      }

      this.updateFooterStatus();
      this.renderList();
    } catch (err) {
      console.warn('loadAndRender error:', err);
    }
  }

  async updateFooterStatus() {
    if (this.windowStatusDot && this.windowStatusText) {
      if (this.currentWorkspaceId && this.workspaces[this.currentWorkspaceId]) {
        const currentWs = this.workspaces[this.currentWorkspaceId];
        this.windowStatusDot.className = 'footer-indicator managed';
        this.windowStatusText.textContent = `${currentWs.name} (Managed)`;
        if (this.btnSaveCurrentWindow) this.btnSaveCurrentWindow.style.display = 'none';
      } else {
        this.windowStatusDot.className = 'footer-indicator unmanaged';
        this.windowStatusText.textContent = 'Unmanaged window';
        if (this.btnSaveCurrentWindow) {
          this.btnSaveCurrentWindow.style.display = 'block';
          this.btnSaveCurrentWindow.textContent = 'Save as new';
        }
      }
    }

    if (this.currentWindowId) {
      try {
        const tabs = await chrome.tabs.query({ windowId: this.currentWindowId });
        const cnt = tabs && tabs.length > 0 ? tabs.length : 1;
        this.currentTabCount = cnt;
        if (this.lblCreateWithTabs) {
          this.lblCreateWithTabs.textContent = `Create workspace with ${cnt} ${cnt === 1 ? 'tab' : 'tabs'}`;
        }
      } catch {
        // ignore
      }
    }
  }

  renderList() {
    this.listContainer.innerHTML = '';
    const newWsSection = document.querySelector('.new-workspace-section');

    // Filter workspaces based on search query
    let displayIds = this.workspaceOrder.filter((id) => Boolean(this.workspaces[id]));

    if (this.searchQuery) {
      displayIds = displayIds.filter((id) => {
        const ws = this.workspaces[id];
        if (ws.name.toLowerCase().includes(this.searchQuery)) return true;
        // Also match inside tab titles / URLs
        return (ws.tabs || []).some(
          (t) =>
            (t.title && t.title.toLowerCase().includes(this.searchQuery)) ||
            (t.url && t.url.toLowerCase().includes(this.searchQuery))
        );
      });
    }

    // Order workspaces: Edge 144+ defaults to Most Recently Used (MRU)
    if (this.settings.sortByMru !== false) {
      displayIds.sort((a, b) => {
        if (a === this.currentWorkspaceId) return -1;
        if (b === this.currentWorkspaceId) return 1;
        const timeA = this.workspaces[a]?.lastOpenedAt || this.workspaces[a]?.updatedAt || 0;
        const timeB = this.workspaces[b]?.lastOpenedAt || this.workspaces[b]?.updatedAt || 0;
        return timeB - timeA;
      });
    }

    if (displayIds.length === 0) {
      if (newWsSection) newWsSection.style.display = this.searchQuery ? 'block' : 'none';

      const empty = document.createElement('div');
      empty.className = 'empty-state';

      if (this.searchQuery) {
        empty.innerHTML = `
          <div class="empty-state-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
          </div>
          <div class="empty-state-title">No matching workspaces</div>
          <p class="empty-state-desc">No workspaces or tabs matched your search.</p>
        `;
      } else {
        const cnt = this.currentTabCount || 1;
        empty.innerHTML = `
          <div class="empty-state-icon">
            <svg viewBox="0 0 20 20" width="26" height="26" fill="currentColor">
              <path d="M4.5 2A2.5 2.5 0 0 0 2 4.5v8A2.5 2.5 0 0 0 4.5 15h8a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 12.5 2zM3 12.5V6h11v6.5c0 .83-.67 1.5-1.5 1.5h-8A1.5 1.5 0 0 1 3 12.5M3 5v-.5C3 3.67 3.67 3 4.5 3h8c.83 0 1.5.67 1.5 1.5V5zm4.5 13a2.5 2.5 0 0 1-2.45-2h1.04c.2.58.76 1 1.41 1H14a3 3 0 0 0 3-3V7.5c0-.65-.42-1.2-1-1.41V5.05a2.5 2.5 0 0 1 2 2.45V14a4 4 0 0 1-4 4z"/>
            </svg>
          </div>
          <div class="empty-state-title">Get started with Workspaces</div>
          <p class="empty-state-desc">Organize tabs for different tasks and projects in dedicated windows.</p>
          <div class="empty-actions">
            <button id="btn-empty-create-tabs" class="empty-action-card primary" type="button">
              <div class="eac-icon">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                  <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
                </svg>
              </div>
              <div class="eac-text">
                <div class="eac-title">Create workspace with ${cnt} ${cnt === 1 ? 'tab' : 'tabs'}</div>
                <div class="eac-subtitle">Save tabs from this window into a workspace</div>
              </div>
            </button>
            <button id="btn-empty-create-blank" class="empty-action-card secondary" type="button">
              <div class="eac-icon">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="2" y="2" width="12" height="12" rx="2"/>
                  <path d="M8 5v6M5 8h6" stroke-linecap="round"/>
                </svg>
              </div>
              <div class="eac-text">
                <div class="eac-title">Create blank workspace</div>
                <div class="eac-subtitle">Start fresh with an empty workspace</div>
              </div>
            </button>
          </div>
        `;

        const btnTabs = empty.querySelector('#btn-empty-create-tabs');
        if (btnTabs) {
          btnTabs.onclick = () => this.openNewWorkspaceModal(true);
        }
        const btnBlank = empty.querySelector('#btn-empty-create-blank');
        if (btnBlank) {
          btnBlank.onclick = () => this.openNewWorkspaceModal(false);
        }
      }

      this.listContainer.appendChild(empty);
      this.notifyFlyoutHeight();
      return;
    }

    if (newWsSection) {
      newWsSection.style.display = this.currentMode === 'workspaces' ? 'block' : 'none';
    }

    // Render cards
    displayIds.forEach((id) => {
      const ws = this.workspaces[id];
      const isOpen = Object.values(this.bindings).includes(id);
      const isCurrentWindow = this.currentWorkspaceId === id;
      const isExpanded = Boolean(this.searchQuery) || this.expandedWorkspaceIds.has(id);

      const card = renderWorkspaceCard({
        workspace: ws,
        isOpen,
        isCurrentWindow,
        isExpanded,
        searchQuery: this.searchQuery,
        onToggleExpand: (wsId) => this.toggleExpand(wsId),
        onOpenWorkspace: (wsId) => this.handleOpenWorkspace(wsId),
        onContextMenu: (params) => this.handleContextMenu(params),
        onTabClick: (wsId, tab) => this.handleTabClick(wsId, tab),
        onTabClose: (wsId, tabId) => this.handleTabClose(wsId, tabId),
        onTabMerge: (params) => this.handleTabMerge(params),
        onAddTabToGroup: (params) => this.handleAddTabToGroup(params),
        onUngroup: (wsId, groupId) => this.handleUngroup(wsId, groupId),
        onUpdateGroup: (wsId, groupId, headerEl) => this.handleUpdateGroup(wsId, groupId, headerEl),
        onRemoveTabFromGroup: (params) => this.handleRemoveTabFromGroup(params),
        onReorderDrop: (sourceId, targetId, position) => this.handleReorderDrop(sourceId, targetId, position),
        onTabDrop: (tabId, targetWsId) => this.handleTabDrop(tabId, targetWsId)
      });

      this.listContainer.appendChild(card);
    });

    this.notifyFlyoutHeight();
  }

  toggleExpand(workspaceId) {
    if (this.expandedWorkspaceIds.has(workspaceId)) {
      this.expandedWorkspaceIds.delete(workspaceId);
    } else {
      this.expandedWorkspaceIds.add(workspaceId);
    }
    this.renderList();
    if (this.expandedWorkspaceIds.has(workspaceId)) {
      requestAnimationFrame(() => {
        const card = document.getElementById(`card-${workspaceId}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }

  async handleOpenWorkspace(workspaceId) {
    try {
      const isSwitchingToDifferentWindow = workspaceId !== this.currentWorkspaceId;
      await sendBackgroundMessage(MESSAGE_TYPES.OPEN_WORKSPACE, { id: workspaceId });
      await this.loadAndRender();
      if (isSwitchingToDifferentWindow) {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'CLOSE_WORKSPACES_FLYOUT' }, '*');
          }
          if (document.documentElement.classList.contains('is-popup')) {
            window.close();
          }
        } catch {}
      }
    } catch (err) {
      alert(`Could not open workspace: ${err.message}`);
    }
  }

  handleContextMenu(params) {
    showContextMenu({
      ...params,
      onOpen: (id) => this.handleOpenWorkspace(id),
      onCloseWindow: async (id) => {
        await sendBackgroundMessage(MESSAGE_TYPES.CLOSE_WORKSPACE, { id });
        await this.loadAndRender();
      },
      onRename: (ws) => this.openRenameModal(ws),
      onChangeColor: async (id, newColor) => {
        await sendBackgroundMessage(MESSAGE_TYPES.RECOLOR_WORKSPACE, { id, color: newColor });
        await this.loadAndRender();
      },
      onDuplicate: async (id) => {
        await sendBackgroundMessage(MESSAGE_TYPES.DUPLICATE_WORKSPACE, { id });
        await this.loadAndRender();
      },
      onDelete: (ws) => this.promptDeleteWorkspace(ws)
    });
  }

  async handleTabClick(workspaceId, tab) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.OPEN_TAB_IN_WORKSPACE, {
        workspaceId,
        tabId: tab.id,
        url: tab.url
      });
      if (document.documentElement.classList.contains('is-popup')) {
        window.close();
      } else {
        await this.loadAndRender();
      }
    } catch (err) {
      console.warn('handleTabClick error:', err);
    }
  }

  async handleTabClose(workspaceId, tabId) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE, {
        workspaceId,
        tabId
      });
      await this.loadAndRender();
    } catch (err) {
      console.warn('handleTabClose error:', err);
    }
  }

  async handleReorderDrop(sourceId, targetId, position) {
    const order = [...this.workspaceOrder];
    const sourceIdx = order.indexOf(sourceId);
    if (sourceIdx === -1) return;

    order.splice(sourceIdx, 1);
    let targetIdx = order.indexOf(targetId);
    if (position === 'after') {
      targetIdx += 1;
    }
    order.splice(targetIdx, 0, sourceId);

    this.workspaceOrder = order;
    this.renderList();

    try {
      await sendBackgroundMessage(MESSAGE_TYPES.REORDER_WORKSPACES, { order });
    } catch (err) {
      console.warn('handleReorderDrop error:', err);
      await this.loadAndRender();
    }
  }

  async handleTabDrop(tabId, targetWorkspaceId) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE, {
        tabId,
        targetWorkspaceId
      });
      await this.loadAndRender();
    } catch (err) {
      alert(`Could not move tab: ${err.message}`);
    }
  }

  switchMode(mode) {
    this.currentMode = mode;
    const newWsSection = document.querySelector('.new-workspace-section');

    if (mode === 'workspaces') {
      if (this.navBtnWorkspaces) {
        this.navBtnWorkspaces.classList.add('active');
        this.navBtnWorkspaces.setAttribute('aria-selected', 'true');
      }
      if (this.navBtnOpenTabs) {
        this.navBtnOpenTabs.classList.remove('active');
        this.navBtnOpenTabs.setAttribute('aria-selected', 'false');
      }

      this.listContainer.classList.remove('hidden');
      if (this.searchSection) this.searchSection.classList.remove('hidden');
      if (this.windowTabsSection) this.windowTabsSection.classList.add('hidden');
      if (newWsSection) {
        const hasWorkspaces = Object.keys(this.workspaces).length > 0;
        newWsSection.style.display = hasWorkspaces ? 'block' : 'none';
      }
      this.renderList();
    } else {
      if (this.navBtnOpenTabs) {
        this.navBtnOpenTabs.classList.add('active');
        this.navBtnOpenTabs.setAttribute('aria-selected', 'true');
      }
      if (this.navBtnWorkspaces) {
        this.navBtnWorkspaces.classList.remove('active');
        this.navBtnWorkspaces.setAttribute('aria-selected', 'false');
      }

      this.listContainer.classList.add('hidden');
      if (this.searchSection) this.searchSection.classList.add('hidden');
      if (this.windowTabsSection) this.windowTabsSection.classList.remove('hidden');
      if (newWsSection) {
        newWsSection.style.display = 'none';
      }
      if (this.liveTabsView) {
        this.liveTabsView.loadAndRender();
      }
    }
    this.notifyFlyoutHeight();
  }

  async handleTabMerge(mergeParams) {
    try {
      const res = await sendBackgroundMessage(MESSAGE_TYPES.MERGE_TABS_INTO_GROUP, mergeParams);
      await this.loadAndRender();
      if (res?.groupId && res?.isNew) {
        // Find newly rendered group header in target workspace card to anchor name prompt
        const targetWsCard = document.getElementById(`card-${mergeParams.targetWorkspaceId}`);
        const groupHeader = targetWsCard?.querySelector(`.workspace-group-section[data-group-id="${res.groupId}"] .workspace-group-header`);

        showNamePrompt(res.groupId, groupHeader || null, async ({ groupId, title, color }) => {
          const targetWsId = mergeParams.targetWorkspaceId;
          if (targetWsId) {
            await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_TAB_GROUP, {
              workspaceId: targetWsId,
              groupId: groupId || res.groupId,
              title,
              color
            }).catch(() => {});
            await this.loadAndRender();
          }
        });
      }
    } catch (err) {
      console.warn('handleTabMerge error:', err);
    }
  }

  async handleAddTabToGroup({ workspaceId, tabId, groupId }) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.ADD_TAB_TO_GROUP, {
        workspaceId,
        tabId,
        groupId
      });
      await this.loadAndRender();
    } catch (err) {
      console.warn('handleAddTabToGroup error:', err);
    }
  }

  async handleUngroup(workspaceId, groupId) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.UNGROUP_TABS, {
        workspaceId,
        groupId
      });
      await this.loadAndRender();
    } catch (err) {
      console.warn('handleUngroup error:', err);
    }
  }

  async handleRemoveTabFromGroup({ workspaceId, tabId }) {
    try {
      await sendBackgroundMessage(MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP, {
        workspaceId,
        tabId
      });
      await this.loadAndRender();
    } catch (err) {
      console.warn('handleRemoveTabFromGroup error:', err);
    }
  }

  handleUpdateGroup(workspaceId, groupId, anchorEl) {
    showNamePrompt(groupId, anchorEl, async ({ groupId: updatedGid, title, color }) => {
      try {
        await sendBackgroundMessage(MESSAGE_TYPES.UPDATE_TAB_GROUP, {
          workspaceId,
          groupId: updatedGid || groupId,
          title,
          color
        });
        await this.loadAndRender();
      } catch (err) {
        console.warn('handleUpdateGroup error:', err);
      }
    });
  }

  openNewWorkspaceModal(fromCurrentWindow = false) {
    let defaultName = 'Workspace 1';
    let counter = 1;
    const existingNames = new Set(
      Object.values(this.workspaces).map((w) => (w.name || '').toLowerCase().trim())
    );
    while (existingNames.has(`workspace ${counter}`)) {
      counter++;
    }
    defaultName = `Workspace ${counter}`;

    this.newWsNameInput.value = defaultName;
    this.newWsFromCurrent.checked = fromCurrentWindow;

    // Pick an unused color from Fluent colors
    const ALL_COLORS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray'];
    const usedColors = new Set(Object.values(this.workspaces).map((w) => w.color));
    const nextColor = ALL_COLORS.find((c) => !usedColors.has(c)) || ALL_COLORS[(counter - 1) % ALL_COLORS.length];
    this.colorPicker.setSelected(nextColor);

    this.modalNew.classList.remove('hidden');
    try {
      this.newWsNameInput.focus();
      this.newWsNameInput.select();
    } catch {}
  }

  notifyFlyoutHeight() {
    // Flyout maintains a stable, dependable fixed height with smooth internal scrolling
  }

  openRenameModal(workspace) {
    this.renameWsId.value = workspace.id;
    this.renameWsName.value = workspace.name;
    if (this.colorPickerEdit && workspace.color) {
      this.colorPickerEdit.setSelected(workspace.color);
    }
    this.modalRename.classList.remove('hidden');
    try {
      this.renameWsName.focus();
      this.renameWsName.select();
    } catch {}
  }

  async promptDeleteWorkspace(workspace) {
    if (!this.settings?.confirmDelete) {
      // Bypassed in settings
      await sendBackgroundMessage(MESSAGE_TYPES.DELETE_WORKSPACE, { id: workspace.id });
      await this.loadAndRender();
      return;
    }

    this.pendingDeleteWorkspace = workspace;
    this.deletePromptText.textContent = `Are you sure you want to delete "${workspace.name}"? Its open window will stay open as unmanaged.`;
    this.deleteDontAskAgain.checked = false;
    this.modalDelete.classList.remove('hidden');
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new SidePanelApp();
  app.init();
});
