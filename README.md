# Workspaces

> An Edge-style Workspaces + Tab Groups extension for Brave and Chromium browsers (Manifest V3).

![Workspaces](assets/icons/icon-128.png)

A workspace is a **named, color-tagged, persistent set of tabs bound to one browser window**. When you switch between projects, tasks, or subjects, each workspace manages its own window, tabs, and native tab groups seamlessly.

---

## Features

- **Window-bound Workspaces**: Each workspace opens in its own window. Clicking an already-open workspace immediately focuses its window.
- **Side Panel Integration**: Edge-style side panel (`chrome.sidePanel`) accessible anytime via toolbar icon or `Ctrl+Shift+W`.
- **Automatic Tab Sync**: Debounced (400ms) full-window snapshotting to `chrome.storage.local`. Survives unexpected crashes and browser restarts.
- **Native Tab Groups**: Recreates native Chromium `chrome.tabGroups` with titles, colors, and collapsed states.
- **Startup Recovery**: Intelligently rebinds restored browser windows after restart using Jaccard URL-overlap matching (no duplicate windows).
- **Service-Worker Resilient**: Powered by `chrome.storage.session` for window bindings; retains state across MV3 idle terminations.
- **Drag-and-Drop**:
  - Reorder workspaces in the side panel.
  - Drag individual tabs across workspaces.
- **Search & Quick Preview**: Expand workspaces in the panel to inspect, open, or close individual tabs without leaving your current window.
- **Backup & Restore**: Export and import full workspace configurations via JSON.
- **Privacy First**: Zero external telemetry, zero network tracking, runs 100% locally.

---

## Visual Accents & Theming

Extensions in Chromium cannot directly style the OS or browser title bar. To provide clear visual distinction, Workspaces uses a multi-tier visual cue system:

1. **Toolbar Action Badge**: Colored badge dot matching the workspace color for the active window.
2. **Side Panel Card Accent**: The current workspace is highlighted with a 4px colored accent bar and subtle background tint.
3. **Optional Top Accent Border**: Injects a sleek 3px colored accent bar at the very top of http(s) pages (can be toggled in Options).

---

## Installation (Unpacked)

1. Open Brave and navigate to `brave://extensions` (or `chrome://extensions`).
2. Toggle on **Developer mode** in the top right corner.
3. Click the **Load unpacked** button.
4. Select this directory (`S:\Works\Projects\extension\GROTB`).
5. Pin the **Workspaces** extension to your browser toolbar.
6. Click the icon or press `Ctrl+Shift+W` to open the side panel!

---

## Architecture & Data Flow

```
┌────────────────────────────────────────────────────────┐
│                   Side Panel UI                        │
│   (panel.js, components: cards, tab-list, context menu) │
└───────────────────────┬────────────────────────────────┘
                        │ chrome.runtime.sendMessage
                        ▼
┌────────────────────────────────────────────────────────┐
│           Background Service Worker (MV3)             │
│  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │  window-opener   │  │        tab-sync             │ │
│  └────────┬─────────┘  └─────────────┬───────────────┘ │
│           │                          │                 │
│           ▼                          ▼                 │
│  ┌──────────────────┐  ┌─────────────────────────────┐ │
│  │ window-registry  │  │      group-sync             │ │
│  │ (storage.session)│  │   (chrome.tabGroups)        │ │
│  └──────────────────┘  └─────────────────────────────┘ │
└───────────────────────┬────────────────────────────────┘
                        │ Persist / Restore
                        ▼
┌────────────────────────────────────────────────────────┐
│        chrome.storage.local (Schema Version 1)         │
│         • workspaces    • workspaceOrder   • settings  │
└────────────────────────────────────────────────────────┘
```

### Storage Split: Local vs. Session
- **`chrome.storage.local`**: Survives browser restarts. Stores workspace names, colors, saved tabs, tab groups, and user settings.
- **`chrome.storage.session`**: Preserved across service worker sleeps, but wiped on browser exit. Holds dynamic bindings between temporary `windowId`s and persistent `workspaceId`s, active workspace pointers, and the `suppressSync` lock.

### The `suppressSync` Lock
When restoring 20+ tabs and tab groups in a newly created window, `chrome.tabs.onCreated` and `chrome.tabs.onUpdated` fire rapidly. Setting `suppressSync = true` during window creation prevents thrashing and race conditions, ensuring tabs restore in perfect order.

---

## Brave-Specific Considerations Handled

- **Empty / Privacy-Stripped Favicons**: Brave Shields may block standard tab `favIconUrl` properties. We fall back to the Chromium `_favicon/?pageUrl=...` API and generated letter-tile initials.
- **Restricted Internal Schemes**: `brave://` and `chrome://` URLs are handled safely during window restoration to prevent browser navigation exceptions.
- **Session Restore Timing**: Brave restores previously open windows before extension startup handlers settle. Startup recovery introduces a 1500ms settling pause before running Jaccard overlap matching.
- **Sync & Profile Deduplication**: Enforces a strict "one window per workspace, first match wins" rule.

---

## Keyboard Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+Shift+W` | Open workspace side panel switcher |
| `Ctrl+Shift+N` | Create a new workspace |

*Shortcuts can be customized at `brave://extensions/shortcuts`.*

---

## Folder Structure

```
GROTB/
├── manifest.json
├── README.md
├── .gitignore
├── assets/
│   └── icons/
│       ├── icon-16.png
│       ├── icon-32.png
│       ├── icon-48.png
│       └── icon-128.png
├── src/
│   ├── background/
│   │   ├── service-worker.js     # Entry point & lifecycle listeners
│   │   ├── workspace-manager.js  # CRUD operations & persistence
│   │   ├── window-registry.js    # windowId <-> workspaceId session binding
│   │   ├── tab-sync.js           # Debounced window tab & group synchronization
│   │   ├── window-opener.js      # Window creation, tab group restore & focus
│   │   ├── group-sync.js         # chrome.tabGroups serialization & restore
│   │   ├── startup-recovery.js   # URL Jaccard matching on restart
│   │   └── router.js             # runtime.onMessage command dispatcher
│   ├── shared/
│   │   ├── constants.js          # Storage keys, settings, message types
│   │   ├── colors.js             # 9 workspace colors mapped to tabGroups
│   │   ├── storage.js            # Async chrome.storage wrapper
│   │   ├── schema.js             # Data models & validation
│   │   ├── utils.js              # IDs, debounce, deepEqual, URL normalization
│   │   └── messages.js           # Typed messaging helpers
│   ├── sidepanel/
│   │   ├── panel.html
│   │   ├── panel.css
│   │   ├── panel.js
│   │   └── components/
│   │       ├── workspace-card.js # Workspace row component
│   │       ├── tab-list.js       # Expandable tab preview list
│   │       ├── color-picker.js   # Color swatch selector
│   │       └── context-menu.js   # Action context menu
│   ├── options/
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js            # Settings, JSON backup & restore
│   └── content/
│       └── accent-border.js      # Optional colored top border on web pages
└── test/
    ├── manual-checklist.md
    └── fixtures/
        └── sample-workspaces.json
```

---

## License

MIT License.
