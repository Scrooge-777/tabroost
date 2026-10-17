/**
 * Tab Tree — renders tabs grouped like the tab strip (pinned, groups, ungrouped),
 * with drag-and-drop grouping. Used for both stored workspaces and the live window.
 *
 * Data:
 *   tabs:   [{ id, url, title, favIconUrl, pinned, active, groupId }]
 *   groups: [{ id, title, color, collapsed }]
 * Drag payload (JSON, type DRAG_TYPE): { tabId, groupId, sourceWorkspaceId, live }
 */

import { ICONS } from './icons.js';
import { applyColorVars } from '../../shared/colors.js';
import { getFaviconUrl, getFallbackTileLetter, isNewTabUrl, escapeHtml, pluralize } from '../../shared/utils.js';

export const DRAG_TYPE = 'application/x-workspaces-tab';

export function readDragData(e) {
  try {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isTabDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE);
}

/**
 * @param {Object} opts
 * @param {Array} opts.tabs
 * @param {Array} opts.groups
 * @param {string|null} opts.workspaceId  source workspace for drag payloads (null = live window)
 * @param {boolean} opts.live
 * @param {string} opts.query  highlight / filter text
 * @param {(group) => boolean} opts.isExpanded
 * @param {Object} opts.on  handlers: activate, close, ungroupTab, dropOnTab, dropOnGroup, dropUngroup,
 *                          toggleGroup, editGroup, ungroupAll, tabMenu
 */
export function renderTabTree({ tabs, groups, workspaceId = null, live = false, query = '', isExpanded, on = {} }) {
  const root = document.createElement('div');
  root.className = 'tab-tree';
  root.setAttribute('role', 'group');

  const q = query.trim().toLowerCase();
  const visible = q
    ? tabs.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
    : tabs;

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tab-tree-empty';
    empty.textContent = q ? 'No matching tabs' : 'No tabs';
    root.appendChild(empty);
    return root;
  }

  const groupsById = new Map(groups.map((g) => [String(g.id), g]));
  const ctx = { workspaceId, live, q, on };

  // Walk in tab order so groups appear where they sit on the tab strip
  let currentGroupEl = null;
  let currentGroupId = null;
  let hasUngrouped = false;

  for (const tab of visible) {
    const gid = tab.groupId != null && String(tab.groupId) !== '-1' ? String(tab.groupId) : null;
    const group = gid ? groupsById.get(gid) : null;

    if (group) {
      if (gid !== currentGroupId) {
        const members = visible.filter((t) => String(t.groupId) === gid);
        const expanded = q ? true : isExpanded ? isExpanded(group) : !group.collapsed;
        currentGroupEl = renderGroup(group, members.length, expanded, ctx);
        currentGroupId = gid;
        root.appendChild(currentGroupEl);
      }
      currentGroupEl.querySelector('.group-tabs').appendChild(renderTabRow(tab, group, ctx));
    } else {
      currentGroupEl = null;
      currentGroupId = null;
      hasUngrouped = true;
      root.appendChild(renderTabRow(tab, null, ctx));
    }
  }

  // Dropping a grouped tab here pops it out of its group
  if (groups.length > 0 && on.dropUngroup) {
    const zone = document.createElement('div');
    zone.className = 'ungroup-zone';
    zone.innerHTML = `${ICONS.popout}<span>Drop here to remove from group</span>`;
    attachDrop(zone, (data) => data.groupId != null, (data) => on.dropUngroup(data));
    root.appendChild(zone);
  }
  root.classList.toggle('has-ungrouped', hasUngrouped);
  return root;
}

function renderGroup(group, count, expanded, ctx) {
  const section = document.createElement('div');
  section.className = `group${expanded ? '' : ' is-collapsed'}`;
  section.dataset.groupId = String(group.id);
  applyColorVars(section, group.color);

  const head = document.createElement('div');
  head.className = 'group-head';
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.setAttribute('aria-expanded', String(expanded));
  head.innerHTML = `
    <span class="group-chevron">${ICONS.chevronRight}</span>
    <span class="group-pill">${escapeHtml(group.title || 'Untitled group')}</span>
    <span class="group-count">${count}</span>
    <span class="row-actions">
      ${ctx.on.editGroup ? `<button type="button" class="icon-btn is-sm" data-act="edit" title="Rename or recolor group" aria-label="Edit group">${ICONS.edit}</button>` : ''}
      ${ctx.on.ungroupAll ? `<button type="button" class="icon-btn is-sm" data-act="ungroup" title="Ungroup tabs" aria-label="Ungroup">${ICONS.ungroup}</button>` : ''}
    </span>
  `;

  const toggle = () => {
    const nowExpanded = section.classList.toggle('is-collapsed') === false;
    head.setAttribute('aria-expanded', String(nowExpanded));
    ctx.on.toggleGroup?.(group, nowExpanded);
  };
  head.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') return ctx.on.editGroup(group, head);
    if (act === 'ungroup') return ctx.on.ungroupAll(group);
    toggle();
  });
  head.addEventListener('keydown', (e) => {
    if (e.target !== head) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'F2' && ctx.on.editGroup) {
      e.preventDefault();
      ctx.on.editGroup(group, head);
    }
  });

  if (ctx.on.dropOnGroup) {
    attachDrop(head, (data) => String(data.groupId) !== String(group.id), (data) => ctx.on.dropOnGroup(data, group));
  }

  const body = document.createElement('div');
  body.className = 'group-tabs';
  section.append(head, body);
  return section;
}

