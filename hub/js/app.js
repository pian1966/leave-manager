/*
 * Church Hub – app shell.
 * Modules (people, rosters, leave, privacy, import, settings) register with Hub.register({...}) and appear as cards on Home.
 * A module object:
 *   id, name, desc (one line), icon (SVG path), tint, roles (who may open it; omit = everyone)
 *   render(parts)  → HTML for #/id/...parts      after(parts) → wire up anything after render (optional)
 *   todos(user)    → [{ text, href, tag }]       stat(user)   → short text on the Home card (optional)
 *   actions        → { name: function (el, ev) } called for clicks on [data-act="id:name"]
 */
var Hub = (function () {
  'use strict';
  var modules = [], user = null, root = null;

  /* ---------- roles and permissions (UI now; database security rules when on Firebase) ---------- */
  var ROLES = {
    admin: { label: 'Administrator', perms: ['*'] },
    pastor: { label: 'Pastor', perms: ['people.view', 'people.edit', 'notes', 'children', 'rosters.view'] },
    rosters: { label: 'Roster coordinator', perms: ['people.basic', 'rosters.manage', 'rosters.view'] },
    kids: { label: 'Children’s ministry', perms: ['people.basic', 'children', 'medical', 'rosters.view'] },
    member: { label: 'Member', perms: [] }
  };
  function can(perm) {
    if (!user) return false;
    var p = (ROLES[user.appRole] || ROLES.member).perms;
    return p.indexOf('*') >= 0 || p.indexOf(perm) >= 0;
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmt(iso, withYear) {
    if (!iso) return '';
    var d = LeaveCore.parse(iso);
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }
  function today() { return LeaveCore.iso(new Date()); }
  function name(p) { return p ? ((p.preferredName || p.firstName) + ' ' + p.lastName) : ''; }
  function initials(p) { return p ? ((p.preferredName || p.firstName || '?')[0] + (p.lastName || '')[0]).toUpperCase() : '?'; }
  var AV = ['#E8590C', '#2F6FB3', '#0F766E', '#7C3AED', '#B0527A', '#4C9A6A', '#A16207', '#0E7490'];
  function avatar(p, size) {
    var c = AV[(p && p.id ? p.id.charCodeAt(p.id.length - 1) : 0) % AV.length];
    return '<span class="av" style="--c:' + c + (size ? ';--s:' + size + 'px' : '') + '" aria-hidden="true">' + esc(initials(p)) + '</span>';
  }
  function icon(path, size) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"></path></svg>';
  }
  var ICON = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    people: 'M16 11a4 4 0 1 0-8 0M3 21c1-4 5-6 9-6s8 2 9 6',
    rosters: 'M8 3v4M16 3v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 13h3M8 17h3M14 13h3',
    leave: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
    privacy: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
    import: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    plus: 'M12 5v14M5 12h14', back: 'M15 18l-6-6 6-6', search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-3.5-3.5',
    check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12', lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    split: 'M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 14v7', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M4 6h16M4 12h16M4 18h16', download: 'M12 3v12M7 10l5 5 5-5M4 21h16', trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15', sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z'
  };

  /* ---------- modules ---------- */
  function register(m) { modules.push(m); }
  function enabled() {
    var on = (Store.settings().modules || {});
    return modules.filter(function (m) { return on[m.id] !== false && (!m.roles || m.roles.indexOf(user.appRole) >= 0 || can('*')); });
  }
  function moduleById(id) { return modules.filter(function (m) { return m.id === id; })[0]; }

  /* ---------- routing ---------- */
  function parts() { return (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent); }
  function go(path) { location.hash = '#/' + path; }

  /* ---------- rendering ---------- */
  function render() {
    if (!user) return renderSignIn();
    var p = parts(), mod = p[0] === 'home' ? null : moduleById(p[0]);
    if (mod && enabled().indexOf(mod) < 0) { go('home'); return; }
    var body = mod ? mod.render(p.slice(1)) : renderHome();
    root.innerHTML = shell(mod, body);
    if (mod && mod.after) mod.after(p.slice(1));
    var h = root.querySelector('main h1'); if (h) document.title = h.textContent + ' · Church Hub';
  }

  function navItems(active) {
    var items = [{ id: 'home', name: 'Home', icon: ICON.home }].concat(enabled().map(function (m) { return { id: m.id, name: m.name, icon: m.icon }; }));
    return items.map(function (it) {
      return '<a href="#/' + it.id + '" class="nav' + (it.id === active ? ' on' : '') + '"' + (it.id === active ? ' aria-current="page"' : '') + '>' + icon(it.icon) + '<span>' + esc(it.name) + '</span></a>';
    }).join('');
  }
  function shell(mod, body) {
    var active = mod ? mod.id : 'home', s = Store.settings();
    var tabs = ['home'].concat(enabled().filter(function (m) { return ['people', 'rosters', 'leave'].indexOf(m.id) >= 0; }).map(function (m) { return m.id; })).slice(0, 4);
    return '<div class="app">' +
      '<aside class="side" aria-label="Main menu"><div class="brand"><span class="mark">' + icon('M12 3v18M6 9h12', 18) + '</span><span><b>Church Hub</b><small>' + esc(s.churchName) + '</small></span></div>' +
      '<nav>' + navItems(active) + '</nav>' +
      '<div class="who">' + avatar(user) + '<span><b>' + esc(name(user)) + '</b><small>' + esc((ROLES[user.appRole] || ROLES.member).label) + '</small></span>' +
      '<button class="icon-btn ghost" data-act="hub:signout" aria-label="Sign out" title="Sign out">' + icon(ICON.out) + '</button></div></aside>' +
      '<div class="main-col">' +
      '<header class="top"><a href="#/home" class="brand small"><span class="mark">' + icon('M12 3v18M6 9h12', 16) + '</span><b>Church Hub</b></a>' +
      '<button class="icon-btn" data-act="hub:menu" aria-label="All apps">' + icon(ICON.menu) + '</button></header>' +
      (s.demo ? '<div class="demo">Demo with made-up people. Changes stay in this browser. <button class="link" data-act="hub:reset">Reset demo</button> · <button class="link" data-act="hub:signout">Switch person</button></div>' : '') +
      '<main id="main" tabindex="-1">' + body + '</main></div>' +
      '<nav class="tabbar" aria-label="Quick menu">' + tabs.map(function (id) {
        var m = id === 'home' ? { name: 'Home', icon: ICON.home } : moduleById(id);
        return '<a href="#/' + id + '" class="' + (id === active ? 'on' : '') + '">' + icon(m.icon, 22) + '<span>' + esc(m.name) + '</span></a>';
      }).join('') + '<button data-act="hub:menu">' + icon(ICON.menu, 22) + '<span>More</span></button></nav>' +
      '</div>';
  }

  function renderHome() {
    var todos = [];
    enabled().forEach(function (m) { if (m.todos) (m.todos(user) || []).forEach(function (t) { t.mod = m; todos.push(t); }); });
    var hour = new Date().getHours(), hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return '<div class="page-head"><div><h1>' + hello + ', ' + esc(user.preferredName || user.firstName) + '</h1><p class="lead">' + esc(fmt(today(), true)) + ' · ' + esc((ROLES[user.appRole] || ROLES.member).label) + '</p></div></div>' +
      '<section class="block"><h2>To do</h2>' + (todos.length ? '<ul class="todo">' + todos.slice(0, 8).map(function (t) {
        return '<li><a href="' + esc(t.href) + '"><span class="dot" style="--c:' + t.mod.tint + '"></span><span class="grow">' + esc(t.text) + '</span><span class="tag" style="--c:' + t.mod.tint + '">' + esc(t.tag || t.mod.name) + '</span></a></li>';
      }).join('') + '</ul>' : '<p class="empty">Nothing needs you right now.</p>') + '</section>' +
      '<section class="block"><h2>Apps</h2><div class="cards">' + enabled().map(function (m) {
        return '<a class="appcard" href="#/' + m.id + '"><span class="ic" style="--c:' + m.tint + '">' + icon(m.icon, 22) + '</span><b>' + esc(m.name) + '</b><span>' + esc(m.stat ? m.stat(user) : m.desc) + '</span></a>';
      }).join('') + '</div></section>';
  }

  function renderSignIn() {
    var s = Store.settings();
    var people = Store.list('people').filter(function (p) { return p.familyRole !== 'child' && p.active !== false; });
    var byRole = {};
    people.forEach(function (p) { (byRole[p.appRole] = byRole[p.appRole] || []).push(p); });
    var order = ['admin', 'pastor', 'rosters', 'kids', 'member'];
    root.innerHTML = '<div class="signin"><div class="signin-card">' +
      '<div class="brand big"><span class="mark">' + icon('M12 3v18M6 9h12', 22) + '</span><span><b>Church Hub</b><small>' + esc(s.churchName) + '</small></span></div>' +
      '<h1>Sign in</h1>' +
      '<p class="lead">This is a demo with made-up people. Choose who to be: each role sees different things.</p>' +
      order.filter(function (r) { return byRole[r]; }).map(function (r) {
        return '<h2 class="role-h">' + esc(ROLES[r].label) + '</h2><div class="pick">' + byRole[r].slice(0, r === 'member' ? 4 : 3).map(function (p) {
          return '<button data-act="hub:signin" data-id="' + p.id + '">' + avatar(p) + '<span><b>' + esc(name(p)) + '</b><small>' + esc(p.staff ? p.staff.category : p.category) + '</small></span></button>';
        }).join('') + '</div>';
      }).join('') +
      '<div class="row" style="margin-top:14px"><label class="field grow" style="margin:0">Or anyone else<select id="si-any">' + people.slice().sort(function (a, b) { return name(a).localeCompare(name(b)); }).map(function (p) { return '<option value="' + p.id + '">' + esc(name(p)) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn" style="align-self:flex-end" data-act="hub:signinany">Sign in</button></div>' +
      '<p class="fine">When live: sign in with Google or an email link. ' + esc(s.privacyNotice.split('.')[0]) + '. <a href="#" data-act="hub:notice">Privacy notice</a></p>' +
      '</div></div>';
  }

  /* ---------- modal and toast ---------- */
  var lastFocus = null;
  function modal(html, label, wide) {
    lastFocus = document.activeElement;
    var m = document.getElementById('modal');
    m.innerHTML = '<div class="overlay" data-act="hub:overlay"><div class="dialog' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + html + '</div></div>';
    var f = m.querySelector('input:not([type=hidden]), select, textarea, button:not(.x)'); if (f) f.focus();
  }
  function closeModal() { document.getElementById('modal').innerHTML = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function dialogHead(title, sub) { return '<header class="dlg-h"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><button class="icon-btn ghost x" data-act="hub:close" aria-label="Close">' + icon(ICON.x) + '</button></header>'; }
  var toastTimer = null;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function download(filename, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    a.download = filename; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- events ---------- */
  var hubActions = {
    signin: function (el) { var p = Store.get('people', el.dataset.id); user = p; Store.setUser(p); try { sessionStorage.setItem('hub_user', p.id); } catch (e) {} Store.audit('Signed in (demo)', 'people/' + p.id); go('home'); render(); },
    signinany: function () { hubActions.signin({ dataset: { id: document.getElementById('si-any').value } }); },
    signout: function () { user = null; Store.setUser(null); try { sessionStorage.removeItem('hub_user'); } catch (e) {} location.hash = ''; render(); },
    reset: function () { if (confirmBtn(this)) { Store.reset(makeSampleData); user = Store.get('people', user.id) || null; render(); toast('Demo data reset'); } },
    menu: function () {
      modal(dialogHead('All apps') + '<div class="cards in-dialog">' + [{ id: 'home', name: 'Home', icon: ICON.home, tint: '#6B625A', desc: 'Your to-do list' }].concat(enabled()).map(function (m) {
        return '<a class="appcard" href="#/' + m.id + '" data-act="hub:close"><span class="ic" style="--c:' + m.tint + '">' + icon(m.icon, 22) + '</span><b>' + esc(m.name) + '</b><span>' + esc(m.desc) + '</span></a>';
      }).join('') + '</div><div class="dlg-foot"><button class="btn" data-act="hub:signout">' + icon(ICON.out, 18) + 'Sign out</button></div>', 'All apps');
    },
    notice: function (el, ev) { ev.preventDefault(); modal(dialogHead('Privacy notice', 'How we use your information') + '<div class="dlg-body"><p>' + esc(Store.settings().privacyNotice) + '</p><p class="muted">Information Officer: ' + esc(Store.settings().informationOfficer.name) + '</p></div>', 'Privacy notice'); },
    close: function () { closeModal(); },
    overlay: function (el, ev) { if (ev.target === el) closeModal(); }
  };
  /** Two-step confirm on a button: first click asks, second click does it. */
  function confirmBtn(el, text) {
    if (!el || !el.dataset) return true;
    if (el.dataset.sure) return true;
    el.dataset.sure = '1'; el.dataset.was = el.innerHTML; el.textContent = text || 'Click again to confirm'; el.classList.add('danger');
    setTimeout(function () { if (el.isConnected && el.dataset.sure) { delete el.dataset.sure; el.innerHTML = el.dataset.was; el.classList.remove('danger'); } }, 4000);
    return false;
  }

  function onClick(ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var spec = el.dataset.act.split(':'), fn;
    if (spec[0] === 'hub') fn = hubActions[spec[1]];
    else { var m = moduleById(spec[0]); fn = m && m.actions && m.actions[spec[1]]; }
    if (!fn) return;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') ev.preventDefault();
    fn.call(el, el, ev);
  }
  function onKey(ev) { if (ev.key === 'Escape' && document.querySelector('#modal .overlay')) closeModal(); }

  function start() {
    root = document.getElementById('app');
    Store.load(makeSampleData);
    try { var id = sessionStorage.getItem('hub_user'); if (id) { user = Store.get('people', id); Store.setUser(user); } } catch (e) {}
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', function () { closeModal(); render(); var m = document.getElementById('main'); if (m) m.focus({ preventScroll: true }); window.scrollTo(0, 0); });
    Store.onChange(function () { if (user) user = Store.get('people', user.id) || user; });
    render();
  }

  return { register: register, start: start, render: render, go: go, can: can, user: function () { return user; }, ROLES: ROLES,
    esc: esc, fmt: fmt, today: today, name: name, avatar: avatar, icon: icon, ICON: ICON, modal: modal, closeModal: closeModal,
    dialogHead: dialogHead, toast: toast, download: download, confirmBtn: confirmBtn, MON: MON, DOW: DOW };
})();
