# Brave Workspaces — Manual Test Checklist

Use this checklist to verify extension behavior in Brave Browser (Chromium 114+ / Brave 1.52+).

---

## Pre-flight: Installation

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** in the top right.
3. Click **Load unpacked** and select the extension root folder: `S:\Works\Projects\extension\GROTB`.
4. Verify the extension loads without manifest or service worker errors.
5. Pin the "Workspaces" extension icon to the browser toolbar.
6. Click the toolbar icon to confirm the side panel opens on the right.

---

## Core Test Scenarios

### 1. Workspace Creation & Window Binding

- [ ] **Create from current window**:
  - Open a window with 3 different tabs (e.g. Wikipedia, GitHub, MDN).
  - Open the side panel, click **Save as new** in the footer.
  - Name it "Dev Test", select a color (e.g., Cyan).
  - **Expected**: Workspace appears in the list; footer shows "Dev Test (Managed)" with green dot; toolbar icon shows colored badge.
- [ ] **Close and Reopen**:
  - Close the "Dev Test" window.
  - In another window's side panel, click "Dev Test".
  - **Expected**: A new window opens restoring all 3 tabs in their original order.
- [ ] **Focus already open workspace**:
  - Minimize or background the "Dev Test" window.
  - Click "Dev Test" in the side panel.
  - **Expected**: The existing window is focused without duplicating windows.

### 2. Tab Synchronization & Debouncing

- [ ] **Open new tab inside workspace**:
  - In a managed workspace window, open 2 new tabs.
  - Check the side panel tab count.
  - **Expected**: Count updates within 400ms.
- [ ] **Reorder and Pin tabs**:
  - Drag a tab to the first position and pin it (`Right click -> Pin`).
  - Close the workspace window and reopen it.
  - **Expected**: Pinned status and new tab order are accurately preserved.
- [ ] **Drag tab between windows**:
  - Open two managed workspace windows side by side.
  - Drag a tab from Window A into Window B.
  - **Expected**: The tab leaves Workspace A and is recorded into Workspace B.

### 3. Native Tab Groups Synchronization

- [ ] **Create native tab group**:
  - Select two tabs in the workspace window, right click -> **Add tabs to new group**.
  - Name the group "Docs", set color to "Cyan".
  - Collapse the group.
  - Close the window.
  - Reopen the workspace.
  - **Expected**: The group is restored with title "Docs", cyan color, and collapsed state.

### 4. Browser Restart & Recovery Matching

- [ ] **Restart Test**:
  - Open two workspaces ("College" and "Personal") in separate windows.
  - Quit Brave completely (`Menu -> Exit` or `Ctrl+Shift+Q`).
  - Relaunch Brave.
  - **Expected**: Brave restores the two windows, startup-recovery runs Jaccard overlap matching, and both windows rebind to their respective workspaces without creating duplicate windows.

### 5. Service Worker Cold Start

- [ ] **Idle Sleep Test**:
  - Leave the browser completely untouched for 5 minutes (MV3 service worker goes inactive).
  - In `brave://extensions`, inspect the service worker state (shows `(inactive)`).
  - Click a workspace card in the side panel or use `Ctrl+Shift+W`.
  - **Expected**: The service worker wakes up cleanly, bindings in `chrome.storage.session` remain valid, and the window focuses/opens immediately.

### 6. Deletion Behavior

- [ ] **Delete open workspace**:
  - With a workspace window currently open, click `... -> Delete Workspace`.
  - Confirm deletion.
  - **Expected**: The workspace is removed from storage and panel. The browser window remains open, and the footer transitions to "Unmanaged window".

### 7. Backup, Export, and Import

- [ ] **Export JSON**:
  - Go to Options (`⚙️` button in side panel).
  - Click **Export Workspaces (JSON)**.
  - **Expected**: `brave-workspaces-backup-YYYY-MM-DD.json` downloads.
- [ ] **Reset & Restore**:
  - Click **Reset All Data** in the Danger Zone.
  - Verify workspaces are wiped/reset.
  - Click **Import Workspaces**, select the downloaded JSON (or `test/fixtures/sample-workspaces.json`).
  - **Expected**: Workspaces, tab groups, and tabs are fully restored.

### 8. Drag-and-Drop Operations

- [ ] **Reorder workspaces**:
  - Drag a workspace card up or down in the panel list.
  - **Expected**: Cards reorder smoothly and the order persists after reloading the panel.
- [ ] **Move tab between workspaces via panel**:
  - Expand Workspace A in the side panel.
  - Drag a tab item from Workspace A and drop it onto Workspace B's card.
  - **Expected**: Tab is moved to Workspace B.