function renderTabRow(tab, group, ctx) {
  const row = document.createElement('div');
  row.className = `tab-row${tab.active ? ' is-active' : ''}${tab.pinned ? ' is-pinned' : ''}`;
  row.dataset.tabId = String(tab.id);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = `${tab.title || ''}\n${tab.url || ''}`.trim();
  row.draggable = true;

  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  const fav = isNewTabUrl(tab.url) ? null : getFaviconUrl(tab.url, tab.favIconUrl);
  if (fav) {
    const img = document.createElement('img');
    img.src = fav;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      icon.replaceChildren(letterTile(tab));
    }, { once: true });
    icon.appendChild(img);
  } else {
    icon.appendChild(letterTile(tab));
  }

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.innerHTML = highlight(tab.title || tab.url || 'Untitled', ctx.q);

  const actions = document.createElement('span');
  actions.className = 'row-actions';
  if (group && ctx.on.ungroupTab) {
    actions.insertAdjacentHTML('beforeend', `<button type="button" class="icon-btn is-sm" data-act="ungroup" title="Remove from group" aria-label="Remove from group">${ICONS.popout}</button>`);
  }
  if (ctx.on.close) {
    actions.insertAdjacentHTML('beforeend', `<button type="button" class="icon-btn is-sm" data-act="close" title="Close tab" aria-label="Close tab">${ICONS.close}</button>`);
  }

  row.append(icon, title);
  if (tab.pinned) row.insertAdjacentHTML('beforeend', `<span class="tab-pin" title="Pinned">${ICONS.pin}</span>`);
  row.appendChild(actions);

  row.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return ctx.on.close(tab);
    if (act === 'ungroup') return ctx.on.ungroupTab(tab);
    ctx.on.activate?.(tab);
  });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.on.activate?.(tab);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && ctx.on.close) {
      e.preventDefault();
      ctx.on.close(tab);
    }
  });
  row.addEventListener('contextmenu', (e) => {
    if (!ctx.on.tabMenu) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.on.tabMenu(tab, group, e.clientX, e.clientY);
  });

  row.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({
      tabId: tab.id,
      groupId: group ? group.id : null,
      sourceWorkspaceId: ctx.workspaceId,
      live: ctx.live
    }));
    e.dataTransfer.setData('text/uri-list', tab.url || '');
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('is-dragging');
    document.body.classList.add('is-dragging-tab');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-tab');
    document.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  });

  if (ctx.on.dropOnTab) {
    attachDrop(row, (data) => String(data.tabId) !== String(tab.id), (data) => ctx.on.dropOnTab(data, tab, group));
  }
  return row;
}

function letterTile(tab) {
  const tile = document.createElement('span');
  if (isNewTabUrl(tab.url)) {
    tile.className = 'tab-letter is-newtab';
    tile.innerHTML = ICONS.newTab;
  } else {
    tile.className = 'tab-letter';
    tile.textContent = getFallbackTileLetter(tab.title, tab.url);
  }
  return tile;
}

function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return safe;
  return `${escapeHtml(text.slice(0, idx))}<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>${escapeHtml(text.slice(idx + q.length))}`;
}

export function attachDrop(el, accept, onDrop) {
  el.addEventListener('dragover', (e) => {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('is-drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove('is-drop-target');
  });
  el.addEventListener('drop', (e) => {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('is-drop-target');
    const data = readDragData(e);
    if (data && accept(data)) onDrop(data);
  });
}

export function describeWorkspace(ws) {
  const parts = [pluralize(ws.tabs?.length || 0, 'tab')];
  if (ws.groups?.length) parts.push(pluralize(ws.groups.length, 'group'));
  return parts.join(' · ');
}
