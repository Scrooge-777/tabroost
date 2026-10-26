# Changelog

## 1.4.0

### Security
- The message router now checks who is asking. Content scripts (which run beside web pages) can only read the page indicator and save the pill position; every other command must come from an extension page. A sender without this extension's id is rejected.
- Cloud sync only accepts plain hex Gist IDs, so a tampered setting can no longer redirect requests. A truncated Gist is only read from `gist.githubusercontent.com` or `api.github.com` over HTTPS, so the token is never sent anywhere else.
- Explicit extension-page Content Security Policy (`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`).
- Backup ids are escaped before they reach the options page markup.
- Decryption errors keep their cause for easier debugging.
- CodeQL scanning runs on every push and weekly.

### Changed
- Dev tooling upgraded: ESLint 10, c8 12, GitHub Actions `checkout` v7. CI now runs on Node 20, 22 and 24. Minimum Node for development is 20.19.
- Added `test/security.test.mjs` (sender policy, Gist ID and URL checks).

### Fixed
- Removed an unused variable in the page indicator and two dead assignments that ESLint 10 flags.

## 1.3.0

### Added
- Reopen last session: if the browser restarts and some workspaces that were open do not come back, the panel offers to reopen them (Reopen / Dismiss).
- Workspace notes: an optional note per workspace, shown under its name and edited in the workspace dialog. Notes sync with the workspace.
- Templates: save a workspace as a template (workspace menu) and create new workspaces from it (New workspace menu). Up to 20 templates; kept on this device.
- Sync conflict report: when two devices changed the same workspace, sync still keeps the newer version, now saves the other one in that workspace's history ("Replaced by sync"), and lists it under Settings > Cloud Sync.

### Changed
- Internal: workspace-manager split into core, snapshot and tab-operations modules. No behavior change.

## 1.2.0

### Fixed
- The panel never knew which workspace the current window belongs to (`GET_CURRENT_STATUS` returned different field names than the panel read), so the "This window" bar always said "Unsaved window".
- Restoring a workspace could lose its tab groups and live tab mapping: tabs were discarded before grouping, and discarding can give a tab a new id. Discarding now happens last.
- Cloud sync no longer fails: it called `saveState` and `saveSettings`, which did not exist.
- Deleting a workspace now records a tombstone, so sync no longer brings deleted workspaces back. Undo clears it.
- Settings changed while a sync is running are no longer overwritten.
- Sync merges inside the storage lock, so edits made during a sync are kept.
- Sync re-reads and re-merges when another device writes during a sync.

### Security
- GitHub token and passphrase moved out of settings. They are session-only unless "Remember on this device" is on, and are never exported or backed up. Existing values are migrated automatically.
- Exports no longer contain sync settings.
- Encryption format v2: PBKDF2 600,000 iterations, stored KDF parameters, format and version bound as additional authenticated data. v1 data is still readable.
- Data from the cloud is validated and sanitized before it is saved. Data from a newer schema is refused.
- Minimum passphrase length of 8 characters.
- Tab restore uses a scheme allowlist, and ignores leading whitespace and control characters.
- The side panel page uses a dynamic URL so websites cannot guess it.

### Added
- Version history per workspace: automatic versions (at most every 10 minutes while it changes, and when its window closes), manual versions, and a version taken before every restore. Open it from the workspace menu: see what changed (+added / −removed tabs) and restore. The newest 20 are kept. Not synced or exported.
- Edge handle: drag it up or down to move it, optional open-on-hover, and a list of sites where it stays hidden.
- Popup: close button, Ctrl+K to search, and it remembers the last tab you used.
- Edge handle with a slide-out panel (new default style), like an edge panel on a phone: a thin strip on the screen edge instead of a floating dot, so it does not cover site menus. Click it to open your workspaces in a popup card beside the handle. The floating dot is still available under Settings > Style.
- Optional passphrase-encrypted export and import files.
- Request timeouts, GitHub rate-limit handling and exponential backoff for background sync.
- Sync lock that survives service worker restarts.
- Retry button when the panel cannot reach the extension.
- Tests: end-to-end sync against a fake Gist API, call-contract check, version check.
- ESLint, coverage, release and Dependabot workflows, SECURITY.md, PRIVACY.md, CONTRIBUTING.md.

### Changed
- The on-page pill and accent border are opt-in again. Site access is an optional permission requested when you turn a feature on, and removed when you turn both off. The content script is registered only while a feature is on.
- Page indicator internals renamed from "workspaces" to "tabroost". Export files are labeled `tabroost`; the old label is still accepted on import.
