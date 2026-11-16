/* Home info panel: full-screen pages (Calendar, Rates, Football) behind one header button, mr.redify only. */
(function (root) {
  'use strict';
  const doc = root.document,
    pages = [],
    KEY_BACK = 461;
  let button = null,
    panel = null,
    tabs = null,
    body = null,
    empty = null,
    opened = false,
    current = -1;
  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  function el(tag, cls) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function renderTabs() {
    tabs.innerHTML = '';
    pages.forEach(function (spec, i) {
      const tab = el('button', 'info-tab');
      tab.type = 'button';
      tab.tabIndex = -1;
      tab.textContent = t(spec.label); // spec.label is the English key, translated when rendered
      tab.addEventListener('click', function () {
        show(i);
      });
      spec.tab = tab;
      tabs.appendChild(tab);
    });
  }
  function show(index) {
    if (index < 0 || index >= pages.length || index === current) return;
    const previous = pages[current];
    if (previous) {
      previous.host.hidden = true;
      previous.tab.classList.remove('selected');
      try {
        if (previous.onHide) previous.onHide();
      } catch (_) {}
    }
    current = index;
    const spec = pages[index];
    if (!spec.host) {
      spec.host = el('div', 'info-page');
      body.appendChild(spec.host);
      try {
        spec.render(spec.host);
      } catch (_) {}
    }
    spec.host.hidden = false;
    spec.tab.classList.add('selected');
    try {
      if (spec.onShow) spec.onShow();
    } catch (_) {}
  }
  // Texts translated when used: the language may be detected after this script ran (HomeI18n.ready).
  function labels() {
    if (empty) empty.textContent = t('Nothing to show yet');
    if (button) {
      button.setAttribute('aria-label', t('Info'));
      button.title = t('Info');
    }
  }
  function open() {
    if (opened || !panel || !isActive()) return;
    opened = true;
    labels();
    // Pages registered after the first open appear too.
    current = -1;
    pages.forEach(function (spec) {
      if (spec.host) spec.host.hidden = true;
    });
    renderTabs();
    empty.hidden = pages.length > 0;
    tabs.hidden = pages.length < 2;
    panel.hidden = false;
    show(0);
  }
  function close() {
    if (!opened) return;
    opened = false;
    const spec = pages[current];
    if (spec) {
      try {
        if (spec.onHide) spec.onHide();
      } catch (_) {}
    }
    current = -1;
    if (panel) panel.hidden = true;
  }
  function isActive() {
    return !!(root.HomeInfo && root.HomeInfo.isMrRedify());
  }
  function applyScope() {
    const on = isActive();
    labels();
    if (button) button.hidden = !on;
    if (!on) close();
  }
  function onKey(e) {
    if (!opened) return;
    const k = e.keyCode;
    if ([9, 37, 38, 39, 40, 13, KEY_BACK, 27].indexOf(k) < 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k === KEY_BACK || k === 27) close();
    else if (k === 37) show(current - 1);
    else if (k === 39) show(current + 1);
    else if (k === 9) show(current + (e.shiftKey ? -1 : 1));
  }
  function init() {
    button = doc.getElementById('btnInfo');
    panel = doc.getElementById('infoPanel');
    if (!button || !panel) return;
    tabs = panel.querySelector('.info-tabs');
    body = panel.querySelector('.info-body');
    empty = panel.querySelector('.info-empty');
    labels();
    if (root.HomeI18n && root.HomeI18n.ready) root.HomeI18n.ready(labels);
    // Capture, like the Settings panel: while open, Home's own handlers never see the key.
    doc.addEventListener('keydown', onKey, true);
    if (root.HomeInfo) root.HomeInfo.onScopeChange(applyScope);
    applyScope();
  }
  root.InfoPanel = {
    registerPage: function (spec) {
      if (!spec || !spec.id || typeof spec.render !== 'function') return;
      for (let i = 0; i < pages.length; i++)
        if (pages[i].id === spec.id) {
          pages[i] = spec;
          return;
        }
      pages.push(spec);
    },
    open: open,
    close: close,
    isOpen: function () {
      return opened;
    }
  };
  if (doc.readyState === 'loading')
    doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
