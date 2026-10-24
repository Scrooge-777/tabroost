# Privacy policy

Tabroost does not collect, transmit or sell personal data. There is no analytics, no tracking and no server operated by the developer.

## Data stored on your device

Workspace names, colors, icons, the titles and URLs of saved tabs, tab groups, window positions, settings and automatic backups. All of it stays in your browser's extension storage.

## Optional cloud sync

Off by default. If you turn it on, Tabroost encrypts your workspaces in the browser with a key derived from your passphrase and uploads the ciphertext to a private GitHub Gist in your own GitHub account, using a personal access token you provide. The developer has no access to the gist, your token or your passphrase. GitHub's own privacy policy applies to data stored there.

## Permissions

| Permission | Why |
|---|---|
| `tabs`, `tabGroups` | Read and restore the tabs and tab groups of workspace windows |
| `storage`, `unlimitedStorage` | Save workspaces and backups locally |
| `sidePanel` | Side panel UI |
| `favicon` | Show site icons |
| `contextMenus` | Move tabs between workspaces from the right-click menu |
| `alarms` | Scheduled backups and optional sync |
| `scripting` | Inject the on-page workspace indicator into open tabs |
| Optional access to all websites | Only if you turn on the on-page indicator; removed when you turn it off |

## Contact

Open an issue at https://github.com/Scrooge-777/tabroost/issues.
