/*
 * Church Hub – rostering engine (shared by the app, the future server, and the tests).
 *
 * What makes it different from "random" rostering:
 *  - Together groups: a family or friends who want to serve at the SAME service.
 *      strength "must"   → the whole group is rostered together, or none of them.
 *      strength "prefer" → try to place them together; if that's impossible, place people on their own.
 *  - Apart groups: people who must NOT serve at the same service (e.g. parents of a baby).
 *  - Nobody is rostered while away: approved leave (from the Leave app) and blockout dates.
 *  - Fair turns: people who haven't served for longest go first; each person's preferred frequency is respected.
 *  - Deterministic and explainable: no randomness; every assignment carries a plain-English reason.
 *
 * Data (all plain objects, ISO dates 'yyyy-mm-dd'):
 *   people:       [{ id, firstName, lastName, active }]
 *   positions:    [{ id, teamId, name, needed }]                  needed = people per service
 *   skills:       [{ personId, positionId, frequency }]            frequency: 'weekly' | 'fortnightly' | 'monthly' | 'occasional'
 *   services:     [{ id, date, time, name }]
 *   assignments:  [{ id, serviceId, positionId, personId, status, source }]  status: pending | accepted | declined
 *   groups:       [{ id, name, kind: 'together'|'apart', strength: 'must'|'prefer', memberIds: [] }]
 *   away:         [{ personId, from, to, reason }]                 blockouts + approved leave
 */
