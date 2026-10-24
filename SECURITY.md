# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/Scrooge-777/tabroost/security/advisories/new)
for this repository. You can expect a first reply within a few days.

## Supported versions

Only the latest release receives fixes.

## Threat model in short

- Workspaces live in `chrome.storage.local` unencrypted. Anyone with access to your browser profile can read them.
- Cloud sync is end-to-end encrypted before upload (AES-256-GCM, PBKDF2-SHA-256 with 600,000 iterations,
  format and version bound as additional authenticated data). GitHub only stores ciphertext.
- The GitHub token and sync passphrase are kept in `chrome.storage.session` by default.
  With "Remember on this device" they are also written to `chrome.storage.local` unencrypted.
  Use a token limited to the `gist` scope.
- Secrets are excluded from exports, backups and broadcast settings.
- Data downloaded from the cloud is validated and sanitized before it reaches storage.
