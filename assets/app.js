/* Leave Manager – front end (no build step, no framework). */
(function () {
  'use strict';
  var CFG = window.LEAVE_CONFIG || {};
  var LIVE = typeof CFG.API_URL === 'string' && CFG.API_URL.indexOf('https://') === 0;
  var C = window.LeaveCore;
  var app = document.getElementById('app');
  var modalRoot = document.getElementById('modal-root');

  /* ------------------------------ helpers ------------------------------ */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('tlp_' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('tlp_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem('tlp_' + k); } catch (e) { /* ignore */ } }
  };
  function todayISO() { return C.iso(new Date()); }
  function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 12); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmt(s, withYear) {
    var d = C.parse(s);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + (withYear ? ' ' + d.getFullYear() : '');
  }
  function fmtLong(s) { var d = C.parse(s); return DOW[d.getDay()] + ' ' + fmt(s, true); }
  function fmtRange(r) {
    if (r.start === r.end) return fmtLong(r.start) + (r.half && r.half !== 'None' ? (r.half === 'AM' ? ' · morning' : ' · afternoon') : '');
    var a = C.parse(r.start), b = C.parse(r.end);
    if (a.getFullYear() === b.getFullYear()) return fmt(r.start) + ' – ' + fmt(r.end, true);
    return fmt(r.start, true) + ' – ' + fmt(r.end, true);
  }
  function days(n) { return C.fmtDays(n) + (n === 1 || n === 0.5 ? ' day' : ' days'); }
  /** "3 days" for day-counted leave, "1 weekend · 3 days" for leave counted per booking. */
  function reqAmount(r) {
    var t = typeOf(r.type);
    if (C.isDayUnit(t)) return days(r.days);
    return C.fmtAmount(t, C.amount(r, t, CTX)) + (C.isCalendarUnit(t) ? '' : ' · ' + days(r.days));
  }
  /** " · Term 4 2026: booked" for leave limited per school term. */
  function termNote(t, staffId, dateStr) {
    if (!(Number(t.perTerm) > 0)) return '';
    var term = C.termOf(S.data, dateStr || todayISO());
    if (!term) return ' · term dates missing';
    var used = C.termBookings(S.data, staffId, t.code, term).length;
    return ' · ' + esc(term.name) + ': ' + (used >= Number(t.perTerm) ? 'booked' : (Number(t.perTerm) - used) + ' left');
  }
  /** " · plus 3 days left from 2026 – use by 1 Feb" while last year's days can still be used. */
  function lastYearNote(b) {
    var ly = b && b.lastYear;
    if (!ly || todayISO() > ly.until) return '';
    return '<br><b class="ly">+ ' + C.fmtDays(ly.left) + ' left from ' + esc(lyName(ly.fromYear)) + ' · use by ' + esc(fmt(ly.until)) + '</b>';
  }
  function catName(st) { return st && st.level ? st.level : ''; }
  function workLabel(st) { return C.daysLabel(C.staffDays(CTX, st.id)); }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
  function firstName(name) { return String(name).split(' ')[0]; }
  function shortName(name) { var p = String(name).split(' '); return p[0] + (p.length > 1 ? ' ' + p[p.length - 1][0] + '.' : ''); }
  var PALETTE = ['#2F6FB3', '#C2410C', '#7C3AED', '#0F766E', '#B45309', '#BE185D', '#4D7C0F', '#1D4ED8', '#9333EA', '#0E7490'];
  function colourOf(st) { if (st.colour) return st.colour; var i = S.data.staff.indexOf(st); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; }
  function av(st, lg) { return '<span class="av' + (lg ? ' lg' : '') + '" style="--c:' + esc(colourOf(st)) + '" aria-hidden="true">' + esc(initials(st.name)) + '</span>'; }
  function typeChip(t, pend, label) { return '<span class="chip' + (pend ? ' pend' : '') + '" style="--c:' + esc(t.colour) + '" title="' + esc(typeDesc(t)) + '">' + esc(label || t.name) + '</span>'; }
  /** Hover text for a leave type: its full name and how it works. */
  function typeDesc(t) {
    var bits = [];
    if (!t.deducts) bits.push('Doesn’t use an allowance');
    else if (C.isCalendarUnit(t)) bits.push('Counted in calendar days, including weekends and holidays');
    else if (!C.isDayUnit(t)) bits.push('Counted per ' + String(t.unit || 'booking').toLowerCase().replace(/s$/, ''));
    else bits.push('Counted in working days');
    if (Number(t.perTerm) > 0) bits.push(t.perTerm + ' per school term');
    if (t.allowedDays) bits.push('Only ' + C.daysLabel(C.parseDays(t.allowedDays, [])));
    if (t.accumulates) bits.push('Builds up each year' + (Number(t.maxBalance) > 0 ? ', up to ' + C.fmtDays(Number(t.maxBalance)) + ' days' : ''));
    if (t.useBy) bits.push('Unused days can be taken until ' + t.useBy + ' next year');
    if (t.halfDay) bits.push('Half days allowed');
    bits.push(t.needsApproval === false ? 'No approval needed' : 'Needs Administrator approval');
    return t.name + (t.code && t.code !== t.name ? ' (' + t.code + ')' : '') + '\n' + bits.join(' · ');
  }
  function pill(status) { return '<span class="pill ' + esc(status) + '">' + esc(status) + '</span>'; }

  var ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    wall: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
    month: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    year: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    approvals: '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    reports: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/><path d="M4 7v14h3"/>',
    employees: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.2"/><path d="M5.5 16c.6-1.9 2-3 3.5-3s2.9 1.1 3.5 3"/><path d="M14.5 9h4M14.5 13h4"/>',
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14c2 .7 3 2.6 3 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function markHTML() { var on = [1, 4, 5]; var s = ''; for (var i = 0; i < 9; i++) s += '<i' + (on.indexOf(i) >= 0 ? ' class="on"' : '') + '></i>'; return '<span class="mark" aria-hidden="true">' + s + '</span>'; }

  /* ------------------------------ state ------------------------------ */
  var VIEWS = ['home', 'wall', 'month', 'year', 'approvals', 'team', 'employees', 'history', 'reports'];
  var hashView = (location.hash || '').replace('#', '');
  var S = {
    token: store.get(LIVE ? 'token' : 'demo_token'),
    data: null,
    view: VIEWS.indexOf(hashView) >= 0 ? hashView : (store.get('view') || 'home'),
    cursor: monthStart(new Date()),
    yearOffset: 0,
    emp: null, empYear: 0, empType: 'all', empStatus: 'Approved',
    repKind: null, repPerson: null, repYear: 0,
    hist: null, histLimit: 60, histF: { period: 'month', person: 'all', kind: 'all', q: '' },
    person: null,
    showPending: store.get('showPending') !== false,
    hidden: store.get('hidden') || {}
  };
  var CTX = null, IX = {}, DL = {};

  function me() { return S.data.user; }
  function isMgr() { return C.isAdmin(me()); }
  function takesLeave(st) { return C.tracksLeave(st || me()); }
  function canManage(st) { return C.canManage(me(), st); }
  function staffById(id) { return C.staffById(S.data, id); }
  var KNOWN_TYPES = { PSL: 'Pastoral Staff Leave', SSL: 'Support Staff Leave', CSL: 'Cleaning Staff Leave', TSL: 'Technical Staff Leave', SL: 'Sick Leave',
    WO: 'Weekend Off (Fri–Sun)', SAB: 'Sabbatical Leave', WA: 'Working Away from Office', UL: 'Unpaid Leave' };
  function typeOf(code) {
    var t = C.type(S.data, code);
    if (t) return t.name && t.name !== t.code ? t : Object.assign({}, t, { name: KNOWN_TYPES[code] || t.name || code });
    return { code: code, name: KNOWN_TYPES[code] || code, colour: '#64748B', deducts: true, needsApproval: true };
  }
  function curLY() { return C.lyOf(todayISO(), CTX.S); }
  function lyName(y) { return C.lyLabel(y, CTX.S); }
  function settings() { return S.data.settings || {}; }
  function sortedStaff() {
    var mine = me().id;
    return S.data.staff.filter(function (s) { return C.tracksLeave(s); })
      .sort(function (a, b) { return a.id === mine ? -1 : b.id === mine ? 1 : a.name.localeCompare(b.name); });
  }
  function pendingForMe() {
    return S.data.requests.filter(function (r) { return r.status === 'Pending' && canManage(staffById(r.staffId)); })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  }

  /* Accept "#2F6FB3", "2F6FB3" or "#abc" from the sheet; anything else falls back. */
  function normHex(v) {
    var h = String(v || '').trim();
    if (/^#?[0-9a-f]{3}$/i.test(h)) h = h.replace(/^#?(.)(.)(.)$/, '#$1$1$2$2$3$3');
    if (/^[0-9a-f]{6}$/i.test(h)) h = '#' + h;
    return /^#[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : '';
  }
  /* The signed-in person's colour (Staff tab, column J) becomes the app's accent colour. */
  function applyAccent(hex) {
    var root = document.documentElement;
    if (!hex) { root.removeAttribute('data-uc'); root.style.removeProperty('--uc'); root.style.removeProperty('--uc-ink'); return; }
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Very pale colours would vanish on white, so they are deepened just enough to read.
    root.style.setProperty('--uc', lum > 185 ? 'color-mix(in srgb, ' + hex + ' 60%, #000000)' : hex);
    root.style.setProperty('--uc-ink', lum > 150 && lum <= 185 ? '#14201C' : '#FFFFFF');
    root.setAttribute('data-uc', '');
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', hex);
  }

  function setData(d) {
    (d.staff || []).forEach(function (s) { s.colour = normHex(s.colour); });
    if (d.user) d.user.colour = normHex(d.user.colour);
    (d.types || []).forEach(function (t) { t.colour = normHex(t.colour) || '#64748B'; });
    S.data = d;
    var meSt = (d.staff || []).filter(function (s) { return d.user && s.id === d.user.id; })[0];
    applyAccent((meSt && meSt.colour) || (d.user && d.user.colour) || '');
    CTX = C.ctx(d);
    IX = {}; DL = {};
    d.requests.forEach(function (r) {
      if (r.status !== 'Approved' && r.status !== 'Pending') return;
      var dl = C.dayList(r, CTX);
      DL[r.id] = dl;
      dl.forEach(function (x) {
        var a = IX[r.staffId] || (IX[r.staffId] = {});
        (a[x.date] || (a[x.date] = [])).push({ r: r, amt: x.amt });
      });
    });
    if (!S.person || !staffById(S.person) || !C.tracksLeave(staffById(S.person))) {
      S.person = C.tracksLeave(d.user) ? d.user.id : ((sortedStaff()[0] || {}).id || d.user.id);
    }
    render();
  }
  function entries(sid, date, all) {
    var a = (IX[sid] || {})[date] || [];
    if (all) return a;
    return a.filter(function (e) { return !S.hidden[e.r.type] && (S.showPending || e.r.status === 'Approved'); });
  }
  function offOn(date, exceptId) {
    var out = [];
    S.data.staff.forEach(function (st) {
      if (st.id === exceptId) return;
      var e = entries(st.id, date, true);
      if (e.length) out.push({ st: st, e: e });
    });
    return out;
  }

  /* ------------------------------ API ------------------------------ */
  function api(action, payload) {
    var body = Object.assign({ action: action, token: S.token }, payload || {});
    if (!LIVE) return Demo.handle(action, body);
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (res) {
        if (!res.ok) throw new Error('The leave server returned an error (' + res.status + '). Check the Apps Script deployment.');
        return res.json();
      })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong.'); return j.data; });
  }
  function call(action, payload, okMsg) {
    if (action !== 'bootstrap') S.hist = null;
    return api(action, payload).then(function (d) {
      if (d && d.staff) setData(d);
      if (okMsg) toast(okMsg);
      return d;
    }).catch(function (err) {
      var m = String(err && err.message || err);
      if (m.indexOf('AUTH') === 0) logout(m.replace(/^AUTH:?\s*/, ''));
      else if (m === 'Failed to fetch') toast('Can’t reach the leave server. Check your connection and the API_URL in config.js.', true);
      else toast(m, true);
      throw err;
    });
  }
  function logout(msg) {
    S.token = null; S.data = null; applyAccent('');
    store.del(LIVE ? 'token' : 'demo_token');
    closeModal();
    render();
    if (msg) toast(msg, true);
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = bad ? 'bad' : ''; }, bad ? 5200 : 2800);
  }

  /* ------------------------------ login ------------------------------ */
  function renderLogin() {
    var strip = '';
    var pattern = [0, 0, 1, 1, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0];
    var cols = ['', '#2F80C0', '#E09F3E', '#D1495B'];
    pattern.forEach(function (p, i) { strip += '<i style="' + (p ? 'background:' + cols[p] : '') + (i % 7 >= 5 ? ';opacity:.4' : '') + '"></i>'; });
    var right;
    if (LIVE) {
      right = '<form id="loginForm" novalidate>' +
        '<h2 style="margin-bottom:6px">Sign in</h2><p class="muted" style="margin:0 0 20px">Use your work email and the PIN your leave administrator gave you.</p>' +
        '<label class="field">Work email<input id="l-email" type="email" autocomplete="username" required value="' + esc(store.get('email') || '') + '"></label>' +
        '<label class="field">PIN<input id="l-pin" type="password" inputmode="numeric" autocomplete="current-password" required></label>' +
        '<div id="l-err"></div><button class="btn primary" style="width:100%;padding:11px" type="submit" id="l-go">Sign in</button></form>';
    } else {
      right = '<div class="pick"><p class="eyebrow">Demo mode</p><h2 style="margin:4px 0 6px">Sign in as a team member</h2>' +
        '<p class="muted small" style="margin:0">Sample data for a 10-person church team. Sign in as Linda (the Administrator) to approve requests and see employee summaries. Changes stay in this browser.</p>' +
        '<div class="people">' + Demo.people().map(function (s) {
          return '<button type="button" data-act="demo-login" data-id="' + esc(s.id) + '"><span class="av" style="--c:' + esc(s.colour) + '">' + esc(initials(s.name)) + '</span>' +
            '<span class="grow"><b>' + esc(s.name) + '</b><br><span>' + (C.tracksLeave(s) ? '' : 'Approves all leave · ') + esc(s.level) + ' · works ' + esc(C.daysLabel(C.parseDays(s.workDays, C.parseDays((Demo.cat(s.level) || {}).workDays, [1, 3, 4, 5])))) + '</span></span></button>';
        }).join('') + '</div></div>';
    }
    app.innerHTML = '<div class="login"><section class="art"><div class="brand">' + markHTML() + '<div><b>Leave Manager</b><small>Team leave, at a glance</small></div></div>' +
      '<div><h1>Who’s in, who’s out, and how many days are left.</h1><p style="margin-top:14px">Request leave, get it approved, and see the whole team on one wallchart. Only your own working days are counted, so days you don’t work and public holidays never come off your balance.</p></div>' +
      '<div class="ministrip" aria-hidden="true">' + strip + '</div></section><section class="form">' + right + '</section></div>';
  }

  /* ------------------------------ shell ------------------------------ */
  function navItems() {
    var items = [['home', 'Overview'], ['wall', 'Wallchart'], ['month', 'Calendar'], ['year', 'Year planner']];
    if (isMgr()) items.push(['approvals', 'Approvals'], ['team', 'Team balances']);
    if (isMgr()) items.push(['employees', 'Employees']);
    if (isMgr()) items.push(['history', 'History']);
    items.push(['reports', 'Reports']);
    return items;
  }
  function render() {
    if (!S.data) return renderLogin();
    if (!isMgr() && (S.view === 'approvals' || S.view === 'team')) S.view = 'home';
    if ((S.view === 'employees' || S.view === 'history') && !isMgr()) S.view = 'home';
    var v = VIEW_FN[S.view]();
    var u = me(), pend = isMgr() ? pendingForMe().length : 0;
    var nav = navItems().map(function (n) {
      return '<button data-act="nav" data-view="' + n[0] + '"' + (S.view === n[0] ? ' aria-current="page"' : '') + '>' + icon(n[0]) + '<span>' + n[1] + '</span>' +
        (n[0] === 'approvals' && pend ? '<span class="badge">' + pend + '</span>' : '') + '</button>';
    }).join('');
    var formUrl = CFG.FORM_URL || settings().FormURL;
    var guideUrl = CFG.GUIDE_URL || 'https://github.com/pian1966/leave-manager/blob/main/STAFF-GUIDE.md';
    var links = '<a href="' + esc(guideUrl) + '" target="_blank" rel="noopener">Staff guide: how to use Leave Manager ↗</a>' + (formUrl ? '<a href="' + esc(formUrl) + '" target="_blank" rel="noopener">Prefer a form? Request via Google Forms ↗</a>' : '') +
      (isMgr() && CFG.SHEET_URL ? '<a href="' + esc(CFG.SHEET_URL) + '" target="_blank" rel="noopener">Open the Google Sheet ↗</a>' : '');
    var brand = '<div class="brand">' + markHTML() + '<div><b>Leave Manager</b><small>' + esc(settings().CompanyName || 'My Team') + '</small></div></div>';
    var tabs = navItems().filter(function (n) { return n[0] !== 'year' || !isMgr(); });
    app.innerHTML =
      '<div class="shell"><aside class="side">' + brand +
      '<button class="btn primary" data-act="new">' + icon('plus').replace('<svg', '<svg width="16" height="16"') + (takesLeave(u) ? 'Request leave' : 'Book leave') + '</button>' +
      '<nav class="nav" aria-label="Main">' + nav + '</nav>' + (links ? '<div class="side-links">' + links + '</div>' : '') +
      '<div class="me">' + av(u) + '<div class="who"><b>' + esc(u.name) + '</b><span>' + (takesLeave(u) ? esc(catName(u)) + ' · ' + esc(u.role) : 'Administrator') + '</span></div><button data-act="logout">Sign out</button></div></aside>' +
      '<main class="main"><div class="mhead">' + brand + '<div class="controls"><button class="btn primary small" data-act="new">+ ' + (takesLeave(u) ? 'Request' : 'Book') + '</button><button class="btn small" data-act="logout" aria-label="Sign out">' + esc(initials(u.name)) + ' · Out</button></div></div>' +
      (!LIVE ? '<div class="demo-note"><span><b>Demo mode.</b> You’re signed in as ' + esc(u.name) + ' (' + esc(u.role) + '). Connect your Google Sheet in config.js to go live.</span><span class="controls"><button class="btn small" data-act="logout">Switch person</button><button class="btn small ghost" data-act="demo-reset">Reset sample data</button></span></div>' : '') +
      '<header class="top"><div class="t"><h1>' + v.title + '</h1>' + (v.sub ? '<p>' + v.sub + '</p>' : '') + '</div><div class="controls">' + (v.controls || '') + '</div></header>' +
      '<div class="view">' + v.body + '</div></main></div>' +
      '<nav class="tabbar" style="--n:' + tabs.length + '" aria-label="Main">' + tabs.map(function (n) {
        return '<button data-act="nav" data-view="' + n[0] + '"' + (S.view === n[0] ? ' aria-current="page"' : '') + '>' + icon(n[0]) + n[1].split(' ')[0] +
          (n[0] === 'approvals' && pend ? '<span class="badge">' + pend + '</span>' : '') + '</button>';
      }).join('') + '</nav>';
  }

  function monthControls() {
    return '<div class="seg"><button data-act="prev" aria-label="Previous month">‹</button><button data-act="thismonth">Today</button><button data-act="next" aria-label="Next month">›</button></div>';
  }
  function legend() {
    return '<div class="legend" role="group" aria-label="Filter leave types">' + S.data.types.map(function (t) {
      return '<button class="chip" style="--c:' + esc(t.colour) + '" title="' + esc(typeDesc(t) + '\nClick to hide or show') + '" data-act="toggle-type" data-code="' + esc(t.code) + '" aria-pressed="' + (!S.hidden[t.code]) + '"><span class="dot"></span>' + esc(t.name) + '</button>';
    }).join('') + '<span class="sep"></span><button class="chip pend" style="--c:var(--muted)" data-act="toggle-pending" aria-pressed="' + S.showPending + '">Pending requests</button></div>';
  }

  /* ------------------------------ views ------------------------------ */
  var VIEW_FN = {};

  VIEW_FN.home = function () {
    var d = S.data, u = me(), y = curLY(), bal = C.balances(d, u.id, y), today = todayISO();
    var hr = new Date().getHours();
    var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    var cards = d.types.filter(function (t) { return t.deducts && bal[t.code].offered; }).map(function (t) {
      var b = bal[t.code], e = Math.max(b.entitled, b.approved + b.pending, 0.0001);
      return '<div class="bal" style="--c:' + esc(t.colour) + '"><div class="head"><span class="dot"></span>' + esc(t.name) + '</div>' +
        '<div class="big num">' + C.fmtDays(b.remaining) + '<small>of ' + C.fmtDays(b.entitled) + ' ' + esc(C.unitName(t, b.entitled)) + ' left</small></div>' +
        '<div class="meter" role="img" aria-label="' + C.fmtDays(b.approved) + ' taken, ' + C.fmtDays(b.pending) + ' pending"><i class="a" style="width:' + (b.approved / e * 100) + '%"></i><i class="p" style="width:' + (b.pending / e * 100) + '%"></i></div>' +
        '<div class="foot">' + C.fmtDays(b.approved) + ' taken' + (b.pending ? ' · ' + C.fmtDays(b.pending) + ' pending' : '') +
        (t.accumulates && b.broughtForward ? ' · includes ' + C.fmtDays(b.broughtForward) + ' saved from earlier years' : '') +
        termNote(t, u.id) + lastYearNote(b) + '</div></div>';
    }).join('');

    // Who's away: next 7 working days
    var wk = '', d0 = C.parse(today), shown = 0, guard = 0;
    while (shown < 7 && guard++ < 21) {
      var ds = C.iso(d0);
      if (C.isWorking(d0, CTX)) {
        var off = offOn(ds).filter(function (o) { return o.e.some(function (e) { return e.r.status === 'Approved' || S.showPending; }); });
        wk += '<div class="wday' + (ds === today ? ' today' : '') + '"><div class="d">' + (ds === today ? 'Today' : DOW[d0.getDay()]) + '<span>' + fmt(ds) + '</span></div><div class="who">' +
          (off.length ? off.map(function (o) {
            return o.e.map(function (e) {
              var t = typeOf(e.r.type);
              return '<button class="chip' + (e.r.status === 'Pending' ? ' pend' : '') + '" style="--c:' + esc(t.colour) + '" data-act="open-req" data-id="' + esc(e.r.id) + '" title="' + esc(t.name) + '">' + esc(shortName(o.st.name)) + (e.amt < 1 ? ' ½' : '') + '</button>';
            }).join('');
          }).join('') : '<span class="muted small">Everyone in</span>') + '</div></div>';
        shown++;
      } else if (CTX.hol[ds]) {
        wk += '<div class="wday"><div class="d">' + DOW[d0.getDay()] + '<span>' + fmt(ds) + '</span></div><div class="who"><span class="chip" style="--c:var(--holiday-ink)">' + esc(CTX.hol[ds]) + '</span></div></div>';
      }
      d0 = C.addDays(d0, 1);
    }

    var mine = d.requests.filter(function (r) { return r.staffId === u.id; });
    var upcoming = mine.filter(function (r) { return r.end >= today && (r.status === 'Approved' || r.status === 'Pending'); }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var past = mine.filter(function (r) { return upcoming.indexOf(r) < 0; }).sort(function (a, b) { return a.start > b.start ? -1 : 1; }).slice(0, 5);
    function reqRow(r) {
      var t = typeOf(r.type);
      return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '"><span class="dot" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + reqAmount(r) + '</span></div>' + pill(r.status) + '</div>';
    }
    var hols = d.holidays.filter(function (h) { return h.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 4);
    var pend = isMgr() ? pendingForMe() : [];
    if (!takesLeave(u)) {
      var recent = d.requests.filter(function (r) { return r.status === 'Approved' && r.end >= today; })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; }).slice(0, 6);
      cards = '';
      upcoming = recent; past = [];
      reqRow = function (r) {
        var t = typeOf(r.type), st = staffById(r.staffId) || { name: '?' };
        return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '">' + av(st) + '<div class="grow"><b>' + esc(st.name) + '</b><span>' + esc(t.name) + ' · ' + esc(fmtRange(r)) + '</span></div>' + pill(r.status) + '</div>';
      };
    }

    return {
      title: greet + ', ' + esc(firstName(u.name)),
      sub: esc(fmtLong(today)) + ' · ' + esc(lyName(y)) + ' leave year · ' + (takesLeave(u) ? esc(catName(u)) + ', working ' + esc(workLabel(u)) : 'Administrator: all leave requests come to you'),
      controls: '<button class="btn primary" data-act="new">' + icon('plus').replace('<svg', '<svg width="16" height="16"') + (takesLeave(u) ? 'Request leave' : 'Book leave for someone') + '</button>',
      body: (pend.length ? '<div class="demo-note" style="background:var(--warn-soft)"><span><b>' + pend.length + ' request' + (pend.length > 1 ? 's' : '') + ' waiting for you.</b> ' + esc(pend.slice(0, 3).map(function (r) { return firstName(staffById(r.staffId).name); }).join(', ')) + (pend.length > 3 ? ' and others' : '') + '</span><button class="btn small" data-act="nav" data-view="approvals">Review now</button></div>' : '') +
        (takesLeave(u) ? '<div class="bals">' + (cards || '<div class="panel muted">No leave allowances are set for your category yet.</div>') + '</div>' : '') +
        '<div class="grid home-grid"><section class="panel"><h2>Who’s away <small>next 7 days the church is open</small></h2><div class="week">' + wk + '</div></section>' +
        '<div class="grid"><section class="panel"><h2>' + (takesLeave(u) ? 'My leave' : 'Coming up') + ' <small>' + upcoming.length + ' upcoming</small></h2><div class="list">' +
        (upcoming.length ? upcoming.map(reqRow).join('') : '<p class="empty">Nothing booked yet.</p>') + '</div>' +
        (past.length ? '<p class="eyebrow" style="margin:16px 0 6px">Earlier</p><div class="list">' + past.map(reqRow).join('') + '</div>' : '') + '</section>' +
        '<section class="panel"><h2>Public holidays</h2><div class="list">' + (hols.length ? hols.map(function (h) {
          return '<div class="li"><div class="grow"><b>' + esc(h.name) + '</b><span>' + esc(fmtLong(h.date)) + '</span></div></div>';
        }).join('') : '<p class="empty">No upcoming holidays on the list. An admin can add them on the Public Holidays sheet.</p>') + '</div></section></div></div>'
    };
  };

  VIEW_FN.wall = function () {
    var y = S.cursor.getFullYear(), m = S.cursor.getMonth(), n = new Date(y, m + 1, 0).getDate(), today = todayISO();
    var dates = [];
    for (var i = 1; i <= n; i++) dates.push(new Date(y, m, i, 12));
    var maxOff = Number(settings().MaxOffPerDay) || 0;
    var head = '<tr class="mrow"><th class="p" scope="col" rowspan="2">Team · ' + sortedStaff().length + '</th>' +
      '<th class="mband" scope="colgroup" colspan="' + dates.length + '"><span>' + MONTHS[m] + ' ' + y + '</span></th></tr><tr class="drow">' + dates.map(function (d) {
      var ds = C.iso(d), closed = !C.isOpen(d, CTX);
      return '<th scope="col" class="' + (ds === today ? 'today' : '') + (closed ? ' closed' : '') + '" title="' + esc(CTX.hol[ds] || (closed ? 'Church closed' : '')) + '">' + DOW[d.getDay()][0] + '<b>' + d.getDate() + '</b>' +
        (CTX.hol[ds] ? '<span class="holname">PH</span>' : (closed ? '<span class="holname closedname">Closed</span>' : '')) + '</th>';
    }).join('') + '</tr>';
    var rows = sortedStaff().map(function (st) {
      var mine = st.id === me().id, canBook = mine || canManage(st), wdays = C.staffDays(CTX, st.id);
      return '<tr class="' + (mine ? 'mine' : '') + '"><th class="p" scope="row"><div class="row">' + av(st) + '<div class="nm"><b>' + esc(st.name) + (mine ? ' (you)' : '') + '</b><span>' + esc(catName(st)) + ' · ' + esc(C.daysLabel(wdays)) + '</span></div></div></th>' +
        dates.map(function (d) {
          var ds = C.iso(d), work = C.isWorking(d, CTX, st.id);
          var cls = [!C.isOpen(d, CTX) ? 'closed' : (wdays.indexOf(d.getDay()) < 0 ? 'we' : ''), CTX.hol[ds] ? 'hol' : '', ds === today ? 'today' : ''];
          var es = work ? entries(st.id, ds) : [];
          var inner = es.map(function (e) {
            var t = typeOf(e.r.type), dl = DL[e.r.id] || [];
            var c = ['bk'];
            if (e.r.status === 'Pending') c.push('pend');
            if (e.amt < 1) c.push(e.r.half === 'PM' ? 'pm' : 'am');
            else { if (dl[0] && dl[0].date === ds) c.push('s'); if (dl.length && dl[dl.length - 1].date === ds) c.push('e'); }
            return '<span class="' + c.join(' ') + '" style="--c:' + esc(t.colour) + '" data-act="open-req" data-id="' + esc(e.r.id) + '" title="' + esc(st.name + ' · ' + t.name + ' · ' + fmtRange(e.r) + ' · ' + e.r.status) + '"></span>';
          }).join('');
          var bookable = work && canBook && !entries(st.id, ds, true).some(function (e) { return e.amt === 1; });
          if (bookable && !inner) cls.push('book');
          var attrs = bookable && !inner ? ' data-act="book" data-date="' + ds + '" data-staff="' + esc(st.id) + '" title="Book ' + esc(firstName(st.name)) + ' off on ' + esc(fmtLong(ds)) + '"' :
            (CTX.hol[ds] ? ' title="' + esc(CTX.hol[ds]) + '"' : '');
          return '<td class="' + cls.join(' ').trim() + '"' + attrs + '>' + inner + '</td>';
        }).join('') + '</tr>';
    }).join('');
    var foot = '<tr><th class="p" scope="row"><span class="small">Away' + (maxOff ? ' · limit ' + maxOff : '') + '</span></th>' + dates.map(function (d) {
      var ds = C.iso(d);
      if (!C.isWorking(d, CTX)) return '<td class="' + (CTX.hol[ds] ? 'hol' : 'closed') + '"></td>';
      var c = 0;
      S.data.staff.forEach(function (st) { var es = entries(st.id, ds); if (es.length) c += es.reduce(function (s, e) { return s + e.amt; }, 0) >= 1 ? 1 : 0.5; });
      return '<td class="' + (maxOff && c > maxOff ? 'hi' : '') + '">' + (c ? C.fmtDays(c) : '') + '</td>';
    }).join('') + '</tr>';
    return {
      title: MONTHS[m] + ' <span class="muted" style="font-weight:500">' + y + '</span>',
      sub: 'Shaded days are days that person doesn’t work. Click an empty working day to book it. Striped blocks are waiting for approval.',
      controls: monthControls(),
      body: legend() + '<div class="wall-wrap"><table class="wall"><thead>' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>'
    };
  };

  VIEW_FN.month = function () {
    var y = S.cursor.getFullYear(), m = S.cursor.getMonth(), today = todayISO();
    var first = new Date(y, m, 1, 12), offset = (first.getDay() + 6) % 7;
    var start = C.addDays(first, -offset);
    var cells = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { cells += '<div class="dow">' + d + '</div>'; });
    var last = new Date(y, m + 1, 0, 12), total = Math.ceil((offset + last.getDate()) / 7) * 7;
    var staff = sortedStaff();
    for (var i = 0; i < total; i++) {
      var d = C.addDays(start, i), ds = C.iso(d), inM = d.getMonth() === m;
      var closed = !C.isOpen(d, CTX);
      var cls = ['cell', inM ? '' : 'out', closed ? 'we' : '', CTX.hol[ds] ? 'hol' : '', ds === today ? 'today' : ''].join(' ');
      var chips = [];
      staff.forEach(function (st) {
        entries(st.id, ds).forEach(function (e) {
          var t = typeOf(e.r.type);
          chips.push('<span class="chip' + (e.r.status === 'Pending' ? ' pend' : '') + '" style="--c:' + esc(t.colour) + '" title="' + esc(st.name + ' · ' + t.name) + '">' + esc(shortName(st.name)) + (e.amt < 1 ? ' ½' : '') + '</span>');
        });
      });
      var max = 4;
      cells += '<div class="' + cls + '" data-act="day" data-date="' + ds + '" role="button" tabindex="0" aria-label="' + esc(fmtLong(ds)) + ', ' + chips.length + ' away"><div class="n"><b>' + d.getDate() + '</b></div>' +
        (CTX.hol[ds] ? '<div class="hn">' + esc(CTX.hol[ds]) + '</div>' : (closed ? '<div class="hn muted">Closed</div>' : '')) + chips.slice(0, max).join('') +
        (chips.length > max ? '<span class="more">+' + (chips.length - max) + ' more</span>' : '') + '</div>';
    }
    return {
      title: MONTHS[m] + ' <span class="muted" style="font-weight:500">' + y + '</span>',
      sub: 'Click a day to see everyone who’s away.',
      controls: monthControls(),
      body: legend() + '<div class="cal">' + cells + '</div>'
    };
  };

  VIEW_FN.year = function () {
    var y = curLY() + S.yearOffset, rng = C.lyRange(y, CTX.S), today = todayISO();
    var st = staffById(S.person) || me();
    var mineOrManaged = st.id === me().id || canManage(st);
    var months = '';
    for (var k = 0; k < 12; k++) {
      var mo = new Date(y, CTX.S - 1 + k, 1, 12), mm = mo.getMonth(), yy = mo.getFullYear();
      var off = (mo.getDay() + 6) % 7, n = new Date(yy, mm + 1, 0).getDate();
      var g = 'MTWTFSS'.split('').map(function (c) { return '<span class="h">' + c + '</span>'; }).join('');
      for (var b = 0; b < off; b++) g += '<span></span>';
      for (var dd = 1; dd <= n; dd++) {
        var d = new Date(yy, mm, dd, 12), ds = C.iso(d), es = entries(st.id, ds);
        var cls = [], style = '', act = '';
        if (C.staffDays(CTX, st.id).indexOf(d.getDay()) < 0) cls.push('we');
        if (CTX.hol[ds]) cls.push('hol');
        if (ds === today) cls.push('td');
        if (es.length) {
          var t = typeOf(es[0].r.type);
          cls.push(es[0].amt < 1 ? 'half' : 'lv');
          if (es[0].r.status === 'Pending') cls.push('pend');
          style = ' style="--c:' + esc(t.colour) + '"';
          act = ' data-act="open-req" data-id="' + esc(es[0].r.id) + '" title="' + esc(t.name + ' · ' + es[0].r.status) + '"';
        } else if (CTX.hol[ds]) act = ' title="' + esc(CTX.hol[ds]) + '"';
        g += '<span class="' + cls.join(' ') + '"' + style + act + '>' + dd + '</span>';
      }
      months += '<div class="mini"><h3>' + MONTHS[mm] + ' <span class="muted" style="font-weight:500">' + yy + '</span></h3><div class="g">' + g + '</div></div>';
    }
    var bal = C.balances(S.data, st.id, y);
    var balRows = S.data.types.map(function (t) {
      var b = bal[t.code];
      if (!b.offered || (!t.deducts && !b.approved && !b.pending)) return '';
      return '<div class="li"><span class="dot" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(t.name) + '</b><span>' +
        C.fmtDays(b.approved) + ' ' + esc(C.unitName(t, b.approved)) + ' taken' + (b.pending ? ' · ' + C.fmtDays(b.pending) + ' pending' : '') + (t.accumulates && b.broughtForward ? ' · ' + C.fmtDays(b.broughtForward) + ' saved' : '') + '</span></div>' +
        (t.deducts ? '<b class="num' + (b.remaining <= 2 ? ' low' : '') + '">' + C.fmtDays(b.remaining) + '<span class="muted small"> / ' + C.fmtDays(b.entitled) + '</span></b>' : '') + '</div>';
    }).join('');
    var reqs = S.data.requests.filter(function (r) { return r.staffId === st.id && r.end >= rng.start && r.start <= rng.end; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var sel = '<select id="yr-person" aria-label="Person" class="btn">' + sortedStaff().map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === st.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('') + '</select>';
    return {
      title: esc(st.id === me().id ? 'My year' : firstName(st.name) + '’s year') + ' <span class="muted" style="font-weight:500">' + esc(lyName(y)) + '</span>',
      sub: esc(fmt(rng.start, true) + ' – ' + fmt(rng.end, true)) + ' · ' + esc(catName(st)) + ', works ' + esc(workLabel(st)) + ' · outlined days are public holidays',
      controls: sel + '<div class="seg"><button data-act="yprev" aria-label="Previous leave year">‹</button><button data-act="ythis">This year</button><button data-act="ynext" aria-label="Next leave year">›</button></div>',
      body: '<div class="year-layout"><div class="months">' + months + '</div><aside class="grid">' +
        (mineOrManaged ? '<section class="panel"><h2>Balances <small>' + esc(lyName(y)) + '</small></h2><div class="list">' + balRows + '</div></section>' : '') +
        '<section class="panel"><h2>Requests <small>' + reqs.length + '</small></h2><div class="list">' + (reqs.length ? reqs.map(function (r) {
          var t = typeOf(r.type);
          return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '"><span class="dot" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + reqAmount(r) + '</span></div>' + pill(r.status) + '</div>';
        }).join('') : '<p class="empty">No leave in this leave year.</p>') + '</div></section></aside></div>'
    };
  };

  VIEW_FN.approvals = function () {
    var pend = pendingForMe();
    var cards = pend.map(function (r) {
      var st = staffById(r.staffId), t = typeOf(r.type);
      var y = C.lyOf(r.start, CTX.S), b = C.balances(S.data, st.id, y)[t.code], amt = C.amount(r, t, CTX);
      var others = {};
      (DL[r.id] || []).forEach(function (x) { offOn(x.date, st.id).forEach(function (o) { others[o.st.name] = 1; }); });
      var names = Object.keys(others);
      var maxOff = Number(settings().MaxOffPerDay) || 0, busiest = 0;
      (DL[r.id] || []).forEach(function (x) { busiest = Math.max(busiest, offOn(x.date, st.id).length + 1); });
      return '<article class="ap"><div><div class="who">' + av(st, true) + '<div><h3>' + esc(st.name) + '</h3>' +
        '<div class="facts"><span>' + typeChip(t) + '</span><b>' + esc(fmtRange(r)) + '</b><span>' + reqAmount(r) + '</span>' +
        (b.entitled != null ? '<span>Balance after: <b class="' + (b.remaining - amt < 0 ? 'low' : '') + '">' + C.fmtDays(b.remaining - amt) + '</b> of ' + C.fmtAmount(t, b.entitled) + '</span>' : '') +
        '<span>Sent ' + esc(String(r.submitted).slice(0, 10)) + (r.source === 'Form' ? ' via form' : '') + '</span></div>' +
        (r.reason ? '<blockquote>' + esc(r.reason) + '</blockquote>' : '') +
        (names.length ? '<span class="warnline">Also away then: ' + esc(names.join(', ')) + (maxOff && busiest > maxOff ? ' · ' + busiest + ' people out on the busiest day' : '') + '</span>' : '') +
        '</div></div></div><div class="side-act"><label class="small muted" for="note-' + esc(r.id) + '">Note to ' + esc(firstName(st.name)) + ' (optional)</label>' +
        '<textarea id="note-' + esc(r.id) + '" rows="2"></textarea><div class="btns"><button class="btn bad" data-act="decide" data-d="Declined" data-id="' + esc(r.id) + '">Decline</button>' +
        '<button class="btn ok" data-act="decide" data-d="Approved" data-id="' + esc(r.id) + '">Approve</button></div></div></article>';
    }).join('');
    var recent = S.data.requests.filter(function (r) { return (r.status === 'Approved' || r.status === 'Declined') && r.decidedOn && canManage(staffById(r.staffId)); })
      .sort(function (a, b) { return a.decidedOn > b.decidedOn ? -1 : 1; }).slice(0, 8);
    return {
      title: 'Approvals',
      sub: pend.length ? pend.length + ' waiting for a decision' : 'You’re all caught up',
      body: '<div class="appr">' + (cards || '<div class="panel muted">No requests are waiting. New ones show up here and are emailed to you.</div>') + '</div>' +
        (recent.length ? '<section class="panel" style="margin-top:20px"><h2>Recently decided</h2><div class="list">' + recent.map(function (r) {
          var st = staffById(r.staffId) || { name: '?' }, t = typeOf(r.type);
          return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '">' + av(st) + '<div class="grow"><b>' + esc(st.name) + ' · ' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + esc(r.decidedBy) + '</span></div>' + pill(r.status) + '</div>';
        }).join('') + '</div></section>' : '')
    };
  };

  /* ---------- Employees (admins only): every date a person has had off ---------- */
  var EMP_STATUS = [
    ['Approved', 'Taken / approved'],
    ['Pending', 'Waiting for approval'],
    ['Booked', 'Approved + waiting'],
    ['All', 'Everything, incl. declined & cancelled']
  ];
  function empDates(st, y, typeCode, status) {
    var rng = C.lyRange(y, CTX.S), rows = [];
    S.data.requests.forEach(function (r) {
      if (r.staffId !== st.id) return;
      if (typeCode !== 'all' && r.type !== typeCode) return;
      var okStatus = status === 'All' || r.status === status || (status === 'Booked' && (r.status === 'Approved' || r.status === 'Pending'));
      if (!okStatus) return;
      if (r.end < rng.start || r.start > rng.end) return;
      var t = typeOf(r.type);
      var list = C.isCalendarUnit(t) ? (function () {
        var out = [], d = C.parse(r.start), e = C.parse(r.end);
        while (d <= e) { out.push({ date: C.iso(d), amt: 1 }); d = C.addDays(d, 1); }
        return out;
      })() : (DL[r.id] || C.dayList(r, CTX));
      list.forEach(function (x) {
        if (x.date < rng.start || x.date > rng.end) return;
        rows.push({ date: x.date, amt: x.amt, r: r, t: t });
      });
    });
    return rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* ---------- History (Administrator): a readable timeline of every leave action ---------- */
  var HIST_KINDS = {
    request: { label: 'Requested', colour: 'var(--accent)' },
    booked: { label: 'Booked by Administrator', colour: '#2F80C0' },
    approve: { label: 'Approved', colour: 'var(--ok)' },
    decline: { label: 'Declined', colour: 'var(--bad)' },
    cancel: { label: 'Cancelled', colour: 'var(--warn)' },
    problem: { label: 'Form problem', colour: 'var(--bad)' }
  };
  function histKind(action) {
    var a = String(action || '').toLowerCase();
    if (a.indexOf('not booked') >= 0) return 'problem';
    if (a.indexOf('booked by') >= 0) return 'booked';
    if (a.indexOf('approved') === 0) return 'approve';
    if (a.indexOf('declined') === 0) return 'decline';
    if (a.indexOf('cancel') === 0) return 'cancel';
    return 'request';
  }
  function niceDates(txt) {
    var m = String(txt || '').match(/(\d{4}-\d{2}-\d{2})(?:\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2}))?(.*)$/);
    if (!m) return String(txt || '');
    return fmtRange({ start: m[1], end: m[2] || m[1], half: /morning/.test(m[3]) ? 'AM' : /afternoon/.test(m[3]) ? 'PM' : 'None' });
  }
  /** Entries rebuilt from the Requests themselves, for activity before the History tab existed. */
  function derivedHistory(logged) {
    // Skip any event the log already has for that request, so nothing shows twice.
    var seen = {}, out = [];
    logged.forEach(function (h) { if (h.requestId) (seen[h.requestId] || (seen[h.requestId] = {}))[histKind(h.action) === 'booked' ? 'request' : histKind(h.action)] = 1; });
    var push = function (r, ev) { var k = histKind(ev.action); if (!(seen[r.id] || {})[k === 'booked' ? 'request' : k]) out.push(ev); };
    S.data.requests.forEach(function (r) {
      var st = staffById(r.staffId) || { name: '' }, t = typeOf(r.type);
      var base = { requestId: r.id, staff: st.name, type: t.name, dates: r.start + ' to ' + r.end + (r.half === 'AM' ? ' (morning)' : r.half === 'PM' ? ' (afternoon)' : ''), days: r.days, derived: true };
      var bookedByAdmin = r.decidedBy && r.decidedBy !== 'Auto-approved' && r.decidedOn && String(r.decidedOn).slice(0, 16) === String(r.submitted).slice(0, 16);
      push(r, Object.assign({}, base, { when: r.submitted, action: bookedByAdmin ? 'Booked by Administrator' : (r.decidedBy === 'Auto-approved' ? 'Requested (no approval needed)' : 'Requested') + (r.source === 'Form' ? ' via Google Form' : ''), by: bookedByAdmin ? r.decidedBy : st.name, note: r.reason, status: bookedByAdmin ? 'Approved' : 'Pending' }));
      var legacyCancel = r.status === 'Cancelled' && !r.cancelledBy;
      if (r.decidedOn && !bookedByAdmin && r.decidedBy !== 'Auto-approved' && !legacyCancel) {
        push(r, Object.assign({}, base, { when: r.decidedOn, action: r.status === 'Declined' ? 'Declined' : 'Approved', by: r.decidedBy, note: r.note, status: r.status === 'Declined' ? 'Declined' : 'Approved' }));
      }
      if (r.cancelledOn || legacyCancel) {
        push(r, Object.assign({}, base, { when: r.cancelledOn || r.decidedOn, action: 'Cancelled', by: r.cancelledBy || r.decidedBy, note: '', status: 'Cancelled' }));
      }
    });
    return out;
  }
  function histSentence(h) {
    var k = histKind(h.action), who = '<b>' + esc(h.by || 'Someone') + '</b>', staff = '<b>' + esc(h.staff || '') + '</b>';
    var own = h.by && h.staff && h.by === h.staff, type = esc(h.type || 'leave');
    var via = /google form/i.test(h.action) ? ' via the Google Form' : '';
    if (k === 'request') return staff + ' requested ' + type + via + (/no approval/i.test(h.action) ? ' <span class="muted">(no approval needed)</span>' : '');
    if (k === 'booked') return who + ' booked ' + type + ' for ' + staff;
    if (k === 'approve') return who + ' approved ' + staff + '’s ' + type;
    if (k === 'decline') return who + ' declined ' + staff + '’s ' + type;
    if (k === 'cancel') {
      var was = /was approved/i.test(h.action) ? 'approved ' : /waiting/i.test(h.action) ? 'pending ' : '';
      return (own ? staff + ' cancelled their own ' : who + ' cancelled ' + staff + '’s ') + was + type;
    }
    return staff + '’s Google Form request for ' + type + ' couldn’t be booked';
  }
  function loadHistory(force) {
    if (S.hist && !force) return;
    S.hist = { loading: true, list: [] };
    api('history').then(function (list) { S.hist = { list: list || [], at: new Date() }; if (S.view === 'history') render(); })
      .catch(function (err) { S.hist = { list: [], error: String(err && err.message || err) }; if (S.view === 'history') render(); });
  }

  VIEW_FN.history = function () {
    loadHistory(false);
    var logged = (S.hist && S.hist.list) || [];
    var all = logged.concat(derivedHistory(logged)).filter(function (h) { return h.when; })
      .sort(function (a, b) { return String(a.when) < String(b.when) ? 1 : String(a.when) > String(b.when) ? -1 : 0; });
    var today = todayISO(), f = S.histF;
    var since = { week: C.iso(C.addDays(C.parse(today), -7)), month: C.iso(C.addDays(C.parse(today), -31)), year: C.lyRange(curLY(), CTX.S).start, all: '' }[f.period] || '';
    var q = f.q.trim().toLowerCase();
    var shown = all.filter(function (h) {
      if (since && String(h.when).slice(0, 10) < since) return false;
      if (f.person !== 'all' && h.staff !== f.person && h.by !== f.person) return false;
      if (f.kind !== 'all' && histKind(h.action) !== f.kind) return false;
      if (q && [h.staff, h.by, h.type, h.note, h.action, h.dates].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var counts = {};
    shown.forEach(function (h) { var k = histKind(h.action); counts[k] = (counts[k] || 0) + 1; });
    var people = {};
    all.forEach(function (h) { if (h.staff) people[h.staff] = 1; if (h.by && h.by !== 'Auto-approved') people[h.by] = 1; });
    var groups = [], cur = null, yest = C.iso(C.addDays(C.parse(today), -1));
    shown.slice(0, S.histLimit).forEach(function (h) {
      var d = String(h.when).slice(0, 10);
      if (!cur || cur.d !== d) { cur = { d: d, items: [] }; groups.push(cur); }
      cur.items.push(h);
    });
    var body = groups.map(function (g) {
      var label = g.d === today ? 'Today' : g.d === yest ? 'Yesterday' : (C.isISO(g.d) ? fmtLong(g.d) : g.d);
      return '<section class="hist-day"><h3>' + esc(label) + '</h3><ol>' + g.items.map(function (h) {
        var k = histKind(h.action), exists = h.requestId && S.data.requests.some(function (r) { return r.id === h.requestId; });
        var t = S.data.types.filter(function (x) { return x.name === h.type; })[0];
        return '<li class="hist-item k-' + k + (exists ? ' click' : '') + '"' + (exists ? ' data-act="open-req" data-id="' + esc(h.requestId) + '" tabindex="0" role="button"' : '') + '>' +
          '<span class="hist-time num">' + esc(String(h.when).slice(11, 16)) + '</span>' +
          '<span class="hist-mark" style="--c:' + HIST_KINDS[k].colour + '" aria-hidden="true"></span>' +
          '<div class="hist-body"><div class="hist-text">' + histSentence(h) + '</div>' +
          '<div class="hist-meta">' + (t ? '<span class="dot" style="--c:' + esc(t.colour) + '"></span>' : '') + esc(niceDates(h.dates)) +
          (h.days !== '' && h.days != null && k !== 'problem' ? ' · ' + days(Number(h.days)) : '') +
          ' · <span class="hist-tag">' + esc(HIST_KINDS[k].label) + '</span>' + (h.derived ? ' <span class="hist-derived" title="Rebuilt from the request record (before the History log started)">from request record</span>' : '') + '</div>' +
          (h.note ? '<blockquote>' + esc(h.note) + '</blockquote>' : '') + '</div></li>';
      }).join('') + '</ol></section>';
    }).join('');
    var status = S.hist && S.hist.loading ? '<p class="muted">Loading the History log…</p>' :
      S.hist && S.hist.error ? '<p class="err">Couldn’t load the History log (' + esc(S.hist.error) + '). Showing what can be rebuilt from the requests. Update the Google script to the latest version to get the full log.</p>' : '';
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    return {
      title: 'History',
      sub: 'Every leave request, decision and cancellation, newest first.',
      controls: '<button class="btn" data-act="hist-refresh">Refresh</button>',
      body: '<div class="hist-filters">' +
        '<label class="field">Period<select id="hist-period">' + opt('week', 'Last 7 days', f.period) + opt('month', 'Last 31 days', f.period) + opt('year', 'This leave year', f.period) + opt('all', 'Everything', f.period) + '</select></label>' +
        '<label class="field">Person<select id="hist-person">' + opt('all', 'Everyone', f.person) + Object.keys(people).sort().map(function (p) { return opt(p, p, f.person); }).join('') + '</select></label>' +
        '<label class="field">Action<select id="hist-kind">' + opt('all', 'All actions', f.kind) + Object.keys(HIST_KINDS).map(function (k) { return opt(k, HIST_KINDS[k].label, f.kind); }).join('') + '</select></label>' +
        '<label class="field hist-q">Search<input id="hist-q" type="search" placeholder="Name, leave type, note…" value="' + esc(f.q) + '"></label></div>' +
        '<div class="hist-counts">' + Object.keys(HIST_KINDS).filter(function (k) { return counts[k]; }).map(function (k) {
          return '<span class="hist-count" style="--c:' + HIST_KINDS[k].colour + '"><b class="num">' + counts[k] + '</b> ' + esc(HIST_KINDS[k].label.toLowerCase()) + '</span>';
        }).join('') + (shown.length ? '' : '') + '</div>' + status +
        (groups.length ? '<div class="panel hist">' + body + '</div>' : '<div class="panel muted">Nothing matches these filters.</div>') +
        (shown.length > S.histLimit ? '<p style="text-align:center;margin-top:12px"><button class="btn" data-act="hist-more">Show more (' + (shown.length - S.histLimit) + ' older)</button></p>' : '')
    };
  };

  /* ---------- Reports: printable leave reports ---------- */
  function datesOf(r) {
    var t = typeOf(r.type);
    if (C.isCalendarUnit(t)) {
      var out = [], d = C.parse(r.start), e = C.parse(r.end), g = 0;
      while (d <= e && g++ < 800) { out.push({ date: C.iso(d), amt: 1 }); d = C.addDays(d, 1); }
      return out;
    }
    return DL[r.id] || C.dayList(r, CTX);
  }
  function inYear(list, y) {
    var rng = C.lyRange(y, CTX.S);
    return list.filter(function (x) { return x.date >= rng.start && x.date <= rng.end; });
  }
  function reqUseText(r, y) {
    var t = typeOf(r.type), n = inYear(datesOf(r), y).reduce(function (s, x) { return s + x.amt; }, 0);
    if (!C.isDayUnit(t) && !C.isCalendarUnit(t)) return C.fmtAmount(t, 1) + ' (' + days(n) + ')';
    return C.fmtAmount(t, n);
  }
  function personRequests(st, y) {
    var rng = C.lyRange(y, CTX.S);
    return S.data.requests.filter(function (r) { return r.staffId === st.id && r.end >= rng.start && r.start <= rng.end; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  }
  function rpHead(title, sub, y) {
    var rng = C.lyRange(y, CTX.S);
    return '<header class="rp-head"><div><div class="rp-org">' + esc(settings().CompanyName || 'Leave Manager') + '</div>' +
      '<h1 class="rp-title">' + esc(title) + '</h1>' + (sub ? '<div class="rp-sub">' + sub + '</div>' : '') + '</div>' +
      '<div class="rp-meta"><span>Leave year</span><b>' + esc(lyName(y)) + '</b><span>' + esc(fmt(rng.start, true) + ' – ' + fmt(rng.end, true)) + '</span></div></header>';
  }
  function rpFoot(note) {
    return '<footer class="rp-foot"><span>' + esc(note || 'Only working days are counted, except Sabbatical (calendar days). Days a person doesn’t normally work, days the church is closed and public holidays are not deducted.') + '</span>' +
      '<span>Prepared ' + esc(fmtLong(todayISO())) + ' by ' + esc(me().name) + '</span></footer>';
  }
  function personReport(st, y) {
    var bal = C.balances(S.data, st.id, y), rng = C.lyRange(y, CTX.S);
    var reqs = personRequests(st, y);
    var used = {};
    reqs.forEach(function (r) { used[r.type] = 1; });
    var sumRows = S.data.types.filter(function (t) { return bal[t.code].offered && (t.deducts || used[t.code]); }).map(function (t) {
      var b = bal[t.code];
      var allow = b.entitled == null ? '—' : C.fmtAmount(t, b.entitled) + (t.accumulates && b.broughtForward ? '<small>incl. ' + C.fmtDays(b.broughtForward) + ' saved</small>' : '');
      var note = [];
      if (b.lastYear && todayISO() <= b.lastYear.until) note.push('+ ' + C.fmtDays(b.lastYear.left) + ' from ' + lyName(b.lastYear.fromYear) + ', use by ' + fmt(b.lastYear.until, true));
      if (Number(t.perTerm) > 0) { var tn = C.termOf(S.data, todayISO()); if (tn) note.push(tn.name + ': ' + (C.termBookings(S.data, st.id, t.code, tn).length >= Number(t.perTerm) ? 'booked' : 'not yet booked')); }
      return '<tr><td><span class="rp-dot" style="background:' + esc(t.colour) + '"></span>' + esc(t.name) + (note.length ? '<small>' + esc(note.join(' · ')) + '</small>' : '') + '</td>' +
        '<td class="n">' + allow + '</td><td class="n">' + C.fmtDays(b.approved) + '</td><td class="n">' + (b.pending ? C.fmtDays(b.pending) : '–') + '</td>' +
        '<td class="n"><b>' + (b.remaining == null ? '—' : C.fmtDays(b.remaining)) + '</b></td></tr>';
    }).join('');
    var reqRows = reqs.map(function (r) {
      var t = typeOf(r.type);
      var dec = (r.status === 'Pending' || (r.status === 'Cancelled' && r.cancelledBy && !r.decidedOn)) ? (r.status === 'Pending' ? 'Awaiting decision' : '') :
        (r.decidedBy ? esc(r.decidedBy) + (r.decidedOn ? '<small>' + esc(fmt(String(r.decidedOn).slice(0, 10), true)) + '</small>' : '') : '');
      if (r.cancelledBy) dec += '<small>Cancelled by ' + esc(r.cancelledBy) + (r.cancelledOn ? ', ' + esc(fmt(String(r.cancelledOn).slice(0, 10), true)) : '') + '</small>';
      return '<tr class="st-' + esc(r.status) + '"><td>' + esc(fmtRange(r)) + '</td><td><span class="rp-dot" style="background:' + esc(t.colour) + '"></span>' + esc(t.name) + '</td>' +
        '<td class="n">' + reqUseText(r, y) + '</td><td><span class="rp-status">' + esc(r.status) + '</span></td><td>' + dec + '</td><td class="rp-note">' + esc(r.reason || '') + (r.note ? '<small>Administrator: ' + esc(r.note) + '</small>' : '') + '</td></tr>';
    }).join('');
    var totalOff = 0;
    reqs.forEach(function (r) { if (r.status === 'Approved') totalOff += inYear(datesOf(r), y).reduce(function (s, x) { return s + x.amt; }, 0); });
    return '<section class="rp-page">' + rpHead('Leave report', esc(st.name), y) +
      '<dl class="rp-who"><div><dt>Employee</dt><dd>' + esc(st.name) + '</dd></div><div><dt>Category</dt><dd>' + esc(catName(st)) + '</dd></div>' +
      '<div><dt>Working days</dt><dd>' + esc(workLabel(st)) + '</dd></div><div><dt>Start date</dt><dd>' + (st.start ? esc(fmt(st.start, true)) : '—') + '</dd></div>' +
      '<div><dt>Days off approved</dt><dd>' + days(totalOff) + '</dd></div><div><dt>Requests</dt><dd>' + reqs.length + '</dd></div></dl>' +
      '<h2 class="rp-h">Leave balances</h2><table class="rp-tbl"><thead><tr><th>Leave type</th><th class="n">Allowance</th><th class="n">Taken</th><th class="n">Pending</th><th class="n">Remaining</th></tr></thead><tbody>' +
      (sumRows || '<tr><td colspan="5">No leave types are set up for this category.</td></tr>') + '</tbody></table>' +
      '<h2 class="rp-h">Leave requests</h2>' + (reqRows ? '<table class="rp-tbl rp-req"><thead><tr><th>Dates</th><th>Leave type</th><th class="n">Days</th><th>Status</th><th>Decided by</th><th>Note</th></tr></thead><tbody>' + reqRows + '</tbody></table>'
        : '<p class="rp-empty">No leave requested in ' + esc(lyName(y)) + '.</p>') +
      '<div class="rp-sign"><div><span></span>Employee signature &amp; date</div><div><span></span>Administrator signature &amp; date</div></div>' +
      rpFoot() + '</section>';
  }
  function summaryReport(y) {
    var staff = sortedStaff().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var mains = {}, rows = [];
    staff.forEach(function (st) { var m = mainType(st, y); if (m) mains[m.t.code] = 1; });
    var others = S.data.types.filter(function (t) { return !mains[t.code]; });
    var tot = { main: 0, pend: 0, off: 0 };
    staff.forEach(function (st) {
      var bal = C.balances(S.data, st.id, y), m = mainType(st, y), pend = 0, off = 0;
      personRequests(st, y).forEach(function (r) {
        var n = inYear(datesOf(r), y).reduce(function (s, x) { return s + x.amt; }, 0);
        if (r.status === 'Approved') off += n; else if (r.status === 'Pending') pend += n;
      });
      tot.pend += pend; tot.off += off; if (m) tot.main += m.b.approved;
      rows.push('<tr><td><b>' + esc(st.name) + '</b><small>' + esc(catName(st)) + '</small></td>' +
        '<td class="n">' + (m ? '<b>' + C.fmtDays(m.b.approved) + '</b> / ' + C.fmtDays(m.b.entitled) + '<small>' + C.fmtDays(m.b.remaining) + ' left</small>' : '–') + '</td>' +
        others.map(function (t) {
          var b = bal[t.code];
          if (!b.offered) return '<td class="n rp-na">–</td>';
          if (b.entitled == null) return '<td class="n">' + (b.approved ? C.fmtDays(b.approved) : '0') + '</td>';
          return '<td class="n"><b>' + C.fmtDays(b.approved) + '</b> / ' + C.fmtDays(b.entitled) + '</td>';
        }).join('') +
        '<td class="n">' + (pend ? C.fmtDays(pend) : '–') + '</td><td class="n"><b>' + C.fmtDays(off) + '</b></td></tr>');
    });
    var heads = '<th>Employee</th><th class="n">Staff leave<small>taken / allowed</small></th>' + others.map(function (t) {
      return '<th class="n">' + esc(t.name.replace(' (Fri–Sun)', '')) + '<small>' + (t.deducts ? 'taken / allowed' : 'days taken') + '</small></th>';
    }).join('') + '<th class="n">Pending<small>days</small></th><th class="n">Total off<small>days</small></th>';
    var away = S.data.requests.filter(function (r) { return r.status === 'Approved' && r.end >= todayISO() && C.tracksLeave(staffById(r.staffId)); })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; }).slice(0, 12);
    return '<section class="rp-page rp-wide">' + rpHead('Staff leave summary', staff.length + ' staff members', y) +
      '<table class="rp-tbl rp-sum"><thead><tr>' + heads + '</tr></thead><tbody>' + rows.join('') + '</tbody>' +
      '<tfoot><tr><td>Total</td><td class="n">' + C.fmtDays(tot.main) + '</td>' + others.map(function () { return '<td></td>'; }).join('') +
      '<td class="n">' + C.fmtDays(tot.pend) + '</td><td class="n">' + C.fmtDays(tot.off) + '</td></tr></tfoot></table>' +
      '<p class="rp-key">“Staff leave” is each person’s main allowance: Pastoral, Support or Cleaning Staff Leave. Weekend Off is counted in weekends; Sabbatical in calendar days, including days saved from earlier years.</p>' +
      (away.length ? '<h2 class="rp-h">Upcoming approved leave</h2><table class="rp-tbl"><thead><tr><th>Employee</th><th>Dates</th><th>Leave type</th><th class="n">Days</th></tr></thead><tbody>' +
        away.map(function (r) { var t = typeOf(r.type); return '<tr><td>' + esc((staffById(r.staffId) || {}).name || '') + '</td><td>' + esc(fmtRange(r)) + '</td><td><span class="rp-dot" style="background:' + esc(t.colour) + '"></span>' + esc(t.name) + '</td><td class="n">' + reqAmount(r) + '</td></tr>'; }).join('') +
        '</tbody></table>' : '') +
      rpFoot() + '</section>';
  }

  VIEW_FN.reports = function () {
    var admin = isMgr(), y = curLY() + S.repYear;
    var kinds = [];
    if (takesLeave(me())) kinds.push(['mine', 'My leave report']);
    if (admin) kinds.push(['person', 'One employee'], ['summary', 'All staff — summary'], ['full', 'All staff — full detail']);
    if (!kinds.some(function (k) { return k[0] === S.repKind; })) S.repKind = kinds[0][0];
    var staff = sortedStaff().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!S.repPerson || !staffById(S.repPerson)) S.repPerson = staff[0] && staff[0].id;
    var body;
    if (S.repKind === 'mine') body = personReport(me(), y);
    else if (S.repKind === 'person') body = staffById(S.repPerson) ? personReport(staffById(S.repPerson), y) : '<p>No staff yet.</p>';
    else if (S.repKind === 'summary') body = summaryReport(y);
    else body = summaryReport(y) + staff.map(function (st) { return personReport(st, y); }).join('');
    var controls = '<div class="rp-controls">' +
      (kinds.length > 1 ? '<label class="field">Report<select id="rep-kind">' + kinds.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === S.repKind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label>' : '') +
      (S.repKind === 'person' ? '<label class="field">Employee<select id="rep-person">' + staff.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.repPerson ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '</div>';
    return {
      title: 'Reports',
      sub: 'Choose a report, then print it or save it as a PDF from the print window.',
      controls: '<div class="seg"><button data-act="rprev" aria-label="Previous leave year">‹</button><button data-act="rthis">' + esc(lyName(y)) + '</button><button data-act="rnext" aria-label="Next leave year">›</button></div>' +
        '<button class="btn primary" data-act="print">Print / Save as PDF</button>',
      body: controls + '<div class="report">' + body + '</div>'
    };
  };

  /** A person's main leave type for the year: their staff leave (e.g. Pastoral Staff Leave), not sick or special leave. */
  function mainType(st, y) {
    var bal = C.balances(S.data, st.id, y), best = null;
    S.data.types.forEach(function (t) {
      var b = bal[t.code];
      if (!t.deducts || !b || b.entitled == null || !C.isDayUnit(t) || t.accumulates) return;
      var score = (t.useBy ? 1000 : 0) + b.entitled;
      if (!best || score > best.score) best = { t: t, b: b, score: score };
    });
    return best;
  }

  VIEW_FN.employees = function () {
    var staff = sortedStaff().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!S.emp || !staffById(S.emp)) S.emp = staff[0] && staff[0].id;
    var st = staffById(S.emp), y = curLY() + S.empYear, today = todayISO();
    var tsel = S.empType || 'all', ssel = S.empStatus || 'Approved';

    var list = staff.map(function (p) {
      var all = empDates(p, y, 'all', 'Approved').reduce(function (s, x) { return s + x.amt; }, 0);
      var main = mainType(p, y), label, tip;
      if (main) {
        label = C.fmtDays(main.b.approved) + '<small>/' + C.fmtDays(main.b.entitled) + '</small>';
        tip = C.fmtDays(main.b.approved) + ' of ' + C.fmtDays(main.b.entitled) + ' days of ' + main.t.name + ' taken in ' + lyName(y) +
          ' (' + C.fmtDays(main.b.remaining) + ' left)' + (all > main.b.approved ? '. All leave: ' + days(all) + ' off.' : '');
      } else { label = C.fmtDays(all); tip = days(all) + ' off in ' + lyName(y); }
      return '<button class="emp-item" data-act="emp" data-id="' + esc(p.id) + '"' + (p.id === S.emp ? ' aria-current="true"' : '') + '>' + av(p) +
        '<span class="grow"><b>' + esc(p.name) + '</b><span>' + esc(catName(p)) + '</span></span><span class="num emp-n" title="' + esc(tip) + '">' + label + '</span></button>';
    }).join('');

    var rows = st ? empDates(st, y, tsel, ssel) : [];
    var totals = {}, totalDays = 0, months = {};
    rows.forEach(function (x) {
      totals[x.r.type] = (totals[x.r.type] || 0) + x.amt; totalDays += x.amt;
      var mk = x.date.slice(0, 7);
      (months[mk] || (months[mk] = [])).push(x);
    });
    var chips = Object.keys(totals).map(function (code) {
      var t = typeOf(code), n = totals[code], word;
      if (C.isCalendarUnit(t)) word = n === 1 ? 'calendar day' : 'calendar days';
      else if (!C.isDayUnit(t)) {   // counted per booking, e.g. Weekend Off
        var ids = {};
        rows.forEach(function (x) { if (x.r.type === code) ids[x.r.id] = 1; });
        n = Object.keys(ids).length; word = C.unitName(t, n);
      } else word = n === 1 || n === 0.5 ? 'day' : 'days';
      var b = C.balances(S.data, st.id, y)[code];
      var left = b && b.entitled != null ? ' · ' + C.fmtDays(b.remaining) + ' of ' + C.fmtAmount(t, b.entitled) + ' left' : '';
      return '<span class="chip" style="--c:' + esc(t.colour) + '" title="' + esc(typeDesc(t)) + '"><span class="dot"></span>' + esc(t.name) + ' · ' + C.fmtDays(n) + ' ' + esc(word) + ({ Approved: ' taken', Pending: ' waiting', Booked: ' booked' }[ssel] || '') + left + '</span>';
    }).join('');
    var table = Object.keys(months).sort().map(function (mk) {
      var items = months[mk], d0 = C.parse(mk + '-01');
      var sum = items.reduce(function (s, x) { return s + x.amt; }, 0);
      return '<tr class="mh"><th colspan="5">' + MONTHS[d0.getMonth()] + ' ' + d0.getFullYear() + '<span>' + days(sum) + '</span></th></tr>' +
        items.map(function (x) {
          var part = x.amt < 1 ? (x.r.half === 'PM' ? 'Afternoon' : 'Morning') : 'Full day';
          return '<tr class="click' + (x.date > today ? ' future' : '') + '" data-act="open-req" data-id="' + esc(x.r.id) + '"><td class="num nowrap">' + esc(fmtLong(x.date)) + (CTX.hol[x.date] ? '<br><span class="muted small">' + esc(CTX.hol[x.date]) + '</span>' : '') + '</td>' +
            '<td>' + typeChip(x.t, x.r.status === 'Pending') + '</td><td class="nowrap">' + part + '</td><td>' + pill(x.r.status) + '</td>' +
            '<td class="muted small">' + esc(x.r.reason || '') + '</td></tr>';
        }).join('');
    }).join('');

    var bal = st ? C.balances(S.data, st.id, y) : {};
    var balLine = st ? S.data.types.filter(function (t) { return t.deducts && bal[t.code].offered; }).map(function (t) {
      var b = bal[t.code];
      return '<span><span class="dot" style="--c:' + esc(t.colour) + '"></span> ' + esc(t.name) + ': <b>' + C.fmtDays(b.remaining) + '</b> of ' + C.fmtDays(b.entitled) + ' left</span>';
    }).join('') : '';

    var mgr = st && st.manager ? S.data.staff.filter(function (s) { return s.email === st.manager; })[0] : null;
    var typeOpts = '<option value="all">All leave types</option>' + S.data.types.map(function (t) {
      return '<option value="' + esc(t.code) + '"' + (t.code === tsel ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    var statusOpts = EMP_STATUS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === ssel ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var personSel = '<select id="emp-person" class="btn emp-person" aria-label="Employee">' + staff.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === S.emp ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('') + '</select>';

    return {
      title: 'Employees',
      sub: 'Every date each person has had off. Click a date to see the request.',
      controls: '<div class="seg"><button data-act="eprev" aria-label="Previous leave year">‹</button><button data-act="ethis">' + esc(lyName(y)) + '</button><button data-act="enext" aria-label="Next leave year">›</button></div>',
      body: '<div class="emp-layout"><nav class="emp-list panel" aria-label="Employees">' + list + '</nav>' +
        '<section class="emp-detail">' + personSel + (st ? '<div class="panel emp-head"><div class="who">' + av(st, true) + '<div><h2>' + esc(st.name) + '</h2>' +
          '<p class="muted">' + esc(catName(st)) + ' · works ' + esc(workLabel(st)) + ' · ' + esc(st.role) + (st.start ? ' · started ' + esc(fmt(st.start, true)) : '') + '' + '</p>' +
          '<p class="small">' + esc(st.email) + '</p></div></div><div class="emp-bal small">' + balLine + '</div></div>' +
          '<div class="emp-filters"><label class="field">Leave type<select id="emp-type">' + typeOpts + '</select></label>' +
          '<label class="field">Show<select id="emp-status">' + statusOpts + '</select></label></div>' +
          '<div class="emp-sum"><span class="big num">' + days(totalDays) + '</span><span class="muted"> in the ' + esc(lyName(y)) + ' leave year</span><div class="legend" style="margin:8px 0 0">' + chips + '</div></div>' +
          (rows.length ? '<div class="panel tbl-wrap"><table class="tbl dates"><thead><tr><th>Date</th><th>Leave type</th><th>Length</th><th>Status</th><th>Note</th></tr></thead><tbody>' + table + '</tbody></table></div>'
            : '<div class="panel muted">No days off match these filters in ' + esc(lyName(y)) + '.</div>') : '') +
        '</section></div>'
    };
  };

  VIEW_FN.team = function () {
    var y = curLY() + S.yearOffset, today = todayISO();
    var dt = S.data.types.filter(function (t) { return t.deducts; });
    var people = sortedStaff().filter(function (st) { return st.id === me().id || canManage(st); });
    var rows = people.map(function (st) {
      var bal = C.balances(S.data, st.id, y);
      var pendN = 0;
      Object.keys(bal).forEach(function (k) { pendN += bal[k].pending; });
      var next = S.data.requests.filter(function (r) { return r.staffId === st.id && r.status === 'Approved' && r.end >= today; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; })[0];
      return '<tr><td><div class="person">' + av(st) + '<div><b>' + esc(st.name) + '</b><br><span class="muted small">' + esc(st.role) + '</span></div></div></td><td>' + esc(catName(st)) + '<br><span class="muted small">' + esc(workLabel(st)) + '</span></td>' +
        dt.map(function (t) {
          var b = bal[t.code], e = Math.max(b.entitled, 0.0001);
          if (!b.offered) return '<td class="muted">–</td>';
          return '<td class="cellbal" style="--c:' + esc(t.colour) + '"><div class="v num' + (b.remaining <= 2 && b.entitled > 0 ? ' low' : '') + '">' + C.fmtDays(b.remaining) + ' <small>/ ' + C.fmtDays(b.entitled) + '</small></div>' +
            '<div class="meter"><i class="a" style="width:' + Math.min(100, b.approved / e * 100) + '%"></i><i class="p" style="width:' + Math.min(100, b.pending / e * 100) + '%"></i></div></td>';
        }).join('') + '<td class="num">' + (pendN ? C.fmtDays(pendN) : '–') + '</td><td>' + (next ? '<button class="btn small ghost" data-act="open-req" data-id="' + esc(next.id) + '">' + esc(fmt(next.start)) + '</button>' : '<span class="muted">–</span>') + '</td></tr>';
    }).join('');

    // Days taken per month (approved), stacked by type
    var rng = C.lyRange(y, CTX.S), monthsArr = [];
    for (var k = 0; k < 12; k++) monthsArr.push({});
    var ids = {};
    people.forEach(function (p) { ids[p.id] = 1; });
    S.data.requests.forEach(function (r) {
      if (r.status !== 'Approved' || !ids[r.staffId]) return;
      (DL[r.id] || []).forEach(function (x) {
        if (x.date < rng.start || x.date > rng.end) return;
        var p = C.parse(x.date), idx = (p.getFullYear() - y) * 12 + p.getMonth() - (CTX.S - 1);
        monthsArr[idx][r.type] = (monthsArr[idx][r.type] || 0) + x.amt;
      });
    });
    var maxV = 1;
    monthsArr.forEach(function (o) { var s = 0; Object.keys(o).forEach(function (k) { s += o[k]; }); maxV = Math.max(maxV, s); });
    var step = maxV <= 10 ? 2 : maxV <= 25 ? 5 : 10, top = Math.ceil(maxV / step) * step;
    var W = 720, H = 240, L = 34, B = 26, T = 10, bw = (W - L - 10) / 12;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Approved leave days per month">';
    for (var v = 0; v <= top; v += step) {
      var yy = T + (H - T - B) * (1 - v / top);
      svg += '<line class="gl" x1="' + L + '" x2="' + (W - 6) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + v + '</text>';
    }
    monthsArr.forEach(function (o, i) {
      var x = L + i * bw + bw * 0.18, w = bw * 0.64, acc = 0;
      S.data.types.forEach(function (t) {
        var val = o[t.code] || 0;
        if (!val) return;
        var h = (H - T - B) * val / top, y0 = T + (H - T - B) * (1 - (acc + val) / top);
        svg += '<rect x="' + x + '" y="' + y0 + '" width="' + w + '" height="' + Math.max(h - 1, 0.5) + '" rx="2" fill="' + esc(t.colour) + '"><title>' + esc(t.name + ': ' + C.fmtDays(val)) + '</title></rect>';
        acc += val;
      });
      var mo = (CTX.S - 1 + i) % 12;
      svg += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + MONTHS[mo].slice(0, 3) + '</text>';
    });
    svg += '</svg>';

    return {
      title: 'Team balances <span class="muted" style="font-weight:500">' + esc(lyName(y)) + '</span>',
      sub: 'Remaining of allowance, including carry-over, saved sabbatical and adjustments. – means that leave type isn’t available to that category.',
      controls: '<div class="seg"><button data-act="yprev" aria-label="Previous leave year">‹</button><button data-act="ythis">This year</button><button data-act="ynext" aria-label="Next leave year">›</button></div>',
      body: '<section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Category</th>' + dt.map(function (t) { return '<th title="' + esc(typeDesc(t)) + '"><span class="dot" style="--c:' + esc(t.colour) + '"></span> ' + esc(t.name) + '</th>'; }).join('') + '<th>Pending</th><th>Next leave</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
        '<section class="panel chart" style="margin-top:16px"><h2>Days taken per month <small>approved leave, ' + people.length + ' people</small></h2>' + svg +
        '<div class="legend" style="margin:8px 0 0">' + S.data.types.map(function (t) { return '<span class="chip" style="--c:' + esc(t.colour) + '"><span class="dot"></span>' + esc(t.name) + '</span>'; }).join('') + '</div></section>'
    };
  };

  /* ------------------------------ modals ------------------------------ */
  function openModal(html, label) {
    modalRoot.innerHTML = '<div class="overlay" data-act="overlay"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + html + '</div></div>';
    var f = modalRoot.querySelector('select, input, textarea, button:not(.x)');
    if (f) f.focus();
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  function requestModal(pre) {
    pre = pre || {};
    var u = me();
    var targets = sortedStaff().filter(function (s) { return s.id === u.id || canManage(s); });
    if (!targets.length) { toast('There’s nobody whose leave you can book.', true); return; }
    var who = pre.staffId || (takesLeave(u) ? u.id : targets[0].id);
    var html = '<header><div><p class="eyebrow">New request</p><h2>' + (takesLeave(u) ? 'Request leave' : 'Book leave') + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header><form id="reqForm" novalidate>' +
      (targets.length > 1 || !takesLeave(u) ? '<label class="field">For<select id="f-staff">' + targets.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === who ? ' selected' : '') + '>' + esc(s.name) + (s.id === u.id ? ' (you)' : '') + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="field">Leave type<select id="f-type">' + typeOptions(staffById(who)) + '</select></label>' +
      '<div class="two"><label class="field">First day<input type="date" id="f-start" required value="' + esc(pre.date || '') + '"></label>' +
      '<label class="field">Last day<input type="date" id="f-end" required value="' + esc(pre.date || '') + '"' + (pre.date ? ' min="' + esc(pre.date) + '"' : '') + '></label></div>' +
      '<div class="field" id="f-half-wrap" hidden><span>Length</span><div class="radios">' +
      '<label><input type="radio" name="half" value="None" checked>Full day</label><label><input type="radio" name="half" value="AM">Morning</label><label><input type="radio" name="half" value="PM">Afternoon</label></div></div>' +
      '<label class="field">' + (takesLeave(u) ? 'Note for the Administrator' : 'Note') + ' <span class="muted" style="font-weight:400">(optional)</span><textarea id="f-reason" rows="2" maxlength="500"></textarea></label>' +
      '<div class="summary" id="f-sum"></div><div id="f-err"></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn primary" id="f-go">' + (takesLeave(u) ? 'Send request' : 'Book leave') + '</button></div></form>';
    openModal(html, 'Request leave');
    updateRequestSummary();
  }
  function typeOptions(st, current) {
    return S.data.types.filter(function (t) { return C.offered(S.data, st, t); }).map(function (t) {
      return '<option value="' + esc(t.code) + '"' + (t.code === current ? ' selected' : '') + '>' + esc(t.name) + (t.deducts ? '' : ' (doesn’t use an allowance)') + '</option>';
    }).join('');
  }
  function readReqForm() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var half = modalRoot.querySelector('input[name="half"]:checked');
    return { staffId: g('f-staff') || me().id, type: g('f-type'), start: g('f-start'), end: g('f-end') || g('f-start'), half: half ? half.value : 'None', reason: g('f-reason') };
  }
  function updateRequestSummary() {
    var sum = document.getElementById('f-sum');
    if (!sum) return;
    var r = readReqForm(), t = C.type(S.data, r.type), st = staffById(r.staffId);
    var halfWrap = document.getElementById('f-half-wrap');
    var single = r.start && r.start === r.end && t && t.halfDay && C.isDayUnit(t);
    halfWrap.hidden = !single;
    if (!single) r.half = 'None';
    if (!C.isISO(r.start) || !C.isISO(r.end)) { sum.innerHTML = '<span class="muted">Pick your dates to see how many working days this uses.</span>'; setErr(''); return; }
    var dl = r.end >= r.start ? C.dayList(r, CTX) : [];
    var n = dl.reduce(function (s, x) { return s + x.amt; }, 0);
    // Which dates in the range aren't counted, and why.
    var skip = { hol: [], closed: [], off: [] }, nSkip = 0;
    if (r.end >= r.start && !(t && C.isCalendarUnit(t))) {
      var d = C.parse(r.start), e = C.parse(r.end), guard = 0;
      var wdays = st ? C.staffDays(CTX, st.id) : CTX.open;
      while (d <= e && guard++ < 800) {
        var ds = C.iso(d), label = DOW[d.getDay()] + ' ' + fmt(ds);
        if (CTX.hol[ds]) { skip.hol.push(label + ': ' + CTX.hol[ds] + ' (public holiday)'); nSkip++; }
        else if (!C.isOpen(d, CTX)) { skip.closed.push(label); nSkip++; }
        else if (wdays.indexOf(d.getDay()) < 0) { skip.off.push(label); nSkip++; }
        d = C.addDays(d, 1);
      }
    }
    var mine = st && st.id === me().id, who = mine ? 'your' : (st ? firstName(st.name) + '’s' : '');
    var skipItems = [];
    if (skip.off.length) skipItems.push(esc(skip.off.join(', ')) + ': not ' + esc(who) + ' working day' + (skip.off.length > 1 ? 's' : '') +
      ' <span class="why">(' + (mine ? 'you work ' : esc(st ? firstName(st.name) : '') + ' works ') + esc(st ? workLabel(st) : '') + ')</span>');
    if (skip.closed.length) {
      var closedDays = C.daysLabel([0, 1, 2, 3, 4, 5, 6].filter(function (x) { return CTX.open.indexOf(x) < 0; }));
      skipItems.push(esc(skip.closed.join(', ')) + ': the church is closed <span class="why">(closed ' + esc(closedDays) + ')</span>');
    }
    skip.hol.forEach(function (h) { skipItems.push(esc(h)); });
    var skipHtml = skipItems.length ? '<div class="notcounted"><b>Not counted (' + days(nSkip) + '):</b><ul>' + skipItems.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' : '';
    var line2 = '';
    var useAmt = t && !C.isDayUnit(t) ? (n ? C.amount(r, t, CTX) : 0) : n;
    if (t && t.deducts && st && n && C.offered(S.data, st, t)) {
      var y = C.lyOf(r.start, CTX.S), b = C.balances(S.data, st.id, y)[t.code];
      if (b.lastYear && r.start <= b.lastYear.until) b = { available: b.available + b.lastYear.left };
      line2 = '<span>' + esc(t.name) + ': ' + C.fmtAmount(t, b.available) + ' available → <b class="' + (b.available - useAmt < 0 ? 'low' : '') + '">' + C.fmtDays(b.available - useAmt) + ' after this</b></span>';
    } else if (t && !t.deducts) line2 = '<span class="muted">' + esc(t.name) + ' doesn’t use any allowance.</span>';
    sum.innerHTML = '<span class="big num">' + (t && !C.isDayUnit(t) ? C.fmtAmount(t, useAmt) + '</span><span class="muted small">' + days(n) + ' away from work' : days(n)) + '</span>' +
      skipHtml +
      (t && t.allowedDays ? '<span class="muted small">' + esc(t.name) + ' can only be booked on ' + esc(C.daysLabel(C.parseDays(t.allowedDays, []))) + (Number(t.perTerm) > 0 ? ', ' + (Number(t.perTerm) === 1 ? 'once' : t.perTerm + ' times') + ' per school term' : '') + '.</span>' : '') +
      (t && st && Number(t.perTerm) > 0 && C.termOf(S.data, r.start) ? '<span class="muted small">Counts as ' + esc(C.termOf(S.data, r.start).name) + '’s ' + esc(t.name) + '.</span>' : '') + line2 +
      (t && t.needsApproval && st && st.id === me().id ? '<span class="muted small">Goes to the Administrator for approval.</span>' : '');
    var err = st && t ? C.validate(S.data, st, r) : null;
    setErr(err || '');
  }
  function setErr(msg) { var e = document.getElementById('f-err'); if (e) e.innerHTML = msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : ''; }

  function requestDetail(id) {
    var r = S.data.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var st = staffById(r.staffId) || { name: 'Former staff member', id: '' }, t = typeOf(r.type), today = todayISO();
    var mine = r.staffId === me().id, mgr = canManage(st);
    var canCancel = (r.status === 'Pending' || r.status === 'Approved') && (mgr || (mine && (r.status === 'Pending' || r.start > today)));
    var html = '<header><div class="who" style="display:flex;gap:12px;align-items:center">' + av(st, true) + '<div><p class="eyebrow">' + esc(t.name) + '</p><h2>' + esc(st.name) + '</h2></div></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<dl class="kv"><dt>Status</dt><dd>' + pill(r.status) + '</dd><dt>Dates</dt><dd>' + esc(fmtRange(r)) + '</dd><dt>Time away</dt><dd>' + reqAmount(r) + '</dd>' +
      (r.reason ? '<dt>Note</dt><dd>' + esc(r.reason) + '</dd>' : '') +
      '<dt>Requested</dt><dd>' + esc(r.submitted) + (r.source ? ' · ' + esc(r.source === 'Form' ? 'Google Form' : 'app') : '') + '</dd>' +
      (r.decidedBy ? '<dt>' + (r.cancelledBy ? (r.decidedOn ? 'Approved by' : 'Decided by') : (r.status === 'Cancelled' ? 'Cancelled by' : r.status === 'Declined' ? 'Declined by' : 'Approved by')) + '</dt><dd>' + esc(r.decidedBy) + (r.decidedOn ? ' · ' + esc(r.decidedOn) : '') + '</dd>' : '') +
      (r.cancelledBy ? '<dt>Cancelled by</dt><dd>' + esc(r.cancelledBy) + (r.cancelledOn ? ' · ' + esc(r.cancelledOn) : '') + '</dd>' : '') +
      (r.note ? '<dt>Manager note</dt><dd>' + esc(r.note) + '</dd>' : '') + '</dl>' +
      (mgr && r.status === 'Pending' ? '<label class="field">Note to ' + esc(firstName(st.name)) + ' (optional)<textarea id="note-' + esc(r.id) + '" rows="2"></textarea></label>' : '') +
      '<div class="actions">' + (canCancel ? '<button class="btn bad" data-act="cancel-req" data-id="' + esc(r.id) + '">Cancel this leave</button>' : '') +
      (mgr && r.status === 'Pending' ? '<button class="btn bad" data-act="decide" data-d="Declined" data-id="' + esc(r.id) + '">Decline</button><button class="btn ok" data-act="decide" data-d="Approved" data-id="' + esc(r.id) + '">Approve</button>' : '<button class="btn" data-act="close">Close</button>') + '</div>';
    openModal(html, 'Leave details');
  }

  function dayDetail(ds) {
    var off = offOn(ds);
    var html = '<header><div><p class="eyebrow">' + (CTX.hol[ds] ? esc(CTX.hol[ds]) : (C.isOpen(C.parse(ds), CTX) ? 'Church open' : 'Church closed')) + '</p><h2>' + esc(fmtLong(ds)) + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<div class="list" style="margin-bottom:18px">' + (off.length ? off.map(function (o) {
        return o.e.map(function (e) {
          var t = typeOf(e.r.type);
          return '<div class="li click" data-act="open-req" data-id="' + esc(e.r.id) + '">' + av(o.st) + '<div class="grow"><b>' + esc(o.st.name) + '</b><span>' + esc(t.name) + (e.amt < 1 ? ' · ' + (e.r.half === 'AM' ? 'morning' : 'afternoon') : '') + ' · ' + esc(fmtRange(e.r)) + '</span></div>' + pill(e.r.status) + '</div>';
        }).join('');
      }).join('') : '<p class="empty">' + (C.isWorking(C.parse(ds), CTX) ? 'Nobody is away.' : 'The church is closed.') + '</p>') + '</div>' +
      '<div class="actions"><button class="btn" data-act="close">Close</button>' + (C.isWorking(C.parse(ds), CTX, me().id) ? '<button class="btn primary" data-act="book" data-date="' + ds + '" data-staff="' + esc(me().id) + '">Book this day</button>' : '') + '</div>';
    openModal(html, fmtLong(ds));
  }

  /* ------------------------------ events ------------------------------ */
  function go(view) {
    S.view = view;
    store.set('view', view);
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* ignore */ }
    if (view === 'year' || view === 'team') S.yearOffset = 0;
    render();
    window.scrollTo(0, 0);
  }
  function busy(btn, on) { if (btn) { btn.disabled = on; if (on) btn.dataset.label = btn.textContent, btn.textContent = 'Saving…'; else if (btn.dataset.label) btn.textContent = btn.dataset.label; } }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var a = el.dataset.act;
    if (a === 'overlay') { if (ev.target === el) closeModal(); return; }
    ev.stopPropagation();
    switch (a) {
      case 'nav': closeModal(); go(el.dataset.view); break;
      case 'prev': S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() - 1, 1, 12); render(); break;
      case 'next': S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + 1, 1, 12); render(); break;
      case 'thismonth': S.cursor = monthStart(new Date()); render(); break;
      case 'yprev': S.yearOffset--; render(); break;
      case 'ynext': S.yearOffset++; render(); break;
      case 'ythis': S.yearOffset = 0; render(); break;
      case 'emp': S.emp = el.dataset.id; render(); break;
      case 'eprev': S.empYear--; render(); break;
      case 'enext': S.empYear++; render(); break;
      case 'ethis': S.empYear = 0; render(); break;
      case 'rprev': S.repYear--; render(); break;
      case 'rnext': S.repYear++; render(); break;
      case 'rthis': S.repYear = 0; render(); break;
      case 'hist-refresh': loadHistory(true); render(); break;
      case 'hist-more': S.histLimit += 100; render(); break;
      case 'print':
        try { window.print(); } catch (e) { toast('Printing isn’t available here. Open Leave Manager in your browser to print.', true); }
        break;
      case 'toggle-type': S.hidden[el.dataset.code] = !S.hidden[el.dataset.code]; store.set('hidden', S.hidden); render(); break;
      case 'toggle-pending': S.showPending = !S.showPending; store.set('showPending', S.showPending); render(); break;
      case 'new': requestModal(); break;
      case 'book': requestModal({ date: el.dataset.date, staffId: el.dataset.staff }); break;
      case 'open-req': requestDetail(el.dataset.id); break;
      case 'day': dayDetail(el.dataset.date); break;
      case 'close': closeModal(); break;
      case 'logout': logout(); break;
      case 'demo-login':
        Demo.handle('login', { staffId: el.dataset.id }).then(function (res) { S.token = res.token; store.set('demo_token', res.token); setData(res.data); });
        break;
      case 'demo-reset':
        if (el.dataset.confirm) { Demo.reset(); call('bootstrap', {}, 'Sample data reset'); }
        else { el.dataset.confirm = '1'; el.textContent = 'Click again to reset'; }
        break;
      case 'decide': {
        var note = document.getElementById('note-' + el.dataset.id);
        var d = el.dataset.d;
        busy(el, true);
        call('decide', { id: el.dataset.id, decision: d, note: note ? note.value : '' }, d === 'Approved' ? 'Approved – they’ve been emailed' : 'Declined – they’ve been emailed')
          .then(closeModal).catch(function () { busy(el, false); });
        break;
      }
      case 'cancel-req':
        if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = 'Yes, cancel it'; el.classList.add('primary'); return; }
        busy(el, true);
        call('cancel', { id: el.dataset.id }, 'Leave cancelled').then(closeModal).catch(function () { busy(el, false); });
        break;
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && modalRoot.innerHTML) closeModal();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[role="button"][data-act]')) { ev.preventDefault(); ev.target.click(); }
  });
  var histTimer;
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'hist-q') {
      S.histF.q = ev.target.value;
      clearTimeout(histTimer);
      histTimer = setTimeout(function () {
        var pos = ev.target.selectionStart; render();
        var el = document.getElementById('hist-q'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
      }, 250);
      return;
    }
    if (ev.target.closest('#reqForm')) {
      if (ev.target.id === 'f-start') syncLastDay(ev.target);
      updateRequestSummary();
    }
  });
  /** The last day follows the first day, unless someone has deliberately picked a later last day. */
  function syncLastDay(startEl) {
    var end = document.getElementById('f-end'), start = startEl.value, prev = startEl.dataset.prev || '';
    if (!end) return;
    if (start && (!end.value || end.value < start || end.value === prev)) end.value = start;
    end.min = start || '';
    startEl.dataset.prev = start;
  }
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'f-start') syncLastDay(ev.target);
    if (ev.target.id === 'yr-person') { S.person = ev.target.value; render(); }
    else if (ev.target.id === 'emp-person') { S.emp = ev.target.value; render(); }
    else if (ev.target.id === 'emp-type') { S.empType = ev.target.value; render(); }
    else if (ev.target.id === 'emp-status') { S.empStatus = ev.target.value; render(); }
    else if (ev.target.id === 'rep-kind') { S.repKind = ev.target.value; render(); }
    else if (ev.target.id === 'hist-period') { S.histF.period = ev.target.value; S.histLimit = 60; render(); }
    else if (ev.target.id === 'hist-person') { S.histF.person = ev.target.value; S.histLimit = 60; render(); }
    else if (ev.target.id === 'hist-kind') { S.histF.kind = ev.target.value; S.histLimit = 60; render(); }
    else if (ev.target.id === 'rep-person') { S.repPerson = ev.target.value; render(); }
    else if (ev.target.id === 'f-staff') {
      var sel = document.getElementById('f-type');
      sel.innerHTML = typeOptions(staffById(ev.target.value), sel.value);
      updateRequestSummary();
    }
    else if (ev.target.closest('#reqForm')) updateRequestSummary();
  });
  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (ev.target.id === 'loginForm') {
      var email = document.getElementById('l-email').value.trim(), pin = document.getElementById('l-pin').value.trim();
      var btn = document.getElementById('l-go'), errBox = document.getElementById('l-err');
      if (!email || !pin) { errBox.innerHTML = '<div class="err">Enter your email and PIN.</div>'; return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      api('login', { email: email, pin: pin }).then(function (res) {
        S.token = res.token; store.set('token', res.token); store.set('email', email); setData(res.data);
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        errBox.innerHTML = '<div class="err" role="alert">' + esc(err.message === 'Failed to fetch' ? 'Can’t reach the leave server. Check the API_URL in config.js.' : err.message) + '</div>';
      });
    }
    if (ev.target.id === 'reqForm') {
      var r = readReqForm(), btn2 = document.getElementById('f-go');
      if (document.getElementById('f-half-wrap').hidden) r.half = 'None';
      var st = staffById(r.staffId), err = C.validate(S.data, st, r);
      if (err) { setErr(err); return; }
      busy(btn2, true);
      var forOther = r.staffId !== me().id, t = C.type(S.data, r.type);
      call('request', r, forOther ? 'Booked for ' + firstName(st.name) : (t.needsApproval ? 'Request sent to the Administrator' : 'Booked'))
        .then(closeModal).catch(function () { busy(btn2, false); });
    }
  });
  window.addEventListener('hashchange', function () {
    var v = location.hash.replace('#', '');
    if (VIEWS.indexOf(v) >= 0 && v !== S.view && S.data) go(v);
  });

  /* ------------------------------ demo backend ------------------------------ */
  var Demo = (function () {
    var KEY = 'demo_db_v11';
    function seed() {
      var yr = new Date().getFullYear();
      // id, name, category, working days override ('' = category default), role, manager
      var staff = [
        ['S01', 'Thandi Mokoena', 'Pastoral Staff', '', 'Staff', ''],
        ['S02', 'Pieter van Wyk', 'Pastoral Staff', '', 'Staff', ''],
        ['S03', 'Grace Ndlovu', 'Pastoral Staff', '', 'Staff', 'thandi@example.com'],
        ['S04', 'Sipho Dlamini', 'Support Staff', '', 'Staff', 'pieter@example.com'],
        ['S05', 'Lerato Khumalo', 'Support Staff', '', 'Staff', 'pieter@example.com'],
        ['S06', 'Jason Naidoo', 'Support Staff', '', 'Staff', 'pieter@example.com'],
        ['S07', 'Megan Smith', 'Support Staff', '', 'Staff', 'pieter@example.com'],
        ['S08', 'Kagiso Molefe', 'Pastoral Staff', '', 'Staff', 'thandi@example.com'],
        ['S09', 'Nomvula Zulu', 'Cleaning Staff', '', 'Staff', 'pieter@example.com'],
        ['S10', 'Ruan Botha', 'Technical Staff', '', 'Staff', ''],
        ['S11', 'Linda Pillay', 'Administrator', '', 'Administrator', '']
      ].map(function (s, i) {
        return { id: s[0], name: s[1], email: s[1].split(' ')[0].toLowerCase() + '@example.com', level: s[2], workDays: s[3], role: s[4], manager: s[5],
          start: s[0] === 'S01' ? (yr - 8) + '-01-15' : s[0] === 'S09' ? yr + '-04-01' : (yr - 2 - (i % 3)) + '-02-01', colour: PALETTE[i], active: true };
      });
      var data = {
        settings: { CompanyName: 'Hillside Community Church', LeaveYearStartMonth: 1, OpenDays: 'Mon, Wed, Thu, Fri, Sat, Sun', TermsIncludeHolidays: 'TRUE', FirstLeaveYear: yr - 1, ProRata: 'TRUE', AllowNegative: 'FALSE', MaxOffPerDay: 3 },
        terms: [
          ['Term 4 2025', '2025-10-07', '2025-12-10'], ['Term 1 2026', '2026-01-14', '2026-03-27'], ['Term 2 2026', '2026-04-08', '2026-06-26'],
          ['Term 3 2026', '2026-07-21', '2026-09-23'], ['Term 4 2026', '2026-10-06', '2026-12-11'], ['Term 1 2027', '2027-01-13', '2027-03-19'],
          ['Term 2 2027', '2027-04-06', '2027-06-25'], ['Term 3 2027', '2027-07-20', '2027-10-01'], ['Term 4 2027', '2027-10-11', '2027-12-10']
        ].map(function (t) { return { name: t[0], start: t[1], end: t[2] }; }),
        types: [
          { code: 'PSL', name: 'Pastoral Staff Leave', colour: '#2F80C0', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
          { code: 'SSL', name: 'Support Staff Leave', colour: '#3A86A8', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
          { code: 'CSL', name: 'Cleaning Staff Leave', colour: '#4C9A6A', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
          { code: 'TSL', name: 'Technical Staff Leave', colour: '#B0527A', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
          { code: 'SL', name: 'Sick Leave', colour: '#D1495B', deducts: true, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' },
          { code: 'WO', name: 'Weekend Off (Fri–Sun)', colour: '#E09F3E', deducts: true, halfDay: false, proRata: false, needsApproval: true, unit: 'Weekends', allowedDays: 'Fri, Sat, Sun', perTerm: 1 },
          { code: 'SAB', name: 'Sabbatical Leave', colour: '#7B61C9', deducts: true, halfDay: false, proRata: true, needsApproval: true, unit: 'Calendar days', accumulates: true, maxBalance: 87.5 },
          { code: 'WA', name: 'Working Away from Office', colour: '#2A9D8F', deducts: true, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' },
          { code: 'UL', name: 'Unpaid Leave', colour: '#64748B', deducts: false, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' }
        ],
        levels: [
          { level: 'Pastoral Staff', label: 'Pastoral Staff', workDays: 'Mon, Wed, Thu, Fri, Sat, Sun', ent: { PSL: 24, SL: 7, WO: 4, SAB: 12.5, WA: 21 } },
          { level: 'Support Staff', label: 'Support Staff', workDays: 'Mon, Wed, Thu, Fri', ent: { SSL: 20, SL: 7 } },
          { level: 'Cleaning Staff', label: 'Cleaning Staff', workDays: 'Fri', ent: { CSL: 3, SL: 7 } },
          { level: 'Technical Staff', label: 'Technical Staff', workDays: 'Mon, Wed, Thu, Fri, Sun', ent: { TSL: 20, SL: 7 } },
          { level: 'Administrator', label: 'Administrator', workDays: 'Mon, Wed, Thu, Fri', ent: {} }
        ],
        staff: staff,
        holidays: [yr - 1, yr, yr + 1].reduce(function (all, y) { return all.concat(C.saPublicHolidays(y)); }, []),
        requests: [],
        adjustments: [{ staffId: 'S05', year: yr, type: 'SSL', days: 2, note: 'Long service' }]
      };
      // Offsets are days from this week's Monday, so the demo always looks current.
      var now = new Date(), mon = C.addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), -((now.getDay() + 6) % 7));
      var plan = [
        // staff, type, start offset, length-1, status, half, note
        ['S08', 'PSL', 0, 6, 'Approved', '', 'Family visit in George'],
        ['S04', 'SSL', 2, 0, 'Approved', 'AM', 'Child’s school meeting'],
        ['S02', 'WO', 4, 2, 'Approved', '', ''],
        ['S06', 'SSL', 7, 3, 'Pending', '', 'Brother’s wedding'],
        ['S01', 'WA', 8, 2, 'Approved', '', 'Synod meeting, Johannesburg'],
        ['S09', 'CSL', 11, 0, 'Pending', '', ''],
        ['S03', 'WO', 11, 2, 'Pending', '', 'Anniversary weekend'],
        ['S07', 'SSL', 21, 4, 'Approved', '', ''],
        ['S05', 'SSL', 14, 4, 'Approved', '', 'Drakensberg hike'],
        ['S08', 'WO', 18, 2, 'Approved', '', ''],
        ['S03', 'WA', 22, 2, 'Approved', '', 'Youth camp, Magaliesberg'],
        ['S01', 'SAB', 56, 86, 'Approved', '', 'Sabbatical: study and rest (3 months)'],
        ['S03', 'SL', -3, 0, 'Approved', '', 'Flu'],
        ['S09', 'SL', -3, 0, 'Approved', '', ''],
        ['S05', 'SL', -10, 0, 'Approved', '', ''],
        ['S02', 'PSL', -14, 4, 'Approved', '', ''],
        ['S07', 'SSL', -14, 2, 'Declined', '', ''],
        ['S08', 'SL', -26, 0, 'Approved', '', ''],
        ['S06', 'SSL', -35, 2, 'Approved', '', ''],
        ['S01', 'WO', -45, 2, 'Approved', '', ''],
        ['S10', 'UL', -66, 0, 'Approved', '', ''],
        ['S10', 'TSL', 28, 6, 'Approved', '', 'Family wedding in Durban'],
        ['S03', 'PSL', -75, 4, 'Approved', '', ''],
        ['S05', 'SSL', -90, 4, 'Approved', '', ''],
        ['S04', 'SSL', -120, 4, 'Approved', '', ''],
        ['S02', 'PSL', -150, 10, 'Approved', '', ''],
        ['S09', 'CSL', -59, 0, 'Approved', '', '']
      ];
      var ctx = C.ctx(data);
      var pieterTeam = ['S04', 'S05', 'S06', 'S07', 'S09', 'S10'];
      plan.forEach(function (p, i) {
        var s = C.addDays(mon, p[2]), e = C.addDays(mon, p[2] + p[3]);
        var sub = C.addDays(s, -12) < now ? C.addDays(s, -12) : C.addDays(now, -(i % 5) - 1);
        var dec = C.addDays(s, -10) < now ? C.addDays(s, -10) : C.addDays(now, -(i % 4));
        var r = { id: 'D' + (100 + i), submitted: C.iso(sub) + ' 09:' + (10 + i), staffId: p[0], type: p[1], start: C.iso(s), end: C.iso(e),
          half: p[5] || 'None', reason: p[6], status: p[4], decidedBy: p[4] === 'Pending' ? '' : 'Linda Pillay',
          decidedOn: p[4] === 'Pending' ? '' : C.iso(dec) + ' 14:05', note: p[4] === 'Declined' ? 'That’s the family service weekend. Could you take the next one?' : '', source: i % 4 === 1 ? 'Form' : 'App' };
        r.days = C.countDays(r, ctx);
        if (r.days > 0) data.requests.push(r);
      });
      return data;
    }
    function db() { var d = store.get(KEY); if (!d || !d.staff) { d = seed(); store.set(KEY, d); } return d; }
    var mem = null;
    function load() { if (!mem) mem = db(); return mem; }
    function save() { store.set(KEY, mem); }
    function nowStr() { var d = new Date(); return C.iso(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    function handle(action, b) {
      return new Promise(function (resolve) { setTimeout(resolve, 180); }).then(function () {
        var d = load();
        if (action === 'login') {
          var u0 = C.staffById(d, b.staffId);
          return { token: 'demo-' + u0.id, data: C.publicView(d, u0) };
        }
        var u = d.staff.filter(function (s) { return 'demo-' + s.id === b.token; })[0];
        if (!u) throw new Error('AUTH: Choose who to sign in as.');
        if (action === 'history') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can see the History log.');
          return (d.history || []).slice().reverse();
        }
        var log = function (act, r, note) {
          var st = C.staffById(d, r.staffId) || {}, t = C.type(d, r.type) || {};
          (d.history || (d.history = [])).push({ when: nowStr(), action: act, requestId: r.id, staff: st.name, type: t.name,
            dates: r.start + ' to ' + r.end + (r.half === 'AM' ? ' (morning)' : r.half === 'PM' ? ' (afternoon)' : ''), days: r.days, status: r.status, by: u.name, note: note || '' });
        };
        if (action === 'request') {
          var p = C.prepareRequest(d, u, b);
          p.req.id = 'D' + Date.now().toString(36).toUpperCase();
          p.req.submitted = nowStr(); p.req.source = 'App'; p.req.note = '';
          p.req.decidedOn = p.req.status === 'Approved' ? nowStr() : '';
          d.requests.push(p.req);
          log(p.staff.id !== u.id ? 'Booked by Administrator' : (p.req.status === 'Approved' ? 'Requested (no approval needed)' : 'Requested'), p.req, p.req.reason);
        } else if (action === 'decide') {
          var q = C.prepareDecision(d, u, b.id, b.decision);
          q.req.status = b.decision; q.req.decidedBy = u.name; q.req.decidedOn = nowStr(); q.req.note = String(b.note || '');
          log(b.decision, q.req, q.req.note);
        } else if (action === 'cancel') {
          var c = C.prepareCancel(d, u, b.id, todayISO());
          var wasApproved = c.req.status === 'Approved';
          c.req.status = 'Cancelled'; c.req.cancelledBy = u.name; c.req.cancelledOn = nowStr();
          log('Cancelled (was ' + (wasApproved ? 'approved' : 'waiting for approval') + ')', c.req, '');
        }
        save();
        return C.publicView(d, u);
      });
    }
    return {
      handle: handle,
      reset: function () { store.del(KEY); mem = null; },
      people: function () { return load().staff; },
      cat: function (name) { return load().levels.filter(function (l) { return l.level === name; })[0]; }
    };
  })();

  /* ------------------------------ boot ------------------------------ */
  if (S.token) {
    api('bootstrap').then(setData).catch(function (err) {
      var m = String(err && err.message || err);
      S.token = null; store.del(LIVE ? 'token' : 'demo_token');
      render();
      if (m.indexOf('AUTH') !== 0) toast(m === 'Failed to fetch' ? 'Can’t reach the leave server. Check the API_URL in config.js.' : m, true);
    });
  } else render();
})();
