/**
 * Real-browser check of the optional on-page features (pill button, accent border, flyout).
 * Headless browsers can't click the permission prompt, so this runs a temporary copy of
 * the extension whose manifest pre-grants the site access normally requested at runtime.
 *
 *   PLAYWRIGHT=<path to playwright-core> BROWSER=<path to brave.exe|chrome.exe> \
 *     node test/page-indicator-smoke.cjs [screenshot-dir]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');

const SRC = path.resolve(__dirname, '..');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ws-page-shots-'));
const BROWSER = process.env.BROWSER || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

/** RGB of one screen pixel (decodes the 1x1 PNG screenshot with zlib) */
async function pixelAt(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const chunks = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const type = png.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') chunks.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = require('zlib').inflateSync(Buffer.concat(chunks));
  return [raw[1], raw[2], raw[3]]; // byte 0 is the row filter type
}

(async () => {
  const ext =fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ext-'));
  for (const item of ['manifest.json', 'src', 'assets']) {
    fs.cpSync(path.join(SRC, item), path.join(ext, item), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = manifest.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Some site</title><body style="margin:0;font:16px sans-serif"><header style="height:56px;background:#eee;padding:16px">Site header / logo</header><p style="padding:16px">Page content</p></body>');
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-profile-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: BROWSER,
    headless: false,
    viewport: { width: 900, height: 650 },
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : [])]
  });

  const errors = [];
  let failed = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
  };

  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    sw.on('console', (m) => { if (m.type() === 'error') errors.push(`[sw] ${m.text()}`); });
    const extId = new URL(sw.url()).host;

    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
    await page.goto(`${base}/site`);

    // Settings page: save the window as a workspace, then turn both features on
    const ui = await ctx.newPage();
    ui.on('pageerror', (e) => errors.push(`[ui] ${e.message}`));
    await ui.goto(`chrome-extension://${extId}/src/options/options.html`);
    await ui.evaluate(async () => {
      const [win] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      await chrome.runtime.sendMessage({ type: 'CREATE_FROM_CURRENT_WINDOW', windowId: win.id, name: 'Research', color: 'purple', icon: '📚' });
    });

    const hasHost = () => page.evaluate(() => Boolean(document.getElementById('tabroost-ext-indicator')));

    await page.bringToFront();
    await page.waitForTimeout(800);
    check('nothing injected while both features are off (default)', !(await hasHost()));

    const res = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { showPagePill: true, accentBorder: true } }));
    check('settings saved', res?.success === true, JSON.stringify(res?.data && { pill: res.data.showPagePill, border: res.data.accentBorder }));

    const registered = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
    check('page script registered', registered.includes('workspaces-page-indicator'), JSON.stringify(registered));

    await page.bringToFront();
    await page.waitForFunction(() => document.getElementById('tabroost-ext-indicator'), null, { timeout: 5000 }).catch(() => {});
    check('injected into the already-open page', await hasHost());

    await page.reload();
    await page.waitForTimeout(1200);
    check('injected on a fresh page load', await hasHost());
    await page.screenshot({ path: path.join(OUT, 'p1-pill-and-border.png') });

    // Closed shadow root: probe what is actually on screen at the pill / border positions
    const handleHit = await page.evaluate(() => document.elementFromPoint(2, 40) === document.getElementById('tabroost-ext-indicator'));
    check('edge handle is on screen (left edge)', handleHit);
    const contentHit = await page.evaluate(() => document.elementFromPoint(40, 40) !== document.getElementById('tabroost-ext-indicator'));
    check('page content next to the handle stays clickable', contentHit);
    // The border is click-through, so read the painted pixel instead (page header is #eee)
    const [r, g, b] = await pixelAt(page, 450, 1);
    check('accent border is painted in the workspace color (top edge)', !(r === 238 && g === 238 && b === 238), `rgb(${r},${g},${b})`);

    await page.mouse.move(2, 40);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'p1b-handle-hover.png'), clip: { x: 0, y: 0, width: 300, height: 120 } });

    await page.mouse.click(2, 40);
    await page.waitForTimeout(1500);
    const flyoutFrame = page.frames().find((f) => f.url().includes('panel.html?mode=flyout'));
    check('clicking the handle opens the slide-out panel', Boolean(flyoutFrame));
    if (flyoutFrame) {
      await flyoutFrame.waitForSelector('.window-bar', { timeout: 5000 }).catch(() => {});
      const title = await flyoutFrame.evaluate(() => document.querySelector('.wb-title')?.textContent).catch(() => null);
      check('flyout shows the current workspace', title === 'Research', `got ${JSON.stringify(title)}`);
      await page.screenshot({ path: path.join(OUT, 'p2-flyout-open.png') });
      await page.keyboard.press('Escape');
      await page.mouse.click(600, 400);
      await page.waitForTimeout(400);
      check('flyout closes on outside click', !page.frames().some((f) => f.url().includes('mode=flyout')));
    }

    // Dot style still works
    await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { pillStyle: 'dot' } }));
    await page.bringToFront();
    await page.waitForTimeout(1200);
    const dotHit = await page.evaluate(() => document.elementFromPoint(18, 19) === document.getElementById('tabroost-ext-indicator'));
    check('dot style: floating dot is on screen (top-left)', dotHit);
    await page.screenshot({ path: path.join(OUT, 'p1c-dot-style.png') });
    await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { pillStyle: 'handle' } }));
    await page.bringToFront();
    await page.waitForTimeout(800);

    // Rename -> pill text follows
    await ui.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'LIST_WORKSPACES' });
      const id = Object.keys(r.data.workspaces)[0];
      await chrome.runtime.sendMessage({ type: 'UPDATE_WORKSPACE', id, name: 'Renamed', color: 'green' });
    });
    await page.bringToFront();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'p3-after-rename.png') });

    // Turn features off -> removed
    await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { showPagePill: false, accentBorder: false } }));
    const after = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
    check('page script unregistered when turned off', after === 0);
    await page.bringToFront();
    await page.waitForTimeout(1000);
    check('indicator removed from the open page', !(await hasHost()));
  } catch (e) {
    failed++;
    console.log('FAIL  crashed —', e.message.split('\n')[0]);
  }

  console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  console.log('Screenshots:', OUT);
  await ctx.close();
  server.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  fs.rmSync(ext, { recursive: true, force: true });
  if (failed || errors.length) process.exitCode = 1;
})();
