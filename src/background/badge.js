/**
 * Toolbar badge — shows the focused window's workspace (abbreviated name, workspace color).
 * chrome.action badges are global or per-tab, not per-window, so the badge follows focus.
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager } from './workspace-manager.js';
import { getColor } from '../shared/colors.js';

function abbreviate(ws) {
  if (ws.icon) return ws.icon;
  const words = (ws.name || 'WS').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || 'WS').substring(0, 3).toUpperCase();
}

export async function updateToolbarBadge(windowId = null) {
  if (!chrome.action?.setBadgeText) return;
  try {
    let targetWinId = windowId;
    if (!targetWinId || targetWinId === chrome.windows.WINDOW_ID_NONE) {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      targetWinId = win?.id;
    }

    const wsId = targetWinId ? await windowRegistry.getWorkspaceForWindow(targetWinId) : null;
    const ws = wsId ? await workspaceManager.getWorkspace(wsId) : null;

    if (!ws) {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle?.({ title: 'Tabroost' });
      return;
    }

    await chrome.action.setBadgeText({ text: abbreviate(ws) });
    await chrome.action.setBadgeBackgroundColor?.({ color: getColor(ws.color).hex });
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    await chrome.action.setTitle?.({ title: `Tabroost — ${ws.name}` });
  } catch {
    // Window closed mid-update
  }
}
