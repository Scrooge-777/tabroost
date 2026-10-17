/**
 * Tab List Component — Expandable list of tabs within a workspace,
 * featuring full Microsoft Edge-style tab group sections, color coding,
 * rename, ungroup, collapse/expand, and drag-and-drop tab grouping.
 */

import { getFaviconUrl, getFallbackTileLetter } from '../../shared/utils.js';
import { WORKSPACE_COLORS } from '../../shared/colors.js';
import { showTabContextMenu } from './context-menu.js';

export function renderTabList({
  workspace,
  isOpen,
  searchQuery = '',
  onTabClick,
  onTabClose,
  onTabDragStart,
  onTabMerge,
  onAddTabToGroup,
  onUngroup,
  onUpdateGroup,
  onRemoveTabFromGroup
}) {
  const container = document.createElement('div');
  container.className = 'workspace-tab-list';

  let tabs = workspace.tabs || [];
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    const nameMatches = (workspace.name || '').toLowerCase().includes(query);
    if (!nameMatches) {
      tabs = tabs.filter(
        (t) =>
          (t.title && t.title.toLowerCase().includes(query)) ||
          (t.url && t.url.toLowerCase().includes(query))
      );
    }
  }

  if (tabs.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'tab-list-empty';
    emptyMsg.textContent = searchQuery ? 'No matching tabs' : 'No tabs in this workspace';
    container.appendChild(emptyMsg);
    return container;
  }

  const groupsMap = new Map((workspace.groups || []).map((g) => [String(g.id), g]));

  // Partition tabs into grouped vs ungrouped
  const groupedTabs = new Map();
  const ungroupedTabs = [];

  tabs.forEach((tab) => {
    if (tab.groupId != null && String(tab.groupId) !== '-1' && String(tab.groupId) !== '') {
      const gid = String(tab.groupId);
      if (!groupedTabs.has(gid)) {
        groupedTabs.set(gid, []);
      }
      groupedTabs.get(gid).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  });

  // 1. Render Group Sections (Edge style)
  for (const [groupId, tabsInGroup] of groupedTabs.entries()) {
    const group = groupsMap.get(groupId) || {
      id: groupId,
      title: 'Group',
      color: 'blue',
      collapsed: false
    };

    const groupSection = document.createElement('div');
    groupSection.className = 'workspace-group-section';
    groupSection.dataset.groupId = groupId;

    const colDef = WORKSPACE_COLORS[group.color] || WORKSPACE_COLORS.blue || { hex: '#0078d4' };

    // Group Header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'workspace-group-header';
    groupHeader.style.borderLeftColor = colDef.hex;
    groupHeader.title = `Group: ${group.title || 'Group'} (${tabsInGroup.length} ${tabsInGroup.length === 1 ? 'tab' : 'tabs'})`;

    const isInitiallyCollapsed = true;
    groupSection.classList.add('is-collapsed');

    groupHeader.innerHTML = `
      <span class="lgh-chevron ${isInitiallyCollapsed ? '' : 'expanded'}">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
          <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
        </svg>
      </span>
      <span class="lgh-indicator" style="background-color: ${colDef.hex}"></span>
      <span class="lgh-title">${escapeHtml(group.title || 'Group')}</span>
      <span class="lgh-count">${tabsInGroup.length}</span>
      <button type="button" class="lgh-rename-btn" title="Rename or recolor group">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
          <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
        </svg>
      </button>
      <button type="button" class="lgh-ungroup-btn" title="Ungroup tabs">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    const chevron = groupHeader.querySelector('.lgh-chevron');

    // Group header click toggles collapse
    groupHeader.addEventListener('click', (e) => {
      if (e.target.closest('.lgh-rename-btn') || e.target.closest('.lgh-ungroup-btn')) return;
      const isCollapsed = groupSection.classList.toggle('is-collapsed');
      if (chevron) {
        chevron.classList.toggle('expanded', !isCollapsed);
      }
      const tabsEl = groupSection.querySelector('.workspace-group-tabs');
      if (tabsEl) {
        tabsEl.style.display = isCollapsed ? 'none' : 'flex';
      }
    });

    // Rename button
    groupHeader.querySelector('.lgh-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onUpdateGroup === 'function') {
        onUpdateGroup(workspace.id, groupId, groupHeader);
      }
    });

    // Ungroup button
    groupHeader.querySelector('.lgh-ungroup-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onUngroup === 'function') {
        onUngroup(workspace.id, groupId);
      }
    });

    // Drag-over to join group
    groupHeader.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('text/tab-id')) {
        e.preventDefault();
        e.stopPropagation();
        groupHeader.classList.add('drop-hover');
        e.dataTransfer.dropEffect = 'move';
      }
    });

    groupHeader.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      groupHeader.classList.remove('drop-hover');
    });

    groupHeader.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      groupHeader.classList.remove('drop-hover');

      const dragged = extractDraggedData(e);
      if (!dragged || !dragged.tabId) return;

      if (typeof onAddTabToGroup === 'function') {
        onAddTabToGroup({
          workspaceId: workspace.id,
          tabId: dragged.tabId,
          groupId
        });
      }
    });

    groupSection.appendChild(groupHeader);

    // Group tabs container
    const groupTabsContainer = document.createElement('div');
    groupTabsContainer.className = 'workspace-group-tabs';
    if (isInitiallyCollapsed) {
      groupTabsContainer.style.display = 'none';
    }

    let tabSeq = 0;

    tabsInGroup.forEach((tab) => {
      groupTabsContainer.appendChild(
        createTabRow({
          tab,
          workspace,
          group,
          seqIndex: tabSeq++,
          onTabClick,
          onTabClose,
          onTabDragStart,
          onTabMerge,
          onAddTabToGroup,
          onRemoveTabFromGroup
        })
      );
    });

    groupSection.appendChild(groupTabsContainer);
    container.appendChild(groupSection);
  }

  // 2. Render Ungrouped Tabs / Pop-out Dropzone
  if (ungroupedTabs.length > 0) {
    const ungroupedContainer = document.createElement('div');
    ungroupedContainer.className = 'workspace-ungrouped-container';

    if (groupedTabs.size > 0) {
      const divider = document.createElement('div');
      divider.className = 'workspace-ungrouped-divider';
      divider.innerHTML = '<span class="wud-title">Ungrouped Tabs</span><span class="divider-hint">(drop here to pop out)</span>';
      ungroupedContainer.appendChild(divider);
    }

    let unSeq = 0;
    ungroupedTabs.forEach((tab) => {
      ungroupedContainer.appendChild(
        createTabRow({
          tab,
          workspace,
          group: null,
          seqIndex: unSeq++,
          onTabClick,
          onTabClose,
          onTabDragStart,
          onTabMerge,
          onAddTabToGroup,
          onRemoveTabFromGroup
        })
      );
    });

    attachWorkspaceUngroupDrop(ungroupedContainer, workspace.id, onRemoveTabFromGroup);
    container.appendChild(ungroupedContainer);
  } else if (groupedTabs.size > 0) {
    // All tabs in this workspace are grouped -> show drop target to ungroup
    const dropzone = document.createElement('div');
    dropzone.className = 'workspace-ungroup-dropzone';
    dropzone.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 3h4v4M13 3l-6 6M4 5H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1"/>
      </svg>
      <span>Drop tab here to pop out of group</span>
    `;
    attachWorkspaceUngroupDrop(dropzone, workspace.id, onRemoveTabFromGroup);
    container.appendChild(dropzone);
  }

  return container;
}

