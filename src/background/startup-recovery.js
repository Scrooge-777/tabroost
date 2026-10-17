/**
 * Startup Recovery — Rebinds restored browser windows to workspaces after browser restart
 * Uses Jaccard URL overlap matching to robustly pair windows to workspaces.
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager, snapshotWindow } from './workspace-manager.js';
import { normalizeUrl, jaccardSimilarity, isNewTabUrl } from '../shared/utils.js';
import { groupSync } from './group-sync.js';
import { MESSAGE_TYPES } from '../shared/constants.js';

export const MATCH_THRESHOLD = 0.5;
// Brave restores windows (and their tabs) progressively; try again for late windows
const PASS_DELAYS_MS = [1500, 5000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function urlSet(urls) {
  return new Set(urls.filter((u) => u && !isNewTabUrl(u)).map(normalizeUrl).filter(Boolean));
}

/**
 * Pair windows to workspaces greedily by best overlap ("first match wins").
 * Pure function so it can be tested directly.
 */
export function matchWindowsToWorkspaces(windows, workspaces, threshold = MATCH_THRESHOLD) {
  const matches = [];
  for (const win of windows) {
    const winUrls = urlSet((win.tabs || []).map((t) => t.url || t.pendingUrl));
    if (winUrls.size === 0) continue;
    for (const ws of workspaces) {
      const wsUrls = urlSet((ws.tabs || []).map((t) => t.url));
      if (wsUrls.size === 0) continue;
      const score = jaccardSimilarity(winUrls, wsUrls);
      if (score >= threshold) matches.push({ winId: win.id, wsId: ws.id, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const usedWindows = new Set();
  const usedWorkspaces = new Set();
  const pairs = [];
  for (const m of matches) {
    if (usedWindows.has(m.winId) || usedWorkspaces.has(m.wsId)) continue;
    usedWindows.add(m.winId);
    usedWorkspaces.add(m.wsId);
    pairs.push(m);
  }
  return pairs;
}

export const startupRecovery = {
  /**
   * Run startup recovery matching
   */
  async runRecovery({ delays = PASS_DELAYS_MS } = {}) {
    const state = await workspaceManager.loadState();
    if (!state.settings?.restoreOnStartup) return [];

    const bound = [];
    for (const delay of delays) {
      await sleep(delay);
      try {
        bound.push(...(await this.runPass()));
      } catch (err) {
        console.warn('startupRecovery: Error during recovery', err);
      }
    }

    if (bound.length) {
      try {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STATE_CHANGED })?.catch?.(() => {});
      } catch {
        // No UI open
      }
    }
    return bound;
  },

  async runPass() {
    const state = await workspaceManager.loadState();
    const workspaces = Object.values(state.workspaces);
    if (workspaces.length === 0) return [];

    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    if (!windows || windows.length === 0) return [];

    const bindings = await windowRegistry.getAllBindings();
    const claimedWindows = new Set(Object.keys(bindings).map(Number));
    const claimedWorkspaces = new Set(Object.values(bindings));

    const pairs = matchWindowsToWorkspaces(
      windows.filter((w) => !claimedWindows.has(w.id)),
      workspaces.filter((ws) => !claimedWorkspaces.has(ws.id))
    );

    for (const pair of pairs) {
      const ws = state.workspaces[pair.wsId];
      await windowRegistry.bind(pair.winId, pair.wsId);
      await this.restoreMissingGroups(pair.winId, ws);

      // Seed live maps so persistent tab IDs stay stable from here on
      const snap = await snapshotWindow(pair.winId, ws).catch(() => null);
      if (snap) await windowRegistry.setLiveMaps(pair.wsId, snap.liveMaps);

      console.log(`startupRecovery: Rebound window ${pair.winId} to "${ws.name}" (overlap ${(pair.score * 100).toFixed(0)}%)`);
    }
    return pairs;
  },

  /**
   * Re-create tab groups when the browser restored the tabs but not their groups
   */
  async restoreMissingGroups(windowId, ws) {
    if (!ws?.groups?.length || !chrome.tabGroups) return;
    try {
      const liveGroups = await chrome.tabGroups.query({ windowId });
      if (liveGroups.length > 0) return;

      const winTabs = await chrome.tabs.query({ windowId });
      const pool = (ws.tabs || []).filter((st) => st.groupId);
      const matched = [];
      for (const wt of winTabs) {
        const norm = normalizeUrl(wt.url || wt.pendingUrl);
        const idx = pool.findIndex((st) => normalizeUrl(st.url) === norm);
        if (idx !== -1) {
          matched.push({ id: wt.id, savedGroupId: pool[idx].groupId, active: wt.active });
          pool.splice(idx, 1);
        }
      }
      if (matched.length) await groupSync.restoreGroups(windowId, ws.groups, matched);
    } catch (err) {
      console.warn('startupRecovery: Could not restore tab groups:', err);
    }
  }
};
