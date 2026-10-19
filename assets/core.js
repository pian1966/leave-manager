/*
 * LeaveCore – shared leave rules.
 * This exact file runs in the browser (web/assets/core.js) AND in Google Apps Script
 * (apps-script/Core.gs), so balances and validation are always calculated the same way.
 * Written in plain ES5-style JavaScript so it works in both places.
 */
var LeaveCore = (function () {
  var DAYN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEK = [1, 2, 3, 4, 5, 6, 0]; // display order, Monday first

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function truthy(v) { return v === true || /^(true|yes|y|1)$/i.test(String(v)); }

  /** "Mon, Wed-Fri, Sun" or "1,3,4,5,0" → [1,3,4,5,0]. Empty → fallback. */
  function parseDays(s, fallback) {
    if (s == null || String(s).trim() === '') return fallback;
    var out = [];
    String(s).split(/[,;\/&\s]+|\band\b/i).forEach(function (part) {
      part = part.trim().toLowerCase();
      if (!part) return;
      var range = part.split(/[-–]/);
      if (range.length === 2 && DAYN[range[0].slice(0, 3)] != null && DAYN[range[1].slice(0, 3)] != null) {
        var a = WEEK.indexOf(DAYN[range[0].slice(0, 3)]), b = WEEK.indexOf(DAYN[range[1].slice(0, 3)]);
        for (var i = a; ; i = (i + 1) % 7) { if (out.indexOf(WEEK[i]) < 0) out.push(WEEK[i]); if (i === b) break; }
        return;
      }
      var n = /^\d$/.test(part) ? +part : DAYN[part.slice(0, 3)];
      if (n != null && n >= 0 && n <= 6 && out.indexOf(n) < 0) out.push(n);
    });
    return out.length ? out : fallback;
  }
  /** [3,4,5,6,0] → "Wed–Sun"; [6,0] → "Sat, Sun"; [3] → "Wed". */
  function daysLabel(list) {
    var on = WEEK.filter(function (d) { return list.indexOf(d) >= 0; });
    if (on.length === 7) return 'Every day';
    var idx = on.map(function (d) { return WEEK.indexOf(d); }), parts = [], i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
      if (j - i >= 2) parts.push(DAYS[WEEK[idx[i]]] + '–' + DAYS[WEEK[idx[j]]]);
      else for (var k = i; k <= j; k++) parts.push(DAYS[WEEK[idx[k]]]);
      i = j + 1;
    }
    return parts.join(', ');
  }

  function find(list, fn) { for (var i = 0; i < list.length; i++) if (fn(list[i])) return list[i]; return null; }
  function type(data, code) { return find(data.types, function (t) { return t.code === code; }); }
  function staffById(data, id) { return find(data.staff, function (s) { return s.id === id; }); }
  function level(data, st) { return st ? find(data.levels, function (l) { return String(l.level) === String(st.level); }) : null; }

  /** Context: church open days, each person's working days, holiday lookup and leave-year start month. */
  function ctx(data) {
    var open = parseDays(data.settings.OpenDays || data.settings.WorkingDays, [1, 2, 3, 4, 5]);
    var hol = {};
    (data.holidays || []).forEach(function (h) { hol[h.date] = h.name; });
    var S = Number(data.settings.LeaveYearStartMonth || 1) || 1;
    var swd = {};
    (data.staff || []).forEach(function (st) {
      var lv = level(data, st);
      swd[st.id] = parseDays(st.workDays, lv ? parseDays(lv.workDays, open) : open);
    });
    return { open: open, hol: hol, S: S, swd: swd };
  }
  function staffDays(c, sid) { return (sid && c.swd[sid]) || c.open; }
  function isOpen(d, c) { return c.open.indexOf(d.getDay()) >= 0; }
  /** With a staff id: is this one of their working days? Without: is the church open (and not a holiday)? */
  function isWorking(d, c, sid) { return staffDays(c, sid).indexOf(d.getDay()) >= 0 && !c.hol[iso(d)]; }

  /** Every day a request takes the person away from work, with 0.5 for half days. */
  function dayList(r, c) {
    var out = [], d = parse(r.start), e = parse(r.end), guard = 0;
    while (d <= e && guard++ < 800) {
      if (isWorking(d, c, r.staffId)) out.push({ date: iso(d), amt: 1 });
      d = addDays(d, 1);
    }
    if (r.half && r.half !== 'None' && out.length === 1) out[0].amt = 0.5;
    return out;
  }
  function countDays(r, c) { return dayList(r, c).reduce(function (s, x) { return s + x.amt; }, 0); }

  /* ---------- units: most leave counts in days; some (e.g. Weekend Off) count per booking ---------- */
  function isDayUnit(t) { return !t || !t.unit || /^days?$/i.test(String(t.unit).trim()); }
  /** "Calendar days": every date counts, including weekends and public holidays (e.g. Sabbatical). */
  function isCalendarUnit(t) { return !!t && /calendar/i.test(String(t.unit || '')); }
  function calendarDates(r) {
    var out = [], d = parse(r.start), e = parse(r.end), g = 0;
    while (d <= e && g++ < 800) { out.push({ date: iso(d), amt: 1 }); d = addDays(d, 1); }
    return out;
  }
  function fmtDays(n) {
    var neg = n < 0; n = Math.abs(n);
    var w = Math.floor(n), f = n - w;
    var s = f >= 0.25 && f < 0.75 ? (w ? w : '') + '½' : String(f >= 0.75 ? w + 1 : w);
    return (neg ? '−' : '') + s;
  }
  function unitName(t, n) {
    if (isDayUnit(t)) return n === 1 || n === 0.5 ? 'day' : 'days';
    if (isCalendarUnit(t)) return n === 1 ? 'calendar day' : 'calendar days';
    var plural = String(t.unit).trim().toLowerCase();
    return n === 1 ? plural.replace(/s$/, '') : plural;
  }
  function fmtAmount(t, n) { return fmtDays(n) + ' ' + unitName(t, n); }
  /** How much of the allowance a request uses. */
  function amount(r, t, c) { return isDayUnit(t) ? countDays(r, c) : isCalendarUnit(t) ? calendarDates(r).length : 1; }

  /** Leave years are identified by the calendar year they start in. */
  function lyOf(dateStr, S) { var p = String(dateStr).split('-'); var y = +p[0], m = +p[1]; return m >= S ? y : y - 1; }
  function lyLabel(y, S) { return S === 1 ? String(y) : y + '/' + String(y + 1).slice(2); }
  function lyRange(y, S) {
    return { start: iso(new Date(y, S - 1, 1, 12)), end: iso(addDays(new Date(y + 1, S - 1, 1, 12), -1)) };
  }

  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /** "1 Feb", "Feb 1" or "02-01" → [2, 1]. */
  function parseMonthDay(v) {
    var x = String(v || '').trim().toLowerCase(), m;
    if (!x) return null;
    if ((m = x.match(/^\d{4}-(\d{1,2})-(\d{1,2})/))) return [+m[1], +m[2]]; // a date the sheet auto-converted
    if ((m = x.match(/^(\d{1,2})[-\/](\d{1,2})$/))) return [+m[1], +m[2]];
    if ((m = x.match(/^(\d{1,2})\s*([a-z]{3})/))) return MON[m[2]] ? [MON[m[2]], +m[1]] : null;
    if ((m = x.match(/^([a-z]{3})[a-z]*\s*(\d{1,2})/))) return MON[m[1]] ? [MON[m[1]], +m[2]] : null;
    return null;
  }
  /** Last date (inclusive) on which last year's unused days of this type can still be used, during leave year y. */
  function graceEnd(t, y, S) {
    var md = t && t.useBy ? parseMonthDay(t.useBy) : null;
    if (!md) return null;
    var yr = y + (md[0] < S ? 1 : 0);
    return yr + '-' + pad(md[0]) + '-' + pad(md[1]);
  }

  /**
   * School terms. With TermsIncludeHolidays on (default), each term runs until the day before the next
   * term starts, so a weekend in the school holidays counts towards the term that has just finished.
   */
  function terms(data) {
    var list = (data.terms || []).filter(function (t) { return isISO(t.start) && isISO(t.end); })
      .slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var withHols = !/^false$/i.test(String(data.settings.TermsIncludeHolidays));
    return list.map(function (t, i) {
      var next = list[i + 1];
      var until = !withHols ? t.end : next ? iso(addDays(parse(next.start), -1)) : t.end.slice(0, 4) + '-12-31';
      return { name: t.name, start: t.start, end: t.end, from: t.start, until: until < t.end ? t.end : until };
    });
  }
  function termOf(data, dateStr) {
    return find(terms(data), function (t) { return dateStr >= t.from && dateStr <= t.until; });
  }
  /** Requests of this type already booked (approved or pending) in the same term. */
  function termBookings(data, staffId, code, term, ignoreId) {
    return data.requests.filter(function (o) {
      return o.staffId === staffId && o.type === code && o.id !== ignoreId &&
        (o.status === 'Approved' || o.status === 'Pending') && o.start >= term.from && o.start <= term.until;
    });
  }

  function canManage(user, st) {
    if (!user || !st) return false;
    if (user.role === 'Admin') return true;
    if (user.role === 'Manager' && st.id !== user.id && st.manager && st.manager === user.email) return true;
    return false;
  }

  /** Is this leave type open to this person's category? Types that use an allowance need a number on the Categories tab. */
  function offered(data, st, t) {
    if (!t || !st) return false;
    if (!t.deducts) return true;
    var lv = level(data, st);
    return !!lv && lv.ent[t.code] != null && !isNaN(lv.ent[t.code]);
  }

  /** One leave year's allowance (category + pro-rata + adjustments). */
  function yearAllowance(data, st, code, y) {
    var c = ctx(data), lv = level(data, st), t = type(data, code);
    var base = lv && lv.ent[code] != null ? Number(lv.ent[code]) || 0 : 0;
    if (t && t.proRata && st.start && isISO(st.start) && !/^false$/i.test(String(data.settings.ProRata))) {
      var r = lyRange(y, c.S);
      if (st.start > r.end) base = 0;
      else if (st.start > r.start) {
        var total = (parse(r.end) - parse(r.start)) / 864e5 + 1;
        var left = (parse(r.end) - parse(st.start)) / 864e5 + 1;
        base = Math.round(base * left / total * 2) / 2;
      }
    }
    var adj = 0;
    (data.adjustments || []).forEach(function (a) {
      if (a.staffId === st.id && a.type === code && Number(a.year) === y) adj += Number(a.days) || 0;
    });
    return base + adj;
  }
  function firstYear(data, st, y) {
    var S = ctx(data).S;
    var sy = st.start && isISO(st.start) ? lyOf(st.start, S) : y;
    return Math.max(sy, y - 60);
  }

  /**
   * { CODE: { YEAR: { approved, pending } } } for one person.
   * For types with a "use by" date (e.g. 1 Feb), days taken early in a leave year use up
   * last year's unused days first; after the use-by date those days are lost.
   */
  function usageAll(data, staffId) {
    var c = ctx(data), u = {}, st = staffById(data, staffId), late = {};
    var first = Number(data.settings.FirstLeaveYear) || 0;
    function add(code, y, amt, status) {
      var a = u[code] || (u[code] = {});
      var k = a[y] || (a[y] = { approved: 0, pending: 0 });
      if (status === 'Approved') k.approved += amt; else k.pending += amt;
    }
    data.requests.forEach(function (r) {
      if (r.staffId !== staffId || (r.status !== 'Approved' && r.status !== 'Pending')) return;
      var t = type(data, r.type);
      if (isCalendarUnit(t)) calendarDates(r).forEach(function (d) { add(r.type, lyOf(d.date, c.S), 1, r.status); });
      else if (!isDayUnit(t)) add(r.type, lyOf(r.start, c.S), 1, r.status);
      else if (t && t.deducts && t.useBy && st) dayList(r, c).forEach(function (d) {
        (late[r.type] || (late[r.type] = [])).push({ date: d.date, amt: d.amt, status: r.status });
      });
      else dayList(r, c).forEach(function (d) { add(r.type, lyOf(d.date, c.S), d.amt, r.status); });
    });
    Object.keys(late).forEach(function (code) {
      var t = type(data, code), used = {}, allow = {};
      var list = late[code].sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.status === 'Approved' ? -1 : 1); });
      list.forEach(function (d) {
        var y = lyOf(d.date, c.S), ge = graceEnd(t, y, c.S), amt = d.amt;
        if (ge && d.date <= ge && y - 1 >= first) {
          var py = y - 1;
          if (allow[py] == null) allow[py] = yearAllowance(data, st, code, py);
          var left = allow[py] - (used[py] || 0);
          var take = Math.max(0, Math.min(left, amt));
          if (take > 0) { add(code, py, take, d.status); used[py] = (used[py] || 0) + take; amt -= take; }
        }
        if (amt > 0) { add(code, y, amt, d.status); used[y] = (used[y] || 0) + amt; }
      });
    });
    return u;
  }

  /**
   * { CODE: { offered, entitled, approved, pending, remaining, available, broughtForward } }
   * entitled is null for types that don't use an allowance (or aren't open to this person).
   * For accumulating types (e.g. Sabbatical) entitled = unused balance from earlier years + this year's allowance.
   */
  function balances(data, staffId, y) {
    var st = staffById(data, staffId), all = usageAll(data, staffId), out = {};
    data.types.forEach(function (t) {
      var per = all[t.code] || {}, cur = per[y] || { approved: 0, pending: 0 };
      var off = offered(data, st, t), e = null, bf = 0;
      if (t.deducts && off) {
        e = yearAllowance(data, st, t.code, y);
        if (t.accumulates) {
          var cap = Number(t.maxBalance) > 0 ? Number(t.maxBalance) : Infinity, pot = 0;
          for (var yy = firstYear(data, st, y); yy <= y; yy++) {
            if (yy < y) {
              pot = Math.min(cap, pot + yearAllowance(data, st, t.code, yy)) - ((per[yy] || {}).approved || 0) - ((per[yy] || {}).pending || 0);
            }
          }
          bf = pot;
          e = Math.min(cap, bf + e);
          bf = Math.max(0, e - yearAllowance(data, st, t.code, y));
        }
      }
      var lastYear = null;
      if (e != null && t.useBy && st && y - 1 >= (Number(data.settings.FirstLeaveYear) || 0)) {
        var ge = graceEnd(t, y, ctx(data).S), prev = per[y - 1] || { approved: 0, pending: 0 };
        var left = yearAllowance(data, st, t.code, y - 1) - prev.approved - prev.pending;
        if (ge && left > 0) lastYear = { left: left, until: ge, fromYear: y - 1 };
      }
      out[t.code] = {
        offered: off, entitled: e, broughtForward: bf, lastYear: lastYear, approved: cur.approved, pending: cur.pending,
        remaining: e == null ? null : e - cur.approved,
        available: e == null ? null : e - cur.approved - cur.pending
      };
    });
    return out;
  }

  /** Returns an error message, or null when the request is fine. */
  function validate(data, st, r, ignoreId, approving) {
    var t = type(data, r.type);
    if (!t) return 'Choose a leave type.';
    if (!st) return 'Choose who the leave is for.';
    if (!offered(data, st, t)) return t.name + ' isn’t available to ' + (st.level ? st.level : 'this person') + '.';
    if (!isISO(r.start) || !isISO(r.end)) return 'Pick a first and last day.';
    if (r.end < r.start) return 'The last day is before the first day.';
    if (r.half && r.half !== 'None') {
      if (!t.halfDay) return t.name + ' can’t be taken as a half day.';
      if (r.start !== r.end) return 'Half days can only be booked on a single date.';
    }
    var allowed = t.allowedDays ? parseDays(t.allowedDays, null) : null;
    if (allowed) {
      var d0 = parse(r.start), e0 = parse(r.end), g = 0;
      while (d0 <= e0 && g++ < 800) {
        if (allowed.indexOf(d0.getDay()) < 0) return t.name + ' can only be booked on ' + daysLabel(allowed) + '.';
        d0 = addDays(d0, 1);
      }
    }
    if (Number(t.perTerm) > 0) {
      var term = termOf(data, r.start);
      if (!term) return t.name + ' is limited per school term, but ' + r.start + ' isn’t in any term on the School Terms tab. Ask an admin to add the term dates.';
      if (r.end > term.until) return t.name + ' can’t run from one school term into the next.';
      var used = termBookings(data, st.id, t.code, term, ignoreId);
      if (used.length >= Number(t.perTerm)) {
        return st.name.split(' ')[0] + ' has already booked ' + (Number(t.perTerm) === 1 ? 'the ' : Number(t.perTerm) + ' of the ') + t.name + ' for ' + term.name +
          ' (' + used[0].start + '). Only ' + t.perTerm + ' per term is allowed.';
      }
    }
    var c = ctx(data), days = dayList(r, c);
    if (!days.length) return 'Those dates are all days ' + st.name.split(' ')[0] + ' doesn’t work, or public holidays, so no leave is needed.';
    if (days.length > 260) return 'That request is longer than a year. Split it into smaller requests.';
    var clash = data.requests.filter(function (o) {
      if (o.staffId !== st.id || o.id === ignoreId) return false;
      if (o.status !== 'Approved' && o.status !== 'Pending') return false;
      if (!(o.start <= r.end && o.end >= r.start)) return false;
      var halves = r.start === r.end && o.start === o.end && r.half && o.half &&
        r.half !== 'None' && o.half !== 'None' && r.half !== o.half;
      return !halves;
    });
    if (clash.length) {
      var ct = type(data, clash[0].type);
      return st.name + ' already has ' + (ct ? ct.name : 'leave') + ' booked from ' + clash[0].start + ' to ' + clash[0].end + '.';
    }
    if (t.deducts && !truthy(data.settings.AllowNegative)) {
      // Compare balances with and without this request in every leave year it touches.
      var others = data.requests.filter(function (o) { return o.id !== ignoreId; });
      var cand = { id: '__check__', staffId: st.id, type: r.type, start: r.start, end: r.end, half: r.half || 'None', status: approving ? 'Approved' : 'Pending' };
      var before = {}, after = {};
      for (var k in data) { before[k] = data[k]; after[k] = data[k]; }
      before.requests = others; after.requests = others.concat([cand]);
      var ys = {};
      calendarDates(r).forEach(function (d) {
        var y = lyOf(d.date, c.S); ys[y] = 1;
        var ge = graceEnd(t, y, c.S);
        if (ge && d.date <= ge && y - 1 >= (Number(data.settings.FirstLeaveYear) || 0)) ys[y - 1] = 1;
      });
      var key = approving ? 'remaining' : 'available', failY = null, have = 0, yl = Object.keys(ys).map(Number).sort();
      yl.forEach(function (y) {
        var b0 = balances(before, st.id, y)[t.code], b1 = balances(after, st.id, y)[t.code];
        if (!t.accumulates || y === yl[yl.length - 1]) have += Math.max(0, b0[key]);
        if (b1[key] < -1e-9 && b1[key] < b0[key] - 1e-9) failY = y;
      });
      if (failY != null) {
        var need = amount(r, t, c);
        return 'Not enough ' + t.name + ': this needs ' + fmtAmount(t, need) + ' but only ' + fmtAmount(t, have) +
          (approving ? ' remain' : ' are available') + (yl.length > 1 ? '' : ' in the ' + lyLabel(failY, c.S) + ' leave year') + '.';
      }
    }
    return null;
  }

  /** Builds a new request (validated) and decides whether it is auto-approved. */
  function prepareRequest(data, actor, b) {
    var target = b.staffId && b.staffId !== actor.id ? staffById(data, b.staffId) : actor;
    if (!target) throw new Error('That staff member isn’t on the Staff sheet.');
    if (target.id !== actor.id && !canManage(actor, target)) throw new Error('You can only book leave for people in your team.');
    var t0 = type(data, String(b.type || ''));
    var r = {
      staffId: target.id, type: String(b.type || ''),
      start: String(b.start || '').slice(0, 10), end: String(b.end || b.start || '').slice(0, 10),
      half: (b.half === 'AM' || b.half === 'PM') && isDayUnit(t0) ? b.half : 'None',
      reason: String(b.reason || '').slice(0, 500)
    };
    var err = validate(data, target, r);
    if (err) throw new Error(err);
    var t = type(data, r.type);
    r.days = countDays(r, ctx(data));
    var bookedByManager = target.id !== actor.id;
    var auto = !t.needsApproval || bookedByManager;
    r.status = auto ? 'Approved' : 'Pending';
    r.decidedBy = auto ? (bookedByManager ? actor.name : 'Auto-approved') : '';
    return { req: r, staff: target, type: t };
  }

  function findReq(data, id) { return find(data.requests, function (r) { return r.id === id; }); }

  function prepareDecision(data, actor, id, decision) {
    var r = findReq(data, id);
    if (!r) throw new Error('That request no longer exists.');
    if (r.status !== 'Pending') throw new Error('This request has already been ' + String(r.status).toLowerCase() + '.');
    var st = staffById(data, r.staffId);
    if (!canManage(actor, st)) throw new Error('Only ' + (st ? st.name.split(' ')[0] + '’s' : 'the') + ' manager or an admin can decide this request.');
    if (decision !== 'Approved' && decision !== 'Declined') throw new Error('Choose approve or decline.');
    if (decision === 'Approved') { var err = validate(data, st, r, r.id, true); if (err) throw new Error(err); }
    return { req: r, staff: st, type: type(data, r.type) };
  }

  function prepareCancel(data, actor, id, todayStr) {
    var r = findReq(data, id);
    if (!r) throw new Error('That request no longer exists.');
    if (r.status !== 'Pending' && r.status !== 'Approved') throw new Error('Only pending or approved leave can be cancelled.');
    var st = staffById(data, r.staffId), mine = r.staffId === actor.id;
    var ok = canManage(actor, st) || (mine && (r.status === 'Pending' || r.start > todayStr));
    if (!ok) throw new Error(mine ? 'Leave that has already started can only be cancelled by your manager.' : 'You can only cancel your own leave.');
    return { req: r, staff: st, type: type(data, r.type) };
  }

  /** What one signed-in person is allowed to see. Fields starting with "_" never leave the server. */
  function publicView(data, user) {
    function clean(o) { var x = {}; for (var k in o) if (k.charAt(0) !== '_' && k !== 'eventId') x[k] = o[k]; return x; }
    var byId = {};
    data.staff.forEach(function (s) { byId[s.id] = s; });
    return {
      settings: data.settings,
      user: clean(user),
      staff: data.staff.filter(function (s) { return s.active !== false; }).map(clean),
      types: data.types, levels: data.levels, holidays: data.holidays, terms: data.terms || [],
      requests: data.requests.map(function (r) {
        var x = clean(r);
        if (r.staffId !== user.id && !canManage(user, byId[r.staffId])) { x.reason = ''; x.note = ''; }
        return x;
      }),
      adjustments: (data.adjustments || []).filter(function (a) { return a.staffId === user.id || canManage(user, byId[a.staffId]); })
    };
  }

  return {
    DAYS: DAYS, iso: iso, parse: parse, addDays: addDays, isISO: isISO, truthy: truthy, parseDays: parseDays, daysLabel: daysLabel,
    ctx: ctx, staffDays: staffDays, isOpen: isOpen, isWorking: isWorking,
    dayList: dayList, countDays: countDays, isDayUnit: isDayUnit, isCalendarUnit: isCalendarUnit, unitName: unitName, fmtAmount: fmtAmount, amount: amount,
    lyOf: lyOf, lyLabel: lyLabel, lyRange: lyRange, graceEnd: graceEnd, parseMonthDay: parseMonthDay, terms: terms, termOf: termOf, termBookings: termBookings,
    type: type, staffById: staffById, level: level, canManage: canManage, offered: offered, yearAllowance: yearAllowance,
    balances: balances, validate: validate, fmtDays: fmtDays, findReq: findReq,
    prepareRequest: prepareRequest, prepareDecision: prepareDecision, prepareCancel: prepareCancel,
    publicView: publicView
  };
})();
if (typeof module !== 'undefined') module.exports = LeaveCore;