function createTabRow({
  tab,
  workspace,
  group,
  seqIndex = 0,
  onTabClick,
  onTabClose,
  onTabDragStart,
  onTabMerge,
  onAddTabToGroup,
  onRemoveTabFromGroup
}) {
  const tabRow = document.createElement('div');
  tabRow.className = `tab-list-row ${tab.active ? 'active-tab' : ''}`;
  tabRow.title = tab.title || tab.url || 'Tab';
  tabRow.draggable = true;
  tabRow.dataset.tabId = String(tab.id);
  tabRow.style.setProperty('--tab-seq', String(seqIndex));

  // Drag start
  tabRow.addEventListener('dragstart', (e) => {
    document.body.classList.add('is-dragging-tab');
    e.dataTransfer.setData('text/plain', JSON.stringify({
      tabId: tab.id,
      groupId: tab.groupId && String(tab.groupId) !== '-1' ? tab.groupId : (group ? group.id : null),
      sourceWorkspaceId: workspace.id,
      url: tab.url,
      title: tab.title
    }));
    e.dataTransfer.setData('text/tab-id', String(tab.id));
    e.dataTransfer.effectAllowed = 'move';
    tabRow.classList.add('dragging');
    if (typeof onTabDragStart === 'function') {
      onTabDragStart(tab, workspace);
    }
  });

  tabRow.addEventListener('dragend', () => {
    document.body.classList.remove('is-dragging-tab');
    tabRow.classList.remove('dragging');
    document.querySelectorAll('.tab-list-row').forEach((r) => r.classList.remove('tab-merge-target'));
    document.querySelectorAll('.workspace-ungrouped-container, .workspace-ungroup-dropzone').forEach((el) => el.classList.remove('drop-hover'));
  });

  // Drag over
  tabRow.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('text/tab-id')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      tabRow.classList.add('tab-merge-target');
    }
  });

  tabRow.addEventListener('dragleave', () => {
    e.stopPropagation();
    tabRow.classList.remove('tab-merge-target');
  });

  // Drop
  tabRow.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('text/tab-id')) return;
    e.preventDefault();
    e.stopPropagation();
    tabRow.classList.remove('tab-merge-target');

    const dragged = extractDraggedData(e);
    if (!dragged || !dragged.tabId || dragged.tabId === tab.id || String(dragged.tabId) === String(tab.id)) {
      return;
    }

    const isTargetGrouped = Boolean(tab.groupId && String(tab.groupId) !== '-1');
    const isDraggedGrouped = Boolean(dragged.groupId && String(dragged.groupId) !== '-1');

    if (isTargetGrouped && typeof onAddTabToGroup === 'function') {
      // Tab is in an existing group -> add dropped tab to this group
      onAddTabToGroup({
        workspaceId: workspace.id,
        tabId: dragged.tabId,
        groupId: tab.groupId
      });
    } else if (isDraggedGrouped && !isTargetGrouped && typeof onRemoveTabFromGroup === 'function') {
      // Dragged was grouped, target is UNGROUPED -> remove dragged tab from its group!
      onRemoveTabFromGroup({
        workspaceId: dragged.sourceWorkspaceId || workspace.id,
        tabId: dragged.tabId
      });
    } else if (typeof onTabMerge === 'function') {
      // Both ungrouped -> merge into new group
      onTabMerge({
        sourceWorkspaceId: dragged.sourceWorkspaceId || workspace.id,
        sourceTabId: dragged.tabId,
        targetWorkspaceId: workspace.id,
        targetTabId: tab.id
      });
    }
  });

  // Favicon or letter tile
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
  tabRow.appendChild(iconContainer);

  // Tab Title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = tab.title || tab.url || 'Untitled';
  tabRow.appendChild(titleSpan);

  // Pinned icon
  if (tab.pinned) {
    const pinIcon = document.createElement('span');
    pinIcon.className = 'tab-pinned-icon';
    pinIcon.title = 'Pinned';
    pinIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.283.282-.544.441-.699.521h1.845a.5.5 0 0 1 .354.854l-.793.792a4 4 0 0 0-.828 1.488 4 4 0 0 0-.233 1.366v1h.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-4l-1 5.5a.5.5 0 0 1-.986-.178l.84-4.622h-3.354a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h.5v-1c0-.472-.08-.94-.233-1.366a4 4 0 0 0-.828-1.488l-.793-.792A.5.5 0 0 1 2.5 2h1.845c-.155-.08-.416-.239-.699-.521C3.342 1.174 3 1.18 3 .5a.5.5 0 0 1 .5-.5h.646z"/></svg>';
    tabRow.appendChild(pinIcon);
  }

  // Quick ungroup / pop out button for grouped tabs
  const isGroupedTab = Boolean(group || (tab.groupId && String(tab.groupId) !== '-1' && String(tab.groupId) !== ''));
  if (isGroupedTab) {
    const ungroupBtn = document.createElement('button');
    ungroupBtn.type = 'button';
    ungroupBtn.className = 'tab-ungroup-btn tab-popout-btn';
    ungroupBtn.title = 'Pop out of group';
    ungroupBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h4v4M13 3l-6 6M4 5H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1"/></svg>';
    ungroupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onRemoveTabFromGroup === 'function') {
        onRemoveTabFromGroup({
          workspaceId: workspace.id,
          tabId: tab.id
        });
      }
    });
    tabRow.appendChild(ungroupBtn);
  }

  // Close tab button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tab-close-btn';
  closeBtn.title = 'Close tab';
  closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2L10 10M10 2L2 10"/></svg>';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof onTabClose === 'function') {
      onTabClose(workspace.id, tab.id);
    }
  });
  tabRow.appendChild(closeBtn);

  // Right-click context menu (Pop out, new window, close)
  tabRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab,
      isGrouped: isGroupedTab,
      onPopOut: () => {
        if (typeof onRemoveTabFromGroup === 'function') {
          onRemoveTabFromGroup({ workspaceId: workspace.id, tabId: tab.id });
        }
      },
      onPopOutNewWindow: () => {
        if (tab.url && chrome.windows?.create) {
          chrome.windows.create({ url: tab.url, focused: true });
        }
      },
      onClose: () => {
        if (typeof onTabClose === 'function') {
          onTabClose(workspace.id, tab.id);
        }
      }
    });
  });

  // Row click
  tabRow.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close-btn') || e.target.closest('.tab-ungroup-btn') || e.target.closest('.tab-popout-btn')) return;
    if (typeof onTabClick === 'function') {
      onTabClick(workspace.id, tab);
    }
  });

  return tabRow;
}

