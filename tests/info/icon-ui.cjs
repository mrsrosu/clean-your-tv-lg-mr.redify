'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// The header calendar icon must stay visible when an installed theme only colours the three known icon classes.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  await page.evaluate(() => {
    // The TV runs without theme-defaults.css (no `.pill svg { fill: currentColor }`) and the theme gives glyphs no colour of their own.
    Array.from(document.styleSheets).forEach((s) => {
      if (s.href && /theme-defaults\.css/.test(s.href)) s.disabled = true;
    });
    const st = document.createElement('style');
    st.textContent =
      '#homeSurface.ctv-home svg{color:transparent;fill:transparent}' +
      '#homeSurface.ctv-home .ctv-input-icon,#homeSurface.ctv-home .ctv-network-icon,#homeSurface.ctv-home .ctv-settings-icon{color:#fff;fill:#fff}' +
      '#homeSurface.ctv-home .ctv-shortcut{background-color:rgba(255,255,255,.12);color:#fff}' +
      '#homeSurface.ctv-home .ctv-shortcut.is-focused{background-color:rgba(255,255,255,.86);color:#0b0d18}';
    document.head.appendChild(st);
    document.getElementById('homeSurface').classList.add('ctv-home');
    document.getElementById('btnInfo').hidden = false;
  });
  const read = () =>
    page.evaluate(() => {
      const b = document.getElementById('btnInfo'),
        c = getComputedStyle(b.querySelector('svg'));
      return {
        fill: c.fill,
        color: c.color,
        bg: getComputedStyle(b).backgroundColor
      };
    });
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const alpha = (s) => (parse(s).length > 3 ? parse(s)[3] : 1);
  const lum = (s) => {
    const [r, g, b] = parse(s);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const idle = await read();
  assert.ok(alpha(idle.fill) > 0.9, 'fill visible idle: ' + idle.fill);
  assert.ok(lum(idle.fill) > 200, 'fill light on glass idle: ' + idle.fill);
  await page.evaluate(() =>
    document.getElementById('btnInfo').classList.add('focused', 'is-focused')
  );
  await page.waitForTimeout(500); // colour/background transition
  const foc = await read();
  assert.ok(alpha(foc.fill) > 0.9, 'fill visible focused: ' + foc.fill);
  assert.ok(
    Math.abs(lum(foc.fill) - lum(foc.bg)) > 120,
    'focused fill contrasts with white pill: ' + foc.fill + ' on ' + foc.bg
  );
  // Peers keep working the same way.
  const settings = await page.evaluate(
    () => getComputedStyle(document.querySelector('#btnSettings svg')).fill
  );
  assert.equal(settings, 'rgb(255, 255, 255)');
  await home.close();
  console.log('PASS icon');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
