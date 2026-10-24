/**
 * Real-browser smoke test: loads the unpacked extension in headless Brave/Chrome,
 * drives the panel, popup and options pages, and saves screenshots.
 *
 *   PLAYWRIGHT=<path to playwright-core> BROWSER=<path to brave.exe|chrome.exe> \
 *     node test/browser-smoke.cjs [screenshot-dir]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');

const EXT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shots-'));
const BRAVE = process.env.BROWSER || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

const pages = {
  '/docs': 'Project Docs', '/github': 'GitHub - repo', '/mail': 'Inbox (3)', '/news': 'Morning News', '/video': 'Lecture Video'
};

(async () => {
  const server = http.createServer((req, res) => {
    const title = pages[req.url] || 'Page';
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
  }).listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-profile-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: BRAVE,
    headless: false,
    viewport: { width: 1200, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : [])]
  });

  const errors = [];
  const watch = (p, label) => {
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${label}] ${m.type()}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  };
  const step = async (name, fn) => {
    try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, '-', e.message.split('\n')[0]); errors.push(`[step ${name}] ${e.message.split('\n')[0]}`); }
  };

  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  sw.on('console', (m) => { if (m.type() === 'error') errors.push(`[sw] ${m.text()}`); });
  console.log('extension id', extId);

  const first = ctx.pages()[0] || await ctx.newPage();
  await first.goto(`${base}/docs`);
  for (const p of ['/github', '/mail']) { const pg = await ctx.newPage(); await pg.goto(base + p); }

  const panel = await ctx.newPage();
  watch(panel, 'panel');
  await panel.setViewportSize({ width: 380, height: 720 });
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`);

  await step('empty state renders', async () => {
    await panel.waitForSelector('.window-bar.is-unmanaged', { timeout: 10000 });
    await panel.screenshot({ path: path.join(OUT, '01-empty-light.png') });
    await panel.emulateMedia({ colorScheme: 'dark' }); await panel.waitForTimeout(500);
    await panel.screenshot({ path: path.join(OUT, '02-empty-dark.png') });
    await panel.emulateMedia({ colorScheme: 'light' });
  });

  await step('save window as workspace via dialog', async () => {
    await panel.click('.window-bar [data-act="save"]');
    await panel.waitForSelector('dialog[open]');
    await panel.fill('#dlg-ws-name', 'Research');
    await panel.click('.emoji-btn[data-emoji="📚"]');
    await panel.screenshot({ path: path.join(OUT, '03-create-dialog.png') });
    await panel.click('dialog button[type="submit"]');
    await panel.waitForSelector('.window-bar.is-managed', { timeout: 10000 });
    await panel.waitForSelector('.ws-card');
  });

  await step('seed closed workspaces', async () => {
    const res = await panel.evaluate(async (base) => chrome.runtime.sendMessage({
      type: 'IMPORT',
      mode: 'merge',
      payload: {
        workspaces: {
          c: {
            id: 'c', name: 'Coursework', color: 'green', icon: '🎓', lastOpenedAt: Date.now() - 3 * 3600e3,
            tabs: [
              { url: base + '/video', title: 'Lecture Video', groupId: 'g1' },
              { url: base + '/docs', title: 'Assignment brief', groupId: 'g1' },
              { url: base + '/news', title: 'Reading list' }
            ],
            groups: [{ id: 'g1', title: 'Week 3', color: 'purple' }]
          },
          s: { id: 's', name: 'Side project', color: 'orange', icon: '🚀', lastOpenedAt: Date.now() - 2 * 86400e3, tabs: [{ url: base + '/github', title: 'GitHub - repo' }] }
        },
        workspaceOrder: ['c', 's']
      }
    }), base);
    if (!res?.success) throw new Error(JSON.stringify(res));
    await panel.waitForFunction(() => document.querySelectorAll('.ws-card').length === 3, null, { timeout: 10000 });
  });

  await step('expand card shows group', async () => {
    await panel.click('.ws-card:nth-child(2) [data-act="expand"]');
    await panel.waitForSelector('.ws-card.is-expanded .group-head');
    await panel.screenshot({ path: path.join(OUT, '04-list-light.png') });
    await panel.emulateMedia({ colorScheme: 'dark' }); await panel.waitForTimeout(500);
    await panel.screenshot({ path: path.join(OUT, '05-list-dark.png') });
    await panel.emulateMedia({ colorScheme: 'light' });
  });

  await step('workspace menu', async () => {
    await panel.hover('.ws-card:nth-child(2) .ws-row');
    await panel.click('.ws-card:nth-child(2) [data-act="menu"]');
    await panel.waitForSelector('.menu');
    await panel.waitForTimeout(800);
    if (!(await panel.$('.menu'))) throw new Error('menu was closed by a re-render');
    await panel.screenshot({ path: path.join(OUT, '06-menu.png') });
    await panel.keyboard.press('Escape');
    await panel.waitForSelector('.menu', { state: 'detached' });
  });

  await step('version history dialog', async () => {
    await panel.hover('.ws-card:nth-child(2) .ws-row');
    await panel.click('.ws-card:nth-child(2) [data-act="menu"]');
    await panel.waitForSelector('.menu');
    await panel.click('.menu-item:has-text("Version history")');
    await panel.waitForSelector('dialog[open] .history-list, dialog[open] .muted');
    await panel.click('dialog[open] [data-save]');
    await panel.waitForSelector('dialog[open] .history-row', { timeout: 5000 });
    await panel.screenshot({ path: path.join(OUT, '06b-history.png') });
    await panel.click('dialog[open] button[type="submit"]');
    await panel.waitForSelector('dialog[open]', { state: 'detached' });
  });

  await step('ctrl+k focuses search', async () => {
    await panel.click('body', { position: { x: 5, y: 5 } });
    await panel.keyboard.press('Control+k');
    const focused = await panel.evaluate(() => document.activeElement?.dataset?.el);
    if (focused !== 'search') throw new Error(`focus is on ${focused}`);
    await panel.keyboard.press('Escape');
  });

  await step('search filters tabs', async () => {
    await panel.fill('[data-el="search"]', 'lecture');
    await panel.waitForTimeout(150);
    const n = await panel.locator('.ws-card').count();
    if (n !== 1) throw new Error(`expected 1 match, got ${n}`);
    await panel.screenshot({ path: path.join(OUT, '07-search.png') });
    await panel.fill('[data-el="search"]', '');
  });

  await step('this window view', async () => {
    await panel.click('[data-view="window"]');
    await panel.waitForSelector('.tab-tree.is-live .tab-row');
    await panel.screenshot({ path: path.join(OUT, '08-this-window.png') });
    await panel.click('[data-view="workspaces"]');
  });

  await step('open closed workspace restores tabs + group in new window', async () => {
    await panel.click('.ws-card:has-text("Coursework") .ws-name');
    await panel.waitForTimeout(2500);
    const result = await sw.evaluate(async () => {
      const wins = await chrome.windows.getAll({ populate: true });
      const groups = await chrome.tabGroups.query({});
      return { windows: wins.map((w) => w.tabs.map((t) => t.title || t.url)), groups: groups.map((g) => `${g.title}/${g.color}`) };
    });
    console.log('      windows:', JSON.stringify(result.windows));
    console.log('      groups :', JSON.stringify(result.groups));
    if (!result.windows.some((w) => w.length === 3)) throw new Error('restored window with 3 tabs not found');
    if (!result.groups.includes('Week 3/purple')) throw new Error('group not restored');
  });

  await step('drag-merge two live tabs in an open workspace card', async () => {
    await panel.bringToFront();
    const card = panel.locator('.ws-card', { hasText: 'Research' });
    if (!(await card.evaluate((el) => el.classList.contains('is-expanded')))) {
      await card.locator('[data-act="expand"]').click();
    }
    const rows = card.locator('.tab-tree > .tab-row');
    await rows.nth(1).dragTo(rows.nth(0));
    await panel.waitForSelector('.group-prompt', { timeout: 5000 });
    await panel.fill('.group-prompt-input', 'Reading');
    await panel.screenshot({ path: path.join(OUT, '08b-group-prompt.png') });
    await panel.keyboard.press('Enter');
    await panel.waitForTimeout(1200);
    const groups = await sw.evaluate(async () => (await chrome.tabGroups.query({})).map((g) => g.title));
    console.log('      native groups:', JSON.stringify(groups));
    if (!groups.includes('Reading')) throw new Error('live group not named');
    // The tabs must stay in this workspace's window even though another window has focus
    await card.locator('.group-head', { hasText: 'Reading' }).waitFor({ timeout: 5000 });
    await panel.screenshot({ path: path.join(OUT, '08c-after-merge.png') });
  });

  await step('popup renders', async () => {
    const popup = await ctx.newPage();
    watch(popup, 'popup');
    await popup.setViewportSize({ width: 380, height: 580 });
    await popup.goto(`chrome-extension://${extId}/src/sidepanel/popup.html`);
    await popup.waitForSelector('.ws-card');
    await popup.screenshot({ path: path.join(OUT, '09-popup.png') });
    await popup.close();
  });

  await step('options renders', async () => {
    const options = await ctx.newPage();
    watch(options, 'options');
    await options.setViewportSize({ width: 900, height: 1000 });
    await options.goto(`chrome-extension://${extId}/src/options/options.html`);
    await options.waitForSelector('#shortcut-list li');
    await options.waitForTimeout(300);
    await options.screenshot({ path: path.join(OUT, '10-options.png'), fullPage: true });
    await options.emulateMedia({ colorScheme: 'dark' }); await options.waitForTimeout(500);
    await options.screenshot({ path: path.join(OUT, '11-options-dark.png') });
    await options.close();
  });

  await step('delete + undo', async () => {
    await panel.bringToFront();
    await panel.click('.ws-card:nth-child(3) .ws-row', { button: 'right' });
    await panel.click('.menu-item.is-danger');
    await panel.waitForSelector('dialog[open]');
    await panel.screenshot({ path: path.join(OUT, '12-confirm.png') });
    await panel.click('dialog button[type="submit"]');
    await panel.waitForSelector('.toast');
    await panel.waitForFunction(() => document.querySelectorAll('.ws-card').length === 2);
    await panel.screenshot({ path: path.join(OUT, '13-undo-toast.png') });
    await panel.click('.toast-action');
    await panel.waitForFunction(() => document.querySelectorAll('.ws-card').length === 3, null, { timeout: 5000 });
  });

  console.log('\nERRORS:\n' + (errors.length ? errors.join('\n') : 'none'));
  console.log('Screenshots:', OUT);
  if (errors.length) process.exitCode = 1;
  await ctx.close();
  server.close();
  fs.rmSync(userDir, { recursive: true, force: true });
})().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
