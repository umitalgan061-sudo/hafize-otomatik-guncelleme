// hafize-kontrol v11: serves this branch and main over http (so sites of several files and modules work), opens
// index.html of each in Chromium, uses the page like a person would (types into text boxes and presses Enter, clicks
// every button) and compares the uncaught errors with main's. Every error is also written as a GitHub annotation,
// so Hafize's next round knows what is broken. Written by Hafize.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const PAGE = process.env.HAFIZE_SAYFA || 'index.html';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
mkdirSync('.kontrol', { recursive: true });
let hasMain = false;
try { execFileSync('git', ['worktree', 'add', '--detach', '.kontrol/main', 'origin/main'], { stdio: 'ignore' }); } catch { /* no main yet, or already there */ }
hasMain = existsSync('.kontrol/main/' + PAGE);
let rules = {};
try { rules = JSON.parse(readFileSync('.github/hafize-kontrol.json', 'utf8')); } catch { /* no rules */ }
// A project with a build (package.json with a "build" script, e.g. Vite or React) is built first; what is checked and
// what goes on the site is the built output. Hafize's rounds write the source, the check builds it.
function siteRoot(dir) {
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return dir; }
  if (!pkg || !pkg.scripts || !pkg.scripts.build) return dir;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, [existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  execFileSync(npm, ['run', 'build'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  const out = rules.cikti ? join(dir, rules.cikti) : ['dist', 'build', 'out'].map((name) => join(dir, name)).find((path) => existsSync(join(path, PAGE)));
  if (!out || !existsSync(join(out, PAGE))) throw new Error('derleme çıktısında ' + PAGE + ' yok');
  return out;
}
// The built site goes to the branch yayin/<branch>; the worker publishes it from there after the merge.
function pushOutput(dir, branch) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo || resolve(dir) === resolve('.')) return;
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
  git('init', '-q');
  git('checkout', '-q', '-b', 'yayin');
  git('add', '-A');
  git('-c', 'user.name=hafize', '-c', 'user.email=hafize@users.noreply.github.com', 'commit', '-q', '-m', 'Derlenmiş site ' + String(process.env.GITHUB_SHA || '').slice(0, 7));
  git('push', '-q', '-f', 'https://x-access-token:' + token + '@github.com/' + repo + '.git', 'yayin:refs/heads/yayin/' + branch);
  console.log('Derlenmiş site gönderildi: yayin/' + branch);
}
const branchName = process.env.GITHUB_REF_NAME || 'yerel';
// Live audit (on schedule or when Hafize starts it after a release): the published site itself is used like a person
// would, measured and held to the owner's acceptance checks. Its findings open the next round.
const live = /^(schedule|workflow_dispatch)$/.test(process.env.GITHUB_EVENT_NAME || '') && /^https?:\/\//.test(rules.canli || '');
if (live) console.log('Canlı denetim: ' + rules.canli);
let mineRoot = '.';
if (live) mineRoot = rules.canli; else try { mineRoot = siteRoot('.'); } catch (error) { console.log('::error title=Derleme hatası::' + String(error.message || error).split('\n')[0].slice(0, 300)); process.exit(1); }
if (!live && branchName === 'main') { pushOutput(mineRoot, 'main'); process.exit(0); }
let mainRoot = '.kontrol/main';
if (live) hasMain = false;
if (hasMain) { try { mainRoot = siteRoot('.kontrol/main'); } catch { hasMain = false; } }
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium || playwright.default.chromium;

