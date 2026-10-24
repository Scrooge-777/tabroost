# Changelog

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
