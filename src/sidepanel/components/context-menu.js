/**
 * Context Menu Component — Renders a custom floating action menu
 */

import { WORKSPACE_COLORS, COLOR_KEYS } from '../../shared/colors.js';

let activeMenu = null;

export function showContextMenu({
  x,
  y,
  workspace,
  isOpen,
  isCurrentWindow,
  onOpen,
  onCloseWindow,
  onRename,
  onChangeColor,
  onDuplicate,
  onDelete
}) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'custom-context-menu';

  // Action: Edit workspace (Edge style primary action)
  const editItem = document.createElement('div');
  editItem.className = 'menu-item';
  editItem.innerHTML = `<span class="menu-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821a.5.5 0 0 0 .619.619l3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.5.5 0 0 1-.107-.018z"/></svg></span> <span>Edit workspace</span>`;
  editItem.onclick = () => {
    closeContextMenu();
    onRename(workspace);
  };
  menu.appendChild(editItem);

  // Action: Delete workspace (Edge style primary action)
  const deleteItem = document.createElement('div');
  deleteItem.className = 'menu-item danger';
  deleteItem.innerHTML = `<span class="menu-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></span> <span>Delete workspace</span>`;
  deleteItem.onclick = () => {
    closeContextMenu();
    onDelete(workspace);
  };
  menu.appendChild(deleteItem);

  const separator1 = document.createElement('div');
  separator1.className = 'menu-separator';
  menu.appendChild(separator1);

  // Secondary actions: Focus/Open
  const openItem = document.createElement('div');
  openItem.className = 'menu-item';
  openItem.innerHTML = `<span class="menu-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h7v7M13 3L6 10"/></svg></span> <span>${isOpen ? 'Focus Window' : 'Open in New Window'}</span>`;
  openItem.onclick = () => {
    closeContextMenu();
    onOpen(workspace.id);
  };
  menu.appendChild(openItem);

  if (isOpen) {
    const closeWinItem = document.createElement('div');
    closeWinItem.className = 'menu-item';
    closeWinItem.innerHTML = `<span class="menu-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></span> <span>Close Window</span>`;
    closeWinItem.onclick = () => {
      closeContextMenu();
      onCloseWindow(workspace.id);
    };
    menu.appendChild(closeWinItem);
  }

  // Duplicate
  const dupItem = document.createElement('div');
  dupItem.className = 'menu-item';
  dupItem.innerHTML = `<span class="menu-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3h8"/></svg></span> <span>Duplicate</span>`;
  dupItem.onclick = () => {
    closeContextMenu();
    onDuplicate(workspace.id);
  };
  menu.appendChild(dupItem);

  // Quick Colors Strip
  const colorHeader = document.createElement('div');
  colorHeader.className = 'menu-sub-header';
  colorHeader.textContent = 'Change Color';
  menu.appendChild(colorHeader);

  const colorStrip = document.createElement('div');
  colorStrip.className = 'menu-color-strip';
  COLOR_KEYS.forEach((colKey) => {
    const colDef = WORKSPACE_COLORS[colKey];
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `menu-color-dot ${workspace.color === colKey ? 'active' : ''}`;
    dot.style.backgroundColor = colDef.hex;
    dot.title = colDef.name;
    dot.onclick = (e) => {
      e.stopPropagation();
      closeContextMenu();
      onChangeColor(workspace.id, colKey);
    };
    colorStrip.appendChild(dot);
  });
  menu.appendChild(colorStrip);

  // Position properly within viewport
  document.body.appendChild(menu);
  activeMenu = menu;

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;

  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  // Close when clicking outside or pressing Escape
  const onDocClick = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
    }
  };

  setTimeout(() => {
    window.addEventListener('click', onDocClick, { once: true });
    window.addEventListener('keydown', onKeyDown, { once: true });
  }, 10);
}

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

export function showTabContextMenu({
  x,
  y,
  tab,
  isGrouped = false,
  onPopOut,
  onPopOutNewWindow,
  onClose,
  onDuplicate
}) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'custom-context-menu tab-context-menu';

  // Option 1: Pop out of group (if grouped)
  if (isGrouped && typeof onPopOut === 'function') {
    const popoutItem = document.createElement('div');
    popoutItem.className = 'menu-item primary-action';
    popoutItem.innerHTML = `
      <span class="menu-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3h4v4M13 3l-6 6M4 5H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-1"/>
        </svg>
      </span>
      <span><strong>Pop out of group</strong></span>
    `;
    popoutItem.onclick = () => {
      closeContextMenu();
      onPopOut();
    };
    menu.appendChild(popoutItem);
  }

  // Option 2: Pop out to new window
  if (typeof onPopOutNewWindow === 'function') {
    const newWinItem = document.createElement('div');
    newWinItem.className = 'menu-item';
    newWinItem.innerHTML = `
      <span class="menu-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="2"/>
          <path d="M2 7h12"/>
        </svg>
      </span>
      <span>Pop out to new window</span>
    `;
    newWinItem.onclick = () => {
      closeContextMenu();
      onPopOutNewWindow();
    };
    menu.appendChild(newWinItem);
  }

  // Option 3: Duplicate tab
  if (typeof onDuplicate === 'function') {
    const dupItem = document.createElement('div');
    dupItem.className = 'menu-item';
    dupItem.innerHTML = `
      <span class="menu-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1.5"/>
          <path d="M3 11V3h8"/>
        </svg>
      </span>
      <span>Duplicate tab</span>
    `;
    dupItem.onclick = () => {
      closeContextMenu();
      onDuplicate();
    };
    menu.appendChild(dupItem);
  }

  // Option 4: Close tab
  if (typeof onClose === 'function') {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    menu.appendChild(sep);

    const closeItem = document.createElement('div');
    closeItem.className = 'menu-item danger';
    closeItem.innerHTML = `
      <span class="menu-icon">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M2 2L10 10M10 2L2 10"/>
        </svg>
      </span>
      <span>Close tab</span>
    `;
    closeItem.onclick = () => {
      closeContextMenu();
      onClose();
    };
    menu.appendChild(closeItem);
  }

  document.body.appendChild(menu);
  activeMenu = menu;

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;

  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  const onDocClick = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
    }
  };

  setTimeout(() => {
    window.addEventListener('click', onDocClick, { once: true });
    window.addEventListener('keydown', onKeyDown, { once: true });
  }, 10);
}
