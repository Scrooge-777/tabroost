/**
 * Workspace Card Component — one workspace row with an expandable tab tree
 */

import { applyColorVars } from '../../shared/colors.js';
import { escapeHtml, timeAgo } from '../../shared/utils.js';
import { ICONS } from './icons.js';
import { renderTabTree, attachDrop, isTabDrag, describeWorkspace } from './tab-tree.js';

const CARD_DRAG_TYPE = 'application/x-workspaces-card';

export function renderWorkspaceCard({
  workspace,
  isOpen,
  isCurrentWindow,
  isExpanded,
  searchQuery = '',
  draggable = true,
  isGroupExpanded,
  on
}) {
  const card = document.createElement('div');
  card.className = `ws-card${isCurrentWindow ? ' is-current' : ''}${isOpen ? ' is-open' : ''}${isExpanded ? ' is-expanded' : ''}`;
  card.id = `card-${workspace.id}`;
  card.dataset.workspaceId = workspace.id;
  card.setAttribute('role', 'listitem');
  applyColorVars(card, workspace.color);

  const status = isCurrentWindow
    ? '<span class="ws-status is-current" title="This window">This window</span>'
    : isOpen
      ? '<span class="ws-status is-open" title="Open in another window">Open</span>'
      : '';

  const row = document.createElement('div');
  row.className = 'ws-row';
  row.tabIndex = 0;
  row.dataset.focusKey = `ws:${workspace.id}`;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${workspace.name}, ${describeWorkspace(workspace)}${isCurrentWindow ? ', this window' : isOpen ? ', open' : ''}`);
  row.draggable = draggable;
  row.innerHTML = `
    <button type="button" class="ws-chevron icon-btn is-sm" data-act="expand" aria-expanded="${isExpanded}" aria-label="${isExpanded ? 'Hide tabs' : 'Show tabs'}" title="${isExpanded ? 'Hide tabs' : 'Show tabs'}" tabindex="-1">${ICONS.chevronRight}</button>
    <span class="ws-avatar">${escapeHtml(workspace.icon || (workspace.name || 'W').trim().charAt(0).toUpperCase())}</span>
    <span class="ws-text">
      <span class="ws-name">${highlightName(workspace.name, searchQuery)}</span>
      <span class="ws-meta">${escapeHtml(describeWorkspace(workspace))}${!isOpen && workspace.lastOpenedAt ? ` · ${escapeHtml(timeAgo(workspace.lastOpenedAt))}` : ''}</span>
      ${workspace.notes ? `<span class="ws-note" title="${escapeHtml(workspace.notes)}">${escapeHtml(workspace.notes.split('\n')[0])}</span>` : ''}
    </span>
    ${status}
    <button type="button" class="icon-btn ws-more" data-act="menu" aria-label="Workspace options" title="Options" tabindex="-1">${ICONS.more}</button>
  `;

  row.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'expand') return on.toggleExpand(workspace.id);
    if (act === 'menu') {
      const btn = e.target.closest('[data-act]');
      const rect = btn.getBoundingClientRect();
      return on.menu({ x: rect.right - 210, y: rect.bottom + 4, anchor: btn });
    }
    on.open(workspace.id);
  });

  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        on.open(workspace.id);
        break;
      case 'ArrowRight':
        if (!isExpanded) { e.preventDefault(); on.toggleExpand(workspace.id); }
        break;
      case 'ArrowLeft':
        if (isExpanded) { e.preventDefault(); on.toggleExpand(workspace.id); }
        break;
      case 'F2':
        e.preventDefault();
        on.edit();
        break;
      case 'Delete':
        e.preventDefault();
        on.remove();
        break;
      case 'ContextMenu': {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        on.menu({ x: rect.left + 40, y: rect.bottom });
        break;
      }
      default:
    }
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    on.menu({ x: e.clientX, y: e.clientY });
  });

  card.appendChild(row);

  if (isExpanded) {
    card.appendChild(renderTabTree({
      tabs: workspace.tabs || [],
      groups: workspace.groups || [],
      workspaceId: workspace.id,
      live: false,
      query: searchQuery && !(workspace.name || '').toLowerCase().includes(searchQuery) ? searchQuery : '',
      isExpanded: (group) => isGroupExpanded(workspace.id, group),
      on: on.tabs
    }));
  }

  // Dropping a tab from another workspace onto the card moves it here
  attachDrop(row, (data) => data.sourceWorkspaceId !== workspace.id, (data) => on.tabDrop(data));

  // Reordering cards (manual sort only)
  if (draggable) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(CARD_DRAG_TYPE, workspace.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      document.querySelectorAll('.ws-card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    });
    card.addEventListener('dragover', (e) => {
      if (isTabDrag(e) || !Array.from(e.dataTransfer.types).includes(CARD_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + Math.min(rect.height, 52) / 2;
      card.classList.toggle('drop-before', before);
      card.classList.toggle('drop-after', !before);
    });
    card.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      card.classList.remove('drop-before', 'drop-after');
    });
    card.addEventListener('drop', (e) => {
      const sourceId = e.dataTransfer.getData(CARD_DRAG_TYPE);
      if (!sourceId) return;
      e.preventDefault();
      const position = card.classList.contains('drop-before') ? 'before' : 'after';
      card.classList.remove('drop-before', 'drop-after');
      if (sourceId !== workspace.id) on.reorder(sourceId, workspace.id, position);
    });
  }

  return card;
}

function highlightName(name, q) {
  const text = name || 'Untitled';
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, idx))}<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>${escapeHtml(text.slice(idx + q.length))}`;
}
