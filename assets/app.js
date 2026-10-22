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
  function catName(st) { if (!st || !st.level) return ''; var lv = S.data && C.level(S.data, st); return lv ? lv.level : st.level; }
  /** Active staff whose category on the Staff tab doesn't match any row on the Categories tab. */
  function badCategories() {
    return S.data.staff.filter(function (st) { return st.active !== false && C.tracksLeave(st) && !C.level(S.data, st); });
  }
  function badCatHtml(list) {
    if (!list.length) return '';
    var names = S.data.levels.map(function (l) { return l.level; });
    return '<div class="covwarn" role="alert"><b>⚠ Check the Staff tab</b>' + list.map(function (st) {
      return '<span><b>' + esc(st.name) + '</b>: the category “' + esc(st.level || '(blank)') + '” isn’t on the Categories tab, so they get no leave allowances.</span>';
    }).join('') + '<span class="muted small">Choose one of: ' + esc(names.join(', ')) + '. Then reload Leave Manager.</span></div>';
  }
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
  function pill(status, r) { return r && r.saving ? '<span class="pill Pending saving">Sending…</span>' : '<span class="pill ' + esc(status) + '">' + esc(status) + '</span>'; }

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
    plus: '<path d="M12 5v14M5 12h14"/>',
    dashboard: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    setup: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function markHTML() { var on = [1, 4, 5]; var s = ''; for (var i = 0; i < 9; i++) s += '<i' + (on.indexOf(i) >= 0 ? ' class="on"' : '') + '></i>'; return '<span class="mark" aria-hidden="true">' + s + '</span>'; }

  /* ------------------------------ state ------------------------------ */
  var VIEWS = ['setup', 'dashboard', 'home', 'wall', 'month', 'year', 'approvals', 'team', 'employees', 'history', 'reports', 'settings'];
  var hashView = (location.hash || '').replace('#', '');
  /* Per-device choices from My settings: light/dark/auto appearance and the page that opens first. */
  function applyTheme(t) {
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  }
  applyTheme(store.get('theme'));
  var S = {
    token: store.get(LIVE ? 'token' : 'demo_token'),
    data: null,
    view: VIEWS.indexOf(hashView) >= 0 ? hashView : (store.get('startView') || store.get('view') || 'home'),
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
  /** Administrators, plus the stand-in approver while active. */
  function isApprover() { return isMgr() || !!(me() && me().standIn); }
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
  /* Android app bridge: present only inside the Leave Manager Android app. */
  var NATIVE = (typeof window.LeaveApp === 'object' && window.LeaveApp) || null;
  function nativeCall(fn, arg) { try { if (NATIVE && typeof NATIVE[fn] === 'function') return arguments.length > 1 ? NATIVE[fn](arg) : NATIVE[fn](); } catch (e) { /* ignore */ } return null; }
  var APK_URL = CFG.APK_URL || 'https://github.com/pian1966/leave-manager/releases/latest/download/LeaveManager.apk';
  var isAndroid = /Android/i.test(navigator.userAgent || '');
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });

  /* The signed-in person's colour (Staff tab, column J) becomes the app's accent colour. */
  function applyAccent(hex) {
    nativeCall('setColour', hex || '');
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
    C.applyStandIn(d, todayISO());
    if (d.user) { var meRow = (d.staff || []).filter(function (x) { return x.id === d.user.id; })[0]; d.user.standIn = !!(meRow && meRow.standIn); }
    var meSt = (d.staff || []).filter(function (s) { return d.user && s.id === d.user.id; })[0];
    applyAccent(S.pickColour || (meSt ? normHex(colourOf(meSt)) : (d.user && d.user.colour) || ''));
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
    var body = Object.assign({}, payload || {}, { action: action, token: S.token });
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
  /** Show a change on screen straight away; returns a function that puts things back if the server says no. */
  function optimistic(mutate) {
    var before = S.data, d = JSON.parse(JSON.stringify(S.data));
    mutate(d);
    setData(d);
    return function undo() { if (S.data) setData(before); };
  }
  function logout(msg) {
    S.token = null; S.data = null; S.pinRequired = false; applyAccent('');
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
      var gOn = googleReady();
      right = '<form id="loginForm" novalidate>' +
        '<h2 style="margin-bottom:6px">Sign in</h2>' +
        (gOn ? '<p class="muted" style="margin:0 0 16px">Use the Google account that matches your email on the staff list.</p>' +
          (NATIVE ? '<button type="button" class="gbtn" data-act="google-native">' + GOOGLE_G + '<span>Sign in with Google</span></button>' : '<div id="g-btn" class="gwrap"></div>') +
          '<div id="g-err"></div><div class="or"><span>or use your email and PIN</span></div>'
          : '<p class="muted" style="margin:0 0 20px">Use your work email and the PIN your leave administrator gave you.</p>') +
        '<label class="field">Work email<input id="l-email" type="email" autocomplete="username" required value="' + esc(store.get('email') || '') + '"></label>' +
        '<label class="field">PIN<input id="l-pin" type="password" inputmode="numeric" autocomplete="current-password" required></label>' +
        '<div id="l-err"></div><button class="btn primary" style="width:100%;padding:11px" type="submit" id="l-go">Sign in</button></form>' +
        (isAndroid && !NATIVE ? '<p class="login-app"><a href="' + esc(APK_URL) + '">Get the Leave Manager app for Android</a></p>' : '');
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
    if (LIVE && googleReady() && !NATIVE) mountGoogleButton();
  }

  /* ------------------------------ Sign in with Google ------------------------------ */
  var GOOGLE_ID = String(CFG.GOOGLE_CLIENT_ID || '').trim();
  var GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
  function googleReady() {
    if (!GOOGLE_ID) return false;
    return !NATIVE || typeof NATIVE.googleSignIn === 'function';
  }
  var gisLoading = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise(function (ok, bad) {
      var sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = ok; sc.onerror = function () { gisLoading = null; bad(new Error('Couldn’t load Google sign-in.')); };
      document.head.appendChild(sc);
    });
    return gisLoading;
  }
  var gisInit = false;
  function mountGoogleButton() {
    loadGis().then(function () {
      var box = document.getElementById('g-btn');
      if (!box) return;
      if (!gisInit) {
        google.accounts.id.initialize({ client_id: GOOGLE_ID, callback: function (resp) { googleLogin(resp.credential); }, ux_mode: 'popup', auto_select: false });
        gisInit = true;
      }
      var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
      google.accounts.id.renderButton(box, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: Math.min(box.clientWidth || 320, 400) });
    }).catch(function (e) { googleError(e.message); });
  }
  function googleError(msg) {
    var box = document.getElementById('g-err');
    if (box) box.innerHTML = '<div class="err" role="alert">' + esc(msg) + '</div>';
    else toast(msg, true);
  }
  function googleLogin(credential) {
    if (!credential) return;
    var box = document.getElementById('g-err'); if (box) box.innerHTML = '<p class="muted small">Signing you in…</p>';
    api('login', { google: credential }).then(function (res) {
      S.token = res.token; store.set('token', res.token); if (res.data && res.data.user) store.set('email', res.data.user.email); setData(res.data);
    }).catch(function (err) {
      googleError(err.message === 'Failed to fetch' ? 'Can’t reach the leave server. Check your connection.' : err.message);
    });
  }
  /* Called by the Android app after its own Google sign-in. */
  window.leaveAppGoogle = function (token) { googleLogin(token); };
  window.leaveAppGoogleError = function (msg) { if (msg) googleError(msg); };

  /* ------------------------------ shell ------------------------------ */
  function navItems() {
    var items = isMgr() ? [['dashboard', 'Dashboard'], ['home', 'Overview']] : [['home', 'Overview']];
    items.push(['wall', 'Wallchart'], ['month', 'Calendar'], ['year', 'Year planner']);
    if (isApprover()) items.push(['approvals', 'Approvals']);
    if (isMgr()) items.push(['team', 'Team balances']);
    if (isMgr()) items.push(['employees', 'Employees']);
    if (isMgr()) items.push(['history', 'History']);
    if (isMgr()) items.push(['setup', 'Setup']);
    items.push(['reports', 'Reports'], ['settings', 'My settings']);
    return items;
  }
  function render() {
    if (!S.data) return renderLogin();
    if (!isApprover() && S.view === 'approvals') S.view = 'home';
    if ((S.view === 'employees' || S.view === 'history' || S.view === 'team' || S.view === 'dashboard' || S.view === 'setup') && !isMgr()) S.view = 'home';
    var v = VIEW_FN[S.view]();
    var u = me(), pend = isApprover() ? pendingForMe().length : 0;
    var nav = navItems().map(function (n) {
      return '<button data-act="nav" data-view="' + n[0] + '"' + (S.view === n[0] ? ' aria-current="page"' : '') + '>' + icon(n[0]) + '<span>' + n[1] + '</span>' +
        (n[0] === 'approvals' && pend ? '<span class="badge">' + pend + '</span>' : '') + '</button>';
    }).join('');
    var formUrl = CFG.FORM_URL || settings().FormURL;
    var guideUrl = CFG.GUIDE_URL || 'https://github.com/pian1966/leave-manager/blob/main/STAFF-GUIDE.md';
    var links = '<a href="' + esc(guideUrl) + '" target="_blank" rel="noopener">Staff guide: how to use Leave Manager ↗</a>' + (isApprover() ? '<a href="' + esc(guideUrl.replace('STAFF-GUIDE', 'ADMIN-GUIDE')) + '" target="_blank" rel="noopener">Administrator guide ↗</a>' : '') + (formUrl ? '<a href="' + esc(formUrl) + '" target="_blank" rel="noopener">Prefer a form? Request via Google Forms ↗</a>' : '') +
      (isMgr() && CFG.SHEET_URL ? '<a href="' + esc(CFG.SHEET_URL) + '" target="_blank" rel="noopener">Open the Google Sheet ↗</a>' : '');
    var brand = '<div class="brand">' + markHTML() + '<div><b>Leave Manager</b><small>' + esc(settings().CompanyName || 'My Team') + '</small></div></div>';
    var tabs = navItems().filter(function (n) { return n[0] !== 'settings' && n[0] !== 'setup' && ((n[0] !== 'year' && n[0] !== 'home') || !isMgr()); });
    app.innerHTML =
      '<div class="shell"><aside class="side">' + brand +
      '<button class="btn primary" data-act="new">' + icon('plus').replace('<svg', '<svg width="16" height="16"') + (takesLeave(u) ? 'Request leave' : 'Book leave') + '</button>' +
      '<nav class="nav" aria-label="Main">' + nav + '</nav>' + (links ? '<div class="side-links">' + links + '</div>' : '') +
      '<div class="me">' + av(u) + '<div class="who"><b>' + esc(u.name) + '</b><span>' + (takesLeave(u) ? esc(catName(u)) + ' · ' + esc(u.role) : 'Administrator') + '</span></div><button data-act="logout-ask">Sign out</button></div></aside>' +
      '<main class="main"><div class="mhead">' + brand + '<div class="controls"><button class="btn primary small" data-act="new">+ ' + (takesLeave(u) ? 'Request' : 'Book') + '</button><button class="btn small icon-btn" data-act="refresh" aria-label="Refresh" title="Get the latest leave">' + icon('refresh') + '</button><button class="btn small icon-btn" data-act="nav" data-view="settings" aria-label="My settings">' + icon('settings') + '</button><button class="btn small" data-act="logout-ask" aria-label="Sign out">' + esc(initials(u.name)) + ' · Out</button></div></div>' +
      (!LIVE ? '<div class="demo-note"><span><b>Demo mode.</b> You’re signed in as ' + esc(u.name) + ' (' + esc(u.role) + '). Connect your Google Sheet in config.js to go live.</span><span class="controls"><button class="btn small" data-act="logout">Switch person</button><button class="btn small ghost" data-act="demo-reset">Reset sample data</button></span></div>' : '') +
      (updateAvailable() && !S.updLater && S.view !== 'settings' ? '<div class="upd-banner" role="status"><span><b>Update available:</b> version ' + esc(S.appLatest.ver) + ' of the Leave Manager app.</span>' +
        '<span class="controls"><a class="btn small primary" href="' + esc(S.appLatest.url) + '">Update</a><button class="btn small ghost" data-act="upd-later">Later</button></span></div>' : '') +
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

  /* ------------------------------ My settings ------------------------------ */
  var SWATCHES = ['#2F6FB3', '#1D4ED8', '#0E7490', '#0F766E', '#2A9D8F', '#4D7C0F', '#15803D', '#B45309',
    '#C2410C', '#B91C1C', '#BE185D', '#B0527A', '#9333EA', '#7C3AED', '#4F46E5', '#475569'];
  function startOptions() { return navItems().filter(function (n) { return n[0] !== 'settings'; }); }
  /* ---------- Choosing your own PIN ---------- */
  function pinProblem(pin) {
    if (!/^\d{4,8}$/.test(pin)) return 'Your PIN must be 4 to 8 digits.';
    if (/^(\d)\1+$/.test(pin)) return 'Don’t use the same digit over and over.';
    if ('0123456789'.indexOf(pin) >= 0 || '9876543210'.indexOf(pin) >= 0) return 'Don’t use digits in order, like 1234.';
    return '';
  }
  function pinFields(prefix) {
    return '<label class="field">New PIN <span class="muted" style="font-weight:400">(4 to 8 digits)</span><input id="' + prefix + '-new" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>' +
      '<label class="field">Type it again<input id="' + prefix + '-again" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>';
  }
  /** Shown straight after signing in with a PIN the Administrator gave out. */
  function pinPrompt(current) {
    S.pinRequired = true; S.pinCurrent = current;
    openModal('<header><div><p class="eyebrow">Welcome, ' + esc(firstName(me().name)) + '</p><h2>Choose your own PIN</h2></div></header>' +
      '<form id="pinFirst" novalidate><p class="muted" style="margin:0 0 14px">You signed in with the PIN the Administrator gave you. Choose a new one that only you know. Please don’t use your bank card PIN.</p>' +
      (current ? '' : '<label class="field">The PIN you were given<input id="pf-cur" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"></label>') +
      pinFields('pf') + '<div id="pf-err"></div>' +
      '<div class="actions"><button type="button" class="btn ghost" data-act="logout">Sign out</button><button type="submit" class="btn primary" id="pf-go">Save my PIN</button></div></form>', 'Choose your own PIN');
  }
  function pinSection() {
    if (!LIVE) return '';
    return '<section class="panel set-block"><h2>Change my PIN</h2><p class="muted">Your PIN is stored scrambled, so nobody can read it, not even the Administrator. If you forget it, the Administrator can give you a new one.</p>' +
      '<form id="pinChange" novalidate><label class="field">Current PIN<input id="pc-cur" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"></label>' +
      pinFields('pc') + '<div id="pc-err"></div><div class="btns"><button type="submit" class="btn primary" id="pc-go">Change PIN</button></div></form></section>';
  }
  function submitPin(prefix, current) {
    var nw = document.getElementById(prefix + '-new').value.trim(), again = document.getElementById(prefix + '-again').value.trim();
    var box = document.getElementById(prefix + '-err'), btn = document.getElementById(prefix + '-go');
    var problem = !current ? 'Type your current PIN.' : pinProblem(nw) || (nw !== again ? 'The two PINs don’t match.' : '') || (nw === current ? 'Choose a PIN that’s different from your current one.' : '');
    if (problem) { box.innerHTML = '<div class="err" role="alert">' + esc(problem) + '</div>'; return; }
    busy(btn, true);
    api('setpin', { current: current, pin: nw }).then(function () {
      S.pinRequired = false; S.pinCurrent = null; closeModal(true);
      toast('Your new PIN is saved. Use it next time you sign in.');
      if (prefix === 'pc') render();
    }).catch(function (err) {
      busy(btn, false);
      var m = String(err && err.message || err);
      if (m.indexOf('AUTH') === 0) { logout(m.replace(/^AUTH:?\s*/, '')); return; }
      box.innerHTML = '<div class="err" role="alert">' + esc(m === 'Failed to fetch' ? 'Can’t reach the leave server. Check your connection.' : m) + '</div>';
    });
  }

  /** Links to the user manuals (they open in the browser, also from the Android app). */
  function helpSection() {
    var staffUrl = CFG.GUIDE_URL || 'https://github.com/pian1966/leave-manager/blob/main/STAFF-GUIDE.md';
    return '<section class="panel set-block"><h2>Help</h2><p class="muted">Step-by-step guides with pictures. They open in your browser.</p>' +
      '<div class="btns"><a class="btn" href="' + esc(staffUrl) + '" target="_blank" rel="noopener">Staff guide ↗</a>' +
      (isApprover() ? '<a class="btn" href="' + esc(staffUrl.replace('STAFF-GUIDE', 'ADMIN-GUIDE')) + '" target="_blank" rel="noopener">Administrator guide ↗</a>' : '') + '</div></section>';
  }
  /** Administrator: switch the automatic staff emails on or off. */
  function setupLink() {
    return isMgr() ? '<section class="panel set-block"><h2>Setup</h2><p class="muted">Staff, categories, leave types, cover rules, holidays and settings, without opening the Google Sheet.</p>' +
      '<div class="btns"><button class="btn primary" data-act="nav" data-view="setup">Open Setup</button></div></section>' : '';
  }
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DEFAULT_REMINDERS = '1 Nov, 1 Dec, 15 Jan';
  function emailSection() {
    if (!isMgr()) return '';
    var set = settings(), weekly = String(set.WeeklyEmail || '').trim(), rem = String(set.ReminderDates || '').trim();
    var day = WEEKDAYS.filter(function (d) { return d.slice(0, 3).toLowerCase() === weekly.slice(0, 3).toLowerCase(); })[0] || 'Monday';
    return '<section class="panel set-block"><h2>Automatic emails</h2><p class="muted">Emails Leave Manager sends to staff by itself. Request and decision emails always go out.</p>' +
      '<label class="toggle"><input type="checkbox" id="em-weekly"' + (weekly ? ' checked' : '') + '><span><b>“Who’s away this week” email to all staff</b>' +
      '<small>Sent about 6am every <select id="em-day" class="btn small"' + (weekly ? '' : ' disabled') + '>' + WEEKDAYS.map(function (d) { return '<option' + (d === day ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></small></span></label>' +
      '<label class="toggle"><input type="checkbox" id="em-rem"' + (rem ? ' checked' : '') + '><span><b>“Use it or lose it” reminders</b>' +
      '<small>To staff with unused leave on ' + esc(rem || DEFAULT_REMINDERS) + ', with a summary for you</small></span></label></section>';
  }
  function saveEmails() {
    var w = document.getElementById('em-weekly'), dsel = document.getElementById('em-day'), r = document.getElementById('em-rem');
    var cur = String(settings().ReminderDates || '').trim();
    var body = { weekly: w.checked ? dsel.value : '', reminders: r.checked ? (cur || DEFAULT_REMINDERS) : '' };
    var msg = (w.checked ? 'Weekly email on (' + dsel.value + 's)' : 'Weekly email off') + ' · ' + (r.checked ? 'reminders on' : 'reminders off');
    call('emails', body, msg).then(render).catch(render);
  }
  /* ---------- Android app: is there a newer version? ---------- */
  var RELEASES_API = CFG.RELEASES_API || 'https://api.github.com/repos/pian1966/leave-manager/releases/latest';
  function verParts(v) { return String(v || '').replace(/^[^\d]*/, '').split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
  function isNewer(a, b) {   // is version a newer than b?
    var x = verParts(a), y = verParts(b);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  }
  /** Asks GitHub for the newest app version (at most once a day unless `force`). Only inside the Android app. */
  function checkAppUpdate(force) {
    if (!NATIVE || typeof NATIVE.version !== 'function') return Promise.resolve(null);
    var mine = nativeCall('version'), last = store.get('updCheck') || {};
    if (!force && last.at && Date.now() - last.at < 864e5) { S.appLatest = last.latest || null; render(); return Promise.resolve(S.appLatest); }
    S.updChecking = true; if (S.view === 'settings') render();
    return fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
      if (!res.ok) throw new Error('GitHub returned ' + res.status);
      return res.json();
    }).then(function (j) {
      var apk = (j.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
      S.appLatest = { ver: String(j.tag_name || '').replace(/^android-v/i, ''), url: apk ? apk.browser_download_url : APK_URL, date: String(j.published_at || '').slice(0, 10) };
      store.set('updCheck', { at: Date.now(), latest: S.appLatest });
      S.updChecking = false; S.updError = null;
      if (force) toast(isNewer(S.appLatest.ver, mine) ? 'Version ' + S.appLatest.ver + ' is available' : 'You have the newest version (' + mine + ')');
      render();
      return S.appLatest;
    }).catch(function () {
      S.updChecking = false; S.updError = 'Couldn’t check for updates. Check your internet connection.';
      if (force) toast(S.updError, true);
      render();
      return null;
    });
  }
  function updateAvailable() {
    return !!(NATIVE && S.appLatest && S.appLatest.ver && isNewer(S.appLatest.ver, nativeCall('version')));
  }
  function appSection() {
    if (NATIVE) {
      var ver = nativeCall('version'), newer = updateAvailable();
      var status = S.updChecking ? '<p class="muted">Checking for a newer version…</p>' :
        newer ? '<p class="upd-yes"><b>Version ' + esc(S.appLatest.ver) + ' is available.</b> Download it, open the file and tap <i>Update</i>. You’ll stay signed in.</p>' :
        S.appLatest ? '<p class="upd-ok">✓ You have the newest version.</p>' :
        S.updError ? '<p class="muted">' + esc(S.updError) + '</p>' : '';
      return '<section class="panel set-block"><h2>Android app</h2><p class="muted">You’re using the Leave Manager Android app' + (ver ? ', version <b>' + esc(ver) + '</b>' : '') +
        '. New features in Leave Manager appear straight away; an app update is only needed now and then.</p>' + status +
        '<div class="btns">' + (newer ? '<a class="btn primary" href="' + esc(S.appLatest.url) + '">Download version ' + esc(S.appLatest.ver) + '</a>' : '') +
        '<button class="btn" data-act="upd-check"' + (S.updChecking ? ' disabled' : '') + '>Check for updates</button></div></section>';
    }
    return '<section class="panel set-block"><h2>Phone app</h2>' +
      '<p class="muted">Put Leave Manager on your phone’s home screen, like any other app.</p>' +
      '<div class="btns">' + (installPrompt ? '<button class="btn primary" data-act="pwa-install">Install on this device</button>' : '') +
      '<a class="btn' + (installPrompt ? '' : ' primary') + '" href="' + esc(APK_URL) + '">Download the Android app</a></div>' +
      '<p class="muted set-help"><b>Android:</b> tap <i>Download the Android app</i>, open the file and tap <i>Install</i>. If asked, allow your browser to install apps.<br>' +
      '<b>iPhone:</b> open this page in Safari, tap the Share button, then <i>Add to Home Screen</i>.</p></section>';
  }
  VIEW_FN.settings = function () {
    var u = me(), mine = staffById(u.id) || u, cur = S.pickColour || colourOf(mine);
    var theme = store.get('theme') || 'auto', start = store.get('startView') || '';
    var sw = SWATCHES.map(function (c) {
      return '<button type="button" class="swatch" style="--c:' + c + '" data-act="pick-colour" data-c="' + c + '" aria-label="Colour ' + c + '" aria-pressed="' + (c.toUpperCase() === String(cur).toUpperCase()) + '"></button>';
    }).join('');
    var changed = S.pickColour && S.pickColour.toUpperCase() !== String(colourOf(mine)).toUpperCase();
    var seg = [['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<label><input type="radio" name="theme" value="' + o[0] + '"' + (theme === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>';
    }).join('');
    var opts = '<option value="">The page I used last</option>' + startOptions().map(function (n) {
      return '<option value="' + n[0] + '"' + (start === n[0] ? ' selected' : '') + '>' + esc(n[1]) + '</option>';
    }).join('');
    return {
      title: 'My settings',
      sub: 'Make Leave Manager yours. Your colour is saved for you everywhere; the other choices are remembered on this device.',
      body:
        '<section class="panel set-block"><h2>My colour</h2>' +
        '<p class="muted">Used for your buttons, the sidebar and your name badge. Other people see it on your badge.</p>' +
        '<div class="set-preview">' + av({ name: u.name, colour: cur }, true) +
        '<button class="btn primary" type="button" tabindex="-1">' + icon('plus').replace('<svg', '<svg width="16" height="16"') + (takesLeave(u) ? 'Request leave' : 'Book leave') + '</button></div>' +
        '<div class="swatches">' + sw + '</div>' +
        '<div class="set-row"><label class="set-custom">Or pick any colour <input type="color" id="set-colour" value="' + esc(String(cur).toLowerCase()) + '"></label>' +
        '<span class="num muted">' + esc(String(cur).toUpperCase()) + '</span></div>' +
        '<div class="btns"><button class="btn primary" data-act="save-colour"' + (changed ? '' : ' disabled') + '>Save my colour</button>' +
        (changed ? '<button class="btn ghost" data-act="undo-colour">Undo</button>' : '') + '</div></section>' +

        '<section class="panel set-block"><h2>Appearance</h2><p class="muted">Light or dark screens on this device.</p>' +
        '<div class="radios" id="set-theme">' + seg + '</div></section>' +

        '<section class="panel set-block"><h2>Start page</h2><p class="muted">The page that opens when you sign in on this device.</p>' +
        '<select id="set-start" class="btn">' + opts + '</select></section>' +
        setupLink() + pinSection() + emailSection() + helpSection() +
        appSection()
    };
  };

  /* ------------------------------ Dashboard (Administrator) ------------------------------ */
  function sickType() { return S.data.types.filter(function (t) { return t.code === 'SL' || /sick/i.test(t.name); })[0]; }
  function unpaidTypes() { return S.data.types.filter(function (t) { return !t.deducts; }); }
  /** Approved working days off per month of leave year y, by leave type: [{ m, label, total, parts: [{t, n}] }]. */
  function monthTotals(y) {
    var rng = C.lyRange(y, CTX.S), out = [], idx = {};
    var d = C.parse(rng.start);
    for (var i = 0; i < 12; i++) {
      var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      idx[key] = out.length; out.push({ key: key, label: MONTHS[d.getMonth()].slice(0, 3), total: 0, by: {} });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
    }
    S.data.requests.forEach(function (r) {
      if (r.status !== 'Approved') return;
      var st = staffById(r.staffId); if (!st || !C.tracksLeave(st)) return;
      (DL[r.id] || C.dayList(r, CTX)).forEach(function (x) {
        var k = idx[x.date.slice(0, 7)]; if (k == null) return;
        out[k].total += x.amt; out[k].by[r.type] = (out[k].by[r.type] || 0) + x.amt;
      });
    });
    return out;
  }
  function monthChart(y) {
    var data = monthTotals(y), max = Math.max.apply(null, data.map(function (m) { return m.total; }).concat([1]));
    var nice = Math.max(4, Math.ceil(max / 4) * 4), W = 640, H = 220, L = 34, B = 26, T = 10, bw = (W - L - 8) / 12;
    var codes = S.data.types.map(function (t) { return t.code; }).filter(function (c) { return data.some(function (m) { return m.by[c]; }); });
    var svg = '<svg class="mchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Days of leave taken per month in ' + esc(lyName(y)) + '">';
    for (var g = 0; g <= 4; g++) {
      var gy = T + (H - T - B) * (1 - g / 4);
      svg += '<line x1="' + L + '" x2="' + (W - 4) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/><text x="' + (L - 6) + '" y="' + (gy + 4) + '" class="ax" text-anchor="end">' + (nice * g / 4) + '</text>';
    }
    data.forEach(function (m, i) {
      var x = L + i * bw + bw * 0.18, w = bw * 0.64, y0 = H - B;
      codes.forEach(function (c) {
        var n = m.by[c]; if (!n) return;
        var h = (H - T - B) * n / nice, t = typeOf(c);
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (y0 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h - 2, 1).toFixed(1) + '" rx="2" fill="' + esc(t.colour) + '"><title>' + esc(m.label + ' · ' + t.name + ': ' + days(n)) + '</title></rect>';
        y0 -= h;
      });
      svg += '<rect x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent"><title>' + esc(m.label + ': ' + days(m.total) + ' off' +
        codes.filter(function (c) { return m.by[c]; }).map(function (c) { return '\n' + typeOf(c).name + ': ' + C.fmtDays(m.by[c]); }).join('')) + '</title></rect>';
      svg += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + m.label + '</text>';
    });
    svg += '</svg>';
    var top = data.slice().sort(function (a, b) { return b.total - a.total; })[0];
    return '<div class="mchart-wrap">' + svg + '</div><div class="legend" style="margin-top:6px">' + codes.map(function (c) { var t = typeOf(c); return '<span class="chip" style="--c:' + esc(t.colour) + '"><span class="dot"></span>' + esc(t.name) + '</span>'; }).join('') + '</div>' +
      (top && top.total ? '<p class="muted small" style="margin:8px 0 0">Busiest month: <b>' + esc(MONTHS[C.parse(top.key + '-01').getMonth()]) + '</b> with ' + days(top.total) + ' of approved leave.</p>' : '<p class="muted small">No approved leave yet this year.</p>');
  }
  /** Sick-leave spells this leave year, with flags for when a doctor's note is usually required in South Africa. */
  function sickStats(y) {
    var t = sickType(); if (!t) return [];
    var rng = C.lyRange(y, CTX.S);
    return sortedStaff().map(function (st) {
      var spells = S.data.requests.filter(function (r) { return r.staffId === st.id && r.type === t.code && r.status === 'Approved' && r.end >= rng.start && r.start <= rng.end; })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      if (!spells.length) return null;
      var total = 0, edge = 0, long = 0, cluster = false, wd = C.staffDays(CTX, st.id);
      spells.forEach(function (r, i) {
        var dl = DL[r.id] || C.dayList(r, CTX);
        total += dl.reduce(function (s2, x) { return s2 + x.amt; }, 0);
        if (dl.length > 2) long++;
        // Next to a day off: the day before the spell or the day after it isn't a working day for this person.
        var before = C.addDays(C.parse(r.start), -1), after = C.addDays(C.parse(r.end), 1);
        if (wd.indexOf(before.getDay()) < 0 || wd.indexOf(after.getDay()) < 0 || CTX.hol[C.iso(before)] || CTX.hol[C.iso(after)]) edge++;
        if (i >= 2 && (C.parse(r.start) - C.parse(spells[i - 2].start)) / 864e5 <= 56) cluster = true;
      });
      return { st: st, spells: spells.length, total: total, edge: edge, long: long, cluster: cluster, last: spells[spells.length - 1] };
    }).filter(Boolean).sort(function (a, b) { return b.total - a.total; });
  }
  VIEW_FN.dashboard = function () {
    var d = S.data, today = todayISO(), y = curLY();
    var pend = pendingForMe();
    var awayToday = offOn(today).filter(function (o) { return o.e.some(function (e) { return e.r.status === 'Approved'; }); });
    // Leave still to take this year, and "use it or lose it".
    var owed = 0, risk = [];
    sortedStaff().forEach(function (st) {
      var m = mainType(st, y); if (m) owed += Math.max(0, m.b.available);
      var items = C.useItOrLoseIt(d, st.id, today);
      if (items.length) risk.push({ st: st, items: items, total: items.reduce(function (a, x) { return a + x.left; }, 0), main: m });
    });
    risk.sort(function (a, b) { return b.total - a.total; });
    var horizon = C.iso(C.addDays(C.parse(today), 56));
    var breaches = C.coverBreaches(d, today, horizon);
    var hasRules = (d.rules || []).some(function (r) { return r.active !== false; });
    var tiles = '<div class="kpis">' +
      '<button class="kpi" data-act="nav" data-view="approvals"><span>Waiting for approval</span><b class="num">' + pend.length + '</b><small>' + (pend.length ? 'Review now →' : 'All caught up') + '</small></button>' +
      '<div class="kpi"><span>Away today</span><b class="num">' + awayToday.length + '</b><small>' + (awayToday.length ? esc(awayToday.map(function (o) { return firstName(o.st.name); }).join(', ')) : 'Everyone in') + '</small></div>' +
      '<div class="kpi"><span>Staff leave still to take</span><b class="num">' + C.fmtDays(owed) + '</b><small>days across the team in ' + esc(lyName(y)) + '</small></div>' +
      '<div class="kpi' + (breaches.length ? ' warn' : '') + '"><span>Cover problems</span><b class="num">' + breaches.length + '</b><small>' + (hasRules ? 'in the next 8 weeks' : 'no cover rules set') + '</small></div></div>';

    var standIn = standInPanel();
    var waiting = '<section class="panel"><h2>Waiting for approval <small>' + (pend.length ? pend.length + ' request' + (pend.length > 1 ? 's' : '') : 'none') + '</small></h2>' +
      (pend.length ? '<div class="list">' + pend.slice(0, 8).map(function (r) {
        var st = staffById(r.staffId), t = typeOf(r.type), w = reqWarnings(r);
        return '<div class="li qd-row"><span class="click" data-act="open-req" data-id="' + esc(r.id) + '">' + av(st) + '</span><div class="grow click" data-act="open-req" data-id="' + esc(r.id) + '"><b>' + esc(st.name) + ' · ' + esc(fmtRange(r)) + '</b><span>' +
          esc(t.name) + ' · ' + reqAmount(r) + (w.length ? ' · <span class="warntxt">⚠ ' + (overWarning(r) ? 'over allowance' : 'cover warning') + '</span>' : '') + '</span></div>' + quickDecide(r) + '</div>';
      }).join('') + (pend.length > 8 ? '<p class="muted small"><a href="#approvals" data-act="nav" data-view="approvals">See all ' + pend.length + ' →</a></p>' : '') + '</div>'
        : '<p class="muted">Nothing is waiting. New requests are emailed to you and show up here.</p>') + '</section>';
    var cover = '<section class="panel"><h2>Cover in the next 8 weeks</h2>' + (!hasRules ? '<p class="muted">No cover rules yet. Add them on the <b>Cover Rules</b> tab of the Google Sheet, e.g. “at least 1 Pastoral Staff on duty every Sunday”.</p>' :
      breaches.length ? '<div class="list">' + breaches.slice(0, 12).map(function (b) {
        return '<div class="li click" data-act="day" data-date="' + b.date + '"><span class="covdot" aria-hidden="true">⚠</span><div class="grow"><b>' + esc(fmtLong(b.date)) + ' · ' + esc(b.rule.name) + '</b><span>' +
          b.onDuty + ' of ' + b.min + ' ' + esc(b.rule.category || 'staff') + ' on duty' + (b.away.length ? ' · away: ' + esc(b.away.join(', ')) : '') + '</span></div></div>';
      }).join('') + (breaches.length > 12 ? '<p class="muted small">…and ' + (breaches.length - 12) + ' more.</p>' : '') + '</div>'
      : '<p class="muted">✓ Every cover rule is met for the next 8 weeks, counting approved and pending leave.</p>') + '</section>';

    var useIt = '<section class="panel"><h2>Use it or lose it <small>unused leave is lost after the date shown</small></h2>' + (risk.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Still to take</th><th>By</th></tr></thead><tbody>' +
      risk.map(function (x) {
        return '<tr><td><div class="person">' + av(x.st) + '<span>' + esc(x.st.name) + '</span></div></td><td>' + x.items.map(function (i) { return '<span class="dot" style="--c:' + esc(i.type.colour) + '"></span> <b class="num">' + C.fmtAmount(i.type, i.left) + '</b> ' + esc(i.type.name); }).join('<br>') + '</td>' +
          '<td>' + x.items.map(function (i) { return esc(fmt(i.until, true)); }).join('<br>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted small" style="margin:10px 0 0">Reminder emails go out automatically on ' + esc(settings().ReminderDates || '1 Nov, 1 Dec, 15 Jan') + '.</p>' : '<p class="muted">Nobody has leave at risk.</p>') + '</section>';

    var sick = sickStats(y), st = sickType();
    var sickHtml = '<section class="panel"><h2>Sick leave patterns <small>' + esc(lyName(y)) + '</small></h2>' + (!sick.length ? '<p class="muted">No sick leave taken this year.</p>' :
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th class="num">Days</th><th class="num">Times</th><th class="num" title="Spells that start or end next to a weekend, day off or public holiday">By a day off</th></tr></thead><tbody>' +
      sick.map(function (x) {
        var flags = [];
        if (x.long) flags.push('<span class="flag">More than 2 days in a row' + (x.long > 1 ? ' (' + x.long + '×)' : '') + '</span>');
        if (x.cluster) flags.push('<span class="flag">3 or more times in 8 weeks</span>');
        if (x.spells >= 3 && x.edge / x.spells >= 0.67) flags.push('<span class="flag soft">Mostly next to weekends</span>');
        return '<tr' + (flags.length ? ' class="hasflags"' : '') + '><td><div class="person">' + av(x.st) + '<span>' + esc(x.st.name) + '</span></div></td><td class="num">' + C.fmtDays(x.total) + (st && C.balances(d, x.st.id, y)[st.code].entitled != null ? ' <span class="muted">/ ' + C.fmtDays(C.balances(d, x.st.id, y)[st.code].entitled) + '</span>' : '') + '</td>' +
          '<td class="num">' + x.spells + '</td><td class="num">' + x.edge + '</td></tr>' +
          (flags.length ? '<tr class="flagrow"><td colspan="4"><div class="flags">' + flags.join(' ') + '</div></td></tr>' : '');
      }).join('') + '</tbody></table></div><p class="muted small" style="margin:10px 0 0">South African law lets an employer ask for a medical certificate when someone is off sick for more than 2 days in a row, or more than twice in 8 weeks. Flags are a prompt to check, not proof of anything.</p>') + '</section>';

    var months = '<section class="panel"><h2>Busiest months <small>approved working days off, ' + esc(lyName(y)) + '</small></h2>' + monthChart(y) + '</section>';
    return {
      title: 'Dashboard',
      sub: esc(fmtLong(today)) + ' · ' + esc(settings().CompanyName || 'Leave Manager'),
      controls: '<button class="btn" data-act="nav" data-view="reports">Reports</button>',
      body: badCatHtml(badCategories()) + tiles + '<div class="dash">' + '<div class="dash-col">' + waiting + cover + useIt + months + '</div><div class="dash-col">' + blockedPanel() + standIn + sickHtml + '</div></div>'
    };
  };



  /* ============================== SETUP (Administrator) ==============================
     Plain-English forms for everything on the Google Sheet. Each save writes to the sheet straight away. */
  var SETUP_TABS = [['church', 'Church'], ['staff', 'Staff'], ['cats', 'Categories'], ['types', 'Leave types'], ['rules', 'Cover rules'], ['dates', 'Holidays & terms'], ['extra', 'Extra days']];
  var WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  var UNITS = [['Days', 'Working days'], ['Calendar days', 'Calendar days (every day, incl. weekends)'], ['Weekends', 'Weekends (each booking counts as 1)'], ['Bookings', 'Bookings (each booking counts as 1)']];
  var COLOURS = ['#2F80C0', '#3A86A8', '#4C9A6A', '#B0527A', '#D1495B', '#E09F3E', '#7B61C9', '#2A9D8F', '#64748B', '#2F6FB3', '#C2410C', '#7C3AED', '#0F766E', '#B45309', '#BE185D', '#4D7C0F'];

  function loadCfg(force) {
    if (S.cfg && !force) return;
    if (S.cfgLoading) return;
    S.cfgLoading = true;
    api('cfg-get').then(function (d) { S.cfgLoading = false; S.cfg = d.cfg; S.cfgError = null; setData(d); })
      .catch(function (e) { S.cfgLoading = false; S.cfgError = String(e && e.message || e); render(); });
  }
  /** Saves one Setup change, then shows the fresh data. Resolves with any extra result (e.g. a new PIN). */
  function saveCfg(what, item, okMsg, btn) {
    if (btn) busy(btn, true);
    return api('cfg-save', { what: what, item: item }).then(function (d) {
      S.cfg = d.cfg; closeModal(true); setData(d); if (okMsg) toast(okMsg);
      return d.result;
    }).catch(function (e) {
      if (btn) busy(btn, false);
      var m = String(e && e.message || e), box = document.getElementById('cf-err');
      if (m.indexOf('AUTH') === 0) { logout(m.replace(/^AUTH:?\s*/, '')); throw e; }
      if (box) box.innerHTML = '<div class="err" role="alert">' + esc(m) + '</div>'; else toast(m, true);
      throw e;
    });
  }

  /* ---------- form building blocks ---------- */
  function fHelp(h) { return h ? '<small class="fhelp">' + esc(h) + '</small>' : ''; }
  function fText(id, label, val, help, type, ph, attrs) {
    return '<label class="field">' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (attrs || '') + '>' + fHelp(help) + '</label>';
  }
  function fSelect(id, label, opts, val, help) {
    return '<label class="field">' + esc(label) + '<select id="' + id + '">' + opts.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' + fHelp(help) + '</label>';
  }
  function fToggle(id, label, on, help) {
    return '<label class="toggle"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span><b>' + esc(label) + '</b>' + (help ? '<small>' + esc(help) + '</small>' : '') + '</span></label>';
  }
  function fDays(id, label, val, help) {
    var on = C.parseDays(val || '', []);
    return '<div class="field"><span>' + esc(label) + '</span><div class="daybox" id="' + id + '">' + WEEK.map(function (w) {
      return '<label><input type="checkbox" value="' + w[0] + '"' + (on.indexOf(w[0]) >= 0 ? ' checked' : '') + '><span>' + w[1] + '</span></label>'; }).join('') + '</div>' + fHelp(help) + '</div>';
  }
  function readDays(id) {
    var box = document.getElementById(id); if (!box) return '';
    var on = Array.prototype.filter.call(box.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return Number(x.value); });
    return WEEK.filter(function (w) { return on.indexOf(w[0]) >= 0; }).map(function (w) { return w[1]; }).join(', ');
  }
  function fColour(id, label, val) {
    val = normHex(val) || COLOURS[0];
    return '<div class="field"><span>' + esc(label) + '</span><div class="swatches sm" id="' + id + '" data-val="' + esc(val) + '">' + COLOURS.map(function (c) {
      return '<button type="button" class="swatch" style="--c:' + c + '" data-act="cf-colour" data-c="' + c + '" aria-label="' + c + '" aria-pressed="' + (c === val) + '"></button>'; }).join('') + '</div></div>';
  }
  function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function gc(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  function cfModal(title, eyebrow, body, saveLabel, extraBtns) {
    openModal('<header><div><p class="eyebrow">' + esc(eyebrow) + '</p><h2>' + esc(title) + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<form id="cfForm" novalidate>' + body + '<div id="cf-err"></div><div class="actions">' + (extraBtns || '') +
      '<button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn primary" id="cf-go">' + esc(saveLabel || 'Save') + '</button></div></form>', title);
  }
  function cfErr(m) { var b = document.getElementById('cf-err'); if (b) b.innerHTML = '<div class="err" role="alert">' + esc(m) + '</div>'; }
  function delBtn(act, id) { return '<button type="button" class="btn bad" data-act="' + act + '" data-id="' + esc(id) + '">Delete</button>'; }
  function onOff(on) { return on ? '' : ' <span class="pill Cancelled">Off</span>'; }

  /* ---------- the page ---------- */
  VIEW_FN.setup = function () {
    loadCfg(false);
    var tab = S.setupTab || 'staff';
    var nav = '<div class="setup-tabs" role="tablist">' + SETUP_TABS.map(function (t) {
      return '<button role="tab" data-act="setup-tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var body;
    if (S.cfgError) body = '<div class="panel"><div class="err">' + esc(S.cfgError) + '</div><p><button class="btn" data-act="setup-reload">Try again</button></p></div>';
    else if (!S.cfg) body = '<div class="panel muted">Loading from the Google Sheet…</div>';
    else body = ({ church: setupChurch, staff: setupStaff, cats: setupCats, types: setupTypes, rules: setupRules, dates: setupDates, extra: setupExtra })[tab]();
    return {
      title: 'Setup',
      sub: 'Change how Leave Manager works, in plain English. Every change is saved to the Google Sheet straight away.',
      controls: '<button class="btn" data-act="setup-reload">Reload from sheet</button>' + (CFG.SHEET_URL ? '<a class="btn" href="' + esc(CFG.SHEET_URL) + '" target="_blank" rel="noopener">Open the sheet ↗</a>' : ''),
      body: nav + '<div class="setup-body">' + body + '</div>'
    };
  };

  /* ---------- Church & settings ---------- */
  function setupChurch() {
    var s = S.cfg.settings;
    return '<section class="panel set-block wide"><h2>Church &amp; settings</h2>' +
      '<form id="cfChurch" novalidate>' +
      fText('cs-name', 'Church name', s.CompanyName, 'Shown at the top of Leave Manager and in emails.') +
      fDays('cs-open', 'Days the church is open', s.OpenDays, 'Other days show as “Closed” on the calendars and are never counted as leave.') +
      '<div class="two">' + fSelect('cs-month', 'Leave year starts in', MONTHS.map(function (m, i) { return [i + 1, m]; }), Number(s.LeaveYearStartMonth) || 1, 'Balances start again in this month.') +
      fText('cs-first', 'First leave year in Leave Manager', s.FirstLeaveYear, 'Unused leave from before this year is never counted.', 'number') + '</div>' +
      fToggle('cs-prorata', 'Reduce allowances for people who start part-way through a year', !/^false$/i.test(String(s.ProRata)), 'e.g. someone starting in July gets about half their staff leave in their first year.') +
      fToggle('cs-neg', 'Let staff ask for more days than they have left', /^true$/i.test(String(s.AllowNegative)), 'Normally off. When on, balances can go below zero.') +
      fToggle('cs-terms', 'Weekends in the school holidays count towards the term that has just ended', !/^false$/i.test(String(s.TermsIncludeHolidays)), 'When off, Weekend Off can only be booked during term dates.') +
      fToggle('cs-auto', 'Update public holidays and school terms automatically', !/^false$/i.test(String(s.AutoUpdateCalendars)), 'On the 1st of each month, next year’s dates are added.') +
      '<div class="two">' + fText('cs-max', 'Highlight days when more people than this are away', s.MaxOffPerDay, 'Shown on the Approvals page. Leave blank for no limit.', 'number') +
      fText('cs-notify', 'Also copy every new request to (optional)', s.NotifyEmail, 'e.g. an HR or office email address.', 'email') + '</div>' +
      fText('cs-url', 'Leave Manager web address', s.AppURL, 'Used for the “Open Leave Manager” link in emails.', 'url', 'https://pian1966.github.io/leave-manager/') +
      fText('cs-cal', 'Google Calendar for approved leave (optional)', s.CalendarId, 'Paste a Google Calendar ID and approved leave is added to it automatically.') +
      '<div class="btns"><button class="btn primary" type="submit" id="cs-go">Save settings</button></div><div id="cf-err"></div></form>' +
      '<p class="muted small">Weekly and reminder emails are switched on or off under <b>My settings → Automatic emails</b>.</p></section>';
  }
  function saveChurch() {
    var item = { CompanyName: gv('cs-name').trim(), OpenDays: readDays('cs-open'), LeaveYearStartMonth: Number(gv('cs-month')), FirstLeaveYear: Number(gv('cs-first')) || '',
      ProRata: gc('cs-prorata') ? 'TRUE' : 'FALSE', AllowNegative: gc('cs-neg') ? 'TRUE' : 'FALSE', TermsIncludeHolidays: gc('cs-terms') ? 'TRUE' : 'FALSE',
      AutoUpdateCalendars: gc('cs-auto') ? 'TRUE' : 'FALSE', MaxOffPerDay: gv('cs-max') === '' ? '' : Number(gv('cs-max')), NotifyEmail: gv('cs-notify').trim(), AppURL: gv('cs-url').trim(), CalendarId: gv('cs-cal').trim() };
    if (!item.CompanyName) return cfErr('Type the church name.');
    if (!item.OpenDays) return cfErr('Tick at least one day the church is open.');
    saveCfg('settings', item, 'Settings saved', document.getElementById('cs-go'));
  }

  /* ---------- Staff ---------- */
  function catOf(name) { return (S.cfg.levels || []).filter(function (l) { return C.catKey(l.name) === C.catKey(name); })[0]; }
  function setupStaff() {
    var list = S.cfg.staff.slice().sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
    var shown = list.filter(function (p) { return p.active || S.showLeft; });
    var left = list.length - list.filter(function (p) { return p.active; }).length;
    return '<section class="panel wide"><div class="setup-head"><h2>Staff <small>' + list.filter(function (p) { return p.active; }).length + ' people</small></h2>' +
      '<button class="btn primary" data-act="cf-staff" data-id="">+ Add staff member</button></div>' +
      '<div class="list">' + shown.map(function (p) {
        var lv = catOf(p.level);
        var pin = p.pin === 'own' ? '<span class="pill Approved">Own PIN</span>' : p.pin === 'given' ? '<span class="pill Pending">Temporary PIN</span>' : '<span class="pill Declined">No PIN</span>';
        return '<div class="li setup-row' + (p.active ? '' : ' off') + '">' + av(p) + '<div class="grow"><b>' + esc(p.name) + (p.role === 'Administrator' ? ' <span class="pill Approved">Administrator</span>' : '') + onOff(p.active) + '</b>' +
          '<span>' + esc(p.level || 'No category') + (lv || p.workDays ? ' · works ' + esc(C.daysLabel(C.parseDays(p.workDays || (lv && lv.workDays) || '', []))) : '') + ' · ' + esc(p.email) + '</span></div>' + pin +
          '<button class="btn small" data-act="cf-staff" data-id="' + esc(p.id) + '">Edit</button></div>';
      }).join('') + '</div>' +
      (left ? '<p style="margin:12px 0 0"><button class="btn small ghost" data-act="cf-showleft">' + (S.showLeft ? 'Hide' : 'Show') + ' ' + left + ' who ha' + (left > 1 ? 've' : 's') + ' left</button></p>' : '') + '</section>';
  }
  function staffModal(id) {
    var p = id ? S.cfg.staff.filter(function (x) { return x.id === id; })[0] : { name: '', email: '', level: (S.cfg.levels[0] || {}).name, workDays: '', role: 'Staff', start: '', colour: '', active: true };
    var cats = S.cfg.levels.map(function (l) { return l.name; });
    var lv = catOf(p.level), own = !!p.workDays;
    var body = fText('sf-name', 'Name', p.name, '', 'text', 'e.g. Thabo Nkosi') +
      fText('sf-email', 'Email', p.email, 'Their Google account if they’ll use Sign in with Google.', 'email') +
      '<div class="two">' + fSelect('sf-level', 'Category', cats, p.level, 'Sets their working days and allowances.') +
      fSelect('sf-role', 'Role', [['Staff', 'Staff'], ['Administrator', 'Administrator (approves leave)']], p.role) + '</div>' +
      '<div class="field"><span>Working days</span><div class="radios"><label><input type="radio" name="sf-wdm" value="cat"' + (own ? '' : ' checked') + '>Same as their category' +
      ' <span id="sf-catdays">' + (lv ? '(' + esc(C.daysLabel(C.parseDays(lv.workDays, []))) + ')' : '') + '</span></label><label><input type="radio" name="sf-wdm" value="own"' + (own ? ' checked' : '') + '>Different days</label></div></div>' +
      '<div id="sf-days-wrap"' + (own ? '' : ' hidden') + '>' + fDays('sf-days', 'Their working days', p.workDays || (lv && lv.workDays) || '', '') + '</div>' +
      fText('sf-start', 'Start date', p.start, 'Used to reduce their first year’s allowance, and for Sabbatical.', 'date') +
      fColour('sf-colour', 'Colour', p.colour || COLOURS[(S.cfg.staff.length) % COLOURS.length]) +
      (id ? fToggle('sf-active', 'Still on the staff', p.active !== false, 'Untick when someone leaves. They can’t sign in any more, but their history is kept.') : '') +
      (id ? '<div class="field"><span>PIN</span><div class="pinline">' + (p.pin === 'own' ? 'They’ve chosen their own PIN.' : p.pin === 'given' ? 'They still have a temporary PIN.' : 'No PIN yet.') +
        ' <button type="button" class="btn small" data-act="cf-pin" data-id="' + esc(p.id) + '">Give a new temporary PIN</button></div></div>' : '<p class="muted small">A temporary PIN is created for them; you’ll see it after saving.</p>');
    cfModal(id ? 'Edit ' + p.name : 'Add a staff member', 'Staff', body, id ? 'Save' : 'Add staff member');
    S.cfEdit = { kind: 'staff', id: id || '' };
  }
  function saveStaff() {
    var own = (modalRoot.querySelector('input[name="sf-wdm"]:checked') || {}).value === 'own';
    var item = { id: S.cfEdit.id, name: gv('sf-name').trim(), email: gv('sf-email').trim(), level: gv('sf-level'), role: gv('sf-role'),
      workDays: own ? readDays('sf-days') : '', start: gv('sf-start'), colour: (document.getElementById('sf-colour') || {}).dataset ? document.getElementById('sf-colour').dataset.val : '',
      active: S.cfEdit.id ? gc('sf-active') : true };
    if (!item.name) return cfErr('Type their name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.email)) return cfErr('Type a valid email address.');
    if (own && !item.workDays) return cfErr('Tick at least one working day, or choose “Same as their category”.');
    saveCfg('staff', item, item.id ? 'Saved ' + item.name : null, document.getElementById('cf-go')).then(function (res) { if (res && res.pin) pinCard(res.name, res.pin, true); });
  }
  function pinCard(name, pin, isNew) {
    var url = settings().AppURL || CFG.APP_URL || location.href.split('#')[0];
    var msg = 'Hi ' + firstName(name) + ', ' + (isNew ? 'you’ve been added to Leave Manager. ' : '') + 'Your temporary PIN is ' + pin + '. Sign in at ' + url + ' with your email and this PIN, then choose your own PIN.';
    openModal('<header><div><p class="eyebrow">' + (isNew ? 'Staff member added' : 'New temporary PIN') + '</p><h2>' + esc(name) + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<p>Their temporary PIN is</p><p class="bigpin">' + esc(pin) + '</p><p class="muted small">Give it to them in person, or copy this message:</p>' +
      '<textarea class="pinmsg" rows="4" readonly>' + esc(msg) + '</textarea>' +
      '<div class="actions"><button class="btn" data-act="cf-copy">Copy message</button><button class="btn primary" data-act="close">Done</button></div>', 'PIN');
  }

  /* ---------- Categories ---------- */
  function typeUnitWord(t) { return /weekend/i.test(t.unit) ? 'weekends' : /booking/i.test(t.unit) ? 'bookings' : /calendar/i.test(t.unit) ? 'calendar days' : 'days'; }
  function setupCats() {
    var types = S.cfg.types.filter(function (t) { return t.active && t.deducts; });
    return '<section class="panel wide"><div class="setup-head"><h2>Categories <small>working days and allowances per year</small></h2>' +
      '<button class="btn primary" data-act="cf-cat" data-id="">+ Add category</button></div><div class="cards">' +
      S.cfg.levels.map(function (l) {
        var n = S.cfg.staff.filter(function (p) { return p.active && C.catKey(p.level) === C.catKey(l.name); }).length;
        var admin = !C.tracksLeave({ level: l.name });
        var ents = admin ? '<span class="muted">Approves leave; doesn’t take leave in Leave Manager.</span>' : types.map(function (t) {
          var v = l.ent[t.code];
          return v === '' || v == null ? '' : '<span class="chip" style="--c:' + esc(t.colour) + '"><span class="dot"></span>' + esc(t.name) + ': <b>' + C.fmtDays(Number(v)) + '</b> ' + typeUnitWord(t) + '</span>';
        }).join('') || '<span class="muted">No allowances yet.</span>';
        return '<article class="cat-card"><header><b>' + esc(l.name) + '</b><span class="muted small">' + n + ' staff · works ' + esc(C.daysLabel(C.parseDays(l.workDays, []))) + '</span></header>' +
          '<div class="chips">' + ents + '</div><div class="btns"><button class="btn small" data-act="cf-cat" data-id="' + esc(l.name) + '">Edit</button></div></article>';
      }).join('') + '</div><p class="muted small" style="margin-top:12px">Leave types that don’t use an allowance (e.g. Unpaid Leave) are available to everyone.</p></section>';
  }
  function catModal(name) {
    var l = name ? catOf(name) : { name: '', workDays: 'Mon, Wed, Thu, Fri', ent: {} };
    var admin = name && !C.tracksLeave({ level: l.name });
    var types = S.cfg.types.filter(function (t) { return t.active && t.deducts; });
    var body = fText('cf-cname', 'Name', l.name, admin ? 'This category is for the people who approve leave.' : 'e.g. Pastoral Staff, Part-Time Support Staff', 'text', '', admin ? ' readonly' : '') +
      fDays('cf-cdays', 'Usual working days', l.workDays, 'People in this category work these days. You can change them for one person under Staff.') +
      (admin ? '' : '<div class="field"><span>Allowances per leave year</span><div class="ents">' + types.map(function (t) {
        var v = l.ent[t.code];
        return '<label class="ent"><span class="dot" style="--c:' + esc(t.colour) + '"></span><span class="grow">' + esc(t.name) + '</span>' +
          '<input type="number" min="0" step="0.5" data-code="' + esc(t.code) + '" value="' + esc(v == null ? '' : v) + '" placeholder="–"><small>' + typeUnitWord(t) + '</small></label>';
      }).join('') + '</div>' + fHelp('Leave a box empty if this category doesn’t get that type of leave.') + '</div>');
    var n = name ? S.cfg.staff.filter(function (p) { return C.catKey(p.level) === C.catKey(name); }).length : 0;
    cfModal(name ? 'Edit ' + name : 'Add a category', 'Category', body, name ? 'Save' : 'Add category', name && !admin ? (n ? '' : delBtn('cf-cat-del', name)) : '');
    S.cfEdit = { kind: 'cat', id: name || '' };
  }
  function saveCat() {
    var ent = {};
    Array.prototype.forEach.call(modalRoot.querySelectorAll('.ents input[data-code]'), function (x) { ent[x.dataset.code] = x.value === '' ? '' : Number(x.value); });
    var item = { oldName: S.cfEdit.id, name: gv('cf-cname').trim(), workDays: readDays('cf-cdays'), ent: ent };
    if (!item.name) return cfErr('Give the category a name.');
    if (!item.workDays) return cfErr('Tick at least one working day.');
    saveCfg('category', item, 'Saved ' + item.name, document.getElementById('cf-go'));
  }

  /* ---------- Leave types ---------- */
  function setupTypes() {
    return '<section class="panel wide"><div class="setup-head"><h2>Leave types</h2><button class="btn primary" data-act="cf-type" data-id="">+ Add leave type</button></div>' +
      '<p class="muted small" style="margin:0 0 10px">Switch off any type you don’t use yet (e.g. Sick Leave). It disappears from requests, balances, calendars, reports and the Google Form. Existing records are kept.</p>' +
      '<div class="list">' + S.cfg.types.map(function (t) {
        return '<div class="li setup-row' + (t.active ? '' : ' off') + '"><span class="dot big" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(t.name) + ' <span class="muted small">' + esc(t.code) + '</span>' + onOff(t.active) + '</b>' +
          '<span>' + esc(typeDesc(t).split('\n')[1] || '') + '</span></div>' +
          '<label class="sw" title="In use"><input type="checkbox" data-type-toggle="' + esc(t.code) + '"' + (t.active ? ' checked' : '') + ' aria-label="' + esc(t.name) + ' in use"><span></span></label>' +
          '<button class="btn small" data-act="cf-type" data-id="' + esc(t.code) + '">Edit</button></div>';
      }).join('') + '</div></section>';
  }
  function typeModal(code) {
    var t = code ? S.cfg.types.filter(function (x) { return x.code === code; })[0] :
      { code: '', name: '', colour: COLOURS[S.cfg.types.length % COLOURS.length], deducts: true, halfDay: true, proRata: false, needsApproval: true, unit: 'Days', allowedDays: '', accumulates: false, perTerm: '', maxBalance: '', useBy: '', active: true };
    var body = '<div class="two">' + fText('tf-name', 'Name', t.name, '', 'text', 'e.g. Family Responsibility Leave') +
      fText('tf-code', 'Short code', t.code, code ? 'Can’t be changed.' : '1–6 letters, used on the sheet, e.g. FRL.', 'text', 'FRL', code ? ' readonly' : ' maxlength="6"') + '</div>' +
      fColour('tf-colour', 'Colour on calendars', t.colour) +
      fSelect('tf-unit', 'How it’s counted', UNITS, t.unit || 'Days') +
      fToggle('tf-active', 'In use', t.active, 'Untick to hide this leave type everywhere.') +
      fToggle('tf-deducts', 'Uses an allowance', t.deducts, 'Set how many days each category gets under Categories. Untick for e.g. Unpaid Leave.') +
      fToggle('tf-approve', 'Needs the Administrator’s approval', t.needsApproval !== false, '') +
      fToggle('tf-half', 'Half days allowed', t.halfDay, '') +
      fToggle('tf-prorata', 'Reduce for people who start part-way through a year', t.proRata, '') +
      fToggle('tf-acc', 'Unused days build up from year to year', t.accumulates, 'e.g. Sabbatical.') +
      '<div class="two">' + fText('tf-max', 'Most that can build up', t.maxBalance, 'Only for leave that builds up. Blank = no limit.', 'number') +
      fText('tf-term', 'Most bookings per school term', t.perTerm, 'e.g. 1 for Weekend Off. Blank = no limit.', 'number') + '</div>' +
      fText('tf-useby', 'Unused days can still be taken until (next year)', t.useBy, 'e.g. 1 Feb. Blank = unused days are lost at the end of the leave year.', 'text', '1 Feb') +
      fDays('tf-days', 'Only on these days (optional)', t.allowedDays, 'Leave all unticked to allow any working day. Weekend Off uses Fri, Sat, Sun.');
    cfModal(code ? 'Edit ' + t.name : 'Add a leave type', 'Leave type', body, code ? 'Save' : 'Add leave type');
    S.cfEdit = { kind: 'type', id: code || '' };
  }
  function saveType(itemOverride) {
    var item = itemOverride || { isNew: !S.cfEdit.id, code: gv('tf-code').trim().toUpperCase(), name: gv('tf-name').trim(), colour: document.getElementById('tf-colour').dataset.val,
      unit: gv('tf-unit'), active: gc('tf-active'), deducts: gc('tf-deducts'), needsApproval: gc('tf-approve'), halfDay: gc('tf-half'), proRata: gc('tf-prorata'),
      accumulates: gc('tf-acc'), maxBalance: gv('tf-max'), perTerm: gv('tf-term'), useBy: gv('tf-useby').trim(), allowedDays: readDays('tf-days') };
    if (!itemOverride) {
      if (!item.name) return cfErr('Give the leave type a name.');
      if (!/^[A-Z][A-Z0-9]{0,5}$/.test(item.code)) return cfErr('The short code must be 1–6 letters, e.g. FRL.');
      if (item.useBy && !C.parseMonthDay(item.useBy)) return cfErr('Type the date like “1 Feb”, or leave it blank.');
    }
    return saveCfg('type', item, itemOverride ? (item.active ? item.name + ' switched on' : item.name + ' switched off') : 'Saved ' + item.name, itemOverride ? null : document.getElementById('cf-go'));
  }

  /* ---------- Cover rules ---------- */
  function setupRules() {
    var rules = S.data.rules || [], mins = rules.filter(function (r) { return C.isMinRule(r); });
    return '<section class="panel wide"><div class="setup-head"><h2>People on duty</h2><button class="btn primary" data-act="cf-min" data-id="">+ Add rule</button></div>' +
      '<p class="muted small" style="margin:0 0 10px">Make sure enough people are working, e.g. at least one pastor every Sunday.</p>' +
      (mins.length ? '<div class="list">' + mins.map(function (r) {
        var on = r.active !== false;
        return '<div class="li setup-row' + (on ? '' : ' off') + '"><span class="blk-ico" aria-hidden="true">👥</span><div class="grow"><b>' + esc(r.name) + onOff(on) + '</b><span>At least ' + (Number(r.min) || 1) + ' ' +
          esc(r.category || 'staff') + ' on ' + esc(r.days ? C.daysLabel(C.parseDays(r.days, [])) : 'every day') + (r.from ? ' · ' + esc(ruleWhen(r)) : '') + ' · ' + (/warn/i.test(r.action) ? 'warning only' : 'blocked') + '</span></div>' +
          '<label class="sw"><input type="checkbox" data-rule-toggle="' + esc(r.id || '') + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(r.name) + ' on or off"><span></span></label>' +
          '<button class="btn small" data-act="cf-min" data-id="' + esc(r.id || '') + '">Edit</button></div>';
      }).join('') + '</div>' : '<p class="muted">No rules yet.</p>') + '</section>' +
      blockedPanel();
  }
  function minModal(id) {
    var r = id ? (S.data.rules || []).filter(function (x) { return x.id === id; })[0] : { name: 'Sunday cover', category: '', days: 'Sun', min: 1, action: 'Warn', message: '', active: true };
    var cats = String(r.category || '').split(',').map(function (x) { return C.catKey(x); }).filter(String);
    var levels = S.cfg.levels.filter(function (l) { return C.tracksLeave({ level: l.name }); });
    var body = fText('mf-name', 'Name', r.name, '', 'text', 'e.g. Sunday cover') +
      '<div class="field"><span>Who must be on duty</span><div class="rb-cats">' + levels.map(function (l) {
        return '<label class="chk"><input type="checkbox" name="mf-cat" value="' + esc(l.name) + '"' + (cats.indexOf(C.catKey(l.name)) >= 0 ? ' checked' : '') + '>' + esc(l.name) + '</label>'; }).join('') + '</div>' +
      fHelp('Leave all unticked to count all staff.') + '</div>' +
      fDays('mf-days', 'On these days', r.days, 'Leave all unticked for every day.') +
      fText('mf-min', 'At least this many people', r.min || 1, '', 'number', '1', ' min="1"') +
      '<div class="field"><span>If a request would break the rule</span><div class="radios"><label><input type="radio" name="mf-act" value="Warn"' + (/block/i.test(r.action) ? '' : ' checked') + '>Allow it, with a warning</label><label><input type="radio" name="mf-act" value="Block"' + (/block/i.test(r.action) ? ' checked' : '') + '>Block the request</label></div></div>' +
      fText('mf-msg', 'Message (optional, shown to staff)', r.message, '', 'text', 'e.g. At least one pastor must be on duty every Sunday.');
    cfModal(id ? 'Edit ' + r.name : 'Add a rule', 'People on duty', body, id ? 'Save' : 'Add rule', id ? delBtn('blk-del', id) : '');
    S.cfEdit = { kind: 'min', id: id || '', active: r.active !== false };
  }
  function saveMin() {
    var cats = Array.prototype.map.call(modalRoot.querySelectorAll('input[name="mf-cat"]:checked'), function (x) { return x.value; });
    var item = { id: S.cfEdit.id, kind: 'Minimum on duty', name: gv('mf-name').trim(), category: cats.join(', '), days: readDays('mf-days'), min: Number(gv('mf-min')) || 1,
      ruleAction: (modalRoot.querySelector('input[name="mf-act"]:checked') || {}).value || 'Warn', message: gv('mf-msg').trim(), active: S.cfEdit.active };
    if (!item.name) return cfErr('Give the rule a name, e.g. Sunday cover.');
    var btn = document.getElementById('cf-go'); busy(btn, true);
    call('rule-save', item, 'Saved ' + item.name).then(function () { closeModal(true); }).catch(function () { busy(btn, false); });
  }

  /* ---------- Holidays & terms ---------- */
  function setupDates() {
    var y = new Date().getFullYear(), yr = S.holYear || y;
    var hols = S.cfg.holidays.filter(function (h) { return h.date.slice(0, 4) === String(yr); });
    var years = {}; S.cfg.holidays.forEach(function (h) { years[h.date.slice(0, 4)] = 1; });
    var terms = S.cfg.terms.filter(function (t) { return Number(t.end.slice(0, 4)) >= y - 1; });
    return '<div class="dash"><section class="panel"><div class="setup-head"><h2>Public holidays</h2><button class="btn primary" data-act="cf-hol" data-id="">+ Add</button></div>' +
      '<div class="seg" style="margin-bottom:10px">' + Object.keys(years).sort().filter(function (k) { return Number(k) >= y - 1; }).map(function (k) {
        return '<button data-act="cf-holyear" data-y="' + k + '"' + (String(yr) === k ? ' aria-current="true" class="on"' : '') + '>' + k + '</button>'; }).join('') + '</div>' +
      '<div class="list">' + (hols.map(function (h) {
        return '<div class="li setup-row"><div class="grow"><b>' + esc(h.name) + '</b><span>' + esc(fmtLong(h.date)) + '</span></div><button class="btn small" data-act="cf-hol" data-id="' + esc(h.date) + '">Edit</button></div>';
      }).join('') || '<p class="muted">None for ' + yr + '.</p>') + '</div><p class="muted small" style="margin-top:10px">South African public holidays are added automatically each year. Add your own here, e.g. a local holiday.</p></section>' +
      '<section class="panel"><div class="setup-head"><h2>School terms</h2><button class="btn primary" data-act="cf-term" data-id="">+ Add</button></div><div class="list">' +
      (terms.map(function (t) {
        return '<div class="li setup-row"><div class="grow"><b>' + esc(t.name) + '</b><span>' + esc(fmtRange({ start: t.start, end: t.end })) + '</span></div><button class="btn small" data-act="cf-term" data-id="' + esc(t.name) + '">Edit</button></div>';
      }).join('') || '<p class="muted">No terms yet.</p>') + '</div><p class="muted small" style="margin-top:10px">Used for “one Weekend Off per term”. Filled in automatically from the official school calendar.</p></section></div>';
  }
  function holModal(date) {
    var h = date ? S.cfg.holidays.filter(function (x) { return x.date === date; })[0] : { date: '', name: '' };
    cfModal(date ? 'Edit holiday' : 'Add a holiday', 'Public holiday', fText('hf-name', 'Name', h.name, '', 'text', 'e.g. Church anniversary') + fText('hf-date', 'Date', h.date, '', 'date'), 'Save', date ? delBtn('cf-hol-del', date) : '');
    S.cfEdit = { kind: 'hol', id: date || '' };
  }
  function termModal(name) {
    var t = name ? S.cfg.terms.filter(function (x) { return x.name === name; })[0] : { name: '', start: '', end: '' };
    cfModal(name ? 'Edit ' + t.name : 'Add a school term', 'School term', fText('tm-name', 'Name', t.name, 'e.g. Term 1 2027', 'text', 'Term 1 2027') +
      '<div class="two">' + fText('tm-start', 'First day', t.start, '', 'date', '', ' data-follow="tm-end"') + fText('tm-end', 'Last day', t.end, '', 'date') + '</div>', 'Save', name ? delBtn('cf-term-del', name) : '');
    S.cfEdit = { kind: 'term', id: name || '' };
  }

  /* ---------- Extra days (adjustments) ---------- */
  function setupExtra() {
    var list = (S.cfg.adjustments || []).slice().sort(function (a, b) { return b.year - a.year; });
    return '<section class="panel wide"><div class="setup-head"><h2>Extra days <small>add or take away days for one person in one year</small></h2>' +
      '<button class="btn primary" data-act="cf-adj" data-id="">+ Add</button></div>' +
      '<p class="muted small" style="margin:0 0 10px">e.g. 2 extra days for long service, or −5 days already taken before Leave Manager started.</p>' +
      '<div class="list">' + (list.map(function (a) {
        var p = S.cfg.staff.filter(function (x) { return x.id === a.staffId; })[0] || { name: a.staffId }, t = S.cfg.types.filter(function (x) { return x.code === a.type; })[0] || { name: a.type };
        return '<div class="li setup-row"><div class="grow"><b>' + esc(p.name) + ': ' + (a.days > 0 ? '+' : '') + C.fmtDays(a.days) + ' ' + esc(t.name) + '</b><span>' + esc(lyName(a.year)) + (a.note ? ' · ' + esc(a.note) : '') + '</span></div>' +
          '<button class="btn small" data-act="cf-adj" data-id="' + esc(a.id || '') + '">Edit</button></div>';
      }).join('') || '<p class="muted">None yet.</p>') + '</div></section>';
  }
  function adjModal(id) {
    var a = id ? S.cfg.adjustments.filter(function (x) { return x.id === id; })[0] : { staffId: '', year: curLY(), type: '', days: '', note: '' };
    var people = S.cfg.staff.filter(function (p) { return p.active && C.tracksLeave({ level: p.level }); }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    var types = S.cfg.types.filter(function (t) { return t.active && t.deducts; });
    var body = fSelect('af-staff', 'Staff member', people.map(function (p) { return [p.id, p.name]; }), a.staffId) +
      '<div class="two">' + fSelect('af-type', 'Leave type', types.map(function (t) { return [t.code, t.name]; }), a.type) +
      fSelect('af-year', 'Leave year', [curLY() - 1, curLY(), curLY() + 1].map(function (y) { return [y, lyName(y)]; }), a.year) + '</div>' +
      fText('af-days', 'Days', a.days, 'Use a minus sign to take days away, e.g. -5. Half days like 1.5 are fine.', 'number', '2', ' step="0.5"') +
      fText('af-note', 'Note', a.note, '', 'text', 'e.g. Long service');
    cfModal(id ? 'Edit extra days' : 'Add extra days', 'Extra days', body, 'Save', id ? delBtn('cf-adj-del', id) : '');
    S.cfEdit = { kind: 'adj', id: id || '' };
  }

  /* ---------- events for Setup ---------- */
  function setupClick(a, el) {
    switch (a) {
      case 'setup-tab': S.setupTab = el.dataset.tab; render(); return true;
      case 'setup-reload': S.cfg = null; S.cfgError = null; loadCfg(true); render(); return true;
      case 'cf-showleft': S.showLeft = !S.showLeft; render(); return true;
      case 'cf-staff': staffModal(el.dataset.id); return true;
      case 'cf-cat': catModal(el.dataset.id); return true;
      case 'cf-type': typeModal(el.dataset.id); return true;
      case 'cf-min': minModal(el.dataset.id); return true;
      case 'cf-hol': holModal(el.dataset.id); return true;
      case 'cf-term': termModal(el.dataset.id); return true;
      case 'cf-adj': adjModal(el.dataset.id); return true;
      case 'cf-holyear': S.holYear = Number(el.dataset.y); render(); return true;
      case 'cf-colour': {
        var box = el.closest('.swatches'); box.dataset.val = el.dataset.c;
        Array.prototype.forEach.call(box.querySelectorAll('.swatch'), function (b) { b.setAttribute('aria-pressed', String(b === el)); });
        return true;
      }
      case 'cf-pin': {
        var who = S.cfg.staff.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = 'Yes – their current PIN will stop working'; el.classList.add('primary'); return true; }
        saveCfg('pin', { id: el.dataset.id }, null, el).then(function (r) { if (r) pinCard(r.name || who.name, r.pin, false); });
        return true;
      }
      case 'cf-copy': {
        var ta = modalRoot.querySelector('.pinmsg');
        if (ta) { ta.select(); try { navigator.clipboard.writeText(ta.value).then(function () { toast('Copied'); }, function () { document.execCommand('copy'); toast('Copied'); }); } catch (e) { document.execCommand('copy'); toast('Copied'); } }
        return true;
      }
      case 'cf-cat-del': case 'cf-hol-del': case 'cf-term-del': case 'cf-adj-del': {
        if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = 'Yes, delete'; el.classList.add('primary'); return true; }
        var what = { 'cf-cat-del': 'category-delete', 'cf-hol-del': 'holiday-delete', 'cf-term-del': 'term-delete', 'cf-adj-del': 'adjustment-delete' }[a];
        var item = a === 'cf-cat-del' ? { name: el.dataset.id } : a === 'cf-hol-del' ? { date: el.dataset.id } : a === 'cf-term-del' ? { name: el.dataset.id } : { id: el.dataset.id };
        saveCfg(what, item, 'Deleted', el);
        return true;
      }
    }
    return false;
  }
  function setupSubmit(form) {
    if (form.id === 'cfChurch') { saveChurch(); return true; }
    if (form.id !== 'cfForm' || !S.cfEdit) return false;
    var k = S.cfEdit.kind;
    if (k === 'staff') saveStaff();
    else if (k === 'cat') saveCat();
    else if (k === 'type') saveType();
    else if (k === 'min') saveMin();
    else if (k === 'hol') {
      var hn = gv('hf-name').trim(), hd = gv('hf-date');
      if (!hn || !hd) return cfErr('Give the holiday a name and a date.'), true;
      saveCfg('holiday', { name: hn, date: hd, oldDate: S.cfEdit.id }, 'Saved ' + hn, document.getElementById('cf-go'));
    } else if (k === 'term') {
      var tn = gv('tm-name').trim(), ts = gv('tm-start'), te = gv('tm-end');
      if (!tn || !ts || !te) return cfErr('Give the term a name, first day and last day.'), true;
      if (te < ts) return cfErr('The last day is before the first day.'), true;
      saveCfg('term', { name: tn, start: ts, end: te, oldName: S.cfEdit.id }, 'Saved ' + tn, document.getElementById('cf-go'));
    } else if (k === 'adj') {
      var days = Number(gv('af-days'));
      if (!days) return cfErr('Type the number of days (use a minus sign to take days away).'), true;
      saveCfg('adjustment', { id: S.cfEdit.id, staffId: gv('af-staff'), type: gv('af-type'), year: Number(gv('af-year')), days: days, note: gv('af-note').trim() }, 'Saved', document.getElementById('cf-go'));
    }
    return true;
  }
  function setupChange(t) {
    if (t.name === 'sf-wdm') { var w = document.getElementById('sf-days-wrap'); if (w) w.hidden = t.value !== 'own'; return true; }
    if (t.id === 'sf-level') {
      var lv = catOf(t.value), lab = document.getElementById('sf-catdays');
      if (lab) lab.textContent = lv ? '(' + C.daysLabel(C.parseDays(lv.workDays, [])) + ')' : '';
      if ((modalRoot.querySelector('input[name="sf-wdm"]:checked') || {}).value !== 'own' && lv) {   // keep the day boxes in step until they choose their own
        var box = document.getElementById('sf-days'), on = C.parseDays(lv.workDays, []);
        if (box) Array.prototype.forEach.call(box.querySelectorAll('input'), function (x) { x.checked = on.indexOf(Number(x.value)) >= 0; });
      }
      return true;
    }
    if (t.dataset && t.dataset.typeToggle) {
      var ty = S.cfg.types.filter(function (x) { return x.code === t.dataset.typeToggle; })[0];
      if (ty) saveType(Object.assign({}, ty, { active: t.checked })).catch(function () { t.checked = !t.checked; });
      return true;
    }
    return false;
  }

  /* ---------- Blocked days ("No leave" cover rules) ---------- */
  var MONTH3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var EASTER_NAMES = { '-7': 'Palm Sunday', '-3': 'Maundy Thursday', '-2': 'Good Friday', '-1': 'Holy Saturday', '0': 'Easter Sunday', '1': 'Family Day (Easter Monday)' };
  function easterLabel(n) { return EASTER_NAMES[String(n)] || (n < 0 ? (-n) + ' days before Easter' : n + ' days after Easter'); }
  function specKind(v) { v = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'once' : /^easter/i.test(v) ? 'easter' : 'yearly'; }
  function easterN(v) { var m = /^easter\s*([+-]\s*\d+)?$/i.exec(String(v || '').trim()); return m && m[1] ? Number(m[1].replace(/\s/g, '')) : 0; }
  function specText(v) {
    var k = specKind(v);
    if (k === 'once') return fmt(v, true);
    if (k === 'easter') return easterLabel(easterN(v));
    var md = C.parseMonthDay(v); return md ? md[1] + ' ' + MONTH3[md[0] - 1] : String(v);
  }
  function ruleWhen(rule) {
    var k = specKind(rule.from), same = !rule.to || rule.to === rule.from;
    var txt = specText(rule.from) + (same ? '' : ' – ' + specText(rule.to));
    return txt + (k === 'once' ? '' : ', every year');
  }
  function ruleWho(rule) { return rule.category ? rule.category : 'All staff'; }
  function blockedRules() { return (S.data.rules || []).filter(function (r) { return r.kind && !C.isMinRule(r); }); }
  function blockedPanel() {
    var list = blockedRules(), today = todayISO();
    return '<section class="panel" id="blocked"><h2>Blocked days <small>no leave on these days</small></h2>' +
      (list.length ? '<div class="list">' + list.map(function (r) {
        var nx = C.nextOccurrence(r, today), on = r.active !== false, warn = /warn/i.test(r.action);
        return '<div class="li blk-row' + (on ? '' : ' off') + '"><span class="blk-ico" aria-hidden="true">' + (warn ? '⚠' : '⛔') + '</span>' +
          '<div class="grow"><b>' + esc(r.name || 'Blocked days') + '</b><span>' + esc(ruleWhen(r)) + ' · ' + esc(ruleWho(r)) + ' · ' + (warn ? 'warning only' : 'blocked') +
          (on && nx ? '<br>Next: ' + esc(fmtRange({ start: nx.start, end: nx.end })) : '') + (on ? '' : '<br><i>Switched off</i>') + '</span></div>' +
          '<span class="qd"><label class="sw" title="' + (on ? 'Switch off' : 'Switch on') + '"><input type="checkbox" aria-label="' + esc((r.name || 'Blocked days') + ' on or off') + '" data-rule-toggle="' + esc(r.id || '') + '"' + (on ? ' checked' : '') + (r.id ? '' : ' disabled') + '><span></span></label>' +
          (r.id ? '<button class="btn small" data-act="blk-edit" data-id="' + esc(r.id) + '">Edit</button>' : '') + '</span></div>';
      }).join('') + '</div>' : '<p class="muted">No blocked days yet. Add Christmas, Easter or special church events so nobody books leave then.</p>') +
      '<div class="btns" style="margin-top:12px"><button class="btn primary" data-act="blk-new">+ Add blocked days</button></div>' +
      '<p class="muted small" style="margin:10px 0 0">Staff see blocked days on the calendars. <b>Blocked</b> stops them sending a request; <b>warning only</b> lets it through with a warning to you. You can always book leave yourself.</p></section>';
  }
  function dmSelects(prefix, v) {
    var md = C.parseMonthDay(v) || [12, 25], d = '', m = '';
    for (var i = 1; i <= 31; i++) d += '<option' + (i === md[1] ? ' selected' : '') + '>' + i + '</option>';
    MONTH3.forEach(function (x, i) { m += '<option value="' + x + '"' + (i + 1 === md[0] ? ' selected' : '') + '>' + MONTHS[i] + '</option>'; });
    var fol = prefix === 'rb-f' ? ' data-follow-dm="rb-t"' : '';
    return '<span class="dm"><select id="' + prefix + 'd" class="btn" aria-label="Day"' + fol + '>' + d + '</select><select id="' + prefix + 'm" class="btn" aria-label="Month"' + fol + '>' + m + '</select></span>';
  }
  function easterSelect(id, n, follow) {
    var o = '';
    for (var i = -7; i <= 7; i++) o += '<option value="' + i + '"' + (i === n ? ' selected' : '') + '>' + esc(easterLabel(i)) + '</option>';
    return '<select id="' + id + '" class="btn"' + (follow ? ' data-follow="' + follow + '" data-num="1"' : '') + '>' + o + '</select>';
  }
  function blockedModal(rule) {
    var r = rule || { name: '', from: '24 Dec', to: '24 Dec', category: '', action: 'Block', message: '', active: true };
    var mode = specKind(r.from), cats = String(r.category || '').split(',').map(function (x) { return C.catKey(x); }).filter(String);
    var levels = S.data.levels.filter(function (l) { return C.tracksLeave({ level: l.level }); });
    var html = '<header><div><p class="eyebrow">Blocked days</p><h2>' + (rule ? 'Change blocked days' : 'Add blocked days') + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<form id="blkForm" novalidate><input type="hidden" id="rb-id" value="' + esc(r.id || '') + '">' +
      '<label class="field">Name<input id="rb-name" maxlength="60" value="' + esc(r.name) + '" placeholder="e.g. Christmas services, Church camp"></label>' +
      '<div class="field"><span>When</span><div class="radios" id="rb-mode">' + [['yearly', 'Same dates every year'], ['easter', 'Around Easter (moves each year)'], ['once', 'One year only']].map(function (o) {
        return '<label><input type="radio" name="rb-mode" value="' + o[0] + '"' + (mode === o[0] ? ' checked' : '') + '>' + o[1] + '</label>'; }).join('') + '</div></div>' +
      '<div class="rb-pane" data-mode="yearly"' + (mode === 'yearly' ? '' : ' hidden') + '><div class="two"><div class="field"><span>From</span>' + dmSelects('rb-f', mode === 'yearly' ? r.from : '24 Dec') + '</div><div class="field"><span>To</span>' + dmSelects('rb-t', mode === 'yearly' ? (r.to || r.from) : '24 Dec') + '</div></div></div>' +
      '<div class="rb-pane" data-mode="easter"' + (mode === 'easter' ? '' : ' hidden') + '><div class="two"><label class="field">From' + easterSelect('rb-fe', mode === 'easter' ? easterN(r.from) : -2, 'rb-te') + '</label><label class="field">To' + easterSelect('rb-te', mode === 'easter' ? easterN(r.to || r.from) : -2) + '</label></div></div>' +
      '<div class="rb-pane" data-mode="once"' + (mode === 'once' ? '' : ' hidden') + '><div class="two"><label class="field">From<input type="date" id="rb-fs" data-follow="rb-ts" value="' + esc(mode === 'once' ? r.from : '') + '"></label><label class="field">To<input type="date" id="rb-ts" value="' + esc(mode === 'once' ? (r.to || r.from) : '') + '"></label></div></div>' +
      '<div class="field"><span>Who can’t take leave</span><div class="radios"><label><input type="radio" name="rb-who" value="all"' + (cats.length ? '' : ' checked') + '>All staff</label><label><input type="radio" name="rb-who" value="some"' + (cats.length ? ' checked' : '') + '>Only some categories</label></div>' +
      '<div class="rb-cats"' + (cats.length ? '' : ' hidden') + '>' + levels.map(function (l) {
        return '<label class="chk"><input type="checkbox" name="rb-cat" value="' + esc(l.level) + '"' + (cats.indexOf(C.catKey(l.level)) >= 0 ? ' checked' : '') + '>' + esc(l.level) + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><span>If someone asks for leave then</span><div class="radios"><label><input type="radio" name="rb-act" value="Block"' + (/warn/i.test(r.action) ? '' : ' checked') + '>Block the request</label><label><input type="radio" name="rb-act" value="Warn"' + (/warn/i.test(r.action) ? ' checked' : '') + '>Allow it, with a warning</label></div></div>' +
      '<label class="field">Message <span class="muted" style="font-weight:400">(optional, shown to staff)</span><input id="rb-msg" maxlength="200" value="' + esc(r.message || '') + '" placeholder="e.g. All hands on deck for the Christmas services"></label>' +
      '<p class="muted small" id="rb-preview"></p><div id="rb-err"></div>' +
      '<div class="actions">' + (rule ? '<button type="button" class="btn bad" data-act="blk-del" data-id="' + esc(r.id) + '">Delete</button>' : '') +
      '<button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn primary" id="rb-go">' + (rule ? 'Save' : 'Add') + '</button></div></form>';
    openModal(html, 'Blocked days');
    blkPreview();
  }
  function readBlk() {
    var mode = (modalRoot.querySelector('input[name="rb-mode"]:checked') || {}).value || 'yearly', from, to;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var esp = function (n) { n = Number(n); return n === 0 ? 'Easter' : 'Easter' + (n > 0 ? '+' : '') + n; };
    if (mode === 'yearly') { from = g('rb-fd') + ' ' + g('rb-fm'); to = g('rb-td') + ' ' + g('rb-tm'); }
    else if (mode === 'easter') { from = esp(g('rb-fe')); to = esp(g('rb-te')); }
    else { from = g('rb-fs'); to = g('rb-ts') || g('rb-fs'); }
    var some = ((modalRoot.querySelector('input[name="rb-who"]:checked') || {}).value === 'some');
    var cats = some ? Array.prototype.map.call(modalRoot.querySelectorAll('input[name="rb-cat"]:checked'), function (x) { return x.value; }) : [];
    return { id: g('rb-id'), name: g('rb-name').trim(), from: from, to: to, mode: mode, some: some, category: cats.join(', '),
      action: (modalRoot.querySelector('input[name="rb-act"]:checked') || {}).value || 'Block', message: g('rb-msg').trim() };
  }
  function blkPreview() {
    var box = document.getElementById('rb-preview'); if (!box) return;
    var b = readBlk();
    Array.prototype.forEach.call(modalRoot.querySelectorAll('.rb-pane'), function (p) { p.hidden = p.dataset.mode !== b.mode; });
    var cb = modalRoot.querySelector('.rb-cats'); if (cb) cb.hidden = !b.some;
    if (b.mode === 'easter' && easterN(b.to) < easterN(b.from)) { box.textContent = 'The last day is before the first day.'; return; }
    var nx = (b.mode !== 'once' || (b.from && b.to)) ? C.nextOccurrence({ from: b.from, to: b.to }, todayISO()) : null;
    box.innerHTML = nx ? 'Next time: <b>' + esc(fmtRange({ start: nx.start, end: nx.end })) + '</b>' + (b.mode === 'easter' ? ' · Easter moves every year; Leave Manager works out the dates.' : '') :
      (b.mode === 'once' ? (b.from && b.to ? 'These dates have already passed, so this no longer blocks anything. You can keep it as a record or delete it.' : 'Choose the dates.') : '');
  }
  function saveBlk() {
    var b = readBlk(), err = document.getElementById('rb-err');
    var problem = !b.name ? 'Give it a name, e.g. Christmas services.' : (b.mode === 'once' && (!b.from || !b.to)) ? 'Choose the first and last day.' :
      (b.mode === 'once' && b.to < b.from) ? 'The last day is before the first day.' : (b.some && !b.category) ? 'Tick at least one category, or choose All staff.' :
      (b.mode === 'easter' && easterN(b.to) < easterN(b.from)) ? 'The last day is before the first day.' : '';
    if (problem) { err.innerHTML = '<div class="err" role="alert">' + esc(problem) + '</div>'; return; }
    var btn = document.getElementById('rb-go'); busy(btn, true);
    var existing = b.id && (S.data.rules || []).filter(function (r) { return r.id === b.id; })[0];
    call('rule-save', { id: b.id, name: b.name, from: b.from, to: b.to, category: b.category, ruleAction: b.action, message: b.message, active: existing ? existing.active !== false : true },
      (b.id ? 'Saved: ' : 'Added: ') + b.name).then(function () { closeModal(); }).catch(function () { busy(btn, false); });
  }
  /** Blocked-day rules for a date (for everyone, or for one person). */
  function blockedOn(ds, st) { return S.data.rules ? C.noLeaveRules(S.data, ds, st) : []; }

  /* ---------- Stand-in approver ---------- */
  function standInPanel() {
    var set = settings(), id = String(set.StandInID || ''), from = String(set.StandInFrom || '').slice(0, 10), to = String(set.StandInTo || '').slice(0, 10);
    var who = id ? staffById(id) : null, today = todayISO();
    var state = !who ? '<p class="muted">Nobody is set. Choose someone to approve leave while you’re away. They get the request emails and an Approvals page, but can’t approve their own leave.</p>' :
      '<p><b>' + esc(who.name) + '</b> ' + (today < from ? 'will approve leave' : today > to ? 'approved leave' : 'is approving leave') + ' from <b>' + esc(fmt(from, true)) + '</b> to <b>' + esc(fmt(to, true)) + '</b>.' +
      (today >= from && today <= to ? ' <span class="pill Approved">Active now</span>' : today > to ? ' <span class="pill Cancelled">Ended</span>' : ' <span class="pill Pending">Scheduled</span>') + '</p>';
    var people = S.data.staff.filter(function (p) { return p.active !== false && !C.isAdmin(p); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<section class="panel" id="standin"><h2>Stand-in approver</h2>' + state +
      '<div class="si-form"><label class="field">Person<select id="si-who"><option value="">Choose…</option>' + people.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="two"><label class="field">From<input type="date" id="si-from" data-follow="si-to" value="' + esc(from) + '"></label><label class="field">To<input type="date" id="si-to" value="' + esc(to) + '"></label></div>' +
      '<div class="btns"><button class="btn primary" data-act="si-save">' + (who ? 'Update' : 'Set stand-in') + '</button>' + (who ? '<button class="btn ghost" data-act="si-clear">Remove</button>' : '') + '</div></div></section>';
  }

  /* ---------- Payroll: unpaid leave per person per month ---------- */
  function payrollData(y) {
    var rng = C.lyRange(y, CTX.S), ut = unpaidTypes().map(function (t) { return t.code; });
    var months = monthTotals(y).map(function (m) { return { key: m.key, label: m.label }; });
    var rows = sortedStaff().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (st) {
      var per = {}, total = 0, list = [];
      S.data.requests.forEach(function (r) {
        if (r.staffId !== st.id || r.status !== 'Approved' || ut.indexOf(r.type) < 0 || r.end < rng.start || r.start > rng.end) return;
        var n = 0;
        (DL[r.id] || C.dayList(r, CTX)).forEach(function (x) { if (x.date < rng.start || x.date > rng.end) return; per[x.date.slice(0, 7)] = (per[x.date.slice(0, 7)] || 0) + x.amt; total += x.amt; n += x.amt; });
        list.push({ r: r, n: n });
      });
      return { st: st, per: per, total: total, list: list };
    });
    return { months: months, rows: rows, types: unpaidTypes() };
  }
  function payrollReport(y) {
    var p = payrollData(y), any = p.rows.some(function (r) { return r.total; });
    var head = '<th>Employee</th>' + p.months.map(function (m) { return '<th class="n">' + m.label + '</th>'; }).join('') + '<th class="n">Total</th>';
    var body = p.rows.map(function (r) {
      return '<tr><td><b>' + esc(r.st.name) + '</b><small>' + esc(catName(r.st)) + '</small></td>' + p.months.map(function (m) {
        return '<td class="n' + (r.per[m.key] ? '' : ' rp-na') + '">' + (r.per[m.key] ? '<b>' + C.fmtDays(r.per[m.key]) + '</b>' : '–') + '</td>'; }).join('') +
        '<td class="n"><b>' + C.fmtDays(r.total) + '</b></td></tr>';
    }).join('');
    var tot = p.months.map(function (m) { return p.rows.reduce(function (a, r) { return a + (r.per[m.key] || 0); }, 0); });
    var detail = [];
    p.rows.forEach(function (r) { r.list.forEach(function (x) { detail.push({ st: r.st, r: x.r, n: x.n }); }); });
    detail.sort(function (a, b) { return a.r.start < b.r.start ? -1 : 1; });
    return '<section class="rp-page rp-wide"' + rpStyle(colourOf(staffById(me().id) || me())) + '>' + rpHead('Payroll: unpaid leave', 'Working days of ' + esc(p.types.map(function (t) { return t.name; }).join(', ') || 'unpaid leave') + ' per month', y) +
      '<table class="rp-tbl rp-sum"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody><tfoot><tr><td>Total</td>' +
      tot.map(function (n) { return '<td class="n">' + (n ? C.fmtDays(n) : '–') + '</td>'; }).join('') + '<td class="n">' + C.fmtDays(tot.reduce(function (a, b) { return a + b; }, 0)) + '</td></tr></tfoot></table>' +
      '<h2 class="rp-h">Unpaid leave taken</h2>' + (detail.length ? '<table class="rp-tbl"><thead><tr><th>Employee</th><th>Dates</th><th>Leave type</th><th class="n">Working days</th><th>Approved by</th></tr></thead><tbody>' +
        detail.map(function (x) { var t = typeOf(x.r.type); return '<tr><td>' + esc(x.st.name) + '</td><td>' + esc(fmtRange(x.r)) + '</td><td><span class="rp-dot" style="background:' + esc(t.colour) + '"></span>' + esc(t.name) + '</td><td class="n">' + C.fmtDays(x.n) + '</td><td>' + esc(x.r.decidedBy || '') + '</td></tr>'; }).join('') +
        '</tbody></table>' : '<p class="rp-empty">No unpaid leave in ' + esc(lyName(y)) + '.</p>') +
      '<p class="rp-key">Only approved leave is counted, in each person’s working days (public holidays and days they don’t work are left out). Half days count as 0.5.' + (any ? '' : '') + '</p>' +
      rpFoot('For payroll. Unpaid leave doesn’t use any allowance, so it isn’t shown on balance reports.') + '</section>';
  }
  function payrollCsv(y) {
    var p = payrollData(y), q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['Employee', 'Category'].concat(p.months.map(function (m) { return m.label + ' ' + m.key.slice(0, 4); }), ['Total unpaid days']).map(q).join(',')];
    p.rows.forEach(function (r) { lines.push([r.st.name, catName(r.st)].concat(p.months.map(function (m) { return r.per[m.key] || 0; }), [r.total]).map(q).join(',')); });
    lines.push('');
    lines.push(['Employee', 'First day', 'Last day', 'Leave type', 'Working days', 'Approved by'].map(q).join(','));
    p.rows.forEach(function (r) { r.list.forEach(function (x) { lines.push([r.st.name, x.r.start, x.r.end, typeOf(x.r.type).name, x.n, x.r.decidedBy || ''].map(q).join(',')); }); });
    return lines.join('\r\n');
  }
  function downloadText(name, text, mime) {
    if (NATIVE) {
      if (typeof NATIVE.shareText === 'function') { nativeCall2('shareText', name, text); return; }
      try { navigator.clipboard.writeText(text); toast('Copied the CSV. Update the Android app to share it as a file.'); } catch (e) { toast('Open Leave Manager in a browser to download this file.', true); }
      return;
    }
    var blob = new Blob(['﻿' + text], { type: mime || 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function nativeCall2(fn, a, b) { try { return NATIVE[fn](a, b); } catch (e) { return null; } }

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
      return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '"><span class="dot" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + reqAmount(r) + '</span></div>' + pill(r.status, r) + '</div>';
    }
    var hols = d.holidays.filter(function (h) { return h.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 4);
    var pend = isApprover() ? pendingForMe() : [];
    if (!takesLeave(u)) {
      var recent = d.requests.filter(function (r) { return r.status === 'Approved' && r.end >= today; })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; }).slice(0, 6);
      cards = '';
      upcoming = recent; past = [];
      reqRow = function (r) {
        var t = typeOf(r.type), st = staffById(r.staffId) || { name: '?' };
        return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '">' + av(st) + '<div class="grow"><b>' + esc(st.name) + '</b><span>' + esc(t.name) + ' · ' + esc(fmtRange(r)) + '</span></div>' + pill(r.status, r) + '</div>';
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
      '<th class="mband" scope="colgroup" colspan="' + dates.length + '"><span class="mb-in"><span class="mb-name"><span class="mb-full">' + MONTHS[m] + ' ' + y + '</span><span class="mb-short">' + MONTHS[m].slice(0, 3) + ' ' + y + '</span></span>' + monthControls() + '</span></th></tr><tr class="drow">' + dates.map(function (d) {
      var ds = C.iso(d), closed = !C.isOpen(d, CTX), blk = blockedOn(ds);
      var tip = [CTX.hol[ds] || (closed ? 'Church closed' : '')].concat(blk.map(function (r) { return '⛔ No leave: ' + r.name + (r.category ? ' (' + r.category + ')' : ''); })).filter(String).join('\n');
      return '<th scope="col" class="' + (ds === today ? 'today' : '') + (closed ? ' closed' : '') + (blk.length ? ' blk' : '') + '" title="' + esc(tip) + '">' + DOW[d.getDay()][0] + '<b>' + d.getDate() + '</b>' +
        (CTX.hol[ds] ? '<span class="holname">PH</span>' : (closed ? '<span class="holname closedname">Closed</span>' : (blk.length ? '<span class="holname blkname">No leave</span>' : ''))) + '</th>';
    }).join('') + '</tr>';
    var rows = sortedStaff().map(function (st) {
      var mine = st.id === me().id, canBook = mine || canManage(st), wdays = C.staffDays(CTX, st.id);
      return '<tr class="' + (mine ? 'mine' : '') + '"><th class="p" scope="row"><div class="row">' + av(st) + '<div class="nm"><b>' + esc(st.name) + (mine ? ' (you)' : '') + '</b><span>' + esc(catName(st)) + ' · ' + esc(C.daysLabel(wdays)) + '</span></div></div></th>' +
        dates.map(function (d) {
          var ds = C.iso(d), work = C.isWorking(d, CTX, st.id);
          var cls = [!C.isOpen(d, CTX) ? 'closed' : (wdays.indexOf(d.getDay()) < 0 ? 'we' : ''), C.isHolidayFor(d, CTX, st.id) ? 'hol' : '', ds === today ? 'today' : ''];
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
        (CTX.hol[ds] ? '<div class="hn">' + esc(CTX.hol[ds]) + '</div>' : (closed ? '<div class="hn muted">Closed</div>' : '')) +
        blockedOn(ds).map(function (r) { return '<div class="hn blkname" title="No leave' + (r.category ? ' for ' + esc(r.category) : '') + '">⛔ ' + esc(r.name) + '</div>'; }).join('') + chips.slice(0, max).join('') +
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
          return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '"><span class="dot" style="--c:' + esc(t.colour) + '"></span><div class="grow"><b>' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + reqAmount(r) + '</span></div>' + pill(r.status, r) + '</div>';
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
        (function () { var w = reqWarnings(r); return w.length ? coverHtml(w) : ''; })() +
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
          return '<div class="li click" data-act="open-req" data-id="' + esc(r.id) + '">' + av(st) + '<div class="grow"><b>' + esc(st.name) + ' · ' + esc(fmtRange(r)) + '</b><span>' + esc(t.name) + ' · ' + esc(r.decidedBy) + '</span></div>' + pill(r.status, r) + '</div>';
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
    problem: { label: 'Form problem', colour: 'var(--bad)' },
    setting: { label: 'Settings change', colour: 'var(--muted)' },
    change: { label: 'Changed', colour: '#7C3AED' }
  };
  function histKind(action) {
    var a = String(action || '').toLowerCase();
    if (a.indexOf('stand-in') >= 0 || a.indexOf('automatic emails') >= 0 || a.indexOf('blocked days') >= 0) return 'setting';
    if (a.indexOf('changed') === 0) return 'change';
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
    if (k === 'change') return (own ? staff + ' changed their own ' : who + ' changed ' + staff + '’s ') + 'leave, now ' + type +
      (/again/i.test(h.action) ? ' <span class="muted">(needs approval again)</span>' : '');
    if (k === 'setting') {
      if (/automatic emails/i.test(h.action)) return who + ' changed the automatic emails';
      if (/blocked days/i.test(h.action)) return who + ' ' + esc(String(h.action).replace(/^Blocked days /i, '')) + ' blocked days' + (h.note ? ': ' + esc(h.note.split(':')[0]) : '');
      if (/removed/i.test(h.action)) return who + ' removed the stand-in approver';
      return who + ' made ' + staff + ' stand-in approver';
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
  /** Report colours come from a person's own colour (Staff tab, column J); very pale ones are deepened to read on white paper. */
  function rpStyle(hex) {
    hex = normHex(hex);
    if (!hex) return '';
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    var acc = lum > 150 ? 'color-mix(in srgb, ' + hex + ' 55%, #000000)' : hex;
    return ' style="--rp-accent:' + acc + ';--rp-soft:color-mix(in srgb, ' + hex + ' 9%, #FFFFFF);--rp-c:' + hex + '"';
  }
  function rpBadge(st) {
    return '<span class="rp-badge" style="background:' + esc(normHex(colourOf(st)) || '#0F4F43') + '">' + esc(initials(st.name)) + '</span>';
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
  /** Requests still waiting for approval, shown near the top of a person's report. */
  function pendingBlock(st, reqs) {
    var pend = reqs.filter(function (r) { return r.status === 'Pending'; });
    if (!pend.length) return '';
    return '<div class="rp-pending"><h2 class="rp-h" style="margin-top:0">Waiting for approval <small>' + pend.length + ' request' + (pend.length > 1 ? 's' : '') + ' not yet approved</small></h2>' +
      pend.map(function (r) {
        var t = typeOf(r.type), w = reqWarnings(r);
        return '<div class="rp-prow"><div><b>' + esc(fmtRange(r)) + '</b><span><span class="rp-dot" style="background:' + esc(t.colour) + '"></span>' + esc(t.name) + ' · ' + reqAmount(r) +
          ' · sent ' + esc(fmt(String(r.submitted).slice(0, 10), true)) + '</span>' + (r.reason ? '<span class="rp-note">“' + esc(r.reason) + '”</span>' : '') +
          (w.length && canManage(st) ? '<span class="rp-warn">⚠ ' + esc(w.join(' ')) + '</span>' : '') + '</div>' + quickDecide(r) + '</div>';
      }).join('') + '</div>';
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
    return '<section class="rp-page"' + rpStyle(colourOf(st)) + '>' + rpHead('Leave report', rpBadge(st) + esc(st.name), y) +
      '<dl class="rp-who"><div><dt>Employee</dt><dd>' + esc(st.name) + '</dd></div><div><dt>Category</dt><dd>' + esc(catName(st)) + '</dd></div>' +
      '<div><dt>Working days</dt><dd>' + esc(workLabel(st)) + '</dd></div><div><dt>Start date</dt><dd>' + (st.start ? esc(fmt(st.start, true)) : '—') + '</dd></div>' +
      '<div><dt>Days off approved</dt><dd>' + days(totalOff) + '</dd></div><div><dt>Requests</dt><dd>' + reqs.length + '</dd></div></dl>' +
      pendingBlock(st, reqs) +
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
      rows.push('<tr><td><b><span class="rp-dot rp-pdot" style="background:' + esc(normHex(colourOf(st)) || '#64748B') + '"></span>' + esc(st.name) + '</b><small>' + esc(catName(st)) + '</small></td>' +
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
    return '<section class="rp-page rp-wide"' + rpStyle(colourOf(staffById(me().id) || me())) + '>' + rpHead('Staff leave summary', staff.length + ' staff members', y) +
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
    if (admin) kinds.push(['person', 'One employee'], ['summary', 'All staff — summary'], ['full', 'All staff — full detail'], ['payroll', 'Payroll — unpaid leave']);
    if (!kinds.some(function (k) { return k[0] === S.repKind; })) S.repKind = kinds[0][0];
    var staff = sortedStaff().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!S.repPerson || !staffById(S.repPerson)) S.repPerson = staff[0] && staff[0].id;
    var body;
    if (S.repKind === 'mine') body = personReport(me(), y);
    else if (S.repKind === 'person') body = staffById(S.repPerson) ? personReport(staffById(S.repPerson), y) : '<p>No staff yet.</p>';
    else if (S.repKind === 'summary') body = summaryReport(y);
    else if (S.repKind === 'payroll') body = payrollReport(y);
    else body = summaryReport(y) + staff.map(function (st) { return personReport(st, y); }).join('');
    var controls = '<div class="rp-controls">' +
      (kinds.length > 1 ? '<label class="field">Report<select id="rep-kind">' + kinds.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === S.repKind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label>' : '') +
      (S.repKind === 'person' ? '<label class="field">Employee<select id="rep-person">' + staff.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.repPerson ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '</div>';
    return {
      title: 'Reports',
      sub: 'Choose a report, then print it or save it as a PDF from the print window.',
      controls: '<div class="seg"><button data-act="rprev" aria-label="Previous leave year">‹</button><button data-act="rthis">' + esc(lyName(y)) + '</button><button data-act="rnext" aria-label="Next leave year">›</button></div>' +
        (S.repKind === 'payroll' ? '<button class="btn" data-act="csv">Download CSV</button>' : '') +
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
        var pct = main.b.entitled > 0 ? Math.min(100, Math.round(main.b.approved / main.b.entitled * 100)) : 0;
        label = '<b>' + C.fmtDays(main.b.approved) + ' used</b><small>' + C.fmtDays(main.b.remaining) + ' left of ' + C.fmtDays(main.b.entitled) + '</small>' +
          '<i class="emp-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></i>';
        tip = C.fmtDays(main.b.approved) + ' of ' + C.fmtDays(main.b.entitled) + ' days of ' + main.t.name + ' taken in ' + lyName(y) +
          ' (' + C.fmtDays(main.b.remaining) + ' left)' + (all > main.b.approved ? '. All leave: ' + days(all) + ' off.' : '');
      } else { label = '<b>' + C.fmtDays(all) + ' used</b><small>days off</small>'; tip = days(all) + ' off in ' + lyName(y); }
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
          (C.tracksLeave(st) && !C.level(S.data, st) ? badCatHtml([st]) : '') +
          '<p class="muted">' + esc(catName(st)) + ' · works ' + esc(workLabel(st)) + ' · ' + esc(st.role) + (st.start ? ' · started ' + esc(fmt(st.start, true)) : '') + (typeof st.pinChosen === 'boolean' ? ' · ' + (st.pinChosen ? 'has chosen their own PIN' : 'still on the PIN you gave them') : '') + '</p>' +
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
  /** While someone must choose their own PIN, that window can't be closed (except by signing out). */
  function closeModal(force) { if (S.pinRequired && !force) return; modalRoot.innerHTML = ''; S.editId = null; }

  function requestModal(pre) {
    pre = pre || {};
    var u = me(), ed = pre.edit || null;
    S.editId = ed ? ed.id : null;
    if (ed) return editModal(ed);
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
      (takesLeave(u) ? '<label class="field"><span>Note for the Administrator <span class="req" aria-hidden="true">*</span></span><textarea id="f-reason" rows="2" maxlength="500" required aria-required="true" placeholder="What is the leave for? e.g. family visit, doctor’s appointment"></textarea></label>'
        : '<label class="field">Note <span class="muted" style="font-weight:400">(optional)</span><textarea id="f-reason" rows="2" maxlength="500"></textarea></label>') +
      '<div id="f-ph" class="phnote" hidden></div><div class="summary" id="f-sum"></div><div id="f-err"></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn primary" id="f-go">' + (takesLeave(u) ? 'Send request' : 'Book leave') + '</button></div></form>';
    openModal(html, 'Request leave');
    updateRequestSummary();
  }
  /** The request form, filled in with an existing request so it can be corrected. */
  function editModal(r) {
    var u = me(), st = staffById(r.staffId), admin = isMgr(), mine = r.staffId === u.id;
    var willReapprove = !admin && r.status === 'Approved';
    var html = '<header><div><p class="eyebrow">Change leave' + (mine ? '' : ' · ' + esc(st.name)) + '</p><h2>Correct this request</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header><form id="reqForm" novalidate>' +
      '<input type="hidden" id="f-staff" value="' + esc(r.staffId) + '">' +
      '<label class="field">Leave type<select id="f-type">' + typeOptions(st, r.type) + '</select></label>' +
      '<div class="two"><label class="field">First day<input type="date" id="f-start" required value="' + esc(r.start) + '"></label>' +
      '<label class="field">Last day<input type="date" id="f-end" required value="' + esc(r.end) + '" min="' + esc(r.start) + '"></label></div>' +
      '<div class="field" id="f-half-wrap" hidden><span>Length</span><div class="radios">' + [['None', 'Full day'], ['AM', 'Morning'], ['PM', 'Afternoon']].map(function (h) {
        return '<label><input type="radio" name="half" value="' + h[0] + '"' + ((r.half || 'None') === h[0] ? ' checked' : '') + '>' + h[1] + '</label>'; }).join('') + '</div></div>' +
      '<label class="field"><span>Note for the Administrator' + (admin ? ' <span class="muted" style="font-weight:400">(optional)</span>' : ' <span class="req" aria-hidden="true">*</span>') + '</span><textarea id="f-reason" rows="2" maxlength="500">' + esc(r.reason || '') + '</textarea></label>' +
      '<div id="f-ph" class="phnote" hidden></div><div class="summary" id="f-sum"></div><div id="f-err"></div>' +
      (willReapprove ? '<p class="covwarn" style="margin-top:0"><b>Needs approval again</b><span>This leave is already approved. After you change it, it goes back to the Administrator to approve.</span></p>' :
        admin ? '<p class="muted small">' + esc(firstName(st.name)) + ' will be emailed about the change. It stays ' + esc(r.status.toLowerCase()) + '.</p>' : '') +
      '<div class="actions"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn primary" id="f-go">Save changes</button></div></form>';
    openModal(html, 'Change leave');
    var startEl = document.getElementById('f-start'); if (startEl) startEl.dataset.prev = r.start;
    updateRequestSummary();
  }
  /** Leave data without the request being changed, so its own days don't count against it. */
  function dataForForm() {
    if (!S.editId) return S.data;
    var d = {}; for (var k in S.data) d[k] = S.data[k];
    d.requests = S.data.requests.filter(function (x) { return x.id !== S.editId; });
    return d;
  }
  /** Order in the leave-type list: their own staff leave first, then Weekend Off, then the rest, with Sick Leave last. */
  function typeRank(t) {
    if (t.code === 'SL' || /sick/i.test(t.name)) return 9;
    if (/^(PSL|SSL|CSL|TSL)$/.test(t.code) || /staff leave/i.test(t.name)) return 0;
    if (t.code === 'WO' || /weekend/i.test(t.name)) return 1;
    return 2;
  }
  function typeOptions(st, current) {
    var list = S.data.types.filter(function (t) { return C.offered(S.data, st, t); })
      .map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) { return (typeRank(a.t) - typeRank(b.t)) || (a.i - b.i); })
      .map(function (x) { return x.t; });
    return list.map(function (t) {
      return '<option value="' + esc(t.code) + '"' + (t.code === current ? ' selected' : '') + '>' + esc(t.name) + (t.deducts ? '' : ' (doesn’t use an allowance)') + '</option>';
    }).join('');
  }
  function readReqForm() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var half = modalRoot.querySelector('input[name="half"]:checked');
    return { staffId: g('f-staff') || me().id, type: g('f-type'), start: g('f-start'), end: g('f-end') || g('f-start'), half: half ? half.value : 'None', reason: g('f-reason') };
  }
  function isWeekendType(t) { return !!t && /weekend/i.test(String(t.unit || '')); }
  /** Weekend Off: the first day snaps to that week's Friday, and the last day is that Sunday (locked). */
  function snapWeekend() {
    var tSel = document.getElementById('f-type'), sEl = document.getElementById('f-start'), eEl = document.getElementById('f-end');
    if (!tSel || !sEl || !eEl) return;
    var t = C.type(S.data, tSel.value), note = document.getElementById('f-wknote');
    if (!isWeekendType(t)) {
      if (eEl.readOnly) { eEl.readOnly = false; eEl.classList.remove('locked'); }
      if (note) note.remove();
      return;
    }
    var d = C.isISO(sEl.value) ? C.parse(sEl.value) : C.parse(todayISO());
    var dow = d.getDay(), shift = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;   // Sat/Sun → that Friday; Mon–Thu → coming Friday
    var fri = C.iso(C.addDays(d, shift)), sun = C.iso(C.addDays(C.parse(fri), 2));
    sEl.value = fri; sEl.dataset.prev = fri; eEl.value = sun; eEl.min = fri;
    eEl.readOnly = true; eEl.classList.add('locked');
    if (!note) eEl.closest('.two').insertAdjacentHTML('afterend', '<p class="muted small" id="f-wknote" style="margin:-4px 0 10px">' + esc(t.name) + ' is always Friday to Sunday. Pick any day in the weekend you want.</p>');
  }
  /** The official South African public holiday on this date, even if its row was removed from the Public Holidays tab. */
  var STAT = {};
  function statHol(ds) {
    var y = ds.slice(0, 4);
    if (!STAT[y]) { STAT[y] = {}; C.saPublicHolidays(Number(y)).forEach(function (h) { STAT[y][h.date] = h.name; }); }
    return STAT[y][ds] || '';
  }
  /** Below the note: acknowledge a public holiday that is a working day for this person (a Sunday holiday moved to Monday). */
  function phNote(worked, st, mine, t) {
    var el = document.getElementById('f-ph');
    if (!el) return;
    if (!worked.length || !st) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = worked.map(function (d) {
      var ds = C.iso(d), moved = '', dayName = DOW[d.getDay()], plural = { Sun: 'Sundays', Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays' }[dayName] || 'that day';
      for (var i = 1; i <= 2; i++) { var m = C.iso(C.addDays(d, i)); if (/observed/i.test(CTX.hol[m] || statHol(m))) { moved = m; break; } }
      return '<p><b>' + esc(dayName + ' ' + fmt(ds)) + ' is ' + esc(CTX.hol[ds] || statHol(ds)) + '</b>, a public holiday, but it’s a working day for ' + (mine ? 'you' : esc(firstName(st.name))) +
        ' because ' + (mine ? 'you work ' : esc(firstName(st.name)) + ' works ') + esc(plural) + '. It counts as a day of ' + esc(t ? t.name : 'leave') +
        (moved ? '; the public holiday is ' + (mine ? 'yours' : 'theirs') + ' on ' + esc(DOW[C.parse(moved).getDay()] + ' ' + fmt(moved)) + ' instead' : '') + '.</p>';
    }).join('');
    el.hidden = false;
  }
  function updateRequestSummary() {
    var sum = document.getElementById('f-sum');
    if (!sum) return;
    snapWeekend();
    var r = readReqForm(), t = C.type(S.data, r.type), st = staffById(r.staffId);
    var halfWrap = document.getElementById('f-half-wrap');
    var single = r.start && r.start === r.end && t && t.halfDay && C.isDayUnit(t);
    halfWrap.hidden = !single;
    if (!single) r.half = 'None';
    if (!C.isISO(r.start) || !C.isISO(r.end)) { phNote([]); sum.innerHTML = '<span class="muted">Pick your dates to see how many working days this uses.</span>'; setErr(''); return; }
    var dl = r.end >= r.start ? C.dayList(r, CTX) : [];
    var n = dl.reduce(function (s, x) { return s + x.amt; }, 0);
    // Which dates in the range aren't counted, and why.
    var skip = { hol: [], closed: [], off: [] }, nSkip = 0, worked = [];
    if (r.end >= r.start && !(t && C.isCalendarUnit(t))) {
      var d = C.parse(r.start), e = C.parse(r.end), guard = 0;
      var wdays = st ? C.staffDays(CTX, st.id) : CTX.open;
      while (d <= e && guard++ < 800) {
        var ds = C.iso(d), label = DOW[d.getDay()] + ' ' + fmt(ds);
        if (st && (CTX.hol[ds] || statHol(ds)) && !C.isHolidayFor(d, CTX, st.id) && C.isWorking(d, CTX, st.id)) worked.push(d);
        if (st ? C.isHolidayFor(d, CTX, st.id) : CTX.hol[ds]) { skip.hol.push(label + ': ' + CTX.hol[ds] + ' (public holiday)'); nSkip++; }
        else if (!C.isOpen(d, CTX)) { skip.closed.push(label); nSkip++; }
        else if (wdays.indexOf(d.getDay()) < 0) { skip.off.push(label); nSkip++; }
        d = C.addDays(d, 1);
      }
    }
    var mine = st && st.id === me().id, who = mine ? 'your' : (st ? firstName(st.name) + '’s' : '');
    phNote(worked, st, mine, t);
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
      var y = C.lyOf(r.start, CTX.S), b = C.balances(dataForForm(), st.id, y)[t.code];
      if (b.lastYear && r.start <= b.lastYear.until) b = { available: b.available + b.lastYear.left };
      line2 = '<span>' + esc(t.name) + ': ' + C.fmtAmount(t, b.available) + ' available → <b class="' + (b.available - useAmt < 0 ? 'low' : '') + '">' + C.fmtDays(b.available - useAmt) + ' after this</b></span>';
    } else if (t && !t.deducts) line2 = '<span class="muted">' + esc(t.name) + ' doesn’t use any allowance.</span>';
    sum.innerHTML = '<span class="big num">' + (t && !C.isDayUnit(t) ? C.fmtAmount(t, useAmt) + '</span><span class="muted small">' + days(n) + ' away from work' : days(n)) + '</span>' +
      skipHtml +
      (t && t.allowedDays ? '<span class="muted small">' + esc(t.name) + ' can only be booked on ' + esc(C.daysLabel(C.parseDays(t.allowedDays, []))) + (Number(t.perTerm) > 0 ? ', ' + (Number(t.perTerm) === 1 ? 'once' : t.perTerm + ' times') + ' per school term' : '') + '.</span>' : '') +
      (t && st && Number(t.perTerm) > 0 && C.termOf(S.data, r.start) ? '<span class="muted small">Counts as ' + esc(C.termOf(S.data, r.start).name) + '’s ' + esc(t.name) + '.</span>' : '') + line2 +
      (t && t.needsApproval && st && st.id === me().id ? '<span class="muted small" id="f-approve">After you send it, the Administrator will be asked to approve it. You’ll get an email with their decision.</span>' : '');
    var errs = st && t ? C.validateAll(S.data, st, r, S.editId || undefined, false, isMgr()) : [];
    var err = errs[0] || null;
    setErr(errs);
    if (!err && st && t && n) {
      var warns = C.requestWarnings(S.data, st, r, S.editId || undefined, false).map(function (m) {
        return st.id === me().id ? m.replace('More than ' + st.name.split(' ')[0] + '’s allowance', 'More than your allowance') : m;
      });
      var over = C.allowanceWarning(S.data, st, r, S.editId || undefined, false);
      if (warns.length) sum.insertAdjacentHTML('beforeend', coverHtml(warns, isMgr() ? 'As Administrator you can still book it.' :
        over ? 'You can still send it, but it will need the Administrator’s approval, and they’ll see this warning.' : 'You can still send it; the Administrator will see this warning.'));
    }
  }
  /** Approve / Decline buttons for someone who can decide this request (not shown when printing). */
  function quickDecide(r) {
    var st = staffById(r.staffId);
    if (r.status !== 'Pending' || !st || !canManage(st)) return '';
    return '<span class="qd rp-act"><button class="btn small bad" data-act="decide" data-d="Declined" data-id="' + esc(r.id) + '">Decline</button>' +
      '<button class="btn small ok" data-act="decide" data-d="Approved" data-id="' + esc(r.id) + '">Approve</button></span>';
  }
  /** Over-allowance warning for a request that's waiting or approved ('' if none). */
  function overWarning(r) {
    var st = staffById(r.staffId);
    return st ? C.allowanceWarning(S.data, st, r, r.id, true) : '';
  }
  function coverHtml(list, tail) {
    return '<div class="covwarn" role="note"><b>⚠ Please check</b>' + list.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') +
      (tail ? '<span class="muted small">' + esc(tail) + '</span>' : '') + '</div>';
  }
  function reqWarnings(r) {
    var st = staffById(r.staffId);
    if (!st || (r.status !== 'Pending' && r.status !== 'Approved')) return [];
    return C.requestWarnings(S.data, st, r, r.id, true);
  }
  /** Shows a problem under the request form, and greys out the send button until it's fixed. */
  function setErr(msg) {
    var list = Array.isArray(msg) ? msg.filter(Boolean) : (msg ? [msg] : []);
    msg = list.length ? list : '';
    var e = document.getElementById('f-err');
    if (e) e.innerHTML = !list.length ? '' : list.length === 1 ? '<div class="err" role="alert">' + esc(list[0]) + '</div>' :
      '<div class="err" role="alert"><b>' + list.length + ' things to fix before you can send this:</b><ul>' + list.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
    var ap = document.getElementById('f-approve'); if (ap) ap.hidden = !!list.length;
    var go = document.getElementById('f-go');
    if (go) {
      go.disabled = !!msg;
      go.classList.toggle('blocked', !!msg);
      if (msg) go.title = 'Fix the problem shown above first'; else go.removeAttribute('title');
    }
  }

  function requestDetail(id) {
    var r = S.data.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var st = staffById(r.staffId) || { name: 'Former staff member', id: '' }, t = typeOf(r.type), today = todayISO();
    var mine = r.staffId === me().id, mgr = canManage(st) && !r.saving;
    if (r.saving) mine = false;
    var canCancel = !r.saving && (r.status === 'Pending' || r.status === 'Approved') && (isMgr() || (mine && (r.status === 'Pending' || r.start > today)));
    var html = '<header><div class="who" style="display:flex;gap:12px;align-items:center">' + av(st, true) + '<div><p class="eyebrow">' + esc(t.name) + '</p><h2>' + esc(st.name) + '</h2></div></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      '<dl class="kv"><dt>Status</dt><dd>' + pill(r.status) + '</dd><dt>Dates</dt><dd>' + esc(fmtRange(r)) + '</dd><dt>Time away</dt><dd>' + reqAmount(r) + '</dd>' +
      (r.reason ? '<dt>Note</dt><dd>' + esc(r.reason) + '</dd>' : '') +
      '<dt>Requested</dt><dd>' + esc(r.submitted) + (r.source ? ' · ' + esc(r.source === 'Form' ? 'Google Form' : 'app') : '') + '</dd>' +
      (r.decidedBy ? '<dt>' + (r.cancelledBy ? (r.decidedOn ? 'Approved by' : 'Decided by') : (r.status === 'Cancelled' ? 'Cancelled by' : r.status === 'Declined' ? 'Declined by' : 'Approved by')) + '</dt><dd>' + esc(r.decidedBy) + (r.decidedOn ? ' · ' + esc(r.decidedOn) : '') + '</dd>' : '') +
      (r.cancelledBy ? '<dt>Cancelled by</dt><dd>' + esc(r.cancelledBy) + (r.cancelledOn ? ' · ' + esc(r.cancelledOn) : '') + '</dd>' : '') +
      (r.note ? '<dt>Manager note</dt><dd>' + esc(r.note) + '</dd>' : '') + '</dl>' +
      (mgr && r.status === 'Pending' ? (function () { var w = reqWarnings(r); return w.length ? coverHtml(w) : ''; })() : '') +
      (mgr && r.status === 'Pending' ? '<label class="field">Note to ' + esc(firstName(st.name)) + ' (optional)<textarea id="note-' + esc(r.id) + '" rows="2"></textarea></label>' : '') +
      '<div class="actions">' + (canCancel ? '<button class="btn bad" data-act="cancel-req" data-id="' + esc(r.id) + '">Cancel this leave</button>' : '') +
      (!r.saving && !C.editBlock(S.data, me(), r, today) ? '<button class="btn" data-act="edit-req" data-id="' + esc(r.id) + '">Change</button>' : '') +
      (mgr && r.status === 'Pending' ? '<button class="btn bad" data-act="decide" data-d="Declined" data-id="' + esc(r.id) + '">Decline</button><button class="btn ok" data-act="decide" data-d="Approved" data-id="' + esc(r.id) + '">Approve</button>' : '<button class="btn" data-act="close">Close</button>') + '</div>';
    openModal(html, 'Leave details');
  }

  function dayDetail(ds) {
    var off = offOn(ds);
    var html = '<header><div><p class="eyebrow">' + (CTX.hol[ds] ? esc(CTX.hol[ds]) : (C.isOpen(C.parse(ds), CTX) ? 'Church open' : 'Church closed')) + '</p><h2>' + esc(fmtLong(ds)) + '</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
      blockedOn(ds).map(function (r) { return '<div class="covwarn" style="margin:0 0 12px"><b>⛔ No leave: ' + esc(r.name) + '</b><span>' + esc(ruleWho(r)) + (r.message ? ' · ' + esc(r.message) : '') + '</span></div>'; }).join('') +
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
    if (S.pickColour && view !== 'settings') { S.pickColour = null; applyAccent(colourOf(staffById(me().id) || me())); }
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
    if (/^(setup-|cf-)/.test(a) && setupClick(a, el)) return;
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
        if (NATIVE && typeof NATIVE.print === 'function') { nativeCall('print'); break; }
        try { window.print(); } catch (e) { toast('Printing isn’t available here. Open Leave Manager in your browser to print.', true); }
        break;
      case 'toggle-type': S.hidden[el.dataset.code] = !S.hidden[el.dataset.code]; store.set('hidden', S.hidden); render(); break;
      case 'toggle-pending': S.showPending = !S.showPending; store.set('showPending', S.showPending); render(); break;
      case 'pick-colour': S.pickColour = el.dataset.c; applyAccent(S.pickColour); render(); break;
      case 'undo-colour': S.pickColour = null; applyAccent(colourOf(staffById(me().id) || me())); render(); break;
      case 'save-colour': {
        var col = S.pickColour; if (!col) break;
        busy(el, true);
        call('prefs', { colour: col }, 'Your colour is saved').then(function () { S.pickColour = null; render(); })
          .catch(function () { busy(el, false); });
        break;
      }
      case 'csv': downloadText('unpaid-leave-' + lyName(curLY() + S.repYear) + '.csv', payrollCsv(curLY() + S.repYear)); break;
      case 'si-save': {
        var siWho = document.getElementById('si-who').value, siFrom = document.getElementById('si-from').value, siTo = document.getElementById('si-to').value;
        if (!siWho) { toast('Choose who will stand in.', true); break; }
        if (!siFrom || !siTo) { toast('Choose the first and last day.', true); break; }
        busy(el, true);
        call('standin', { staffId: siWho, from: siFrom, to: siTo }, firstName(staffById(siWho).name) + ' will approve leave from ' + fmt(siFrom) + ' to ' + fmt(siTo))
          .then(render).catch(function () { busy(el, false); });
        break;
      }
      case 'si-clear':
        busy(el, true);
        call('standin', { staffId: '' }, 'Stand-in approver removed').then(render).catch(function () { busy(el, false); });
        break;
      case 'google-native': nativeCall('googleSignIn', GOOGLE_ID); break;
      case 'upd-check': checkAppUpdate(true); break;
      case 'upd-later': S.updLater = true; render(); break;
      case 'pwa-install':
        if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.then(function () { installPrompt = null; render(); }); }
        break;
      case 'refresh': refreshData(true); break;
      case 'blk-new': blockedModal(null); break;
      case 'blk-edit': { var br = (S.data.rules || []).filter(function (x) { return x.id === el.dataset.id; })[0]; if (br) blockedModal(br); break; }
      case 'blk-del':
        if (!el.dataset.confirm) { el.dataset.confirm = '1'; el.textContent = 'Yes, delete'; el.classList.add('primary'); return; }
        busy(el, true);
        call('rule-delete', { id: el.dataset.id }, 'Blocked days deleted').then(function () { closeModal(); }).catch(function () { busy(el, false); });
        break;
      case 'new': requestModal(); break;
      case 'edit-req': { var er = C.findReq(S.data, el.dataset.id); if (er) requestModal({ edit: er }); break; }
      case 'book': requestModal({ date: el.dataset.date, staffId: el.dataset.staff }); break;
      case 'open-req': requestDetail(el.dataset.id); break;
      case 'day': dayDetail(el.dataset.date); break;
      case 'close': closeModal(); break;
      case 'logout': closeModal(); logout(); break;
      case 'logout-ask':
        openModal('<header><div><p class="eyebrow">Leave Manager</p><h2>Sign out?</h2></div><button class="x" data-act="close" aria-label="Close">×</button></header>' +
          '<p class="muted" style="margin:0 0 18px">You’ll need your ' + (GOOGLE_ID ? 'Google account or ' : '') + 'email and PIN to sign in again.</p>' +
          '<div class="actions"><button class="btn" data-act="close">Stay signed in</button><button class="btn primary" data-act="logout">Sign out</button></div>', 'Sign out?');
        break;
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
        if (d === 'Approved' && !el.dataset.confirm) {
          var ovr = (S.data.requests || []).filter(function (x) { return x.id === el.dataset.id; })[0];
          var ow = ovr ? overWarning(ovr) : '';
          if (ow) { el.dataset.confirm = '1'; el.textContent = 'Approve anyway'; toast('⚠ ' + ow); return; }
        }
        var decId = el.dataset.id, noteVal = note ? note.value : '';
        var undoD = optimistic(function (dd) {
          dd.requests.forEach(function (x) { if (x.id === decId) { x.status = d; x.decidedBy = me().name; x.decidedOn = C.iso(new Date()); x.note = noteVal; x.saving = true; } });
        });
        closeModal();
        toast(d === 'Approved' ? 'Approving…' : 'Declining…');
        call('decide', { id: decId, decision: d, note: noteVal }, d === 'Approved' ? 'Approved – they’ve been emailed' : 'Declined – they’ve been emailed')
          .catch(function () { undoD(); });
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
    if (ev.target.dataset && ev.target.dataset.follow && ev.target.type === 'date') followFrom(ev.target);
    if (ev.target.id === 'set-colour') { applyAccent(normHex(ev.target.value)); return; }
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
  /* "To follows From" everywhere: picking a From date copies it into To, unless To was already set to a later date. */
  function initialValue(el) {
    if (el.dataset.prev != null) return el.dataset.prev;
    if (el.tagName === 'SELECT') { var o = Array.prototype.filter.call(el.options, function (x) { return x.defaultSelected; })[0]; return o ? o.value : el.value; }
    return el.defaultValue;
  }
  function followFrom(fromEl) {
    var to = document.getElementById(fromEl.dataset.follow); if (!to) return;
    var num = !!fromEl.dataset.num, v = fromEl.value, prev = initialValue(fromEl);
    var before = num ? Number(to.value) < Number(v) : (to.value && v && to.value < v);
    if (v !== '' && (to.value === '' || to.value === prev || before)) to.value = v;
    if (!num && to.type === 'date') to.min = v || '';
    fromEl.dataset.prev = v;
  }
  function followDayMonth(el) {   // same dates every year: day + month selects
    var p = el.dataset.followDm, fd = el.id.replace(/[dm]$/, 'd'), fm = el.id.replace(/[dm]$/, 'm');
    var fD = document.getElementById(fd), fM = document.getElementById(fm), tD = document.getElementById(p + 'd'), tM = document.getElementById(p + 'm');
    if (!fD || !fM || !tD || !tM) return;
    var prev = (fD.dataset.prev != null ? fD.dataset.prev : initialValue(fD)) + ' ' + (fM.dataset.prev != null ? fM.dataset.prev : initialValue(fM));
    if (tD.value + ' ' + tM.value === prev) { tD.value = fD.value; tM.value = fM.value; }
    fD.dataset.prev = fD.value; fM.dataset.prev = fM.value;
  }
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
    if (ev.target.dataset && ev.target.dataset.follow) followFrom(ev.target);
    if (ev.target.dataset && ev.target.dataset.followDm) followDayMonth(ev.target);
    if (ev.target.id === 'set-colour') { S.pickColour = normHex(ev.target.value); applyAccent(S.pickColour); render(); return; }
    if (ev.target.name === 'theme' && ev.target.closest('#set-theme')) { store.set('theme', ev.target.value); applyTheme(ev.target.value); toast('Appearance saved on this device'); return; }
    if (ev.target.id === 'em-weekly' || ev.target.id === 'em-day' || ev.target.id === 'em-rem') { saveEmails(); return; }
    if (setupChange(ev.target)) return;
    if (ev.target.closest && ev.target.closest('#blkForm')) { blkPreview(); return; }
    if (ev.target.dataset && ev.target.dataset.ruleToggle) {
      var on = ev.target.checked;
      call('rule-save', { id: ev.target.dataset.ruleToggle, toggle: true, active: on }, on ? 'Blocked days switched on' : 'Blocked days switched off').catch(function () { render(); });
      return;
    }
    if (ev.target.id === 'set-start') { if (ev.target.value) store.set('startView', ev.target.value); else store.del('startView'); toast('Start page saved on this device'); return; }
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
    if (ev.target.id === 'blkForm') { saveBlk(); return; }
    if (setupSubmit(ev.target)) return;
    if (ev.target.id === 'pinFirst') { submitPin('pf', S.pinCurrent || (document.getElementById('pf-cur') || {}).value || ''); return; }
    if (ev.target.id === 'pinChange') { submitPin('pc', document.getElementById('pc-cur').value.trim()); return; }
    if (ev.target.id === 'loginForm') {
      var email = document.getElementById('l-email').value.trim(), pin = document.getElementById('l-pin').value.trim();
      var btn = document.getElementById('l-go'), errBox = document.getElementById('l-err');
      if (!email || !pin) { errBox.innerHTML = '<div class="err">Enter your email and PIN.</div>'; return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      api('login', { email: email, pin: pin }).then(function (res) {
        S.token = res.token; store.set('token', res.token); store.set('email', email); setData(res.data);
        if (res.mustChangePin) pinPrompt(pin);
        checkAppUpdate(false);
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        errBox.innerHTML = '<div class="err" role="alert">' + esc(err.message === 'Failed to fetch' ? 'Can’t reach the leave server. Check the API_URL in config.js.' : err.message) + '</div>';
      });
    }
    if (ev.target.id === 'reqForm') {
      var r = readReqForm(), btn2 = document.getElementById('f-go');
      if (document.getElementById('f-half-wrap').hidden) r.half = 'None';
      var st = staffById(r.staffId), err = (r.staffId === me().id && !isMgr() && String(r.reason || '').trim().length < 3) ? 'Please add a note for the Administrator saying what the leave is for.' : C.validate(S.data, st, r, S.editId || undefined, false, isMgr());
      if (err) { setErr(err); return; }
      busy(btn2, true);
      if (S.editId) {
        var orig = C.findReq(S.data, S.editId), tNew = C.type(S.data, r.type);
        var again = !isMgr() && orig && orig.status === 'Approved' && tNew && tNew.needsApproval !== false;
        r.id = S.editId;
        call('edit', r, again ? 'Changed – sent to the Administrator to approve again' : (isMgr() && r.staffId !== me().id ? 'Changed – ' + firstName(st.name) + ' has been emailed' : 'Changes saved'))
          .then(function () { S.editId = null; closeModal(); }).catch(function () { busy(btn2, false); });
        return;
      }
      var forOther = r.staffId !== me().id, t = C.type(S.data, r.type);
      // Show it at once; the server finishes in the background.
      var undo = optimistic(function (d) {
        d.requests.push({ id: 'saving-' + Date.now(), staffId: r.staffId, type: r.type, start: r.start, end: r.end, half: r.half || 'None', reason: r.reason || '',
          status: (forOther || t.needsApproval === false) ? 'Approved' : 'Pending', submitted: C.iso(new Date()), source: 'App', saving: true,
          decidedBy: forOther ? me().name : '', days: C.countDays(r, CTX) });
      });
      closeModal();
      toast('Sending…');
      call('request', r, forOther ? 'Booked for ' + firstName(st.name) : (t.needsApproval ? 'Request sent to the Administrator' : 'Booked'))
        .catch(function (err) {
          undo();
          // Bring the form back with what they typed, and the reason it didn't go through.
          requestModal({ date: r.start, staffId: r.staffId });
          var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
          set('f-type', r.type); set('f-start', r.start); set('f-end', r.end); set('f-reason', r.reason || '');
          var h = modalRoot.querySelector('input[name="half"][value="' + (r.half || 'None') + '"]'); if (h) h.checked = true;
          updateRequestSummary();
          setErr(String(err && err.message || err).replace(/^AUTH:?\s*/, ''));
        });
    }
  });
  window.addEventListener('hashchange', function () {
    var v = location.hash.replace('#', '');
    if (VIEWS.indexOf(v) >= 0 && v !== S.view && S.data) go(v);
  });

  /* ---------- Refresh: button in the phone header, and pull down from the top ---------- */
  var refreshing = false;
  function refreshData(show) {
    if (!S.token || !S.data || refreshing) return;
    refreshing = true;
    document.documentElement.classList.add('is-refreshing');
    api('bootstrap').then(function (d) {
      S.hist = null; setData(d);
      if (d && d.mustChangePin && !S.pinRequired) pinPrompt(null);
      if (show) toast('Up to date');
    }).catch(function (err) {
      var m = String(err && err.message || err);
      if (m.indexOf('AUTH') === 0) logout(m.replace(/^AUTH:?\s*/, ''));
      else toast(m === 'Failed to fetch' ? 'Can’t reach the leave server. Check your connection.' : m, true);
    }).then(function () { refreshing = false; document.documentElement.classList.remove('is-refreshing'); });
  }
  (function pullToRefresh() {
    var startY = null, pulled = 0, ind = document.createElement('div');
    ind.className = 'ptr'; ind.innerHTML = icon('refresh'); ind.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ind);
    function reset() { startY = null; pulled = 0; ind.style.transform = ''; ind.classList.remove('ready'); }
    document.addEventListener('touchstart', function (e) {
      if (!S.data || modalRoot.innerHTML || window.scrollY > 0 || e.touches.length !== 1) { startY = null; return; }
      startY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (startY == null) return;
      pulled = Math.max(0, Math.min(120, e.touches[0].clientY - startY));
      if (window.scrollY > 0) { reset(); return; }
      ind.style.transform = 'translate(-50%, ' + (pulled * 0.8) + 'px) rotate(' + (pulled * 3) + 'deg)';
      ind.classList.toggle('ready', pulled > 80);
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (startY != null && pulled > 80) refreshData(true);
      reset();
    });
  })();
  // Coming back to the app or tab after a while: quietly fetch the latest leave.
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) refreshData(false);
    hiddenAt = 0;
  });

  /* Android back button: close an open window first, then go back to Overview; otherwise let the app close. */
  window.leaveAppBack = function () {
    if (S.pinRequired) return true;
    if (modalRoot.innerHTML) { closeModal(); return true; }
    if (S.data && S.view !== 'home') { go('home'); return true; }
    return false;
  };

  /* ------------------------------ demo backend ------------------------------ */
  var Demo = (function () {
    var KEY = 'demo_db_v15';
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
        ['S10', 'Ruan Botha', 'Part-Time Technical Staff', '', 'Staff', ''],
        ['S11', 'Linda Pillay', 'Administrator', '', 'Administrator', '']
      ].map(function (s, i) {
        return { id: s[0], name: s[1], email: s[1].split(' ')[0].toLowerCase() + '@example.com', level: s[2], workDays: s[3], role: s[4], manager: s[5],
          start: s[0] === 'S01' ? (yr - 8) + '-01-15' : s[0] === 'S09' ? yr + '-04-01' : (yr - 2 - (i % 3)) + '-02-01', colour: PALETTE[i], active: true };
      });
      var data = {
        settings: { CompanyName: 'Hillside Community Church', LeaveYearStartMonth: 1, OpenDays: 'Mon, Wed, Thu, Fri, Sat, Sun', TermsIncludeHolidays: 'TRUE', FirstLeaveYear: yr - 1, ProRata: 'TRUE', AllowNegative: 'FALSE', MaxOffPerDay: 3,
          WeeklyEmail: 'Monday', ReminderDates: '1 Nov, 1 Dec, 15 Jan', StandInID: '', StandInFrom: '', StandInTo: '' },
        rules: [
          { name: 'Sunday cover', kind: 'Minimum on duty', category: 'Pastoral Staff', days: 'Sun', from: '', to: '', min: 1, action: 'Warn', message: 'At least one pastor must be on duty every Sunday.', active: true },
          { name: 'Easter services', kind: 'No leave', category: 'Pastoral Staff, Part-Time Technical Staff', days: '', from: 'Easter-2', to: 'Easter+1', min: 0, action: 'Warn', message: 'Good Friday to Family Day.', active: true },
          { name: 'Christmas services', kind: 'No leave', category: 'Pastoral Staff, Part-Time Technical Staff', days: '', from: '24 Dec', to: '26 Dec', min: 0, action: 'Block', message: 'All hands on deck for the Christmas services.', active: true }
        ],
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
          { level: 'Part-Time Technical Staff', label: 'Part-Time Technical Staff', workDays: 'Mon, Wed, Thu, Fri, Sun', ent: { TSL: 20, SL: 7 } },
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
        ['S09', 'CSL', -59, 0, 'Approved', '', ''],
        // a Sunday with no pastor on duty (for the Dashboard's cover check)
        ['S02', 'PSL', 12, 1, 'Approved', '', ''],
        ['S08', 'PSL', 13, 0, 'Approved', '', ''],
        ['S01', 'PSL', 13, 0, 'Pending', '', 'Family reunion'],
        // sick-leave patterns and unpaid leave (Dashboard, Payroll)
        ['S06', 'SL', -7, 0, 'Approved', '', ''],
        ['S06', 'SL', -21, 0, 'Approved', '', ''],
        ['S06', 'SL', -38, 0, 'Approved', '', ''],
        ['S04', 'SL', -96, 2, 'Approved', '', 'Bronchitis'],
        ['S07', 'UL', -130, 1, 'Approved', '', 'Extra days for overseas trip'],
        ['S04', 'UL', -40, 0, 'Approved', '', ''],
        ['S10', 'UL', -180, 2, 'Approved', '', '']
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
    var CFG_KEYS = ['CompanyName', 'OpenDays', 'LeaveYearStartMonth', 'FirstLeaveYear', 'TermsIncludeHolidays', 'ProRata', 'AllowNegative', 'MaxOffPerDay', 'NotifyEmail', 'AppURL', 'CalendarId', 'AutoUpdateCalendars', 'WeeklyEmail', 'ReminderDates'];
    function demoCfg(d) {
      var st = {}; CFG_KEYS.forEach(function (k) { st[k] = d.settings[k] == null ? '' : d.settings[k]; });
      (d.adjustments || []).forEach(function (a, i) { if (!a.id) a.id = 'A' + (i + 2); });
      var codes = d.types.map(function (t) { return t.code; });
      return { settings: st,
        staff: d.staff.map(function (s) { return { id: s.id, name: s.name, email: s.email, level: s.level, workDays: s.workDays || '', role: C.isAdmin(s) ? 'Administrator' : 'Staff', start: s.start || '', colour: s.colour || '', active: s.active !== false, pin: s.pin || 'own' }; }),
        levels: d.levels.map(function (l) { var e = {}; codes.forEach(function (c) { e[c] = l.ent[c] == null ? '' : l.ent[c]; }); return { name: l.level, workDays: l.workDays, ent: e }; }),
        types: d.types.map(function (t) { return Object.assign({ active: true, perTerm: '', maxBalance: '', useBy: '', allowedDays: '' }, t, { active: t.active !== false }); }),
        holidays: d.holidays.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }), terms: (d.terms || []).slice(), adjustments: (d.adjustments || []).slice(), rules: d.rules || [] };
    }
    function demoCfgSave(d, u, what, it) {
      var ck = C.catKey, out = null;
      if (what === 'settings') Object.keys(it).forEach(function (k) { if (CFG_KEYS.indexOf(k) >= 0) d.settings[k] = it[k]; });
      else if (what === 'staff') {
        if (d.staff.some(function (s) { return s.email === String(it.email).toLowerCase() && s.id !== it.id; })) throw new Error('Someone else already has ' + it.email + '.');
        var fields = { name: it.name, email: String(it.email).toLowerCase(), level: it.level, workDays: it.workDays || '', role: it.role, start: it.start || '', colour: it.colour || '', active: it.active !== false };
        if (it.id) {
          var adm = d.staff.filter(function (s) { return C.isAdmin(s) && s.active !== false; }), was = C.staffById(d, it.id);
          if (was && C.isAdmin(was) && adm.length === 1 && (it.role !== 'Administrator' || it.active === false)) throw new Error('There must always be at least one active Administrator.');
          Object.assign(was, fields);
        } else {
          var n = 0; d.staff.forEach(function (s) { var m = /^S(\d+)$/.exec(s.id); if (m) n = Math.max(n, Number(m[1])); });
          var id = 'S' + (n + 1 < 10 ? '0' : '') + (n + 1), pin = String(4000 + Math.floor(Math.random() * 5000));
          d.staff.push(Object.assign({ id: id, manager: '', pin: 'given' }, fields)); out = { id: id, pin: pin, name: it.name };
        }
      } else if (what === 'pin') { var ps = C.staffById(d, it.id); ps.pin = 'given'; out = { pin: String(4000 + Math.floor(Math.random() * 5000)), name: ps.name }; }
      else if (what === 'category') {
        var lv = it.oldName ? d.levels.filter(function (l) { return ck(l.level) === ck(it.oldName); })[0] : null;
        if (d.levels.some(function (l) { return ck(l.level) === ck(it.name) && l !== lv; })) throw new Error('There’s already a category called ' + it.name + '.');
        var ent = {}; Object.keys(it.ent || {}).forEach(function (c) { if (it.ent[c] !== '' && it.ent[c] != null) ent[c] = Number(it.ent[c]); });
        if (lv) { if (it.oldName !== it.name) d.staff.forEach(function (s) { if (ck(s.level) === ck(it.oldName)) s.level = it.name; }); lv.level = lv.label = it.name; lv.workDays = it.workDays; if (C.tracksLeave({ level: it.name })) lv.ent = ent; }
        else d.levels.push({ level: it.name, label: it.name, workDays: it.workDays, ent: ent });
      } else if (what === 'category-delete') {
        if (d.staff.some(function (s) { return ck(s.level) === ck(it.name); })) throw new Error('Move the staff in this category first.');
        d.levels = d.levels.filter(function (l) { return ck(l.level) !== ck(it.name); });
      } else if (what === 'type') {
        var ex = d.types.filter(function (t) { return t.code === it.code; })[0];
        if (it.isNew && ex) throw new Error('There’s already a leave type with the code ' + it.code + '.');
        var nt = { code: it.code, name: it.name, colour: it.colour, deducts: !!it.deducts, halfDay: !!it.halfDay, proRata: !!it.proRata, needsApproval: it.needsApproval !== false, unit: it.unit || 'Days',
          allowedDays: it.allowedDays || '', accumulates: !!it.accumulates, perTerm: Number(it.perTerm) || 0, maxBalance: Number(it.maxBalance) || 0, useBy: it.useBy || '', active: it.active !== false };
        if (ex) Object.assign(ex, nt); else d.types.push(nt);
      } else if (what === 'holiday') {
        d.holidays = d.holidays.filter(function (h) { return h.date !== it.oldDate; }); d.holidays.push({ date: it.date, name: it.name });
      } else if (what === 'holiday-delete') d.holidays = d.holidays.filter(function (h) { return h.date !== it.date; });
      else if (what === 'term') { d.terms = d.terms.filter(function (t) { return t.name !== it.oldName; }); d.terms.push({ name: it.name, start: it.start, end: it.end }); }
      else if (what === 'term-delete') d.terms = d.terms.filter(function (t) { return t.name !== it.name; });
      else if (what === 'adjustment') {
        var row = { staffId: it.staffId, year: Number(it.year), type: it.type, days: Number(it.days), note: it.note || '' };
        var ea = it.id ? d.adjustments.filter(function (a) { return a.id === it.id; })[0] : null;
        if (ea) Object.assign(ea, row); else { row.id = 'A' + Date.now().toString(36); d.adjustments.push(row); }
      } else if (what === 'adjustment-delete') d.adjustments = d.adjustments.filter(function (a) { return a.id !== it.id; });
      return out;
    }
    function nowStr() { var d = new Date(); return C.iso(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    function handle(action, b) {
      return new Promise(function (resolve) { setTimeout(resolve, 180); }).then(function () {
        var d = load();
        if (action === 'login') {
          var u0 = C.staffById(d, b.staffId);
          return { token: 'demo-' + u0.id, data: C.publicView(d, u0) };
        }
        C.applyStandIn(d, todayISO());
        (d.rules || []).forEach(function (x, i) { if (!x.id) x.id = 'R' + (i + 2); });
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
        } else if (action === 'edit') {
          var pe = C.prepareEdit(d, u, b.id, b, todayISO());
          var er2 = pe.req, nx = pe.next;
          er2.type = nx.type; er2.start = nx.start; er2.end = nx.end; er2.half = nx.half; er2.days = nx.days; er2.reason = nx.reason; er2.status = pe.status;
          if (pe.status === 'Pending') { er2.decidedBy = ''; er2.decidedOn = ''; } else if (C.isAdmin(u)) { er2.decidedBy = u.name; er2.decidedOn = nowStr(); }
          log('Changed' + (pe.reapprove ? ' (needs approval again)' : ''), er2, 'Was: ' + pe.changes.join('; '));
        } else if (action === 'cfg-get' || action === 'cfg-save') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can open Setup.');
          var res = action === 'cfg-save' ? demoCfgSave(d, u, b.what, b.item || {}) : null;
          save();
          var vv = C.publicView(d, C.staffById(d, u.id) || u); vv.cfg = demoCfg(d); vv.result = res;
          return vv;
        } else if (action === 'rule-save') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can change blocked days.');
          d.rules = d.rules || [];
          d.rules.forEach(function (x, i) { if (!x.id) x.id = 'R' + (i + 2); });
          var ex = b.id ? d.rules.filter(function (x) { return x.id === b.id; })[0] : null;
          if (b.toggle) { if (ex) ex.active = !!b.active; }
          else {
            var nr = { name: b.name, kind: 'No leave', category: b.category || '', days: '', from: b.from, to: b.to, min: 0, action: b.ruleAction || 'Block', message: b.message || '', active: b.active !== false };
            if (ex) Object.assign(ex, nr); else { nr.id = 'R' + (d.rules.length + 2) + '-' + Date.now().toString(36); d.rules.push(nr); }
          }
          (d.history || (d.history = [])).push({ when: nowStr(), action: b.toggle ? 'Blocked days switched ' + (b.active ? 'on' : 'off') : (ex ? 'Blocked days changed' : 'Blocked days added'), requestId: '', staff: '', type: '', dates: '', days: '', status: '', by: u.name, note: b.name || (ex && ex.name) || '' });
        } else if (action === 'rule-delete') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can change blocked days.');
          var gone = (d.rules || []).filter(function (x) { return x.id === b.id; })[0];
          d.rules = (d.rules || []).filter(function (x) { return x.id !== b.id; });
          (d.history || (d.history = [])).push({ when: nowStr(), action: 'Blocked days removed', requestId: '', staff: '', type: '', dates: '', days: '', status: '', by: u.name, note: gone ? gone.name : '' });
        } else if (action === 'emails') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can change the automatic emails.');
          d.settings.WeeklyEmail = String(b.weekly || ''); d.settings.ReminderDates = String(b.reminders || '');
          (d.history || (d.history = [])).push({ when: nowStr(), action: 'Automatic emails changed', requestId: '', staff: '', type: '', dates: '', days: '', status: '', by: u.name,
            note: 'Weekly email: ' + (b.weekly || 'off') + ' · Reminders: ' + (b.reminders || 'off') });
        } else if (action === 'standin') {
          if (!C.isAdmin(u)) throw new Error('Only an Administrator can choose a stand-in approver.');
          if (b.staffId && (!b.from || !b.to || b.to < b.from)) throw new Error('Choose the first and last day of the stand-in period.');
          d.settings.StandInID = b.staffId || ''; d.settings.StandInFrom = b.staffId ? b.from : ''; d.settings.StandInTo = b.staffId ? b.to : '';
          (d.history || (d.history = [])).push({ when: nowStr(), action: b.staffId ? 'Stand-in approver set' : 'Stand-in approver removed', requestId: '',
            staff: b.staffId ? C.staffById(d, b.staffId).name : '', type: '', dates: b.staffId ? b.from + ' to ' + b.to : '', days: '', status: '', by: u.name, note: '' });
          C.applyStandIn(d, todayISO());
        } else if (action === 'prefs') {
          var hx = normHex(b.colour);
          if (!hx) throw new Error('Choose a colour first.');
          u.colour = hx;
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
    api('bootstrap').then(function (d) { setData(d); if (d && d.mustChangePin) pinPrompt(null); checkAppUpdate(false); }).catch(function (err) {
      var m = String(err && err.message || err);
      S.token = null; store.del(LIVE ? 'token' : 'demo_token');
      render();
      if (m.indexOf('AUTH') !== 0) toast(m === 'Failed to fetch' ? 'Can’t reach the leave server. Check the API_URL in config.js.' : m, true);
    });
  } else render();
})();