function serve(root) {
  if (/^https?:\/\//.test(root)) return Promise.resolve({ url: root, close: () => {} });
  const base = resolve(root);
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    let file = join(base, path || PAGE);
    if (!file.startsWith(base)) { response.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ url: `http://127.0.0.1:${server.address().port}/${PAGE}`, close: () => server.close() })));
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function errorsOf(root) {
  const site = await serve(root);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const used = [];
  let using = false;
  page.on('pageerror', (error) => (using ? used : errors).push(String(error?.message ?? error).split('\n')[0].slice(0, 200)));
  // A script or module that failed to load ("scriptError", a 404 module) stops a page as surely as an uncaught error.
  page.on('console', (message) => { if (message.type() !== 'error') return; const text = message.text(); if (/scriptError|Failed to load module|is not defined|Uncaught|SyntaxError|TypeError|ReferenceError|Cannot read propert/i.test(text)) (using ? used : errors).push('Konsol: ' + text.split('\n')[0].slice(0, 200)); });
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(site.url, { waitUntil: 'load', timeout: 60_000 }).catch((error) => errors.push('Sayfa açılmadı: ' + error.message.slice(0, 160)));
  await page.waitForTimeout(12_000);
  const body = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
  const nodes = await page.evaluate(() => document.querySelectorAll('body *').length).catch(() => 0);
  using = true;
  for (const box of (await page.$$('input[type="text"], input[type="search"], input:not([type])')).slice(0, 10)) {
    if (!(await box.isVisible().catch(() => false))) continue;
    await box.fill('Ankara').catch(() => {});
    await box.press('Enter').catch(() => {});
    await page.waitForTimeout(800);
  }
  for (const target of (await page.$$('button, [onclick], [role="button"], input[type="button"], input[type="submit"]')).slice(0, 40)) {
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (!page.url().startsWith(site.url.replace(/[^/]*$/, ''))) await page.goto(site.url).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.close();
  site.close();
  return { errors: [...new Set(errors)], used: [...new Set(used)], nodes, body };
}
const mine = await errorsOf(mineRoot);
const base = hasMain ? await errorsOf(mainRoot) : { errors: [], used: [], nodes: 0 };
// Usability: what a visitor actually sees on opening the site, on a desktop and on a phone, measured point by point
// (a map behind a full-screen panel is not seen however big its box is). The project's own rules say what must be seen.
const usability = [];
async function seenShare(root, viewport, selector) {
  const site = await serve(root);
  const phone = viewport.width < 600;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(site.url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const result = await page.evaluate((target) => {
    const goal = target ? document.querySelector(target) : null;
    let hits = 0; let total = 0;
    for (let y = 0.5; y < 24; y += 1) for (let x = 0.5; x < 12; x += 1) {
      total += 1;
      const element = document.elementFromPoint(innerWidth * x / 12, innerHeight * y / 24);
      if (goal && element && (element === goal || goal.contains(element))) hits += 1;
    }
    return { share: Math.round(hits * 100 / total), found: Boolean(goal), overflow: document.documentElement.scrollWidth > innerWidth + 2 };
  }, selector || '').catch(() => ({ share: 0, found: false, overflow: false }));
  await context.close();
  site.close();
  return result;
}
for (const [name, viewport, least] of [['masaüstü', { width: 1280, height: 800 }, rules.masaustu_en_az], ['telefon', { width: 390, height: 844 }, rules.telefon_en_az]]) {
  const seen = await seenShare(mineRoot, viewport, rules.ana_oge);
  console.log('Kullanılabilirlik', name, JSON.stringify(seen));
  if (rules.ana_oge && !seen.found) usability.push(rules.ana_oge + ' sayfada yok');
  else if (rules.ana_oge && typeof least === 'number' && seen.share < least) usability.push(name + ' açılışında ' + rules.ana_oge + ' ekranın yalnızca yüzde ' + seen.share + ' kadarında görünüyor, en az yüzde ' + least + ' olmalı: üstünü kaplayan panel, kart ya da başlık var');
  if (name === 'telefon' && seen.overflow) usability.push('telefonda sayfa yana taşıyor, yatay kaydırma çıkıyor');
}
// The owner's acceptance checks (.github/hafize-kontrol.json "kabul": [{"ad", "ifade", "cihaz"}]): each is a JavaScript
// expression run inside the opened page once it has settled. Anything but true fails the check in the owner's own words.
const accepted = [];
async function acceptance(root, viewport, checks) {
  const site = await serve(root);
  const phone = viewport.width < 600;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(site.url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(Number(rules.kabul_bekle) || 15000);
  // A map page is measured once its view is ready and done loading (GitHub's machine is slower than a desk computer).
  await page.evaluate(async () => {
    // A top-level let is not a property of the window: the name itself is looked up.
    const view = (() => { try { return eval('view'); } catch { return undefined; } })();
    if (!view || typeof view.when !== 'function') return;
    await Promise.race([view.when(), new Promise((done) => setTimeout(done, 45000))]).catch(() => {});
    for (let i = 0; i < 90 && view.updating; i++) await new Promise((done) => setTimeout(done, 500));
  }).catch(() => {});
  const out = [];
  // Every check has 90 seconds and says how it went as it goes (2026-11-05: one check never answered, the job ran
  // silently into its time limit and the round's work was thrown away). A page that stops answering is not waited on
  // check after check: the rest are reported as not measured.
  let frozen = false;
  for (const check of checks) {
    if (frozen) { out.push(check.ad + ' (ölçülemedi: sayfa yanıt vermiyor)'); continue; }
    const started = Date.now();
    let timer;
    const verdict = await Promise.race([
      page.evaluate(async (code) => {
        try { const value = await (0, eval)('(async () => (' + code + '))()'); return value === true ? true : typeof value === 'string' ? 'ölçülen: ' + value.slice(0, 200) : false; } catch (error) { return 'hata: ' + String((error && error.message) || error).slice(0, 120); }
      }, check.ifade).catch((error) => 'hata: ' + String(error.message).slice(0, 120)),
      new Promise((done) => { timer = setTimeout(() => done('zaman aşımı: 90 saniyede sonuç vermedi'), 90_000); }),
    ]);
    clearTimeout(timer);
    console.log('  ' + (verdict === true ? '✓' : '✗') + ' ' + Math.round((Date.now() - started) / 1000) + ' sn ' + check.ad.slice(0, 80));
    if (typeof verdict === 'string' && verdict.startsWith('zaman aşımı')) frozen = !(await Promise.race([page.evaluate(() => true).catch(() => false), new Promise((done) => setTimeout(() => done(false), 20_000))]));
    if (verdict !== true) out.push(check.ad + (typeof verdict === 'string' ? ' (' + verdict + ')' : ''));
  }
  await Promise.race([context.close().catch(() => {}), new Promise((done) => setTimeout(done, 15_000))]);
  site.close();
  return out;
}
const checks = Array.isArray(rules.kabul) ? rules.kabul.filter((check) => check && check.ad && check.ifade) : [];
for (const [name, viewport, key] of [['masaüstü', { width: 1280, height: 800 }, 'masaustu'], ['telefon', { width: 390, height: 844 }, 'telefon']]) {
  const own = checks.filter((check) => !check.cihaz || check.cihaz === key);
  if (!own.length) continue;
  const failed = await acceptance(mineRoot, viewport, own);
  console.log('Kabul', name, JSON.stringify({ denenen: own.length, tutmayan: failed }));
  for (const line of failed) accepted.push(name + ': ' + line);
}
await browser.close();
const oneLine = (text) => String(text).replace(/[\r\n%]/g, ' ');
// A one- or two-letter message comes from the test browser's software WebGL, not from the page; it shows up at load or
// while clicking at random, on main as well. It is written down but never fails the check. An error main has anywhere
// (at load or in use) is not new either.
const noise = (error) => String(error).trim().length <= 2;
const onMain = (error) => base.errors.includes(error) || base.used.includes(error);
const fresh = mine.errors.filter((error) => !onMain(error) && !noise(error));
const freshUse = mine.used.filter((error) => !onMain(error) && !noise(error));
for (const error of mine.errors) console.log(`::${fresh.includes(error) ? 'error' : 'warning'} title=Açılış hatası${fresh.includes(error) ? '' : ' (main de var)'}::${oneLine(error)}`);
for (const error of mine.used) console.log(`::${freshUse.includes(error) ? 'error' : 'warning'} title=Kullanım hatası${freshUse.includes(error) ? '' : ' (main de var)'}::${oneLine(error)}`);
console.log('Bu dal:', JSON.stringify(mine));
console.log('main:', JSON.stringify(base));
for (const line of usability) console.log('::error title=Kullanılabilirlik hatası::' + oneLine(line));
for (const line of accepted) console.log('::error title=Kabul hatası::' + oneLine(line));
if (mine.nodes < 3) { console.log('::error title=Açılış hatası::Sayfa boş görünüyor'); process.exit(1); }
if (usability.length) { console.error('Kullanılabilirlik:', usability.join(' | ')); process.exit(1); }
if (accepted.length) { console.error('Kabul:', accepted.join(' | ')); process.exit(1); }
if (fresh.length || freshUse.length) { console.error('Yeni hata:', [...fresh, ...freshUse].join(' | ')); process.exit(1); }
if (!live) pushOutput(mineRoot, branchName);
console.log('Temiz: main\'de olmayan bir hata yok.');