function attachWorkspaceUngroupDrop(element, workspaceId, onRemoveTabFromGroup) {
  element.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('text/tab-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      element.classList.add('drop-hover');
    }
  });

  element.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && element.contains(e.relatedTarget)) return;
    element.classList.remove('drop-hover');
  });

  element.addEventListener('drop', (e) => {
    if (e.target.closest('.tab-list-row')) return;
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drop-hover');

    const dragged = extractDraggedData(e);
    if (dragged && dragged.tabId && typeof onRemoveTabFromGroup === 'function') {
      onRemoveTabFromGroup({
        workspaceId: dragged.sourceWorkspaceId || workspaceId,
        tabId: dragged.tabId
      });
    }
  });
}

function extractDraggedData(e) {
  const plain = e.dataTransfer.getData('text/plain');
  if (plain) {
    try {
      const parsed = JSON.parse(plain);
      if (parsed && parsed.tabId) return parsed;
    } catch {}
  }
  const tabIdStr = e.dataTransfer.getData('text/tab-id');
  if (tabIdStr) {
    const tabId = parseInt(tabIdStr, 10);
    if (!isNaN(tabId)) {
      return { tabId };
    }
    return { tabId: tabIdStr };
  }
  return null;
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

function createLetterTile(title, url) {
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
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
