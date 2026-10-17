/**
 * Startup Recovery — Rebinds restored browser windows to workspaces after browser restart
 * Uses Jaccard URL overlap matching to robustly pair windows to workspaces.
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager } from './workspace-manager.js';
import { normalizeUrl, jaccardSimilarity } from '../shared/utils.js';
import { windowOpener } from './window-opener.js';
import { groupSync } from './group-sync.js';
import { MESSAGE_TYPES } from '../shared/constants.js';

export const startupRecovery = {
  /**
   * Run startup recovery matching
   */
  async runRecovery() {
    // Check if recovery is enabled in settings
    const state = await workspaceManager.getState();
    if (!state.settings?.restoreOnStartup) {
      console.log('startupRecovery: restoreOnStartup is disabled in settings.');
      return;
    }

    // Wait 1500ms to allow Brave's session restore to settle windows and tabs
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      // Get all open windows with tabs populated
      const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (!windows || windows.length === 0) return;

      const workspaces = Object.values(state.workspaces);
      if (workspaces.length === 0) return;

      // Check current session bindings (in case any exist already)
      const existingBindings = await windowRegistry.getAllBindings();
      const claimedWindows = new Set(Object.keys(existingBindings).map(Number));
      const claimedWorkspaces = new Set(Object.values(existingBindings));

      // Build normalized URL sets for open windows
      const windowUrlSets = new Map();
      for (const win of windows) {
        if (claimedWindows.has(win.id)) continue;

        const urls = new Set(
          (win.tabs || [])
            .map((t) => normalizeUrl(t.url || t.pendingUrl))
            .filter((u) => u && !u.startsWith('newtab') && !u.startsWith('about:blank'))
        );
        windowUrlSets.set(win.id, urls);
      }

      // Build normalized URL sets for saved workspaces
      const workspaceUrlSets = new Map();
      for (const ws of workspaces) {
        if (claimedWorkspaces.has(ws.id)) continue;

        const urls = new Set(
          (ws.tabs || [])
            .map((t) => normalizeUrl(t.url))
            .filter((u) => u && !u.startsWith('newtab') && !u.startsWith('about:blank'))
        );
        workspaceUrlSets.set(ws.id, urls);
      }

      // Calculate overlap scores between each candidate window and workspace
      const matches = [];

      for (const [winId, winUrls] of windowUrlSets.entries()) {
        if (winUrls.size === 0) continue;

        for (const [wsId, wsUrls] of workspaceUrlSets.entries()) {
          if (wsUrls.size === 0) continue;

          const score = jaccardSimilarity(winUrls, wsUrls);
          if (score >= 0.6) {
            matches.push({ winId, wsId, score });
          }
        }
      }

      // Sort matches descending by similarity score
      matches.sort((a, b) => b.score - a.score);

      // Greedily pair highest-scoring window and workspace ("first match wins")
      const newlyBoundWindows = new Set();
      const newlyBoundWorkspaces = new Set();

      for (const match of matches) {
        if (newlyBoundWindows.has(match.winId) || newlyBoundWorkspaces.has(match.wsId)) {
          continue;
        }

        await windowRegistry.bind(match.winId, match.wsId);
        newlyBoundWindows.add(match.winId);
        newlyBoundWorkspaces.add(match.wsId);

        // Re-attach persistent tab groups if native groups vanished on restart (Workona fix)
        const ws = state.workspaces[match.wsId];
        if (ws && ws.groups && ws.groups.length > 0 && chrome.tabGroups) {
          try {
            const liveGroups = await chrome.tabGroups.query({ windowId: match.winId });
            if (!liveGroups || liveGroups.length === 0) {
              const winTabs = await chrome.tabs.query({ windowId: match.winId });
              const matchedTabs = [];
              for (const wt of winTabs) {
                const norm = normalizeUrl(wt.url || wt.pendingUrl);
                const savedTab = (ws.tabs || []).find(
                  (st) => normalizeUrl(st.url) === norm && st.groupId
                );
                if (savedTab) {
                  matchedTabs.push({ id: wt.id, savedGroupId: savedTab.groupId });
                }
              }
              if (matchedTabs.length > 0) {
                await groupSync.restoreGroups(match.winId, ws.groups, matchedTabs);
                console.log(`startupRecovery: Restored ${ws.groups.length} tab groups in Window ${match.winId}`);
              }
            }
          } catch (groupErr) {
            console.warn('startupRecovery: Could not restore tab groups:', groupErr);
          }
        }

        // Update badge for this window
        await windowOpener.updateToolbarBadge(match.winId, match.wsId);
        console.log(`startupRecovery: Successfully rebound Window ${match.winId} to Workspace ${match.wsId} (overlap: ${(match.score * 100).toFixed(1)}%)`);
      }

      // Broadcast state update to any open UI
      try {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STATE_CHANGED }, () => {
          if (chrome.runtime.lastError) {
            // No UI active
          }
        });
      } catch {
        // Ignore
      }
    } catch (err) {
      console.warn('startupRecovery: Error during recovery', err);
    }
  }
};
