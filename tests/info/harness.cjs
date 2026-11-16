'use strict';
// Reusable browser harness for the Home info features: preview build + TV compile,
// placeholder Settings tabs for ids no feature module has registered yet, scope toggle.
const { chromium } = require('playwright'),
  fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  { pathToFileURL } = require('node:url');
const site = path.resolve(process.env.INFO_SITE || 'build/tests/info-ui');
const ids = ['idle', 'daily', 'calendar', 'football'];
// Runs right before settings-categories.js: only ids not registered through HomeInfo.registerTab get a placeholder.
const prologue =
  "(function(){var l={idle:'Idle screen',daily:'Rates & holidays',calendar:'Calendar',football:'Football'};" +
  JSON.stringify(ids) +
  '.forEach(function(id){if(HomeInfo.tabs().some(function(t){return t.id===id;}))return;' +
  "HomeInfo.registerTab({id:id,label:HomeI18n.t(l[id]),build:function(pane){var b=document.createElement('button');b.type='button';b.textContent=id;pane.appendChild(b);}});});})();\n";
let built = false;
function build() {
  if (built || process.env.INFO_SITE) return;
  built = true;
  const localPython = path.resolve(
    '.venv-cytv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );
  cp.execFileSync(
    process.env.PYTHON ||
      (fs.existsSync(localPython) ? localPython : 'python3'),
    ['scripts/preview.py', '--build', site],
    { stdio: 'pipe' }
  );
  for (const edition of ['launcher', 'root-launcher']) {
    const folder = path.join(site, edition),
      sources = {};
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, e.name);
        if (e.isDirectory()) walk(file);
        else if (/\.(js|css|html)$/.test(file))
          sources[path.relative(folder, file)] = fs.readFileSync(file, 'utf8');
      }
    })(folder);
    const compiled = JSON.parse(
      cp.execFileSync(process.execPath, ['scripts/compile-tv-web.cjs'], {
        input: JSON.stringify(sources),
        maxBuffer: 64 * 1024 * 1024
      })
    );
    for (const [name, content] of Object.entries(compiled))
      fs.writeFileSync(path.join(folder, name), content);
    // Only the launcher loads the info modules.
    if (edition !== 'launcher') continue;
    const file = path.join(folder, 'settings-categories.js');
    fs.writeFileSync(file, prologue + fs.readFileSync(file, 'utf8'));
  }
}
function launchOptions() {
  const chrome =
    process.env.CHROME_PATH ||
    (fs.existsSync(chromium.executablePath())
      ? ''
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return chrome
    ? { headless: true, executablePath: chrome }
    : { headless: true };
}
async function openHome(opts) {
  opts = opts || {};
  build();
  const browser = await chromium.launch(launchOptions()),
    page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US'
    }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:/, (r) => r.abort());
  await page.addInitScript(() => {
    // Same legacy webOS DOM gaps as the weather UI test.
    delete Element.prototype.replaceChildren;
    delete Element.prototype.closest;
  });
  await page.goto(
    pathToFileURL(path.join(site, opts.edition || 'launcher', 'index.html'))
      .href
  );
  await page.waitForFunction(
    () => window.RootLauncherRendered && window.HomeInfo
  );
  await page.evaluate(() => window.HomeUIReady);
  async function setScope(on) {
    await page.evaluate((v) => {
      document
        .getElementById('homeSurface')
        .classList.toggle('ctv-mr-redify', v);
      document.dispatchEvent(new Event('ctv-scope'));
    }, !!on);
  }
  await setScope(!!opts.mrRedify);
  return { page, errors, setScope, close: () => browser.close() };
}
module.exports = { openHome, ids };
