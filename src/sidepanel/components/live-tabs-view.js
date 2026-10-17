/**
 * Live Tabs View — Renders current window's open tabs as draggable rows for drag-to-merge tab grouping
 */

import { getFaviconUrl, getFallbackTileLetter } from '../../shared/utils.js';
import { WORKSPACE_COLORS } from '../../shared/colors.js';
import { showNamePrompt } from './group-name-prompt.js';
import { showTabContextMenu } from './context-menu.js';

export class LiveTabsView {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.currentWindowId = options.currentWindowId || null;
    this.onTabCountChange = options.onTabCountChange || null;
    this.tabs = [];
    this.groups = [];
    this.expandedGroupIds = new Set();

    // Allow dropping a grouped tab onto empty space in the container to ungroup it
    this.container.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/tab-id') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });

    this.container.addEventListener('drop', async (e) => {
      if (e.target.closest('.live-tab-row') || e.target.closest('.live-group-header') || e.target.closest('.live-ungrouped-divider') || e.target.closest('.live-ungroup-dropzone')) {
        return;
      }
      e.preventDefault();
      const rawId = e.dataTransfer.getData('text/tab-id') || e.dataTransfer.getData('text/plain');
      let draggedId = null;
      try {
        const parsed = JSON.parse(rawId);
        if (parsed?.tabId) draggedId = Number(parsed.tabId);
      } catch {}
      if (!draggedId) draggedId = Number(rawId);
      if (!draggedId) return;

      try {
        const draggedTab = await chrome.tabs.get(draggedId);
        const TAB_GROUP_ID_NONE = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;
        if (draggedTab.groupId && draggedTab.groupId !== TAB_GROUP_ID_NONE) {
          await chrome.tabs.ungroup([draggedId]);
          await this.loadAndRender();
        }
      } catch (err) {
        console.warn('Container drop ungroup failed:', err);
      }
    });
  }

  async loadAndRender() {
    try {
      if (!this.currentWindowId && chrome.windows?.getLastFocused) {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        this.currentWindowId = win ? win.id : (await chrome.windows?.getCurrent?.())?.id;
      }

      if (!this.currentWindowId || !chrome.tabs?.query) return;

      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId: this.currentWindowId }),
        chrome.tabGroups?.query ? chrome.tabGroups.query({ windowId: this.currentWindowId }) : Promise.resolve([])
      ]);

      this.tabs = tabs || [];
      this.groups = groups || [];

      if (typeof this.onTabCountChange === 'function') {
        this.onTabCountChange(this.tabs.length);
      }

      this.render();
    } catch (err) {
      console.warn('LiveTabsView: load error', err);
    }
  }

  render() {
    this.container.innerHTML = '';

    if (this.tabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <p class="empty-state-desc">No open tabs in this window.</p>
      `;
      this.container.appendChild(empty);
      return;
    }

    const groupsMap = new Map(this.groups.map((g) => [g.id, g]));

    // Group tabs by groupId (-1 / undefined = ungrouped)
    const groupedTabs = new Map();
    const ungroupedTabs = [];

    this.tabs.forEach((t) => {
      if (t.groupId && t.groupId !== -1 && groupsMap.has(t.groupId)) {
        if (!groupedTabs.has(t.groupId)) {
          groupedTabs.set(t.groupId, []);
        }
        groupedTabs.get(t.groupId).push(t);
      } else {
        ungroupedTabs.push(t);
      }
    });

    // 1. Render Group Sections
    for (const [groupId, tabsInGroup] of groupedTabs.entries()) {
      const group = groupsMap.get(groupId);
      const isExpanded = this.expandedGroupIds.has(groupId);
      const isCollapsed = !isExpanded;

      const groupSection = document.createElement('div');
      groupSection.className = `live-group-section ${isCollapsed ? 'is-collapsed' : ''}`;
      groupSection.dataset.groupId = groupId;

      const colorDef = WORKSPACE_COLORS[group.color] || WORKSPACE_COLORS.grey || { hex: '#888888' };

      // Group Header
      const header = document.createElement('div');
      header.className = 'live-group-header';
      header.style.borderLeftColor = colorDef.hex;

      header.innerHTML = `
        <span class="lgh-chevron ${isExpanded ? 'expanded' : ''}" title="${isExpanded ? 'Collapse group' : 'Expand group'}">
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 2.5L7.5 6L4 9.5"/>
          </svg>
        </span>
        <span class="lgh-indicator" style="background-color: ${colorDef.hex};"></span>
        <span class="lgh-title">${escapeHtml(group.title || 'Group')}</span>
        <span class="lgh-count">${tabsInGroup.length}</span>
        <button type="button" class="lgh-rename-btn" title="Rename or recolor group">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
          </svg>
        </button>
        <button type="button" class="lgh-ungroup-btn" title="Ungroup tabs">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 3l10 10M13 3L3 13" stroke-linecap="round"/>
          </svg>
        </button>
      `;

      // Allow dragging group headers or dropping tabs onto group headers to join group
      header.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/tab-id')) {
          e.preventDefault();
          header.classList.add('drop-hover');
        }
      });
      header.addEventListener('dragleave', () => header.classList.remove('drop-hover'));
      header.addEventListener('drop', async (e) => {
        e.preventDefault();
        header.classList.remove('drop-hover');
        const draggedId = Number(e.dataTransfer.getData('text/tab-id'));
        if (draggedId) {
          try {
            await chrome.tabs.group({ tabIds: [draggedId], groupId });
            if (chrome.tabGroups?.update) {
              await chrome.tabGroups.update(groupId, { collapsed: false }).catch(() => {});
            }
            this.expandedGroupIds.add(groupId);
            await this.loadAndRender();
          } catch (err) {
            console.warn('Failed to add tab to group:', err);
          }
        }
      });

      // Toggle group collapse on header click
      header.addEventListener('click', async (e) => {
        if (e.target.closest('.lgh-rename-btn') || e.target.closest('.lgh-ungroup-btn')) return;
        if (this.expandedGroupIds.has(groupId)) {
          this.expandedGroupIds.delete(groupId);
        } else {
          this.expandedGroupIds.add(groupId);
        }
        if (chrome.tabGroups?.update) {
          try {
            await chrome.tabGroups.update(groupId, { collapsed: !this.expandedGroupIds.has(groupId) });
          } catch {}
        }
        this.render();
      });

      // Rename button triggers custom inline naming prompt
      header.querySelector('.lgh-rename-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showNamePrompt(groupId, header, () => this.loadAndRender());
      });

      // Ungroup button
      header.querySelector('.lgh-ungroup-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const tabIds = tabsInGroup.map((t) => t.id);
        try {
          await chrome.tabs.ungroup(tabIds);
          await this.loadAndRender();
        } catch (err) {
          console.warn('Could not ungroup tabs:', err);
        }
      });

      groupSection.appendChild(header);

      // Group tabs (only rendered when expanded)
      if (isExpanded) {
        let liveSeq = 0;
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'live-group-tabs';
        tabsInGroup.forEach((tab) => {
          tabsContainer.appendChild(this.createDraggableTabRow(tab, group, liveSeq++));
        });
        groupSection.appendChild(tabsContainer);
      }

      this.container.appendChild(groupSection);
    }

    // 2. Render Ungrouped Tabs / Pop-out Dropzone
    if (ungroupedTabs.length > 0) {
      const ungroupedContainer = document.createElement('div');
      ungroupedContainer.className = 'live-ungrouped-container';

      if (groupedTabs.size > 0) {
        const divider = document.createElement('div');
        divider.className = 'live-ungrouped-divider';
        divider.innerHTML = '<span class="lud-title">Ungrouped Tabs</span><span class="live-divider-hint">(drop here to pop out)</span>';
        ungroupedContainer.appendChild(divider);
      }

      let unLiveSeq = 0;
      ungroupedTabs.forEach((tab) => {
        ungroupedContainer.appendChild(this.createDraggableTabRow(tab, null, unLiveSeq++));
      });

      this.attachUngroupDropTarget(ungroupedContainer);
      this.container.appendChild(ungroupedContainer);
    } else if (groupedTabs.size > 0) {
      // All open tabs in this window are currently grouped
      // Provide an immediate drop target zone to ungroup tabs
      const dropzone = document.createElement('div');
      dropzone.className = 'live-ungroup-dropzone';
      dropzone.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3h4v4M13 3l-6 6M4 5H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1"/>
        </svg>
        <span>Drop tab here to pop out of group</span>
      `;
      this.attachUngroupDropTarget(dropzone);
      this.container.appendChild(dropzone);
    }
  }

  attachUngroupDropTarget(element) {
    element.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/tab-id') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        element.classList.add('drop-hover');
      }
    });

    element.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && element.contains(e.relatedTarget)) return;
      element.classList.remove('drop-hover');
    });

    element.addEventListener('drop', async (e) => {
      // If dropped directly on an inner tab row, let that tab row handle precise positioning
      if (e.target.closest('.live-tab-row')) return;

      e.preventDefault();
      e.stopPropagation();
      element.classList.remove('drop-hover');

      const rawId = e.dataTransfer.getData('text/tab-id') || e.dataTransfer.getData('text/plain');
      let draggedId = null;
      try {
        const parsed = JSON.parse(rawId);
        if (parsed?.tabId) draggedId = Number(parsed.tabId);
      } catch {}
      if (!draggedId) draggedId = Number(rawId);

      if (!draggedId) return;

      try {
        const draggedTab = await chrome.tabs.get(draggedId);
        if (draggedTab && typeof draggedTab.groupId === 'number' && draggedTab.groupId > 0) {
          await chrome.tabs.ungroup([draggedId]);
          await this.loadAndRender();
        }
      } catch (err) {
        console.warn('Drop to pop out failed:', err);
      }
    });
  }

  createDraggableTabRow(tab, group = null, seqIndex = 0) {
    const row = document.createElement('div');
    row.className = `live-tab-row ${tab.active ? 'active-tab' : ''}`;
    row.draggable = true;
    row.dataset.tabId = String(tab.id);
    row.title = tab.title || tab.url || 'Tab';
    row.style.setProperty('--tab-seq', String(seqIndex));

    // 1. Drag detection (HTML5 DnD)
    row.addEventListener('dragstart', (e) => {
      document.body.classList.add('is-dragging-tab');
      e.dataTransfer.setData('text/tab-id', String(tab.id));
      e.dataTransfer.setData('text/plain', JSON.stringify({
        tabId: tab.id,
        groupId: tab.groupId && tab.groupId > 0 ? tab.groupId : (group ? group.id : null),
        title: tab.title,
        url: tab.url
      }));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });

    row.addEventListener('dragend', () => {
      document.body.classList.remove('is-dragging-tab');
      row.classList.remove('is-dragging');
      document.querySelectorAll('.live-tab-row').forEach((r) => r.classList.remove('drop-hover'));
      document.querySelectorAll('.live-ungrouped-container, .live-ungroup-dropzone').forEach((el) => el.classList.remove('drop-hover'));
    });

    // 2. Overlap / drop target
    row.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/tab-id') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault(); // required to allow drop
        row.classList.add('drop-hover');
        e.dataTransfer.dropEffect = 'move';
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-hover');
    });

    // 3. On drop — decide new-group vs existing-group vs ungroup
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-hover');

      const rawId = e.dataTransfer.getData('text/tab-id') || e.dataTransfer.getData('text/plain');
      let draggedId = null;
      let draggedGroupId = null;
      try {
        const parsed = JSON.parse(rawId);
        if (parsed?.tabId) {
          draggedId = Number(parsed.tabId);
          draggedGroupId = parsed.groupId;
        }
      } catch {}
      if (!draggedId) draggedId = Number(rawId);
      const targetId = Number(row.dataset.tabId);

      if (!draggedId || !targetId || draggedId === targetId) return;

      try {
        const targetTab = await chrome.tabs.get(targetId);
        const draggedTab = await chrome.tabs.get(draggedId);

        const isTargetGrouped = typeof targetTab.groupId === 'number' && targetTab.groupId > 0;
        const isDraggedGrouped = (draggedTab && typeof draggedTab.groupId === 'number' && draggedTab.groupId > 0) ||
                                (typeof draggedGroupId === 'number' && draggedGroupId > 0);

        if (isTargetGrouped) {
          // Target already belongs to a group -> add dragged tab to target's group
          await chrome.tabs.group({ tabIds: [draggedId], groupId: targetTab.groupId });
          try {
            await chrome.tabs.move(draggedId, { index: targetTab.index });
          } catch (mErr) {
            console.warn('Move after group warn:', mErr);
          }
          if (chrome.tabGroups?.update) {
            await chrome.tabGroups.update(targetTab.groupId, { collapsed: false }).catch(() => {});
          }
          this.expandedGroupIds.add(targetTab.groupId);
          await this.loadAndRender();
        } else if (isDraggedGrouped) {
          // Dragged tab was grouped, target is UNGROUPED -> ungroup only the dragged tab and move alongside target
          await chrome.tabs.ungroup([draggedId]);
          try {
            await chrome.tabs.move(draggedId, { index: targetTab.index });
          } catch (mErr) {
            console.warn('Move after ungroup warn:', mErr);
          }
          await this.loadAndRender();
        } else {
          // Both are plain ungrouped tabs -> create a NEW group with both
          const newGroupId = await chrome.tabs.group({ tabIds: [draggedId, targetId] });
          if (chrome.tabGroups?.update) {
            await chrome.tabGroups.update(newGroupId, { collapsed: false }).catch(() => {});
          }
          this.expandedGroupIds.add(newGroupId);
          await this.loadAndRender();

          // Step 4: Auto-prompt for name right after creation, anchored to the new group header
          const newGroupSection = this.container.querySelector(`.live-group-section[data-group-id="${newGroupId}"]`);
          const newHeader = newGroupSection?.querySelector('.live-group-header');
          if (newHeader) {
            showNamePrompt(newGroupId, newHeader, () => this.loadAndRender());
          }
        }
      } catch (err) {
        console.warn('Drag-to-group drop failed:', err);
      }
    });

    // Favicon
    const iconContainer = document.createElement('div');
    iconContainer.className = 'tab-icon-container';
    const favUrl = getFaviconUrl(tab.url, tab.favIconUrl);

    if (favUrl) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = favUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => {
        img.remove();
        iconContainer.appendChild(createLetterTile(tab.title, tab.url));
      };
      iconContainer.appendChild(img);
    } else {
      iconContainer.appendChild(createLetterTile(tab.title, tab.url));
    }
    row.appendChild(iconContainer);

    // Title
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title || tab.url || 'Untitled Tab';
    row.appendChild(titleSpan);

    // Pop out / ungroup button for grouped tabs (quick 1-click pop-out action)
    const isGroupedTab = Boolean(group || (tab.groupId && tab.groupId > 0));
    if (isGroupedTab) {
      const ungroupBtn = document.createElement('button');
      ungroupBtn.type = 'button';
      ungroupBtn.className = 'tab-ungroup-btn tab-popout-btn';
      ungroupBtn.title = 'Pop out of group';
      ungroupBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h4v4M13 3l-6 6M4 5H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1"/></svg>';
      ungroupBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await chrome.tabs.ungroup([tab.id]);
          await this.loadAndRender();
        } catch (err) {
          console.warn('Could not pop out tab:', err);
        }
      });
      row.appendChild(ungroupBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-close-btn';
    closeBtn.title = 'Close tab';
    closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await chrome.tabs.remove(tab.id);
        row.remove();
      } catch (err) {
        console.warn('Could not close tab:', err);
      }
    });
    row.appendChild(closeBtn);

    // Right-click context menu (Pop out of group, Pop out to new window, Duplicate, Close)
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu({
        x: e.clientX,
        y: e.clientY,
        tab,
        isGrouped: isGroupedTab,
        onPopOut: async () => {
          try {
            await chrome.tabs.ungroup([tab.id]);
            await this.loadAndRender();
          } catch (err) {
            console.warn('Pop out error:', err);
          }
        },
        onPopOutNewWindow: async () => {
          try {
            await chrome.windows.create({ tabId: tab.id, focused: true });
            await this.loadAndRender();
          } catch (err) {
            console.warn('Pop out to new window error:', err);
          }
        },
        onDuplicate: async () => {
          try {
            await chrome.tabs.duplicate(tab.id);
            await this.loadAndRender();
          } catch (err) {
            console.warn('Duplicate error:', err);
          }
        },
        onClose: async () => {
          try {
            await chrome.tabs.remove(tab.id);
            row.remove();
          } catch (err) {
            console.warn('Close error:', err);
          }
        }
      });
    });

    // Click row to activate tab
    row.addEventListener('click', async (e) => {
      if (e.target.closest('.tab-close-btn') || e.target.closest('.tab-ungroup-btn') || e.target.closest('.tab-popout-btn')) return;
      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      } catch (err) {
        console.warn('Could not activate tab:', err);
      }
    });

    return row;
  }
}

function isNewTabUrl(url = '', title = '') {
  const u = (url || '').toLowerCase();
  const t = (title || '').toLowerCase().trim();
  return u.startsWith('chrome://newtab') ||
         u.startsWith('brave://newtab') ||
         u.startsWith('edge://newtab') ||
         u === 'about:blank' ||
         !url ||
         t === 'new tab';
}

function createLetterTile(title = '', url = '') {
  if (isNewTabUrl(url, title)) {
    const tile = document.createElement('span');
    tile.className = 'tab-newtab-icon';
    tile.title = 'New Tab';
    tile.innerHTML = `
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="4.5" width="12" height="9.5" rx="1.8" fill="currentColor" fill-opacity="0.12"/>
        <path d="M4.5 4.5V2.8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.7"/>
        <line x1="8" y1="7.2" x2="8" y2="11.2"/>
        <line x1="6" y1="9.2" x2="10" y2="9.2"/>
      </svg>
    `;
    return tile;
  }
  const tile = document.createElement('span');
  tile.className = 'tab-letter-tile';
  tile.textContent = getFallbackTileLetter(title, url);
  return tile;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
