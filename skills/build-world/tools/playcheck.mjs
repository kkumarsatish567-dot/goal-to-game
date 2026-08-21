#!/usr/bin/env node
/**
 * playcheck.mjs - does the bundle you are about to publish actually RUN?
 *
 * Run this on the assembled bundle before every publish. It is the last gate
 * before a link reaches another human, and it catches the one failure that
 * every other check misses: a game that builds cleanly, packages cleanly,
 * uploads cleanly, and throws on the first frame.
 *
 * That is not hypothetical. A build shipped to thrixel.world with
 * `window.loadOrbModel = loadOrbModel` left behind after the function it named
 * had been refactored away. Vite does not care - a ReferenceError is a runtime
 * event, not a bundling one - so the build passed, the publish succeeded, and
 * the report said "fully playable, 60 FPS". The page was black. Nobody had
 * opened it.
 *
 * Engine-agnostic on purpose: it drives a real browser and reads the frame, so
 * it works on a kit game, a hand-written one, a Unity WebGL build, or a folder
 * a user handed over. It knows nothing about your game's internals.
 *
 * What it checks, on a desktop viewport and again on a phone:
 *   loads          no pageerror, no console error, no failed asset request
 *   renders        the frame is not blank or a flat wall of one colour
 *   responds       input changes what is on screen - keys on desktop, a real
 *                  touch drag on the phone
 *   fits           no horizontal overflow, canvas fills the screen, and the
 *                  drawing buffer is not asking a phone GPU for desktop pixels
 *
 *   node tools/playcheck.mjs ./dist
 *   node tools/playcheck.mjs https://slug.thrixel.world     # after publishing
 *   node tools/playcheck.mjs ./dist --shot=check.png --keep-serving
 *
 * Exit codes: 0 pass, 1 the bundle is broken, 2 could not check (no browser).
 * Treat 2 as "unknown", never as "fine".
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (n, d = null) => {
  const hit = args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

if (!target) {
  console.error('usage: playcheck.mjs <bundle-dir|url> [--shot=out.png] [--port=5599]');
  process.exit(2);
}

/** Playwright lives in the three.js kit; a hand-assembled bundle may have none. */
async function loadChromium() {
  const tries = ['playwright', 'playwright-core'];
  for (const mod of tries) {
    try {
      return (await import(mod)).chromium;
    } catch { /* keep looking */ }
  }
  // The kit ships it - reach into that install rather than making the caller
  // download a second copy of Chromium.
  const here = new URL('.', import.meta.url).pathname;
  for (const rel of ['../engines/threejs/node_modules/playwright/index.mjs',
                     '../engines/threejs/node_modules/playwright/index.js']) {
    try {
      return (await import(resolve(here, rel))).chromium;
    } catch { /* keep looking */ }
  }
  return null;
}

/** Static file server with no dependencies. Refuses to serve outside the root. */
function serve(root, port) {
  const server = createServer(async (req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = resolve(join(root, clean === '/' ? '/index.html' : clean));
    if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      server.missing.push(clean);
      res.writeHead(404).end('not found');
    }
  });
  server.missing = [];
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const chromium = await loadChromium();
if (!chromium) {
  console.error('playcheck: no browser available, so the bundle was NOT checked.');
  console.error('  Install one:  npm i -D playwright && npx playwright install chromium');
  console.error('  Do not report the game as verified. Say it is unverified, or open it yourself.');
  process.exit(2);
}

const isUrl = /^https?:\/\//.test(target);
const port = Number(flag('port', 5599));
const server = isUrl ? null : await serve(resolve(target), port);
const base = isUrl ? target : `http://127.0.0.1:${port}/`;

const report = { target, checks: [] };
let ok = true;
const ck = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  if (!pass) ok = false;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--enable-gpu-rasterization'],
});

