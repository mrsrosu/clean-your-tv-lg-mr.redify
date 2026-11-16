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
    back = null,
    backText = null,
    rowIndex = -1, // >= 0: the remote focus is on the top row (0 = Back, then page tabs)
    current = -1;
  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  function el(tag, cls) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  // Back to menu: first item of the top row, always visible while the panel is open.
  function renderBack() {
    back = el('button', 'info-back');
    back.type = 'button';
    back.id = 'infoBack';
    back.tabIndex = -1;
    back.innerHTML =
      '<svg class="info-back-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20,11H7.83l5.59,-5.59L12,4l-8,8l8,8l1.41,-1.41L7.83,13H20V11z"/></svg>';
    backText = el('span');
    back.appendChild(backText);
    back.addEventListener('click', close);
    tabs.appendChild(back);
    labels();
  }
  function renderTabs() {
    tabs.innerHTML = '';
    rowIndex = -1;
    renderBack();
    pages.forEach(function (spec, i) {
      const tab = el('button', 'info-tab');
      tab.type = 'button';
      tab.tabIndex = -1;
      tab.hidden = pages.length < 2; // a single page needs no tab
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
    if (backText) {
      backText.textContent = t('Back to menu');
      back.setAttribute('aria-label', t('Back to menu'));
    }
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
    rowIndex = -1;
    if (panel) panel.hidden = true;
  }
  function rowItems() {
    const items = [back];
    pages.forEach(function (spec) {
      if (spec.tab && !spec.tab.hidden) items.push(spec.tab);
    });
    return items;
  }
  function setRow(index) {
    const items = rowItems();
    rowIndex = index;
    items.forEach(function (item, i) {
      item.classList.toggle('focused', i === index);
    });
  }
  // Top row (remote): runs before every page listener, so a page never sees the keys meanwhile.
  function onRowKey(e) {
    if (!opened || rowIndex < 0) return;
    const k = e.keyCode;
    if ([9, 13, 33, 34, 37, 38, 39, 40, 427, 428, KEY_BACK, 27].indexOf(k) < 0)
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const items = rowItems();
    if (k === KEY_BACK || k === 27) close();
    else if (k === 37) setRow(Math.max(0, rowIndex - 1));
    else if (k === 39) setRow(Math.min(items.length - 1, rowIndex + 1));
    else if (k === 40) setRow(-1);
    else if (k === 13) {
      if (rowIndex === 0) close();
      else show(rowIndex - 1);
    } else if (k === 9) show(current + (e.shiftKey ? -1 : 1));
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
    else if (k === 38) setRow(0);
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
    // Window capture, registered before any page's own listener (calendar adds it when shown).
    root.addEventListener('keydown', onRowKey, true);
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
