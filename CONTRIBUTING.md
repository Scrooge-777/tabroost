# Contributing

Thanks for helping. Tabroost has no build step and no runtime dependencies.

```bash
npm ci
npm run lint
npm test
```

- Load the folder as an unpacked extension to try changes in a browser.
- Add or update tests in `test/` for behavior changes. Sync, crypto and storage code needs tests.
- `npm test` includes a call-contract check: every call such as `workspaceManager.someMethod()` must resolve to a real method.
- Keep `package.json` and `manifest.json` versions equal (checked by the tests).
- Never store secrets in `settings`. Use `src/shared/secrets.js`.
- Escape user-controlled text with `escapeHtml` before putting it in `innerHTML`, or use `textContent`.

## Releasing

1. Bump the version in `manifest.json` and `package.json`, and add an entry to `CHANGELOG.md`.
2. Push a tag `vX.Y.Z` that matches the manifest version. The Release workflow runs the tests, builds the zip and attaches it to a GitHub Release.
