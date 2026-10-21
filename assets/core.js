/*
 * LeaveCore – shared leave rules.
 * This exact file runs in the browser (web/assets/core.js) AND in Google Apps Script
 * (apps-script/Core.gs), so balances and validation are always calculated the same way.
 * Written in plain ES5-style JavaScript so it works in both places.
 */
var LeaveCore = (function () {
  var DAYN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEK = [1, 2, 3, 4, 5, 6, 0]; // display order, Monday first

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  /** "2026-06-21" → "Sun 21 Jun 2026" (year left off when withYear is false). */
  function niceDate(s, withYear) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(s || ''))) return String(s || '');
    var d = parse(s);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONS[d.getMonth()] + (withYear === false ? '' : ' ' + d.getFullYear());
  }
  /** A request's dates: "Sun 21 Jun – Thu 25 Jun 2026", or "Sun 21 Jun 2026 (morning)" for one day. */
  function niceRange(r) {
    if (r.start === r.end || !r.end) {
      return niceDate(r.start) + (r.half === 'AM' ? ' (morning)' : r.half === 'PM' ? ' (afternoon)' : '');
    }
    var sameYear = String(r.start).slice(0, 4) === String(r.end).slice(0, 4);
    return niceDate(r.start, !sameYear) + ' – ' + niceDate(r.end);
  }
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
  /** Category names are matched loosely: capitals, extra spaces and – / — / - dashes don't matter. */
  function catKey(v) { return String(v == null ? '' : v).toLowerCase().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim(); }
  function level(data, st) {
    if (!st) return null;
    var k = catKey(st.level);
    return find(data.levels, function (l) { return catKey(l.level) === k; });
  }

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

  /* ---------- South African public holidays (Public Holidays Act 36 of 1994) ---------- */
  function easter(y) { // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var n = h + l - 7 * m + 114;
    return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1, 12);
  }
  /** All statutory public holidays for a year, including the Monday after any that fall on a Sunday. */
  function saPublicHolidays(y) {
    var fixed = [[1, 1, "New Year's Day"], [3, 21, 'Human Rights Day'], [4, 27, 'Freedom Day'], [5, 1, "Workers' Day"],
      [6, 16, 'Youth Day'], [8, 9, "National Women's Day"], [9, 24, 'Heritage Day'], [12, 16, 'Day of Reconciliation'],
      [12, 25, 'Christmas Day'], [12, 26, 'Day of Goodwill']];
    var e = easter(y), list = [], taken = {};
    function push(dt, name) { var k = iso(dt); if (!taken[k]) { taken[k] = 1; list.push({ date: k, name: name }); } }
    fixed.forEach(function (x) { push(new Date(y, x[0] - 1, x[1], 12), x[2]); });
    push(addDays(e, -2), 'Good Friday');
    push(addDays(e, 1), 'Family Day');
    list.slice().forEach(function (h) {
      var d = parse(h.date);
      if (d.getDay() !== 0) return;
      var next = addDays(d, 1);
      while (taken[iso(next)]) next = addDays(next, 1); // e.g. Christmas on a Sunday: Monday is already Day of Goodwill
      push(next, h.name + ' (observed)');
    });
    return list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
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

  /** Administrators approve all leave and see everyone's details. ("Admin" is accepted for older sheets.) */
  function isAdmin(user) { return !!user && /^admin(istrator)?$/i.test(String(user.role || '').trim()); }
  /** Administrators manage everyone; a stand-in approver (while active) can approve or decline other people's leave. */
  function canManage(user, st) {
    return !!user && !!st && (isAdmin(user) || (user.standIn === true && st.id !== user.id));
  }

  /* ---------- Stand-in approver (Settings: StandInID, StandInFrom, StandInTo) ---------- */
  function standInId(data, today) {
    var s = data.settings || {}, id = String(s.StandInID || '').trim();
    if (!id) return '';
    var from = String(s.StandInFrom || '').slice(0, 10), to = String(s.StandInTo || '').slice(0, 10);
    if (isISO(from) && today < from) return '';
    if (isISO(to) && today > to) return '';
    return id;
  }
  /** Marks the active stand-in on the staff list (staff.standIn = true). Returns their id, or ''. */
  function applyStandIn(data, today) {
    var id = standInId(data, today);
    (data.staff || []).forEach(function (st) { st.standIn = !!id && st.id === id && !isAdmin(st); });
    return id;
  }

  /* ---------- Cover rules (the Cover Rules tab) ----------
     kind "Minimum on duty": at least `min` people of `category` must be working on matching days.
     kind "No leave": leave isn't allowed for `category` on matching days (e.g. Easter, Christmas).
     Days: weekdays (e.g. "Sun"); blank = every day. From/To: a date (2026-12-24), a yearly date ("24 Dec"),
     or Easter-based ("Easter-2" = Good Friday, "Easter+1" = Family Day); blank = all year.
     Action "Block" stops staff sending the request; "Warn" lets it through with a warning.
     The Administrator can always override. */
  function ruleDate(spec, y) {
    var v = String(spec || '').trim();
    if (!v) return '';
    if (isISO(v.slice(0, 10))) return v.slice(0, 10);
    var m = /^easter\s*([+-]\s*\d+)?$/i.exec(v);
    if (m) return iso(addDays(easter(y), m[1] ? Number(m[1].replace(/\s/g, '')) : 0));
    var md = parseMonthDay(v);
    return md ? y + '-' + pad(md[0]) + '-' + pad(md[1]) : '';
  }
  function ruleCovers(rule, ds) {
    if (rule.days) {
      var wd = parseDays(rule.days, null);
      if (wd && wd.indexOf(parse(ds).getDay()) < 0) return false;
    }
    if (!rule.from && !rule.to) return true;
    var Y = Number(ds.slice(0, 4));
    for (var y = Y - 1; y <= Y; y++) {
      var f = rule.from ? ruleDate(rule.from, y) : '0000-01-01';
      var t = rule.to ? ruleDate(rule.to, y) : '9999-12-31';
      if (!f || !t) continue;
      if (t < f) t = rule.to ? ruleDate(rule.to, y + 1) : t;   // e.g. 24 Dec – 2 Jan
      if (ds >= f && ds <= t) return true;
    }
    return false;
  }
  function ruleCats(rule) {
    return String(rule.category || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(String);
  }
  function inRuleGroup(rule, st) {
    if (!st || !tracksLeave(st) || st.active === false) return false;
    var cats = ruleCats(rule);
    var lv = catKey(st.level);
    return !cats.length || cats.map(catKey).some(function (c) { return lv === c || (c.indexOf(' ') > 0 && lv.slice(-(c.length + 1)) === ' ' + c); });
  }
  function activeRules(data) {
    return (data.rules || []).filter(function (r) { return r && r.active !== false && r.kind; });
  }
  function isMinRule(rule) { return /min/i.test(String(rule.kind)); }
  /** { date: { staffId: true } } for approved and pending leave (optionally ignoring one request). */
  function awayMap(data, c, ignoreId) {
    var away = {};
    data.requests.forEach(function (o) {
      if (o.id === ignoreId || (o.status !== 'Approved' && o.status !== 'Pending')) return;
      dayList(o, c).forEach(function (d) { (away[d.date] || (away[d.date] = {}))[o.staffId] = true; });
    });
    return away;
  }
  function onDuty(data, c, away, rule, ds) {
    var d = parse(ds);
    return data.staff.filter(function (p) {
      return inRuleGroup(rule, p) && isWorking(d, c, p.id) && !(away[ds] && away[ds][p.id]);
    });
  }
  function listDates(dates) {
    var shown = dates.slice(0, 3).map(function (x) { return niceDate(x); }).join(', ');
    return shown + (dates.length > 3 ? ' and ' + (dates.length - 3) + ' more' : '');
  }
  function groupLabel(rule) { return rule.category ? String(rule.category).trim() : 'staff'; }
  /** Checks a request against the cover rules: { block: [messages], warn: [messages] }. */
  function coverCheck(data, st, r, ignoreId) {
    var out = { block: [], warn: [] }, rules = activeRules(data);
    if (!rules.length || !st) return out;
    var c = ctx(data), days = dayList({ staffId: st.id, start: r.start, end: r.end, half: r.half }, c), away = awayMap(data, c, ignoreId);
    rules.forEach(function (rule) {
      if (!inRuleGroup(rule, st)) return;
      var hits = [], low = null;
      days.forEach(function (d) {
        if (!ruleCovers(rule, d.date)) return;
        if (isMinRule(rule)) {
          var still = onDuty(data, c, away, rule, d.date).filter(function (p) { return p.id !== st.id; }).length;
          var min = Number(rule.min) > 0 ? Number(rule.min) : 1;
          if (still < min) { hits.push(d.date); low = low == null ? still : Math.min(low, still); }
        } else hits.push(d.date);
      });
      if (!hits.length) return;
      var msg = isMinRule(rule)
        ? (rule.name || 'Cover rule') + ': only ' + low + ' ' + groupLabel(rule) + ' would be on duty on ' + listDates(hits) + ' (at least ' + (Number(rule.min) > 0 ? Number(rule.min) : 1) + ' needed).'
        : (rule.name || 'No-leave period') + ': leave isn’t allowed on ' + listDates(hits) + '.';
      if (rule.message) msg += ' ' + rule.message;
      (/block/i.test(String(rule.action)) ? out.block : out.warn).push(msg);
    });
    return out;
  }
  /** Days from `from` to `to` where existing approved/pending leave already breaks a "Minimum on duty" rule. */
  function coverBreaches(data, from, to) {
    var out = [], rules = activeRules(data).filter(isMinRule);
    if (!rules.length) return out;
    var c = ctx(data), away = awayMap(data, c), d = parse(from), e = parse(to), g = 0;
    while (d <= e && g++ < 800) {
      var ds = iso(d);
      rules.forEach(function (rule) {
        if (!ruleCovers(rule, ds)) return;
        var everyone = data.staff.filter(function (p) { return inRuleGroup(rule, p) && isWorking(d, c, p.id); });
        if (!everyone.length) return;
        var here = onDuty(data, c, away, rule, ds), min = Number(rule.min) > 0 ? Number(rule.min) : 1;
        if (here.length < min) out.push({ date: ds, rule: rule, onDuty: here.length, min: min,
          away: everyone.filter(function (p) { return away[ds] && away[ds][p.id]; }).map(function (p) { return p.name; }) });
      });
      d = addDays(d, 1);
    }
    return out;
  }

  /* ---------- "Use it or lose it" ---------- */
  /** Leave with a use-by date (e.g. 1 Feb) that this person still has to take: [{ type, left, until, fromYear }]. */
  function useItOrLoseIt(data, staffId, today) {
    var st = staffById(data, staffId), c = ctx(data), out = [];
    if (!st || !tracksLeave(st) || st.active === false) return out;
    var y = lyOf(today, c.S), first = Number(data.settings.FirstLeaveYear) || 0;
    data.types.forEach(function (t) {
      if (!t.deducts || !t.useBy || !offered(data, st, t)) return;
      var b = balances(data, staffId, y)[t.code];
      if (b.lastYear && today <= b.lastYear.until && b.lastYear.left > 0) out.push({ type: t, left: b.lastYear.left, until: b.lastYear.until, fromYear: y - 1 });
      var ge = graceEnd(t, y + 1, c.S);
      if (y >= first && b.available > 0) out.push({ type: t, left: b.available, until: ge || lyRange(y, c.S).end, fromYear: y });
    });
    return out;
  }
  /** People in the "Administrator" category manage leave but don't take leave in the planner. */
  function tracksLeave(st) { return !!st && !/^administrators?$/.test(catKey(st.level)); }

  /** Is this leave type open to this person's category? Types that use an allowance need a number on the Categories tab. */
  function offered(data, st, t) {
    if (!t || !st || !tracksLeave(st)) return false;
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
  function validate(data, st, r, ignoreId, approving, override) {
    var t = type(data, r.type);
    if (!t) return 'Choose a leave type.';
    if (!st) return 'Choose who the leave is for.';
    if (!tracksLeave(st)) return st.name + ' is in the Administrator category, so their leave isn’t tracked in the planner.';
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
      if (!term) return t.name + ' is limited per school term, but ' + niceDate(r.start) + ' isn’t in any term on the School Terms tab. Ask an admin to add the term dates.';
      if (r.end > term.until) return t.name + ' can’t run from one school term into the next.';
      var used = termBookings(data, st.id, t.code, term, ignoreId);
      if (used.length >= Number(t.perTerm)) {
        return st.name.split(' ')[0] + ' has already booked ' + (Number(t.perTerm) === 1 ? 'the ' : Number(t.perTerm) + ' of the ') + t.name + ' for ' + term.name +
          ' (' + niceRange(used[0]) + '). Only ' + t.perTerm + ' per term is allowed.';
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
      return st.name + ' already has ' + (ct ? ct.name : 'leave') + (clash[0].status === 'Pending' ? ' waiting for approval' : ' booked') + ' for ' + niceRange(clash[0]) + '.';
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
    if (!override) {
      var cv = coverCheck(data, st, r, ignoreId);
      if (cv.block.length) return cv.block[0] + ' If it can’t wait, speak to the Administrator.';
    }
    return null;
  }

  var NOTE_NEEDED = 'Please add a note for the Administrator saying what the leave is for.';
  /** Builds a new request (validated) and decides whether it is auto-approved. */
  function prepareRequest(data, actor, b) {
    var target = b.staffId && b.staffId !== actor.id ? staffById(data, b.staffId) : actor;
    if (!target) throw new Error('That staff member isn’t on the Staff sheet.');
    if (target.id !== actor.id && !isAdmin(actor)) throw new Error('Only an Administrator can book leave for someone else.');
    var t0 = type(data, String(b.type || ''));
    var r = {
      staffId: target.id, type: String(b.type || ''),
      start: String(b.start || '').slice(0, 10), end: String(b.end || b.start || '').slice(0, 10),
      half: (b.half === 'AM' || b.half === 'PM') && isDayUnit(t0) ? b.half : 'None',
      reason: String(b.reason || '').slice(0, 500)
    };
    if (target.id === actor.id && String(r.reason).trim().length < 3) throw new Error(NOTE_NEEDED);
    var err = validate(data, target, r, undefined, false, isAdmin(actor));
    if (err) throw new Error(err);
    var t = type(data, r.type);
    var cw = coverCheck(data, target, r);
    r.warnings = cw.block.concat(cw.warn);
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
    if (!canManage(actor, st)) throw new Error('Only an Administrator can approve or decline leave.');
    if (decision !== 'Approved' && decision !== 'Declined') throw new Error('Choose approve or decline.');
    if (decision === 'Approved') { var err = validate(data, st, r, r.id, true, true); if (err) throw new Error(err); }
    return { req: r, staff: st, type: type(data, r.type) };
  }

  function prepareCancel(data, actor, id, todayStr) {
    var r = findReq(data, id);
    if (!r) throw new Error('That request no longer exists.');
    if (r.status !== 'Pending' && r.status !== 'Approved') throw new Error('Only pending or approved leave can be cancelled.');
    var st = staffById(data, r.staffId), mine = r.staffId === actor.id;
    var ok = isAdmin(actor) || (mine && (r.status === 'Pending' || r.start > todayStr));
    if (!ok) throw new Error(mine ? 'Leave that has already started can only be cancelled by an Administrator.' : 'You can only cancel your own leave.');
    return { req: r, staff: st, type: type(data, r.type) };
  }

  /** What one signed-in person is allowed to see. Fields starting with "_" never leave the server. */
  function publicView(data, user) {
    function clean(o) {
      var x = {};
      for (var k in o) if (k.charAt(0) !== '_' && k !== 'eventId' && !(k === 'pinChosen' && !isAdmin(user) && o.id !== user.id)) x[k] = o[k];
      return x;
    }
    var byId = {};
    data.staff.forEach(function (s) { byId[s.id] = s; });
    return {
      settings: data.settings,
      user: clean(user),
      staff: data.staff.filter(function (s) { return s.active !== false; }).map(clean),
      types: data.types, levels: data.levels, holidays: data.holidays, terms: data.terms || [], rules: data.rules || [],
      requests: data.requests.map(function (r) {
        var x = clean(r);
        if (r.staffId !== user.id && !canManage(user, byId[r.staffId])) { x.reason = ''; x.note = ''; }
        return x;
      }),
      adjustments: (data.adjustments || []).filter(function (a) { return a.staffId === user.id || canManage(user, byId[a.staffId]); })
    };
  }

  return {
    DAYS: DAYS, iso: iso, niceDate: niceDate, niceRange: niceRange, parse: parse, addDays: addDays, isISO: isISO, truthy: truthy, parseDays: parseDays, daysLabel: daysLabel,
    ctx: ctx, staffDays: staffDays, isOpen: isOpen, isWorking: isWorking,
    dayList: dayList, countDays: countDays, isDayUnit: isDayUnit, isCalendarUnit: isCalendarUnit, unitName: unitName, fmtAmount: fmtAmount, amount: amount,
    easter: easter, saPublicHolidays: saPublicHolidays,
    lyOf: lyOf, lyLabel: lyLabel, lyRange: lyRange, graceEnd: graceEnd, parseMonthDay: parseMonthDay, terms: terms, termOf: termOf, termBookings: termBookings,
    type: type, staffById: staffById, level: level, catKey: catKey, canManage: canManage, isAdmin: isAdmin, tracksLeave: tracksLeave, offered: offered, yearAllowance: yearAllowance,
    balances: balances, validate: validate, fmtDays: fmtDays, findReq: findReq,
    prepareRequest: prepareRequest, prepareDecision: prepareDecision, prepareCancel: prepareCancel,
    publicView: publicView,
    standInId: standInId, applyStandIn: applyStandIn,
    ruleDate: ruleDate, ruleCovers: ruleCovers, coverCheck: coverCheck, coverBreaches: coverBreaches, useItOrLoseIt: useItOrLoseIt
  };
})();
if (typeof module !== 'undefined') module.exports = LeaveCore;
