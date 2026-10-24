# Chrome Web Store / Edge Add-ons listing

Ready-to-paste text. Upload `dist/tabroost-v<version>.zip` (`npm run pack`).
The store requires screenshots of 1280x800 or 640x400. The images in this folder are raw captures from the
smoke tests; resize or frame them before uploading.

## Name
Tabroost

## Summary (max 132 characters)
Workspaces for Brave and Chrome: one window per project, saved tabs and groups, instant switching.

## Description
Tabroost gives your browser workspaces, like Edge, for Chromium browsers.

- One window per workspace. Opening a workspace that is already open just focuses its window.
- Saves itself. Tab and group changes are stored within half a second.
- Real tab groups are saved and restored.
- Version history: every workspace keeps versions you can compare and restore.
- Optional edge handle on web pages: a thin strip on the screen edge that opens your workspaces in a popup. Drag it, hide it on chosen sites, or switch to a floating dot.
- Search workspaces and tabs. Ctrl+K inside the popup.
- Undo delete, automatic backups, JSON export and import (optionally passphrase-encrypted).
- Optional end-to-end encrypted sync through a private GitHub Gist you own.
- No analytics, no tracking, no server of ours.

## Category
Productivity

## Privacy
Privacy policy URL: https://github.com/Scrooge-777/tabroost/blob/main/PRIVACY.md
Single purpose: organize browser tabs into saved, switchable workspaces.

## Permission justifications
| Permission | Justification |
|---|---|
| tabs, tabGroups | Read, save and restore the tabs and tab groups of workspace windows |
| storage, unlimitedStorage | Save workspaces, version history and backups locally |
| sidePanel | Show the workspace list in the browser side panel |
| favicon | Show site icons next to saved tabs |
| contextMenus | Move tabs between workspaces from the right-click menu |
| alarms | Scheduled local backups and optional sync |
| scripting | Add the optional on-page edge handle to tabs that are already open |
| Optional access to all websites | Only requested if the user turns on the on-page edge handle, and removed when they turn it off |

## Data usage disclosures
- Does not collect or transmit user data to the developer.
- Optional sync sends only encrypted data to the user's own GitHub account.

## Before submitting
1. Bump the version, tag it, and let the Release workflow attach the zip.
2. Remove nothing from the zip: `npm run pack` already leaves out tests and docs.
3. The manifest `key` field only keeps a stable id for unpacked installs. If the store rejects it, remove it from the uploaded copy only, not from the repo.
