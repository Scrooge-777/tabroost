/**
 * Workspace Card Component — Renders a single workspace row in the side panel
 */

import { getColor } from '../../shared/colors.js';
import { renderTabList } from './tab-list.js';

export function renderWorkspaceCard({
  workspace,
  isOpen,
  isCurrentWindow,
  isExpanded,
  searchQuery = '',
  onToggleExpand,
  onOpenWorkspace,
  onContextMenu,
  onTabClick,
  onTabClose,
  onTabMerge,
  onAddTabToGroup,
  onUngroup,
  onUpdateGroup,
  onRemoveTabFromGroup,
  onReorderDrop,
  onTabDrop
}) {
  const card = document.createElement('div');
  const colorDef = getColor(workspace.color);

  card.className = `workspace-card ${isCurrentWindow ? 'current-window' : ''} ${isOpen ? 'is-open' : ''}`;
  card.id = `card-${workspace.id}`;
  card.dataset.workspaceId = workspace.id;
  card.draggable = true;

  // Visual styling for active workspace
  if (isCurrentWindow) {
    card.style.borderLeftColor = colorDef.hex;
  }

  // --- Header Row ---
  const header = document.createElement('div');
  header.className = 'workspace-card-header';

  // Drag handle / Color dot
  const dot = document.createElement('span');
  dot.className = 'workspace-color-dot';
  dot.style.backgroundColor = colorDef.hex;
  dot.title = `Color: ${colorDef.name}`;
  header.appendChild(dot);

  // Name and tab count (two-line layout matching Edge)
  const textGroup = document.createElement('div');
  textGroup.className = 'workspace-text-group';

  const titleRow = document.createElement('div');
  titleRow.className = 'workspace-title-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'workspace-name';
  nameSpan.textContent = workspace.name;
  titleRow.appendChild(nameSpan);
  textGroup.appendChild(titleRow);

  const tabCount = (workspace.tabs || []).length;
  const countBadge = document.createElement('span');
  countBadge.className = 'workspace-tab-count';
  countBadge.textContent = `${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`;
  textGroup.appendChild(countBadge);

  header.appendChild(textGroup);

  // Actions wrapper container for consistent right-side alignment
  const actions = document.createElement('div');
  actions.className = 'workspace-card-actions';

  // Status indicator slot (Edge style: checkmark for active window, dot for open window, spacer for closed)
  const statusSlot = document.createElement('div');
  statusSlot.className = 'workspace-status-slot';

  if (isCurrentWindow) {
    const checkmark = document.createElement('span');
    checkmark.className = 'workspace-active-check';
    checkmark.title = 'Active in current window';
    checkmark.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>';
    statusSlot.appendChild(checkmark);
  } else if (isOpen) {
    const openDot = document.createElement('span');
    openDot.className = 'workspace-open-dot';
    openDot.title = 'Open in another window';
    statusSlot.appendChild(openDot);
  }
  actions.appendChild(statusSlot);

  // Expand / collapse chevron button
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = `workspace-expand-btn ${isExpanded ? 'expanded' : ''}`;
  expandBtn.title = isExpanded ? 'Collapse tabs' : 'Preview tabs';
  expandBtn.innerHTML = isExpanded
    ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6L4.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleExpand(workspace.id);
  });
  actions.appendChild(expandBtn);

  // More options (...) button
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'workspace-menu-btn';
  menuBtn.title = 'Workspace options';
  menuBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="13" r="1.5" fill="currentColor"/></svg>';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = menuBtn.getBoundingClientRect();
    onContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      workspace,
      isOpen,
      isCurrentWindow
    });
  });
  actions.appendChild(menuBtn);

  header.appendChild(actions);

  // Clicking the card header: if it's the current workspace, toggle expand tabs; otherwise switch to it
  header.addEventListener('click', (e) => {
    // Avoid double trigger if clicking expand or menu buttons
    if (e.target.closest('.workspace-expand-btn') || e.target.closest('.workspace-menu-btn')) {
      return;
    }
    if (isCurrentWindow) {
      onToggleExpand(workspace.id);
    } else {
      onOpenWorkspace(workspace.id);
    }
  });

  // Right-click opens context menu
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onContextMenu({
      x: e.clientX,
      y: e.clientY,
      workspace,
      isOpen,
      isCurrentWindow
    });
  });

  card.appendChild(header);

  // --- Expandable Tab List ---
  if (isExpanded) {
    const tabList = renderTabList({
      workspace,
      isOpen,
      searchQuery,
      onTabClick,
      onTabClose,
      onTabMerge,
      onAddTabToGroup,
      onUngroup,
      onUpdateGroup,
      onRemoveTabFromGroup
    });
    card.appendChild(tabList);
  }

  // --- Drag and Drop Handlers for Reordering and Tab Drop ---
  card.addEventListener('dragstart', (e) => {
    if (e.target.closest('.tab-list-row')) return; // Tab drag handled by tab-list
    e.dataTransfer.setData('application/x-workspace-id', workspace.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    document.querySelectorAll('.workspace-card').forEach((c) => c.classList.remove('drag-over-top', 'drag-over-bottom', 'tab-drop-target'));
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();

    // Check if dragging a tab
    if (e.dataTransfer.types.includes('text/plain')) {
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('tab-drop-target');
      return;
    }

    // Otherwise dragging a workspace card for reorder
    if (e.dataTransfer.types.includes('application/x-workspace-id')) {
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        card.classList.add('drag-over-top');
        card.classList.remove('drag-over-bottom');
      } else {
        card.classList.add('drag-over-bottom');
        card.classList.remove('drag-over-top');
      }
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-top', 'drag-over-bottom', 'tab-drop-target');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    const isTabDrop = e.dataTransfer.types.includes('text/plain');

    if (isTabDrop) {
      card.classList.remove('tab-drop-target');
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.sourceWorkspaceId !== workspace.id) {
          onTabDrop(data.tabId, workspace.id);
        }
      } catch {
        // Ignore parse error
      }
      return;
    }

    // Workspace reorder drop
    const sourceWsId = e.dataTransfer.getData('application/x-workspace-id');
    if (sourceWsId && sourceWsId !== workspace.id) {
      const isTop = card.classList.contains('drag-over-top');
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      onReorderDrop(sourceWsId, workspace.id, isTop ? 'before' : 'after');
    }
  });

  return card;
}
