/* Church Hub – Leave (Leave Manager built in). Uses LeaveCore, the same rules file as Leave Manager. */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store, C = LeaveCore;
  var state = { tab: '' };

  /** Leave Manager's data shape, with staff taken from People. */
  function data() {
    var lv = S.leave();
    var staff = S.find('people', function (p) { return p.staff; }).map(function (p) {
      return { id: p.id, name: H.name(p), email: p.email, level: p.staff.category, workDays: p.staff.workDays || '', role: p.appRole === 'admin' ? 'Administrator' : 'Staff', start: p.staff.start, active: p.active !== false };
    });
    return { settings: lv.settings, rules: lv.rules, terms: lv.terms, types: lv.types, levels: lv.levels, holidays: lv.holidays, adjustments: lv.adjustments, requests: lv.requests, staff: staff };
  }
  function actor(d) { return C.staffById(d, H.user().id) || { id: H.user().id, name: H.name(H.user()), role: H.can('*') ? 'Administrator' : 'Staff', level: 'Administrator' }; }
  function isLeaveAdmin() { return H.can('*'); }
  function takesLeave(d) { var st = C.staffById(d, H.user().id); return st && C.tracksLeave(st); }
  function typeOf(d, code) { return C.type(d, code) || { name: code, colour: '#64748B' }; }
  function pill(st) { return '<span class="tag ' + ({ Approved: 'ok', Pending: 'warn', Declined: 'bad', Cancelled: 'grey' }[st] || 'grey') + '">' + esc(st === 'Pending' ? 'Waiting' : st) + '</span>'; }
  function range(r) { return r.start === r.end ? H.fmt(r.start, true) + (r.half && r.half !== 'None' ? ' (' + (r.half === 'AM' ? 'morning' : 'afternoon') + ')' : '') : H.fmt(r.start) + ' – ' + H.fmt(r.end, true); }

  function tabs(d, active) {
    var t = [];
    if (takesLeave(d)) t.push(['', 'My leave']);
    if (isLeaveAdmin()) { t.push(['approvals', 'Approvals']); t.push(['team', 'Team balances']); }
    t.push(['away', 'Who’s away']);
    return t.length > 1 ? '<nav class="seg" aria-label="Leave" style="margin-bottom:18px">' + t.map(function (x) { return '<a href="#/leave' + (x[0] ? '/' + x[0] : '') + '" class="' + (x[0] === active ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + '</nav>' : '';
  }

  function renderMine(d) {
    var me = H.user(), y = C.lyOf(H.today(), C.ctx(d).S), st = C.staffById(d, me.id);
    var bal = C.balances(d, me.id, y);
    var cards = d.types.filter(function (t) { return t.deducts && C.offered(d, st, t); }).map(function (t) {
      var b = bal[t.code]; if (!b || b.entitled == null) return '';
      var used = b.entitled - b.available, pct = b.entitled ? Math.max(0, Math.min(100, used / b.entitled * 100)) : 0;
      return '<div class="stat" style="--c:' + esc(t.colour) + '"><span>' + esc(t.name) + '</span><b>' + C.fmtDays(b.available) + '</b><span>' + esc(C.unitName(t, b.available)) + ' left of ' + C.fmtDays(b.entitled) + (b.pending ? ' · ' + C.fmtDays(b.pending) + ' waiting' : '') + '</span><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
    var mine = d.requests.filter(function (r) { return r.staffId === me.id && r.end >= H.today() && (r.status === 'Pending' || r.status === 'Approved'); }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    return '<section class="block"><h2>What you have left in ' + esc(C.lyLabel(y, C.ctx(d).S)) + '</h2><div class="bal">' + cards + '</div></section>' +
      '<section class="block"><h2>Your upcoming leave</h2>' + (mine.length ? '<div class="list">' + mine.map(function (r) {
        var t = typeOf(d, r.type);
        return '<div class="item"><span class="dot" style="--c:' + esc(t.colour) + '"></span><span class="grow"><b>' + esc(range(r)) + '</b><small>' + esc(t.name + ' · ' + C.fmtAmount(t, C.amount(r, t, C.ctx(d))) + (r.reason ? ' · ' + r.reason : '')) + '</small></span>' + pill(r.status) +
          (r.status === 'Pending' || r.start > H.today() ? '<button class="btn small" data-act="leave:cancel" data-id="' + r.id + '">Cancel</button>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="empty">No leave booked. Use “Request leave” to book some.</p>') + '</section>';
  }

  function renderApprovals(d) {
    var pend = d.requests.filter(function (r) { return r.status === 'Pending'; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    return '<section class="block"><h2>Waiting for your decision</h2>' + (pend.length ? '<div class="list">' + pend.map(function (r) {
      var st = C.staffById(d, r.staffId), t = typeOf(d, r.type), w = st ? C.requestWarnings(d, st, r, r.id, true) : [];
      return '<div class="item" style="align-items:flex-start"><span class="dot" style="--c:' + esc(t.colour) + ';margin-top:6px"></span><span class="grow"><b>' + esc(st ? st.name : '?') + ' · ' + esc(range(r)) + '</b><small>' + esc(t.name + ' · ' + C.fmtAmount(t, C.amount(r, t, C.ctx(d))) + (r.reason ? ' · “' + r.reason + '”' : '')) + '</small>' +
        (w.length ? '<span class="note warn" style="display:block;margin:8px 0 0;font-size:13px">⚠ ' + w.map(esc).join('<br>⚠ ') + '</span>' : '') + '</span>' +
        '<span class="btns"><button class="btn small" data-act="leave:decide" data-id="' + r.id + '" data-d="Declined">Decline</button><button class="btn small ok" data-act="leave:decide" data-id="' + r.id + '" data-d="Approved"' + (C.allowanceWarning(d, st, r, r.id, true) ? ' data-over="1"' : '') + '>Approve</button></span></div>';
    }).join('') + '</div>' : '<p class="empty">Nothing is waiting for approval.</p>') + '</section>';
  }

  function renderTeam(d) {
    var y = C.lyOf(H.today(), C.ctx(d).S), types = d.types.filter(function (t) { return t.deducts; });
    var staff = d.staff.filter(function (s) { return C.tracksLeave(s) && s.active; });
    return '<section class="block"><h2>Days left in ' + esc(C.lyLabel(y, C.ctx(d).S)) + '</h2><div class="panel table-wrap"><table class="simple"><thead><tr><th>Staff</th>' + types.map(function (t) { return '<th>' + esc(t.code) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      staff.map(function (s) {
        var b = C.balances(d, s.id, y);
        return '<tr><td><b>' + esc(s.name) + '</b><br><span class="muted small">' + esc(s.level) + '</span></td>' + types.map(function (t) { var x = b[t.code]; return '<td>' + (x && x.entitled != null ? C.fmtDays(x.available) : '<span class="muted">–</span>') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><p class="hint">' + types.map(function (t) { return esc(t.code + ' = ' + t.name); }).join(' · ') + '</p></section>';
  }

  function renderAway(d) {
    var t = H.today(), end = C.iso(C.addDays(C.parse(t), 42));
    var list = d.requests.filter(function (r) { return (r.status === 'Approved' || (isLeaveAdmin() && r.status === 'Pending')) && r.end >= t && r.start <= end; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    return '<section class="block"><h2>Away in the next 6 weeks</h2>' + (list.length ? '<div class="list">' + list.map(function (r) {
      var st = C.staffById(d, r.staffId), tp = typeOf(d, r.type);
      return '<div class="item"><span class="dot" style="--c:' + esc(tp.colour) + '"></span><span class="grow"><b>' + esc(st ? st.name : '?') + '</b><small>' + esc(range(r)) + (isLeaveAdmin() ? ' · ' + esc(tp.name) : '') + '</small></span>' + (r.status === 'Pending' ? pill('Pending') : '') + '</div>';
    }).join('') + '</div>' : '<p class="empty">No one is away.</p>') + '<p class="hint">Approved leave also stops people being rostered on those days.</p></section>';
  }

  /* ---------- request form ---------- */
  function requestDialog() {
    var d = data(), me = H.user(), admin = isLeaveAdmin();
    var people = d.staff.filter(function (s) { return C.tracksLeave(s) && s.active && (s.id === me.id || admin); });
    if (!people.length) { H.toast('Leave is for staff members', true); return; }
    var who = people.filter(function (s) { return s.id === me.id; })[0] || people[0];
    H.modal(H.dialogHead(admin && who.id !== me.id ? 'Book leave' : 'Request leave', 'Only your working days are counted.') + '<form class="dlg-body" id="lf" novalidate>' +
      (people.length > 1 ? '<label class="field">For<select id="lf-who">' + people.map(function (s) { return '<option value="' + s.id + '"' + (s.id === who.id ? ' selected' : '') + '>' + esc(s.name) + (s.id === me.id ? ' (you)' : '') + '</option>'; }).join('') + '</select></label>' : '<input type="hidden" id="lf-who" value="' + who.id + '">') +
      '<label class="field">Type of leave<select id="lf-type"></select></label><div id="lf-bal"></div>' +
      '<div class="two"><label class="field">First day<input type="date" id="lf-start"></label><label class="field">Last day<input type="date" id="lf-end"></label></div>' +
      '<label class="field">Note for the Administrator' + (admin ? ' <small>(optional)</small>' : '') + '<textarea id="lf-note" rows="2" placeholder="What is the leave for?"></textarea></label>' +
      '<div id="lf-sum" class="note info" hidden></div><div id="lf-err" class="note bad" hidden></div></form>' +
      '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" id="lf-go" data-act="leave:send">Send request</button></div>', 'Request leave');
    var $ = function (id) { return document.getElementById(id); };
    function fillTypes() {
      var st = C.staffById(d, $('lf-who').value);
      $('lf-type').innerHTML = '<option value="">Choose…</option>' + d.types.filter(function (t) { return C.offered(d, st, t); }).map(function (t) { return '<option value="' + t.code + '">' + esc(t.name) + (t.deducts ? '' : ' (no allowance)') + '</option>'; }).join('');
    }
    function update() {
      var st = C.staffById(d, $('lf-who').value), t = C.type(d, $('lf-type').value);
      var r = { staffId: st.id, type: $('lf-type').value, start: $('lf-start').value, end: $('lf-end').value || $('lf-start').value, half: 'None', reason: $('lf-note').value };
      if (t && /weekend/i.test(t.unit || '') && r.start) { var x = C.parse(r.start); while (x.getDay() !== 5) x = C.addDays(x, x.getDay() === 6 || x.getDay() === 0 ? -1 : 1); r.start = C.iso(x); r.end = C.iso(C.addDays(x, 2)); $('lf-start').value = r.start; $('lf-end').value = r.end; }
      // balance box once a type is chosen
      var bal = '';
      if (t && t.deducts) {
        var b = C.balances(d, st.id, C.lyOf(r.start || H.today(), C.ctx(d).S))[t.code];
        if (b && b.entitled != null) bal = '<div class="fbal" style="--c:' + esc(t.colour) + '">' + (st.id === me.id ? 'You have' : esc(st.name.split(' ')[0]) + ' has') + ' <b>' + C.fmtDays(b.available) + '</b> ' + esc(C.unitName(t, b.available)) + ' of ' + esc(t.name) + ' left' + (b.pending ? ' · ' + C.fmtDays(b.pending) + ' waiting' : '') + '</div>';
      } else if (t) bal = '<div class="fbal" style="--c:' + esc(t.colour) + '">' + esc(t.name) + ' doesn’t use an allowance.</div>';
      $('lf-bal').innerHTML = bal;
      var errs = [], warn = [];
      if (t && C.isISO(r.start) && C.isISO(r.end)) {
        errs = C.validateAll(d, st, r, undefined, false, admin);
        warn = C.requestWarnings(d, st, r, undefined, false);
        var n = C.countDays(r, C.ctx(d));
        $('lf-sum').hidden = false;
        $('lf-sum').innerHTML = '<b>' + esc(C.fmtAmount(t, C.amount(r, t, C.ctx(d)))) + '</b>' + (C.isDayUnit(t) ? '' : ' (' + n + ' working days)') + (warn.length ? '<br>⚠ ' + warn.map(esc).join('<br>⚠ ') : '');
      } else $('lf-sum').hidden = true;
      $('lf-err').hidden = !errs.length; $('lf-err').innerHTML = errs.map(esc).join('<br>');
      $('lf-go').disabled = !t || !C.isISO(r.start) || errs.length > 0;
      $('lf-go').textContent = admin && st.id !== me.id ? 'Book leave' : 'Send request';
    }
    fillTypes();
    $('lf-who').addEventListener('change', function () { fillTypes(); update(); });
    $('lf-type').addEventListener('change', update);
    $('lf-start').addEventListener('change', function () { if (!$('lf-end').value || $('lf-end').value < $('lf-start').value) $('lf-end').value = $('lf-start').value; update(); });
    $('lf-end').addEventListener('change', update);
    $('lf-note').addEventListener('input', update);
    update();
  }

  H.register({
    id: 'leave', name: 'Leave', desc: 'Staff leave – Leave Manager built in', icon: H.ICON.leave, tint: '#E8590C',
    roles: ['admin', 'pastor', 'rosters', 'kids', 'member'],
    stat: function (u) {
      var d = data();
      if (isLeaveAdmin()) { var n = d.requests.filter(function (r) { return r.status === 'Pending'; }).length; return n ? n + ' waiting for approval' : 'Nothing waiting'; }
      return takesLeave(d) ? 'Your balances and requests' : 'Who’s away';
    },
    todos: function () {
      var d = data(); if (!isLeaveAdmin()) return [];
      var n = d.requests.filter(function (r) { return r.status === 'Pending'; }).length;
      return n ? [{ text: 'Approve or decline ' + n + ' leave request' + (n === 1 ? '' : 's'), href: '#/leave/approvals' }] : [];
    },
    render: function (p) {
      var d = data(), v = p[0] || (takesLeave(d) ? '' : isLeaveAdmin() ? 'approvals' : 'away');
      var body = v === 'approvals' && isLeaveAdmin() ? renderApprovals(d) : v === 'team' && isLeaveAdmin() ? renderTeam(d) : v === 'away' ? renderAway(d) : takesLeave(d) ? renderMine(d) : renderAway(d);
      return '<div class="page-head"><div><h1>Leave</h1><p class="lead">Staff leave with the same rules as Leave Manager: only working days count, public holidays are free, and approved leave keeps people off the roster.</p></div>' +
        (takesLeave(d) || isLeaveAdmin() ? '<button class="btn primary" data-act="leave:request">' + H.icon(H.ICON.plus, 18) + (takesLeave(d) ? 'Request leave' : 'Book leave') + '</button>' : '') + '</div>' + tabs(d, v) + body;
    },
    actions: {
      request: function () { requestDialog(); },
      send: function () {
        var d = data(), $ = function (id) { return document.getElementById(id); };
        try {
          var p = C.prepareRequest(d, actor(d), { staffId: $('lf-who').value, type: $('lf-type').value, start: $('lf-start').value, end: $('lf-end').value || $('lf-start').value, half: 'None', reason: $('lf-note').value });
          var r = p.req; r.id = 'L' + Date.now().toString(36).toUpperCase(); r.submitted = H.today(); r.source = 'Hub';
          S.leave().requests.push(r); S.saveLeave((r.status === 'Approved' ? 'Booked ' : 'Requested ') + p.type.name + ' for ' + p.staff.name);
          H.closeModal(); H.render(); H.toast(r.status === 'Approved' ? 'Booked' : 'Sent – the Administrator will approve it');
        } catch (e) { $('lf-err').hidden = false; $('lf-err').textContent = e.message; }
      },
      decide: function (el) {
        if (el.dataset.d === 'Approved' && el.dataset.over && !el.dataset.sure) { H.confirmBtn(el, 'Approve anyway'); H.toast('This is more than their allowance', true); return; }
        var d = data();
        try {
          var p = C.prepareDecision(d, actor(d), el.dataset.id, el.dataset.d);
          p.req.status = el.dataset.d; p.req.decidedBy = H.name(H.user()); p.req.decidedOn = H.today();
          S.saveLeave(el.dataset.d + ' leave for ' + p.staff.name); H.render(); H.toast(el.dataset.d === 'Approved' ? 'Approved' : 'Declined');
        } catch (e) { H.toast(e.message, true); }
      },
      cancel: function (el) {
        if (!H.confirmBtn(el, 'Click again to cancel')) return;
        var d = data();
        try { var p = C.prepareCancel(d, actor(d), el.dataset.id, H.today()); p.req.status = 'Cancelled'; p.req.cancelledBy = H.name(H.user()); S.saveLeave('Cancelled leave'); H.render(); H.toast('Cancelled'); }
        catch (e) { H.toast(e.message, true); }
      }
    }
  });
})();
