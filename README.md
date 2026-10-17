# Workspaces

Edge-style workspaces for Brave and Chrome (Manifest V3).

A workspace is a **named, colored set of tabs and tab groups that lives in its own window**. Close the window when you're done; reopen the workspace later and every tab, pinned tab, tab group (with its color and collapsed state), and the window's size come back exactly as they were.

## Features

- **One window per workspace.** Opening a workspace that's already open just focuses its window.
- **Saved automatically.** Tab and group changes in a workspace window are saved within half a second. Windows that aren't workspaces are never touched.
- **Tab groups.** Groups are saved and restored natively, including their names, colors and collapsed state. You can drag one tab onto another in the panel to group them, rename or recolor groups, and pop tabs out.
- **Manage closed workspaces.** Expand any workspace to see its tabs. You can open, close or move tabs between workspaces, and drag them into groups, without opening the workspace first.
- **Fast switching.** Use the toolbar popup or the side panel, `Alt+Shift+W`, the "Back to …" chip, or an optional shortcut for *switch to previous workspace*.
- **Search** across workspace names, tab titles and URLs.
- **Undo delete**, automatic **backups** (the last 10 snapshots, taken every few hours and before any import, reset or restore), and JSON **export/import** (merge or replace).
- **Reconnect after restart.** When the browser restores its windows, they are matched back to their workspaces by URL overlap.
- **Light and dark themes**, keyboard navigation, and screen-reader labels.
- **Optional on-page indicators.** You can turn on a workspace pill button and an accent border on web pages. Both are off by default. Site access is requested only when you turn one on, so the extension needs **no website permissions** by default.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (`S:\Works\Projects\extension\Workspaces`).
4. Pin **Workspaces** to the toolbar.

## Using it

| Where | What |
|---|---|
| Toolbar icon | Popup switcher. Its panel button opens the side panel. |
| Window bar (top of panel) | Shows whether this window is a workspace. **Save** turns an unsaved window into one. |
| Workspace row | Click to switch (opens or focuses its window). Use the chevron to show its tabs and `⋯` (or right-click) for actions. |
| *This window* tab | The current window's live tabs. Drag a tab onto another to group them, or use **Auto-group** to group by site category. |
| Page right-click | **Move tab to workspace**, **Save this window as a workspace**. |

### Keyboard

| Shortcut | Action |
|---|---|
| `Alt+Shift+W` | Open the workspace switcher |
| `Alt+Shift+N` | New workspace |
| *(unset)* | Switch to the previous workspace. Assign it at `brave://extensions/shortcuts`. |
| `/` | Search (in the panel) |
| `N` | New workspace (in the panel) |
| `↑` `↓` `Enter` | Move between workspaces and open one |
| `→` `←` | Show or hide a workspace's tabs |
| `F2` / `Del` | Edit or delete the focused workspace |

## Architecture

```
src/
├── background/                 MV3 service worker (ES modules)
│   ├── service-worker.js       Entry: listeners, commands, derived UI refresh
│   ├── router.js               runtime.onMessage → actions
│   ├── workspace-manager.js    State, CRUD, tab & group operations (locked writes)
│   ├── window-registry.js      windowId ↔ workspaceId bindings + live ID maps (storage.session)
│   ├── tab-sync.js             Debounced snapshots of workspace windows
│   ├── window-opener.js        Open/restore/focus/close workspace windows
│   ├── group-sync.js           Native tab group restore
│   ├── startup-recovery.js     Rebind restored windows after a browser restart
│   ├── badge.js                Toolbar badge for the focused window
│   ├── context-menus.js        Page / toolbar menus
│   ├── backups.js              Automatic local backups (chrome.alarms)
│   └── page-features.js        Dynamic registration of the optional page script
├── content/page-indicator.js   Optional pill + accent border (shadow DOM)
├── sidepanel/                  Panel, popup and flyout UI (same app, three modes)
│   └── components/             Cards, tab tree, menus, dialogs, toasts, …
├── options/                    Settings page
└── shared/                     Constants, schema/migration, colors, utils
```

**Key design points**

- **Storage.** Workspaces live in `chrome.storage.local`, which survives restarts. Window bindings live in `chrome.storage.session`, which survives worker sleep but is cleared on browser exit. Every write goes through a lock in `workspaceManager.mutate()`, so tab sync and UI actions can't overwrite each other.
- **Stable IDs.** Saved tabs and groups have persistent string IDs. While a workspace is open, `window-registry` keeps a map from those IDs to the live Chrome tab and group IDs. Every panel action on an open workspace goes through that map, so clicking or closing a tab in the panel acts on the real tab instead of opening a duplicate.
- **Schema v2.** Version 1 data migrates automatically. Unknown settings are dropped, references to missing groups are cleaned up, and oversized inline favicons are removed.

## Development

```bash
npm test                 # import check + 43 logic tests against a chrome.* mock
npm run test:browser     # loads the extension in headless Brave via playwright-core
```

The browser test needs `playwright-core` installed or pointed to with `PLAYWRIGHT=<path>`. Point `BROWSER=<path>` at Brave or Chrome if it isn't in the default location. Screenshots are written to a temp folder, or to the folder given as the first argument.

See `test/manual-checklist.md` for the hands-on test pass.

## License

MIT
