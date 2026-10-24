/* Church Hub – Rosters: matrix, auto-fill (together/apart, away, fair turns), teams, serving groups, away dates, my serving. */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store, R = RosterCore;
  var state = { start: 0, preview: null, gapsOpen: false };
  var FREQ = [['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Once a month'], ['occasional', 'Now and then']];

  function manager() { return H.can('rosters.manage') || H.can('*'); }
  function person(id) { return S.get('people', id); }
  function pos(id) { return S.get('positions', id); }
  function team(id) { return S.get('teams', id); }

  /** Away = blockout dates + approved leave from the Leave app. */
  function awayList() {
    var out = S.list('blockouts').map(function (b) { return { personId: b.personId, from: b.from, to: b.to || b.from, reason: b.reason || 'Away', id: b.id, kind: 'blockout' }; });
    var lv = S.leave();
    if (lv) lv.requests.forEach(function (r) { if (r.status === 'Approved') out.push({ personId: r.staffId, from: r.start, to: r.end, reason: 'On leave', kind: 'leave' }); });
    return out;
  }
  function engineData(extra) {
    return { people: S.list('people'), positions: orderedPositions(), skills: S.list('skills'), services: S.list('services'),
      assignments: S.list('assignments').concat(extra || []), groups: S.list('groups'), away: awayList() };
  }
  function orderedPositions() {
    var t = S.list('teams').map(function (x) { return x.id; });
    return S.list('positions').slice().sort(function (a, b) { return t.indexOf(a.teamId) - t.indexOf(b.teamId); });
  }
  function narrow() { return window.innerWidth < 700; }
  function upcoming() { var t = H.today(); return S.list('services').filter(function (s) { return s.date >= t; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
  function inView() {
    var all = S.list('services').slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var first = all.findIndex(function (s) { return s.date >= H.today(); }); if (first < 0) first = Math.max(0, all.length - 4);
    var i = Math.max(0, Math.min(all.length - 1, first + state.start)), n = narrow() ? 1 : 4;
    return all.slice(i, i + n);
  }

  function tabs(active) {
    var t = manager() ? [['', 'Roster'], ['teams', 'Teams'], ['together', 'Serving together'], ['away', 'Away dates'], ['mine', 'My serving']] : [['mine', 'My serving'], ['together', 'Serving together'], ['away', 'Away dates']];
    return '<nav class="seg" aria-label="Rosters" style="margin-bottom:18px">' + t.map(function (x) { return '<a href="#/rosters' + (x[0] ? '/' + x[0] : '') + '" class="' + (x[0] === active ? 'on' : '') + '"' + (x[0] === active ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav>';
  }
  function head(title, lead, btns) { return '<div class="page-head"><div><h1>' + esc(title) + '</h1><p class="lead">' + lead + '</p></div>' + (btns ? '<div class="btns">' + btns + '</div>' : '') + '</div>'; }

  /* ---------- matrix ---------- */
  function renderMatrix() {
    var svcs = inView(), ids = svcs.map(function (s) { return s.id; });
    var extra = state.preview ? state.preview.assignments : [];
    var all = S.list('assignments').concat(extra), away = awayList();
    var problems = R.check(engineData(), ids);
    var html = head('Rosters', 'Who is serving at each service. Families and friends who asked to serve together are kept together.',
      '<button class="btn" data-act="rosters:move" data-d="-' + (narrow() ? 1 : 4) + '" aria-label="Earlier services">‹ Earlier</button><button class="btn" data-act="rosters:move" data-d="' + (narrow() ? 1 : 4) + '" aria-label="Later services">Later ›</button>' +
      (state.preview ? '' : '<button class="btn primary" data-act="rosters:autofill">' + H.icon(H.ICON.sparkle, 18) + 'Fill the gaps for me</button>')) + tabs('');
    if (state.preview) {
      var n = state.preview.assignments.length;
      html += '<div class="note info"><b>' + n + ' suggestion' + (n === 1 ? '' : 's') + '</b> shown with a dashed border. Families and friends are kept together, people who are away are skipped, and turns are shared fairly. ' +
        'Hover or tap a suggestion to see why.' + (state.preview.gaps.length ? ' <b>' + state.preview.gaps.length + ' slot(s) still can’t be filled</b> – see below.' : '') +
        '<div class="btns" style="margin-top:10px"><button class="btn primary small" data-act="rosters:keep">Keep these and ask people</button><button class="btn small" data-act="rosters:discard">Discard</button></div></div>';
    }
    if (problems.length) html += '<div class="note warn"><b>Please check</b><ul>' + problems.map(function (p) { return '<li>' + esc(p.text) + '</li>'; }).join('') + '</ul></div>';
    html += '<div class="legend"><span><i style="background:var(--ok-soft)"></i>Accepted</span><span><i style="background:var(--warn-soft)"></i>Waiting for a reply</span><span><i style="background:#E6EEF7;border:1px dashed #7FA3CF"></i>Suggestion</span><span><i style="border:1px dashed #D9A39A;background:#fff"></i>Gap</span><span><i style="background:#F2EEEA"></i>Said no</span></div>';
    html += '<div class="matrix-wrap"><table class="matrix"><thead><tr><th scope="col">Position</th>' + svcs.map(function (s) { return '<th scope="col">' + esc(H.fmt(s.date)) + '<br><span class="muted small">' + esc(s.time + ' · ' + s.name) + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    var lastTeam = '';
    orderedPositions().forEach(function (p) {
      if (p.teamId !== lastTeam) { lastTeam = p.teamId; html += '<tr class="team-row"><th colspan="' + (svcs.length + 1) + '" scope="rowgroup">' + esc((team(p.teamId) || {}).name) + '</th></tr>'; }
      html += '<tr><th scope="row">' + esc(p.name) + '<small>' + p.needed + ' needed</small></th>' + svcs.map(function (s) {
        var here = all.filter(function (a) { return a.serviceId === s.id && a.positionId === p.id; });
        var live = here.filter(function (a) { return a.status !== 'declined'; }).length;
        var cells = here.map(function (a) {
          var who = person(a.personId), isAway = R.awayReason({ away: away }, a.personId, s.date);
          var cls = a.source === 'auto' && extra.indexOf(a) >= 0 ? 'auto' : isAway && a.status !== 'declined' ? 'away' : a.status;
          var tg = R.groupsOf(engineData(), a.personId, 'together').length ? H.icon(H.ICON.link, 14) : '';
          return '<button class="chip ' + cls + '" data-act="rosters:slot" data-id="' + esc(a.id) + '" title="' + esc(a.reason || (isAway ? isAway : a.status)) + '">' + esc(H.name(who)) + '<span class="tg">' + tg + '</span></button>';
        }).join('');
        for (var i = live; i < p.needed; i++) cells += '<button class="chip gap" data-act="rosters:assign" data-s="' + s.id + '" data-p="' + p.id + '">+ Add someone</button>';
        return '<td><div class="slot">' + cells + '</div></td>';
      }).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (state.preview && state.preview.gaps.length) {
      html += '<section class="panel" style="margin-top:16px"><h2>Why some slots are still empty</h2>' + state.preview.gaps.map(function (g) {
        var s = S.get('services', g.serviceId);
        return '<details style="margin:8px 0"><summary><b>' + esc((pos(g.positionId) || {}).name) + '</b>, ' + esc(H.fmt(s.date)) + ': ' + g.missing + ' more needed</summary><ul class="small muted">' + g.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></details>';
      }).join('') + '<p class="hint">Add more people to the team, or ask someone directly with “+ Add someone”.</p></section>';
    }
    return html;
  }

  function slotDialog(a) {
    var p = person(a.personId), s = S.get('services', a.serviceId), po = pos(a.positionId);
    var isPreview = state.preview && state.preview.assignments.indexOf(a) >= 0;
    var groups = S.find('groups', function (g) { return g.memberIds.indexOf(a.personId) >= 0; });
    H.modal(H.dialogHead(H.name(p), po.name + ' · ' + H.fmt(s.date, true) + ' ' + s.time) + '<div class="dlg-body">' +
      (a.reason ? '<p class="note info">' + esc(a.reason) + '</p>' : '') +
      groups.map(function (g) { return '<p class="hint">' + (g.kind === 'together' ? 'Serves together with ' : 'Kept apart from ') + esc(g.memberIds.filter(function (m) { return m !== p.id; }).map(function (m) { return H.name(person(m)); }).join(', ')) + '.</p>'; }).join('') +
      (isPreview ? '<p class="muted">This is a suggestion. Keep the suggestions to ask them.</p>' : '<p>Status: <b>' + esc({ accepted: 'Accepted', pending: 'Waiting for a reply', declined: 'Said no' }[a.status]) + '</b></p>') + '</div>' +
      '<div class="dlg-foot">' + (isPreview ? '<button class="btn" data-act="rosters:dropsug" data-id="' + esc(a.id) + '">Remove suggestion</button>' :
        '<button class="btn" style="margin-right:auto" data-act="rosters:remove" data-id="' + a.id + '">Take off the roster</button>' +
        (a.status !== 'declined' ? '<button class="btn" data-act="rosters:status" data-id="' + a.id + '" data-s="declined">Mark “can’t make it”</button>' : '') +
        (a.status !== 'accepted' ? '<button class="btn ok" data-act="rosters:status" data-id="' + a.id + '" data-s="accepted">Mark accepted</button>' : '')) + '</div>', 'Roster slot');
  }

  function assignDialog(serviceId, positionId) {
    var s = S.get('services', serviceId), po = pos(positionId), d = engineData();
    var cands = S.find('skills', function (k) { return k.positionId === positionId; }).map(function (k) {
      var p = person(k.personId), why = R.awayReason(d, k.personId, s.date);
      if (!why && d.assignments.some(function (a) { return a.serviceId === serviceId && a.personId === k.personId && a.status !== 'declined'; })) why = 'Already serving that day';
      if (!why && d.assignments.some(function (a) { return a.serviceId === serviceId && a.personId === k.personId && a.status === 'declined'; })) why = 'Said no for that day';
      var apart = R.groupsOf(d, k.personId, 'apart').filter(function (g) { return g.memberIds.some(function (m) { return m !== k.personId && d.assignments.some(function (a) { return a.serviceId === serviceId && a.personId === m && a.status !== 'declined'; }); }); })[0];
      if (!why && apart) why = 'Kept apart from someone already serving';
      var tg = R.groupsOf(d, k.personId, 'together')[0];
      return { p: p, why: why, tg: tg };
    }).filter(function (c) { return c.p && c.p.active !== false; }).sort(function (a, b) { return (!!a.why - !!b.why) || H.name(a.p).localeCompare(H.name(b.p)); });
    H.modal(H.dialogHead('Add someone', po.name + ' · ' + H.fmt(s.date, true)) + '<div class="dlg-body">' +
      (cands.length ? '<div class="list">' + cands.map(function (c) {
        return '<button class="item" data-act="rosters:pick" data-s="' + serviceId + '" data-p="' + positionId + '" data-person="' + c.p.id + '"' + (c.why ? ' disabled style="opacity:.55;cursor:not-allowed"' : '') + '>' + H.avatar(c.p, 32) +
          '<span class="grow"><b>' + esc(H.name(c.p)) + '</b><small>' + esc(c.why || (c.tg ? 'Serves together with ' + c.tg.memberIds.filter(function (m) { return m !== c.p.id; }).map(function (m) { return H.name(person(m)); }).join(', ') + (c.tg.strength === 'must' ? ' (always) – they’ll be asked too' : ' (when possible)') : 'Available')) + '</small></span>' +
          (c.why ? '<span class="tag grey">Not available</span>' : '<span class="tag ok">Available</span>') + '</button>';
      }).join('') + '</div>' : '<p class="empty">No one is on this team yet. Add people under Teams.</p>') + '</div>' +
      '<div class="dlg-foot"><a class="btn" href="#/rosters/teams" data-act="hub:close">Manage teams</a><button class="btn" data-act="hub:close">Close</button></div>', 'Add someone');
  }

  /* ---------- teams ---------- */
  function renderTeams() {
    var html = head('Teams', 'Who can serve in each position, and how often they’d like to.', '<button class="btn" data-act="rosters:newteam">' + H.icon(H.ICON.plus, 18) + 'New team</button>') + tabs('teams');
    html += '<div class="grid2">' + S.list('teams').map(function (t) {
      var ps = S.find('positions', function (p) { return p.teamId === t.id; });
      return '<section class="panel"><h2>' + esc(t.name) + '</h2>' + ps.map(function (p) {
        var ks = S.find('skills', function (k) { return k.positionId === p.id; });
        return '<div style="margin:12px 0"><div class="row"><b class="grow">' + esc(p.name) + '</b><span class="muted small">' + p.needed + ' per service</span><button class="btn small" data-act="rosters:addmember" data-p="' + p.id + '">' + H.icon(H.ICON.plus, 16) + 'Add</button></div>' +
          (ks.length ? '<div class="list" style="margin-top:8px">' + ks.map(function (k) {
            var pp = person(k.personId);
            return '<div class="item">' + H.avatar(pp, 30) + '<span class="grow"><b>' + esc(H.name(pp)) + '</b><small>' + esc((FREQ.filter(function (f) { return f[0] === k.frequency; })[0] || ['', k.frequency])[1]) + '</small></span><button class="icon-btn ghost" data-act="rosters:unskill" data-id="' + k.id + '" aria-label="Remove ' + esc(H.name(pp)) + ' from ' + esc(p.name) + '">' + H.icon(H.ICON.x, 18) + '</button></div>';
          }).join('') + '</div>' : '<p class="hint">No one yet.</p>') + '</div>';
      }).join('') + '<button class="btn small" data-act="rosters:newpos" data-t="' + t.id + '">' + H.icon(H.ICON.plus, 16) + 'Add a position</button></section>';
    }).join('') + '</div>';
    return html;
  }

  /* ---------- serving together / apart ---------- */
  function renderTogether() {
    var gs = S.list('groups'), me = H.user();
    var mine = manager() ? gs : gs.filter(function (g) { return g.memberIds.indexOf(me.id) >= 0; });
    var html = head('Serving together', 'Families and friends who want to serve at the same service – and people who mustn’t serve at the same time.',
      '<button class="btn primary" data-act="rosters:group" data-kind="together">' + H.icon(H.ICON.link, 18) + (manager() ? 'Serve together' : 'Ask to serve with someone') + '</button>' +
      (manager() ? '<button class="btn" data-act="rosters:group" data-kind="apart">' + H.icon(H.ICON.split, 18) + 'Keep apart</button>' : '')) + tabs('together');
    html += '<div class="grid2" style="margin-bottom:16px"><div class="note info" style="margin:0"><b>' + H.icon(H.ICON.link, 16) + ' Serve together</b><br>“Always” = rostered together or not at all (e.g. a family sharing a car). “When possible” = together when it works, otherwise separately.</div>' +
      '<div class="note warn" style="margin:0"><b>' + H.icon(H.ICON.split, 16) + ' Keep apart</b><br>Never rostered at the same service – e.g. parents taking turns with a baby.</div></div>';
    html += mine.length ? '<div class="list">' + mine.map(function (g) {
      return '<div class="item"><span class="ic" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:' + (g.kind === 'together' ? '#E6EEF7;color:#1E4E8C' : '#FFF1CC;color:#7A5300') + '">' + H.icon(g.kind === 'together' ? H.ICON.link : H.ICON.split) + '</span>' +
        '<span class="grow"><b>' + esc(g.name) + '</b><small>' + esc(g.memberIds.map(function (m) { return H.name(person(m)); }).join(', ')) + (g.note ? ' · ' + esc(g.note) : '') + '</small></span>' +
        '<span class="tag ' + (g.kind === 'together' ? '' : 'warn') + '" style="--c:#2F6FB3">' + (g.kind === 'apart' ? 'Keep apart' : g.strength === 'must' ? 'Always together' : 'Together when possible') + '</span>' +
        (manager() || g.memberIds.indexOf(me.id) >= 0 ? '<button class="btn small" data-act="rosters:group" data-id="' + g.id + '">Edit</button>' : '') + '</div>';
    }).join('') + '</div>' : '<p class="empty">You’re not in a serving group yet. Ask to serve with family or a friend, and the roster will keep you together.</p>';
    return html;
  }

  function groupDialog(g, kind) {
    var isNew = !g; g = g || { name: '', kind: kind || 'together', strength: 'prefer', memberIds: manager() ? [] : [H.user().id], note: '' };
    var people = S.find('people', function (p) { return p.active !== false && p.familyRole !== 'child' || (p.familyRole === 'child' && S.find('skills', function (k) { return k.personId === p.id; }).length); })
      .sort(function (a, b) { return H.name(a).localeCompare(H.name(b)); });
    var fams = S.list('families');
    H.modal(H.dialogHead(isNew ? (g.kind === 'apart' ? 'Keep people apart' : 'Serve together') : 'Edit ' + g.name, g.kind === 'apart' ? 'They will never be rostered at the same service.' : 'The roster will put them at the same service.') +
      '<div class="dlg-body"><input type="hidden" id="gr-id" value="' + esc(g.id || '') + '"><input type="hidden" id="gr-kind" value="' + g.kind + '">' +
      '<label class="field">Name<input id="gr-name" value="' + esc(g.name) + '" placeholder="' + (g.kind === 'apart' ? 'e.g. Megan & David (baby at home)' : 'e.g. Naidoo family, or Sam & Kavi') + '"></label>' +
      (g.kind === 'together' ? '<fieldset class="field" style="border:0;padding:0;margin:0 0 14px"><legend style="margin-bottom:6px">How important is it?</legend>' +
        '<label class="check"><input type="radio" name="gr-str" value="must"' + (g.strength === 'must' ? ' checked' : '') + '><span><b>Always together</b><br><span class="muted small">If one can’t serve, none of them are rostered that week.</span></span></label>' +
        '<label class="check"><input type="radio" name="gr-str" value="prefer"' + (g.strength !== 'must' ? ' checked' : '') + '><span><b>Together when possible</b><br><span class="muted small">Otherwise they can be rostered separately.</span></span></label></fieldset>' : '') +
      (manager() && fams.length ? '<label class="field">Quick add a family<select id="gr-fam"><option value="">Choose a family…</option>' + fams.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="margin-bottom:6px">Who</legend><div style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:4px 12px">' +
      people.map(function (p) { return '<label class="check"><input type="checkbox" class="gr-m" value="' + p.id + '"' + (g.memberIds.indexOf(p.id) >= 0 ? ' checked' : '') + '>' + esc(H.name(p)) + (p.familyRole === 'child' ? ' <span class="muted small">(teen)</span>' : '') + '</label>'; }).join('') + '</div></fieldset>' +
      '<label class="field" style="margin-top:14px">Note <small>(optional)</small><input id="gr-note" value="' + esc(g.note || '') + '" placeholder="Why – helps whoever does the roster"></label><p id="gr-err" class="note bad" hidden></p></div>' +
      '<div class="dlg-foot">' + (!isNew ? '<button class="btn" style="margin-right:auto" data-act="rosters:delgroup" data-id="' + g.id + '">Delete</button>' : '') + '<button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="rosters:savegroup">Save</button></div>', 'Serving group');
    var famSel = document.getElementById('gr-fam');
    if (famSel) famSel.addEventListener('change', function () {
      var ids = S.find('people', function (p) { return p.familyId === famSel.value; }).map(function (p) { return p.id; });
      document.querySelectorAll('.gr-m').forEach(function (b) { if (ids.indexOf(b.value) >= 0) b.checked = true; });
      var nm = document.getElementById('gr-name'); if (!nm.value) nm.value = (S.get('families', famSel.value) || {}).name || '';
    });
  }

  /* ---------- away dates ---------- */
  function renderAway() {
    var t = H.today(), me = H.user();
    var list = awayList().filter(function (a) { return a.to >= t && (manager() || a.personId === me.id); }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    return head('Away dates', 'Dates people can’t serve. Approved leave from the Leave app is included automatically.', '<button class="btn primary" data-act="rosters:addaway">' + H.icon(H.ICON.plus, 18) + 'Add away dates</button>') + tabs('away') +
      (list.length ? '<div class="list">' + list.map(function (a) {
        var p = person(a.personId);
        return '<div class="item">' + H.avatar(p, 32) + '<span class="grow"><b>' + esc(H.name(p)) + '</b><small>' + esc(H.fmt(a.from) + (a.to !== a.from ? ' – ' + H.fmt(a.to, true) : '') + ' · ' + a.reason) + '</small></span>' +
          (a.kind === 'leave' ? '<span class="tag" style="--c:#E8590C">From Leave</span>' : (manager() || a.personId === me.id ? '<button class="icon-btn ghost" data-act="rosters:delaway" data-id="' + a.id + '" aria-label="Remove away dates">' + H.icon(H.ICON.trash, 18) + '</button>' : '')) + '</div>';
      }).join('') + '</div>' : '<p class="empty">No one is away soon.</p>');
  }

  /* ---------- my serving ---------- */
  function renderMine() {
    var me = H.user(), t = H.today();
    var mine = S.find('assignments', function (a) { var s = S.get('services', a.serviceId); return a.personId === me.id && s && s.date >= t; })
      .sort(function (a, b) { return S.get('services', a.serviceId).date < S.get('services', b.serviceId).date ? -1 : 1; });
    var sk = S.find('skills', function (k) { return k.personId === me.id; });
    var html = head('My serving', 'Your upcoming turns. Please reply so the roster can be planned.', '') + tabs('mine');
    html += mine.length ? '<div class="list">' + mine.map(function (a) {
      var s = S.get('services', a.serviceId), po = pos(a.positionId);
      return '<div class="item"><span class="grow"><b>' + esc(po.name + ' · ' + (team(po.teamId) || {}).name) + '</b><small>' + esc(H.fmt(s.date, true) + ', ' + s.time + ' · ' + s.name) + '</small></span>' +
        (a.status === 'pending' ? '<button class="btn small" data-act="rosters:reply" data-id="' + a.id + '" data-s="declined">Can’t make it</button><button class="btn small ok" data-act="rosters:reply" data-id="' + a.id + '" data-s="accepted">Accept</button>' :
          '<span class="tag ' + (a.status === 'accepted' ? 'ok' : 'grey') + '">' + (a.status === 'accepted' ? 'Accepted' : 'Said no') + '</span>') + '</div>';
    }).join('') + '</div>' : '<p class="empty">You’re not on the roster in the coming weeks.</p>';
    html += '<div class="grid2" style="margin-top:16px"><section class="panel"><h2>My teams</h2>' + (sk.length ? sk.map(function (k) { var po = pos(k.positionId); return '<p style="margin:6px 0">' + esc(po.name + ' · ' + (team(po.teamId) || {}).name) + ' <span class="muted small">(' + esc(k.frequency) + ')</span></p>'; }).join('') : '<p class="muted">Not on a team yet – speak to the roster coordinator.</p>') + '</section>' +
      '<section class="panel"><h2>Serve with family or friends</h2><p class="muted" style="margin-top:0">Tell us who you’d like to serve with, and the roster will keep you together.</p><a class="btn" href="#/rosters/together">Serving together</a> <a class="btn" href="#/rosters/away">My away dates</a></section></div>';
    return html;
  }

  /* ---------- module ---------- */
  function nextGaps() {
    var s = upcoming()[0]; if (!s) return null;
    var n = 0; orderedPositions().forEach(function (p) { n += Math.max(0, p.needed - S.find('assignments', function (a) { return a.serviceId === s.id && a.positionId === p.id && a.status !== 'declined'; }).length); });
    return { s: s, n: n };
  }
  H.register({
    id: 'rosters', name: 'Rosters', desc: 'Who serves when – families kept together', icon: H.ICON.rosters, tint: '#2F6FB3',
    stat: function (u) {
      if (manager()) { var g = nextGaps(); return g ? (g.n ? g.n + ' gap' + (g.n === 1 ? '' : 's') + ' on ' + H.fmt(g.s.date) : 'All filled for ' + H.fmt(g.s.date)) : 'No services planned'; }
      var p = S.find('assignments', function (a) { return a.personId === u.id && a.status === 'pending'; }).length;
      return p ? p + ' turn' + (p === 1 ? '' : 's') + ' to reply to' : 'Your serving';
    },
    todos: function (u) {
      var out = [], mine = S.find('assignments', function (a) { var s = S.get('services', a.serviceId); return a.personId === u.id && a.status === 'pending' && s && s.date >= H.today(); });
      if (mine.length) out.push({ text: 'Reply to ' + mine.length + ' serving request' + (mine.length === 1 ? '' : 's'), href: '#/rosters/mine' });
      if (manager()) { var g = nextGaps(); if (g && g.n) out.push({ text: 'Fill ' + g.n + ' gap' + (g.n === 1 ? '' : 's') + ' on the roster for ' + H.fmt(g.s.date), href: '#/rosters' }); }
      return out;
    },
    render: function (p) {
      var v = p[0] || (manager() ? '' : 'mine');
      if (v === 'teams' && manager()) return renderTeams();
      if (v === 'together') return renderTogether();
      if (v === 'away') return renderAway();
      if (v === 'mine' || !manager()) return renderMine();
      return renderMatrix();
    },
    actions: {
      move: function (el) { state.start += +el.dataset.d; state.preview = null; H.render(); },
      autofill: function () {
        var ids = inView().filter(function (s) { return s.date >= H.today(); }).map(function (s) { return s.id; });
        state.preview = R.autoFill(engineData(), ids);
        H.render();
        H.toast(state.preview.assignments.length ? state.preview.assignments.length + ' suggestions ready – check and keep them' : 'Nothing more can be filled automatically');
      },
      keep: function () {
        state.preview.assignments.forEach(function (a) { S.put('assignments', { serviceId: a.serviceId, positionId: a.positionId, personId: a.personId, status: 'pending', source: 'auto', reason: a.reason }); });
        S.audit('Kept ' + state.preview.assignments.length + ' roster suggestions', 'assignments');
        var n = state.preview.assignments.length; state.preview = null; H.render(); H.toast(n + ' people asked to serve (they’ll get a message once email is connected)');
      },
      discard: function () { state.preview = null; H.render(); },
      slot: function (el) {
        var a = S.get('assignments', el.dataset.id) || (state.preview && state.preview.assignments.filter(function (x) { return x.id === el.dataset.id; })[0]);
        if (a) slotDialog(a);
      },
      dropsug: function (el) { state.preview.assignments = state.preview.assignments.filter(function (x) { return x.id !== el.dataset.id; }); H.closeModal(); H.render(); },
      status: function (el) { var a = S.get('assignments', el.dataset.id); a.status = el.dataset.s; S.put('assignments', a, 'Roster status changed'); H.closeModal(); H.render(); },
      remove: function (el) { if (!H.confirmBtn(el, 'Click again to remove')) return; S.remove('assignments', el.dataset.id, 'Removed from roster'); H.closeModal(); H.render(); },
      assign: function (el) { assignDialog(el.dataset.s, el.dataset.p); },
      pick: function (el) {
        var sid = el.dataset.s, pid = el.dataset.p, who = el.dataset.person, d = engineData();
        S.put('assignments', { serviceId: sid, positionId: pid, personId: who, status: 'pending', source: 'manual' }, 'Added to roster');
        var tg = R.groupsOf(d, who, 'together').filter(function (g) { return g.strength === 'must'; })[0];
        H.closeModal(); H.render();
        H.toast(tg ? 'Added. ' + H.name(person(who)) + ' always serves with ' + tg.memberIds.filter(function (m) { return m !== who; }).map(function (m) { return H.name(person(m)); }).join(', ') + ' – use “Fill the gaps” to place them too.' : 'Added – waiting for their reply');
      },
      reply: function (el) { var a = S.get('assignments', el.dataset.id); a.status = el.dataset.s; S.put('assignments', a, el.dataset.s === 'accepted' ? 'Accepted a serving turn' : 'Declined a serving turn'); H.render(); H.toast(el.dataset.s === 'accepted' ? 'Thank you!' : 'Thanks for letting us know'); },
      group: function (el) { groupDialog(el.dataset.id ? S.get('groups', el.dataset.id) : null, el.dataset.kind); },
      savegroup: function () {
        var id = document.getElementById('gr-id').value, kind = document.getElementById('gr-kind').value;
        var ids = Array.prototype.map.call(document.querySelectorAll('.gr-m:checked'), function (b) { return b.value; });
        var nm = document.getElementById('gr-name').value.trim(), err = document.getElementById('gr-err');
        if (ids.length < 2) { err.textContent = 'Choose at least two people.'; err.hidden = false; return; }
        if (!manager() && ids.indexOf(H.user().id) < 0) ids.push(H.user().id);
        var str = document.querySelector('input[name=gr-str]:checked');
        var g = id ? S.get('groups', id) : {};
        Object.assign(g, { name: nm || ids.map(function (i) { return person(i).firstName; }).join(' & '), kind: kind, strength: kind === 'apart' ? 'must' : (str ? str.value : 'prefer'), memberIds: ids, note: document.getElementById('gr-note').value.trim() });
        S.put('groups', g, (id ? 'Updated' : 'Created') + ' serving group ' + g.name); H.closeModal(); H.render(); H.toast('Saved – the roster will follow this from now on');
      },
      delgroup: function (el) { if (!H.confirmBtn(el, 'Click again to delete')) return; S.remove('groups', el.dataset.id, 'Deleted serving group'); H.closeModal(); H.render(); },
      addaway: function () {
        var me = H.user(), people = S.find('people', function (p) { return p.active !== false && p.familyRole !== 'child'; }).sort(function (a, b) { return H.name(a).localeCompare(H.name(b)); });
        H.modal(H.dialogHead('Add away dates', 'They won’t be rostered on these days.') + '<div class="dlg-body">' +
          (manager() ? '<label class="field">Who<select id="aw-p">' + people.map(function (p) { return '<option value="' + p.id + '"' + (p.id === me.id ? ' selected' : '') + '>' + esc(H.name(p)) + '</option>'; }).join('') + '</select></label>' : '<input type="hidden" id="aw-p" value="' + me.id + '">') +
          '<div class="two"><label class="field">From<input type="date" id="aw-f" value="' + H.today() + '"></label><label class="field">To<input type="date" id="aw-t" value="' + H.today() + '"></label></div>' +
          '<label class="field">Reason <small>(optional, others don’t see it)</small><input id="aw-r" placeholder="e.g. holiday"></label><p id="aw-err" class="note bad" hidden></p></div>' +
          '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="rosters:saveaway">Save</button></div>', 'Away dates');
        var f = document.getElementById('aw-f'), t = document.getElementById('aw-t');
        f.addEventListener('change', function () { if (!t.value || t.value < f.value) t.value = f.value; });
      },
      saveaway: function () {
        var f = document.getElementById('aw-f').value, t = document.getElementById('aw-t').value || f;
        if (!f || t < f) { var e = document.getElementById('aw-err'); e.textContent = 'Choose a first and last day.'; e.hidden = false; return; }
        S.put('blockouts', { personId: document.getElementById('aw-p').value, from: f, to: t, reason: 'Away' + (document.getElementById('aw-r').value.trim() ? ': ' + document.getElementById('aw-r').value.trim() : '') }, 'Added away dates');
        H.closeModal(); H.render(); H.toast('Saved – no rostering on those days');
      },
      delaway: function (el) { S.remove('blockouts', el.dataset.id, 'Removed away dates'); H.render(); },
      newteam: function () { var n = prompt('Name of the new team (e.g. Prayer)'); if (n && n.trim()) { S.put('teams', { name: n.trim() }, 'Created team ' + n.trim()); H.render(); } },
      newpos: function (el) { var n = prompt('Name of the position (e.g. Camera)'); if (!n || !n.trim()) return; var k = parseInt(prompt('How many people are needed per service?', '1'), 10) || 1; S.put('positions', { teamId: el.dataset.t, name: n.trim(), needed: k }, 'Added position ' + n.trim()); H.render(); },
      addmember: function (el) {
        var po = pos(el.dataset.p), have = S.find('skills', function (k) { return k.positionId === po.id; }).map(function (k) { return k.personId; });
        var people = S.find('people', function (p) { return p.active !== false && have.indexOf(p.id) < 0; }).sort(function (a, b) { return H.name(a).localeCompare(H.name(b)); });
        H.modal(H.dialogHead('Add to ' + po.name) + '<div class="dlg-body"><label class="field">Person<select id="am-p">' + people.map(function (p) { return '<option value="' + p.id + '">' + esc(H.name(p)) + (p.familyRole === 'child' ? ' (child/teen)' : '') + '</option>'; }).join('') + '</select></label>' +
          '<label class="field">How often would they like to serve?<select id="am-f">' + FREQ.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === 'fortnightly' ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="rosters:savemember" data-p="' + po.id + '">Add</button></div>', 'Add team member');
      },
      savemember: function (el) { S.put('skills', { personId: document.getElementById('am-p').value, positionId: el.dataset.p, frequency: document.getElementById('am-f').value }, 'Added to a team'); H.closeModal(); H.render(); },
      unskill: function (el) { S.remove('skills', el.dataset.id, 'Removed from a team'); H.render(); }
    }
  });
  window.RosterHelpers = { awayList: awayList };
})();
