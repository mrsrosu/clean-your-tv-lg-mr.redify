const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
function context(language) {
  const ctx = {
    navigator: { languages: [language], language },
    localStorage: { getItem: () => null, setItem() {} },
    location: { reload() {} }
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('launcher/i18n.js', 'utf8'), ctx);
  return ctx;
}
function run(ctx, file) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
}
const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort();

// 1. Romanian is selectable and chosen automatically for ro / ro-RO.
const ro = context('ro-RO').HomeI18n;
assert(
  ro.languages.some((l) => l.code === 'ro' && l.name === 'Română'),
  'ro is in the language list'
);
assert.equal(ro.language(), 'ro');
assert.equal(context('ro').HomeI18n.language(), 'ro');

// 2. Every English key of the four catalogs has a ro value.
const catalogs = {},
  shared = {
    add(values) {
      for (const [locale, items] of Object.entries(values))
        Object.assign(catalogs[locale] || (catalogs[locale] = {}), items);
    }
  };
function loadFile(file) {
  const ctx = { HomeI18n: shared };
  ctx.window = ctx;
  run(ctx, file);
  return ctx;
}
let total = 0;
function check(label, keys, translated) {
  assert(translated, label + ' has no ro table');
  for (const key of keys) {
    assert.equal(typeof translated[key], 'string', label + ' ro missing ' + key);
    assert(translated[key].trim(), label + ' ro empty ' + key);
    assert.deepEqual(
      placeholders(translated[key]),
      placeholders(key),
      label + ' ro placeholders ' + key
    );
    total++;
  }
}
loadFile('launcher/catalogs.js');
loadFile('launcher/theme-locales.js');
// Wallpaper strings use the English text as key and have no en table.
const wallpaper = loadFile('launcher/wallpaper-locales.js').HomeWallpaperLocales;
check('wallpaper', Object.keys(wallpaper.pl), wallpaper.ro);
const weather = loadFile('launcher/weather-locales.js').WeatherLocales;
check('weather', Object.keys(weather.en), weather.ro);
// Weather also feeds HomeI18n under "Weather / key"; those are part of en.
const enKeys = Object.keys(catalogs.en);
assert(enKeys.length > 250, 'English source strings were loaded');
check('HomeI18n', enKeys, catalogs.ro);

// 3. HomeI18n.t returns the Romanian text with ro active.
const live = context('ro-RO');
for (const file of ['launcher/catalogs.js', 'launcher/theme-locales.js'])
  run(live, file);
assert.equal(live.HomeI18n.t('Settings'), catalogs.ro.Settings);
assert.notEqual(live.HomeI18n.t('Settings'), 'Settings');
assert.equal(
  live.HomeI18n.t('Can\'t open {app}', { app: 'Netflix' }),
  catalogs.ro["Can't open {app}"].replace('{app}', 'Netflix')
);

// 4. info-locales.js is the (initially empty) home of later Romanian strings.
loadFile('launcher/info-locales.js');

console.log('PASS Romanian: language list, normalize and ' + total + ' strings');
