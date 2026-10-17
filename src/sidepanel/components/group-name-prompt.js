/**
 * Group Name Prompt Component — Inline prompt for naming and coloring a newly formed Tab Group
 * Automatically appears when tabs are merged via drag-and-drop or when a group is created.
 */

import { WORKSPACE_COLORS } from '../../shared/colors.js';

const TAB_GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
];

let activePromptElement = null;
let activeGroupId = null;
let activeTimeoutId = null;
let activeDocumentClickHandler = null;

export function showNamePrompt(groupId, anchorElement = null, onFinished = null) {
  if (!groupId) return null;

  // If prompt is already actively open for this exact group, reuse it without recreation
  if (activePromptElement && activeGroupId === groupId) {
    return activePromptElement;
  }

  // Dismiss any existing active prompt cleanly
  dismissNamePrompt();

  activeGroupId = groupId;

  const numericGroupId = typeof groupId === 'number' ? groupId : parseInt(groupId, 10);
  const isNativeGroup = Number.isInteger(numericGroupId) && numericGroupId > 0 && Boolean(chrome.tabGroups);

  const container = document.createElement('div');
  container.className = 'group-name-prompt-popover';
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-label', 'Name tab group');

  // Initial color: query group or pick default
  let selectedColor = 'blue';

  container.innerHTML = `
    <div class="gnp-row-top">
      <span class="gnp-color-preview" style="background-color: var(--color-blue, #0078d4);"></span>
      <input type="text" class="gnp-input" placeholder="Name this group" maxlength="50" autocomplete="off">
      <button type="button" class="gnp-done-btn" title="Done (Enter)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
        </svg>
      </button>
    </div>
    <div class="gnp-colors-row"></div>
  `;

  const input = container.querySelector('.gnp-input');
  const preview = container.querySelector('.gnp-color-preview');
  const doneBtn = container.querySelector('.gnp-done-btn');
  const colorsRow = container.querySelector('.gnp-colors-row');

  // Load current group properties if available for native groups
  if (isNativeGroup && chrome.tabGroups?.get) {
    chrome.tabGroups.get(numericGroupId).then((grp) => {
      if (grp) {
        if (grp.title) input.value = grp.title;
        if (grp.color && TAB_GROUP_COLORS.includes(grp.color)) {
          selectedColor = grp.color;
          updateColorSelection(selectedColor);
        }
      }
    }).catch(() => {});
  }

  // Build color dots
  TAB_GROUP_COLORS.forEach((colorName) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gnp-color-swatch';
    swatch.dataset.color = colorName;
    const def = WORKSPACE_COLORS[colorName] || WORKSPACE_COLORS.blue;
    swatch.style.backgroundColor = def.hex;
    swatch.title = def.label;
    if (colorName === selectedColor) swatch.classList.add('selected');

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedColor = colorName;
      updateColorSelection(colorName);
      try {
        input.focus();
      } catch {}
    });

    colorsRow.appendChild(swatch);
  });

  function updateColorSelection(colorName) {
    const colorDef = WORKSPACE_COLORS[colorName] || WORKSPACE_COLORS.blue;
    preview.style.backgroundColor = colorDef.hex;
    container.querySelectorAll('.gnp-color-swatch').forEach((s) => {
      s.classList.toggle('selected', s.dataset.color === colorName);
    });
  }

  let isCommitted = false;
  async function commitAndClose() {
    if (isCommitted) return;
    isCommitted = true;

    const title = (input.value || '').trim();
    const safeColor = TAB_GROUP_COLORS.includes(selectedColor) ? selectedColor : 'blue';

    // Dismiss UI first to avoid duplicate calls
    dismissNamePrompt();

    // If it's a native Chrome/Brave tab group, update it via chrome.tabGroups
    if (isNativeGroup && chrome.tabGroups?.update) {
      try {
        const grp = await chrome.tabGroups.get(numericGroupId).catch(() => null);
        if (grp) {
          await chrome.tabGroups.update(numericGroupId, {
            title: title || 'Group',
            color: safeColor
          });
        }
      } catch (err) {
        // Only warn on unexpected failures, not normal closures
        if (!err?.message?.includes('No tab group with id') && !err?.message?.includes('Tabs cannot be edited')) {
          console.warn('Could not update tab group title/color:', err);
        }
      }
    }

    if (typeof onFinished === 'function') {
      try {
        await onFinished({ groupId, title: title || 'Group', color: safeColor });
      } catch (cbErr) {
        console.warn('onFinished callback failed:', cbErr);
      }
    }
  }

  // Handle Enter key and Escape key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitAndClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissNamePrompt();
    }
  });

  doneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    commitAndClose();
  });

  // Prevent clicks inside prompt from closing it
  container.addEventListener('click', (e) => e.stopPropagation());

  // Positioning
  if (anchorElement && anchorElement.parentNode) {
    // Insert directly adjacent to anchor element in DOM
    anchorElement.parentNode.insertBefore(container, anchorElement.nextSibling);
  } else {
    // Append to list container or panel container so it stays inside the scrolling layout
    const target = document.getElementById('window-tabs-list') || document.getElementById('workspace-list') || document.querySelector('.panel-container') || document.body;
    target.prepend(container);
  }

  activePromptElement = container;

  // Auto-focus input and ensure visible after render
  requestAnimationFrame(() => {
    try {
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      input.focus();
      input.select();
    } catch {}
  });

  // Global dismiss on click outside
  const onDocumentClick = (e) => {
    if (container && container.contains(e.target)) {
      return;
    }
    commitAndClose();
  };
  activeDocumentClickHandler = onDocumentClick;
  activeTimeoutId = setTimeout(() => {
    activeTimeoutId = null;
    document.addEventListener('click', onDocumentClick);
  }, 120);

  return container;
}

export function dismissNamePrompt() {
  if (activeTimeoutId) {
    clearTimeout(activeTimeoutId);
    activeTimeoutId = null;
  }
  if (activeDocumentClickHandler) {
    document.removeEventListener('click', activeDocumentClickHandler);
    activeDocumentClickHandler = null;
  }
  if (activePromptElement) {
    activePromptElement.remove();
    activePromptElement = null;
  }
  activeGroupId = null;
}
