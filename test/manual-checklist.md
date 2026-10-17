# Workspaces — Manual Test Checklist

Run through this list in real Brave or Chrome after significant changes. `npm test` and `npm run test:browser` already cover the core logic and the main UI flows.

## Setup

1. Go to `brave://extensions`, turn on Developer mode, click **Load unpacked**, and choose this folder.
2. Check that the service worker shows no errors (click **Inspect views → service worker**).
3. Pin the toolbar icon.

## Core

- [ ] **Save a window.** Open 3 tabs, click the toolbar icon, then **Save**. Name it, pick a color and an icon.
  - Expected: the window bar shows the workspace, the toolbar badge shows its initials in its color, and the row is marked *This window*.
- [ ] **Unmanaged windows stay untouched.** Open a new window (`Ctrl+N`) and browse in it.
  - Expected: the panel says *Unsaved window* there, and no saved workspace changes.
- [ ] **Close and reopen.** Close the workspace window, then click the workspace in another window's panel.
  - Expected: a new window opens with the same tabs in order, pinned tabs, groups (names, colors, collapsed state) and window size.
- [ ] **Focus, don't duplicate.** Click a workspace that is already open.
  - Expected: its window comes to the front and no second window opens.
- [ ] **Switch back.** Switch from A to B. The footer should show *Back to A*; click it.
  - Expected: you return to A.

## Tabs inside cards

- [ ] Expand an open workspace and click one of its tabs.
  - Expected: that real tab activates, with no duplicate.
- [ ] Close a tab from the card (×).
  - Expected: the real tab closes. Closing the last tab leaves a New Tab and keeps the window open.
- [ ] Drag a tab from workspace A's card onto workspace B's row.
  - Expected: it moves to B. If B is open the tab moves windows; if B is closed it is stored in B.
- [ ] Drag a tab onto another tab in a card.
  - Expected: a group forms, the name prompt appears, and pressing Enter names the group (also on the real tab strip if the workspace is open).
- [ ] With **another window focused**, group two tabs of an open workspace.
  - Expected: the tabs stay in their own window.

## Workspace management

- [ ] Use `⋯` → **Edit** (or `F2`) to change the name, color and icon. The badge and context menu update.
- [ ] Delete a workspace, then click **Undo** in the notification.
  - Expected: it is restored in the same position.
- [ ] Switch sort to **Recent**: the current workspace comes first, then by last use. Switch back to **Custom** and drag rows to reorder.
- [ ] Search for a tab title.
  - Expected: matching workspaces expand to show only the matching tabs, highlighted.
- [ ] Right-click a page → **Move tab to workspace** → pick a workspace.

## Restart and service worker

- [ ] Open two workspaces, quit the browser completely, then relaunch with session restore on.
  - Expected: within about 5 seconds both windows are recognised as their workspaces again, with no duplicates.
- [ ] Leave the browser idle for more than 5 minutes (the worker shows *inactive*), then switch workspaces.
  - Expected: it works immediately.

## Settings

- [ ] Turn on **Workspace button on pages**.
  - Expected: the browser asks for site access, then the pill appears on open pages and clicking it opens the switcher flyout.
  - Turn it off: the pill disappears and the permission is released.
- [ ] Turn on **Accent border**: a thin colored line appears at the top of pages in workspace windows.
- [ ] Click **Back up now**, change something, then **Restore**.
  - Expected: the earlier state comes back and a *Before restoring* snapshot is added.
- [ ] Export, then import with **Add to my workspaces** (duplicates are added) and with **Replace** (asks for confirmation).
- [ ] Click **Reset everything**.
  - Expected: everything is cleared, and the *Before reset* backup can restore it.

## Look and feel

- [ ] Check light and dark OS themes in the panel, popup, options page and dialogs.
- [ ] Navigate with the keyboard only: `/`, the arrow keys, `Enter`, `F2`, `Del`, `Esc` and `N`.