var RosterCore = (function () {
  'use strict';

  var FREQ_DAYS = { weekly: 7, fortnightly: 14, monthly: 28, occasional: 56 };

  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function byId(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function fullName(p) { return p ? (p.firstName + ' ' + p.lastName).trim() : ''; }

  /** Is this person away (leave or blockout) on this date? Returns the reason or ''. */
  function awayReason(data, personId, date) {
    var hit = (data.away || []).filter(function (a) { return a.personId === personId && a.from <= date && (a.to || a.from) >= date; })[0];
    return hit ? (hit.reason || 'Away') : '';
  }

  /** Groups a person belongs to, by kind. */
  function groupsOf(data, personId, kind) {
    return (data.groups || []).filter(function (g) { return g.kind === kind && g.memberIds.indexOf(personId) >= 0; });
  }

  /**
   * Suggest people for every open slot in the given services.
   * Returns { assignments: [new assignment objects], gaps: [{serviceId, positionId, missing, why}], notes: [] }.
   * Existing assignments (any status) are respected; declined people are not asked again for that service.
   */
  function autoFill(data, serviceIds, opts) {
    opts = opts || {};
    var people = byId(data.people), positions = data.positions || [];
    var services = (data.services || []).filter(function (s) { return serviceIds.indexOf(s.id) >= 0; })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
    var all = (data.assignments || []).slice();          // existing + what we add as we go
    var added = [], gaps = [], seq = 0;

    function serviceOf(id) { return (data.services || []).filter(function (s) { return s.id === id; })[0]; }
    function live(a) { return a.status !== 'declined'; }
    function filled(serviceId, positionId) { return all.filter(function (a) { return a.serviceId === serviceId && a.positionId === positionId && live(a); }).length; }
    function servingAt(serviceId, personId) { return all.some(function (a) { return a.serviceId === serviceId && a.personId === personId && live(a); }); }
    function declined(serviceId, personId) { return all.some(function (a) { return a.serviceId === serviceId && a.personId === personId && a.status === 'declined'; }); }
    function lastServed(personId, beforeDate) {
      var last = '';
      all.forEach(function (a) {
        if (a.personId !== personId || !live(a)) return;
        var s = serviceOf(a.serviceId); if (s && s.date < beforeDate && s.date > last) last = s.date;
      });
      return last;
    }
    function turnsIn(personId, date, days) {
      return all.filter(function (a) {
        if (a.personId !== personId || !live(a)) return false;
        var s = serviceOf(a.serviceId); if (!s) return false;
        var d = daysBetween(s.date, date); return d > -days && d < days;
      }).length;
    }
    function skillFor(personId, positionId) { return (data.skills || []).filter(function (k) { return k.personId === personId && k.positionId === positionId; })[0]; }

    /** Can this person take this position at this service? '' = yes, otherwise why not. */
    function blocker(svc, personId, positionId) {
      var p = people[personId];
      if (!p || p.active === false) return 'not active';
      if (!skillFor(personId, positionId)) return 'not on this team';
      var away = awayReason(data, personId, svc.date); if (away) return away;
      if (servingAt(svc.id, personId)) return 'already serving at this service';
      if (declined(svc.id, personId)) return 'said no to this service';
      var apart = groupsOf(data, personId, 'apart').some(function (g) {
        return g.memberIds.some(function (o) { return o !== personId && servingAt(svc.id, o); });
      });
      if (apart) return 'kept apart from someone already serving';
      var k = skillFor(personId, positionId), gap = FREQ_DAYS[k.frequency] || 14;
      var last = lastServed(personId, svc.date);
      if (last && daysBetween(last, svc.date) < Math.min(gap, 7) ) return 'served too recently';
      return '';
    }

    /** Lower is better: people who've waited longest and served least come first. */
    function score(svc, personId, positionId) {
      var k = skillFor(personId, positionId), want = FREQ_DAYS[k.frequency] || 14;
      var last = lastServed(personId, svc.date), since = last ? daysBetween(last, svc.date) : 999;
      var s = 0;
      if (since < want) s += 50 + (want - since);          // sooner than they asked to serve
      s -= Math.min(since, 120) / 7;                        // waited longer → earlier
      s += turnsIn(personId, svc.date, 56) * 3;             // spread turns over 8 weeks
      return s;
    }

    /** For a together-group, find one open slot at this service for every member (other than `first`). */
    function placeGroup(svc, group, first, firstPos) {
      var plan = [{ personId: first, positionId: firstPos }];
      var taken = {}; taken[firstPos] = 1;
      var others = group.memberIds.filter(function (m) { return m !== first; });
      for (var i = 0; i < others.length; i++) {
        var m = others[i], best = null;
        if (servingAt(svc.id, m)) continue;                 // already there: counts as together
        positions.forEach(function (pos) {
          var open = (pos.needed || 1) - filled(svc.id, pos.id) - (taken[pos.id] || 0);
          if (open <= 0 || blocker(svc, m, pos.id)) return;
          var sc = score(svc, m, pos.id);
          if (!best || sc < best.sc) best = { positionId: pos.id, sc: sc };
        });
        if (!best) return { ok: false, who: m };
        plan.push({ personId: m, positionId: best.positionId });
        taken[best.positionId] = (taken[best.positionId] || 0) + 1;
      }
      return { ok: true, plan: plan };
    }

    function add(svc, personId, positionId, reason) {
      var a = { id: 'auto-' + svc.id + '-' + (++seq), serviceId: svc.id, positionId: positionId, personId: personId, status: 'pending', source: 'auto', reason: reason };
      all.push(a); added.push(a);
    }

    services.forEach(function (svc) {
      positions.forEach(function (pos) {
        var guard = 0;
        while (filled(svc.id, pos.id) < (pos.needed || 1) && guard++ < 50) {
          var cands = (data.skills || []).filter(function (k) { return k.positionId === pos.id; })
            .map(function (k) { return k.personId; })
            .filter(function (pid) { return !blocker(svc, pid, pos.id); })
            .sort(function (a, b) { return (score(svc, a, pos.id) - score(svc, b, pos.id)) || (fullName(people[a]) < fullName(people[b]) ? -1 : 1); });
          var done = false;
          for (var i = 0; i < cands.length && !done; i++) {
            var pid = cands[i], tg = groupsOf(data, pid, 'together');
            if (!tg.length) { add(svc, pid, pos.id, reasonFor(svc, pid)); done = true; break; }
            var g = tg[0], placed = placeGroup(svc, g, pid, pos.id);
            if (placed.ok) {
              placed.plan.forEach(function (x) { add(svc, x.personId, x.positionId, 'Serving together: ' + g.name); });
              done = true;
            } else if (g.strength !== 'must') {
              add(svc, pid, pos.id, reasonFor(svc, pid) + ' (couldn’t place “' + g.name + '” together this time)');
              done = true;
            }
            // must-group that can't all serve: skip this person and try the next candidate
          }
          if (!done) {
            var why = (data.skills || []).filter(function (k) { return k.positionId === pos.id; }).map(function (k) {
              var b = blocker(svc, k.personId, pos.id);
              return fullName(people[k.personId]) + ': ' + (b || 'their “must serve together” group can’t all serve');
            });
            gaps.push({ serviceId: svc.id, positionId: pos.id, missing: (pos.needed || 1) - filled(svc.id, pos.id), why: why });
            break;
          }
        }
      });
    });
    return { assignments: added, gaps: gaps };

    function reasonFor(svc, pid) {
      var last = lastServed(pid, svc.date);
      return last ? 'Fair turn: last served ' + Math.round(daysBetween(last, svc.date) / 7) + ' week(s) before' : 'Fair turn: hasn’t served yet';
    }
  }

  /** Checks an existing roster for problems people should know about. */
  function check(data, serviceIds) {
    var out = [], people = byId(data.people), pos = byId(data.positions);
    (data.services || []).filter(function (s) { return serviceIds.indexOf(s.id) >= 0; }).forEach(function (svc) {
      var here = (data.assignments || []).filter(function (a) { return a.serviceId === svc.id && a.status !== 'declined'; });
      here.forEach(function (a) {
        var away = awayReason(data, a.personId, svc.date);
        if (away) out.push({ serviceId: svc.id, personId: a.personId, level: 'bad', text: fullName(people[a.personId]) + ' is away (' + away + ') but rostered for ' + (pos[a.positionId] || {}).name + '.' });
      });
      (data.groups || []).forEach(function (g) {
        var inHere = g.memberIds.filter(function (m) { return here.some(function (a) { return a.personId === m; }); });
        if (g.kind === 'apart' && inHere.length > 1) out.push({ serviceId: svc.id, level: 'bad', text: g.name + ': ' + inHere.map(function (m) { return fullName(people[m]); }).join(' and ') + ' are both serving, but should be kept apart.' });
        if (g.kind === 'together' && inHere.length && inHere.length < g.memberIds.length)
          out.push({ serviceId: svc.id, level: g.strength === 'must' ? 'bad' : 'warn', text: g.name + ': only ' + inHere.map(function (m) { return fullName(people[m]); }).join(', ') + ' rostered – they asked to serve together.' });
      });
    });
    return out;
  }

  return { autoFill: autoFill, check: check, awayReason: awayReason, groupsOf: groupsOf, fullName: fullName, FREQ_DAYS: FREQ_DAYS };
})();
if (typeof module !== 'undefined') module.exports = RosterCore;