/** Mean and variance of a sampled frame - a blank or flat frame gives ~0 std. */
function frameStats(buf) {
  let n = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < buf.length; i += 4096) {
    const v = buf[i]; sum += v; sumSq += v * v; n++;
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(2) };
}
const diffPct = (a, b) => {
  let n = 0, t = 0;
  for (let i = 0; i < a.length && i < b.length; i += 512) { t++; if (Math.abs(a[i] - b[i]) > 8) n++; }
  return +(100 * n / t).toFixed(2);
};

async function run(label, opts) {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`failed request: ${r.url().split('/').pop()}`));

  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  // Give the game a moment to boot, load assets and draw a few frames.
  await page.waitForTimeout(3500);

  const layout = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const b = c?.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight,
      viewportMeta: document.querySelector('meta[name=viewport]')?.content ?? null,
      canvas: c ? { w: Math.round(b.width), h: Math.round(b.height), dw: c.width, dh: c.height } : null,
    };
  });

  const a = await page.screenshot({ type: 'png' });
  if (opts.hasTouch) {
    // A real drag on the left of the screen: the movement half of any touch
    // scheme. Dispatched as pointer events so pointer- and touch-based games
    // both see it.
    await page.evaluate(async () => {
      const el = document.querySelector('canvas') || document.body;
      const mk = (t, x, y) => el.dispatchEvent(new PointerEvent(t, {
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      const x = Math.round(innerWidth * 0.2), y = Math.round(innerHeight * 0.75);
      mk('pointerdown', x, y);
      for (let i = 1; i <= 24; i++) { mk('pointermove', x, y - i * 8); await new Promise((r) => requestAnimationFrame(r)); }
      mk('pointerup', x, y - 192);
    });
  } else {
    for (const k of ['KeyW', 'ArrowUp', 'Space']) await page.keyboard.down(k);
    await page.mouse.move(200, 300);
    await page.mouse.move(520, 340, { steps: 12 });
    await page.waitForTimeout(600);
    for (const k of ['KeyW', 'ArrowUp', 'Space']) await page.keyboard.up(k);
  }
  await page.waitForTimeout(900);
  const b2 = await page.screenshot({ type: 'png' });

  const stats = frameStats(a);
  const responded = diffPct(a, b2);
  const shot = flag('shot');
  if (shot && opts.hasTouch) await page.screenshot({ path: String(shot) });

  ck(`${label}: loads without errors`, errors.length === 0, errors[0] ?? 'clean');
  ck(`${label}: draws something`, stats.std > 2.5, `frame std ${stats.std} (a blank or flat page is ~0)`);
  ck(`${label}: responds to input`, responded > 0.4, `${responded}% of the frame changed`);
  if (opts.hasTouch) {
    ck('phone: no horizontal overflow', layout.scrollW <= layout.innerW + 1, `scrollWidth ${layout.scrollW} vs ${layout.innerW}`);
    ck('phone: has a viewport meta tag', !!layout.viewportMeta,
       layout.viewportMeta ?? 'MISSING - a phone renders the page zoomed out');
    if (layout.canvas) {
      const mp = layout.canvas.dw * layout.canvas.dh / 1e6;
      ck('phone: drawing buffer is phone-sized', mp <= 2.6,
         `${mp.toFixed(2)} MP - cap devicePixelRatio if this is high`);
    }
  }
  report[label] = { errors: errors.slice(0, 5), frame: stats, respondedPct: responded, layout };
  await page.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 720 } });
  await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  if (server?.missing.length) {
    ck('every referenced file is in the bundle', false,
       `missing: ${[...new Set(server.missing)].slice(0, 6).join(', ')}`);
  }
} catch (e) {
  ck('fatal', false, e.message);
} finally {
  await browser.close();
  server?.close();
}

report.ok = ok;
console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error('\nplaycheck FAILED - do not publish this bundle.');
  console.error('Fix what is listed above and run it again. A game that throws on load');
  console.error('looks exactly like a working one from the terminal.');
}
process.exit(ok ? 0 : 1);
