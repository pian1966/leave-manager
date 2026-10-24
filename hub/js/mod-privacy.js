/* Church Hub – Privacy (POPIA): Information Officer, checklist, data-subject requests, retention, breaches, audit log. */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store;
  var KINDS = ['Access (copy of their information)', 'Correction', 'Deletion', 'Objection to processing'];

  function tabs(a) {
    return '<nav class="seg" aria-label="Privacy" style="margin-bottom:18px">' + [['', 'Overview'], ['requests', 'Requests'], ['retention', 'Retention'], ['breaches', 'Breaches'], ['audit', 'Audit log']].map(function (x) {
      return '<a href="#/privacy' + (x[0] ? '/' + x[0] : '') + '" class="' + (x[0] === a ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + '</nav>';
  }
  function head() { return '<div class="page-head"><div><h1>Privacy (POPIA)</h1><p class="lead">Keeping the church on the right side of the Protection of Personal Information Act: who is responsible, what people agreed to, and every request and incident.</p></div></div>'; }
  function addDays(iso, n) { return LeaveCore.iso(LeaveCore.addDays(LeaveCore.parse(iso), n)); }
  function openRequests() { return S.find('dsr', function (d) { return d.status !== 'Done'; }); }

  function checks() {
    var st = S.settings(), io = st.informationOfficer || {}, people = S.find('people', function (p) { return p.active !== false; });
    var noConsent = people.filter(function (p) { return !PeopleHelpers.hasConsent(p.id, 'Church records'); });
    var kidsNoMed = people.filter(function (p) { return p.familyRole === 'child' && p.medical && !PeopleHelpers.hasConsent(p.id, 'Children’s medical notes'); });
    var overdue = openRequests().filter(function (d) { return d.due < H.today(); });
    return [
      [io.name && !/^\[/.test(io.name), 'Information Officer named', 'Name the person responsible (usually the senior pastor or church administrator).'],
      [!!io.registered, 'Information Officer registered with the Information Regulator', 'Register on the Information Regulator’s portal, then tick it here.'],
      [!!(st.privacyNotice && st.privacyNotice.length > 80), 'Privacy notice written', 'Shown when people are added and in the app.'],
      [noConsent.length === 0, noConsent.length ? noConsent.length + (noConsent.length === 1 ? ' person' : ' people') + ' without recorded consent' : 'Everyone has recorded consent', 'Record consent from their profile (People).'],
      [kidsNoMed.length === 0, kidsNoMed.length ? kidsNoMed.length + ' children with medical notes but no guardian consent' : 'Children’s medical notes have guardian consent', 'Ask a parent or guardian.'],
      [overdue.length === 0, overdue.length ? overdue.length + ' request(s) overdue' : 'No overdue requests', 'Respond within a reasonable time – the church aims for 30 days.']
    ];
  }

  function renderOverview() {
    var st = S.settings(), io = st.informationOfficer || {};
    return head() + tabs('') + '<div class="grid2"><section class="panel"><h2>Checklist</h2><div class="list">' + checks().map(function (c) {
      return '<div class="item"><span style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:' + (c[0] ? 'var(--ok-soft);color:var(--ok)' : 'var(--warn-soft);color:var(--warn)') + '">' + (c[0] ? H.icon(H.ICON.check, 16) : '<b aria-hidden="true">!</b>') + '<span class="sr">' + (c[0] ? 'Done' : 'To do') + '</span></span><span class="grow"><b>' + esc(c[1]) + '</b>' + (c[0] ? '' : '<small>' + esc(c[2]) + '</small>') + '</span></div>';
    }).join('') + '</div></section>' +
      '<section class="panel"><h2>Information Officer</h2><dl class="kv"><dt>Name</dt><dd>' + esc(io.name) + '</dd><dt>Email</dt><dd>' + esc(io.email) + '</dd><dt>Phone</dt><dd>' + esc(io.phone) + '</dd><dt>Deputy</dt><dd>' + esc(io.deputy || '—') + '</dd><dt>Registered</dt><dd>' + (io.registered ? '<span class="tag ok">Yes</span>' : '<span class="tag warn">Not yet</span>') + '</dd></dl>' +
      '<div class="btns" style="margin-top:12px"><button class="btn small" data-act="privacy:io">Edit</button></div></section>' +
      '<section class="panel"><h2>Privacy notice</h2><p class="hint" style="margin-top:0">Plain words: what the church collects, why, how long, and how to ask for it to be corrected or deleted.</p><label class="field"><span class="sr">Privacy notice</span><textarea id="pv-notice" rows="7">' + esc(st.privacyNotice) + '</textarea></label><button class="btn small" data-act="privacy:notice">Save notice</button></section>' +
      '<section class="panel"><h2>How long we keep information</h2><label class="field">Review people who have left or been inactive after<select id="pv-ret">' + [12, 24, 36, 60].map(function (m) { return '<option value="' + m + '"' + (st.retentionMonths === m ? ' selected' : '') + '>' + m + ' months</option>'; }).join('') + '</select></label><button class="btn small" data-act="privacy:ret">Save</button><p class="hint">Staff leave records are kept as employment records.</p></section></div>';
  }

  function renderRequests() {
    var list = S.list('dsr').slice().sort(function (a, b) { return a.received < b.received ? 1 : -1; });
    return head() + tabs('requests') + '<div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">When someone asks to see, correct or delete their information, or objects to how it’s used.</p><button class="btn primary" data-act="privacy:newreq">' + H.icon(H.ICON.plus, 18) + 'Log a request</button></div>' +
      (list.length ? '<div class="list">' + list.map(function (d) {
        var p = S.get('people', d.personId), late = d.status !== 'Done' && d.due < H.today();
        return '<div class="item" style="align-items:flex-start"><span class="grow"><b>' + esc(H.name(p) || 'Deleted person') + ' · ' + esc(d.kind) + '</b><small>Received ' + esc(H.fmt(d.received, true)) + ' · respond by ' + esc(H.fmt(d.due, true)) + (d.notes ? ' · ' + esc(d.notes) : '') + '</small></span>' +
          '<span class="tag ' + (d.status === 'Done' ? 'ok' : late ? 'bad' : 'warn') + '">' + (d.status === 'Done' ? 'Done' : late ? 'Overdue' : 'Open') + '</span>' +
          (d.status !== 'Done' ? '<span class="btns">' + (p && /^Access/.test(d.kind) ? '<button class="btn small" data-act="privacy:export" data-id="' + p.id + '">' + H.icon(H.ICON.download, 16) + 'Export their data</button>' : '') +
            (p && /^Deletion/.test(d.kind) ? '<button class="btn small" data-act="privacy:erase" data-id="' + p.id + '">Delete their information</button>' : '') +
            '<button class="btn small ok" data-act="privacy:done" data-id="' + d.id + '">Mark done</button></span>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="empty">No requests logged.</p>');
  }

  function renderRetention() {
    var months = S.settings().retentionMonths || 24, cutoff = addDays(H.today(), -Math.round(months * 30.4));
    var left = S.find('people', function (p) { return p.active === false && p.firstName !== 'Deleted'; });
    var stale = S.find('people', function (p) { return p.active !== false && (p.updatedAt || p.createdAt || '9') < cutoff && !S.find('assignments', function (a) { return a.personId === p.id; }).length; });
    var row = function (p, why) { return '<div class="item">' + H.avatar(p, 32) + '<span class="grow"><b>' + esc(H.name(p)) + '</b><small>' + esc(why) + '</small></span><a class="btn small" href="#/people/p/' + p.id + '">Open</a><button class="btn small" data-act="privacy:erase" data-id="' + p.id + '">Delete their information</button></div>'; };
    return head() + tabs('retention') + '<p class="muted">POPIA says information should not be kept longer than needed. Review these people: delete their information, or keep them if they’re still connected.</p>' +
      '<section class="block"><h2>People who have left</h2>' + (left.length ? '<div class="list">' + left.map(function (p) { return row(p, 'Marked as left ' + (p.archivedAt ? H.fmt(p.archivedAt, true) : '')); }).join('') + '</div>' : '<p class="empty">No one has been marked as left.</p>') + '</section>' +
      '<section class="block"><h2>No activity for ' + months + ' months</h2>' + (stale.length ? '<div class="list">' + stale.map(function (p) { return row(p, 'Last updated ' + (p.updatedAt || '').slice(0, 10)); }).join('') + '</div>' : '<p class="empty">No one is overdue for review.</p>') + '</section>';
  }

  function renderBreaches() {
    var list = S.list('breaches');
    return head() + tabs('breaches') + '<div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">If personal information is lost, stolen or seen by someone who shouldn’t (e.g. a lost phone, a wrong email), record it here. POPIA requires telling the Information Regulator and the people affected as soon as reasonably possible.</p><button class="btn primary" data-act="privacy:newbreach">' + H.icon(H.ICON.plus, 18) + 'Record an incident</button></div>' +
      (list.length ? '<div class="list">' + list.map(function (b) { return '<div class="item"><span class="grow"><b>' + esc(H.fmt(b.date, true) + ' · ' + b.what) + '</b><small>' + esc('People affected: ' + (b.affected || '?') + ' · Regulator told: ' + (b.regulator || 'not yet') + ' · People told: ' + (b.told || 'not yet')) + '</small></span></div>'; }).join('') + '</div>' : '<p class="empty">No incidents recorded.</p>');
  }

  function renderAudit() {
    var list = S.list('audit').slice(0, 300);
    return head() + tabs('audit') + '<p class="muted">Who did what, and when – including every view of pastoral and children’s medical notes.</p>' +
      '<div class="panel table-wrap"><table class="simple"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' + list.map(function (a) { return '<tr><td class="small">' + esc(a.at) + '</td><td>' + esc(a.who) + '</td><td>' + esc(a.action) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /** Delete someone's personal information, keeping only anonymous numbers (e.g. how many served). */
  function erase(p) {
    var name = H.name(p);
    S.find('consents', function (c) { return c.personId === p.id; }).forEach(function (c) { S.remove('consents', c.id); });
    S.find('notes', function (n) { return n.personId === p.id; }).forEach(function (n) { S.remove('notes', n.id); });
    S.find('skills', function (k) { return k.personId === p.id; }).forEach(function (k) { S.remove('skills', k.id); });
    S.find('blockouts', function (b) { return b.personId === p.id; }).forEach(function (b) { S.remove('blockouts', b.id); });
    S.list('groups').forEach(function (g) { if (g.memberIds.indexOf(p.id) >= 0) { g.memberIds = g.memberIds.filter(function (m) { return m !== p.id; }); if (g.memberIds.length < 2) S.remove('groups', g.id); else S.put('groups', g); } });
    S.put('people', { id: p.id, firstName: 'Deleted', lastName: 'person', active: false, appRole: 'member', familyRole: p.familyRole, category: 'Deleted', deletedAt: H.today(), staff: p.staff ? { category: p.staff.category, start: p.staff.start } : undefined },
      'Deleted the personal information of ' + name + ' (kept anonymous serving and leave statistics)');
  }

  H.register({
    id: 'privacy', name: 'Privacy', desc: 'POPIA: consent, requests and safeguards', icon: H.ICON.privacy, tint: '#0F766E', roles: ['admin'],
    stat: function () { var c = checks().filter(function (x) { return !x[0]; }).length; return c ? c + ' thing' + (c === 1 ? '' : 's') + ' to sort out' : 'All in order'; },
    todos: function () {
      var o = openRequests(); if (!H.can('*')) return [];
      return o.length ? [{ text: o.length + ' privacy request' + (o.length === 1 ? '' : 's') + ' to answer', href: '#/privacy/requests', tag: 'POPIA' }] : [];
    },
    render: function (p) {
      if (!H.can('*')) return '<p class="empty">Only Administrators can open Privacy.</p>';
      return p[0] === 'requests' ? renderRequests() : p[0] === 'retention' ? renderRetention() : p[0] === 'breaches' ? renderBreaches() : p[0] === 'audit' ? renderAudit() : renderOverview();
    },
    actions: {
      io: function () {
        var io = S.settings().informationOfficer;
        H.modal(H.dialogHead('Information Officer', 'The person responsible for POPIA at the church.') + '<div class="dlg-body"><label class="field">Name<input id="io-n" value="' + esc(io.name) + '"></label><div class="two"><label class="field">Email<input id="io-e" type="email" value="' + esc(io.email) + '"></label><label class="field">Phone<input id="io-p" value="' + esc(io.phone) + '"></label></div>' +
          '<label class="field">Deputy <small>(optional)</small><input id="io-d" value="' + esc(io.deputy || '') + '"></label><label class="check"><input type="checkbox" id="io-r"' + (io.registered ? ' checked' : '') + '>Registered with the Information Regulator</label></div>' +
          '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="privacy:saveio">Save</button></div>', 'Information Officer');
      },
      saveio: function () {
        var v = function (id) { return document.getElementById(id).value.trim(); };
        S.setSettings({ informationOfficer: { name: v('io-n'), email: v('io-e'), phone: v('io-p'), deputy: v('io-d'), registered: document.getElementById('io-r').checked } }, 'Updated Information Officer details');
        H.closeModal(); H.render(); H.toast('Saved');
      },
      notice: function () { S.setSettings({ privacyNotice: document.getElementById('pv-notice').value.trim() }, 'Updated the privacy notice'); H.toast('Privacy notice saved'); H.render(); },
      ret: function () { S.setSettings({ retentionMonths: +document.getElementById('pv-ret').value }, 'Changed the retention period'); H.toast('Saved'); H.render(); },
      newreq: function () {
        var people = S.find('people', function (p) { return p.firstName !== 'Deleted'; }).sort(function (a, b) { return H.name(a).localeCompare(H.name(b)); });
        H.modal(H.dialogHead('Log a request') + '<div class="dlg-body"><label class="field">From<select id="rq-p">' + people.map(function (p) { return '<option value="' + p.id + '">' + esc(H.name(p)) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field">They asked for<select id="rq-k">' + KINDS.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select></label><label class="field">Received<input type="date" id="rq-d" value="' + H.today() + '"></label><label class="field">Notes <small>(optional)</small><input id="rq-n"></label></div>' +
          '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="privacy:savereq">Save</button></div>', 'Log a request');
      },
      savereq: function () {
        var d = document.getElementById('rq-d').value || H.today();
        S.put('dsr', { personId: document.getElementById('rq-p').value, kind: document.getElementById('rq-k').value.split(' (')[0], received: d, due: addDays(d, 30), status: 'Open', notes: document.getElementById('rq-n').value.trim() }, 'Logged a privacy request');
        H.closeModal(); H.render(); H.toast('Logged – respond by ' + H.fmt(addDays(d, 30), true));
      },
      done: function (el) { var d = S.get('dsr', el.dataset.id); d.status = 'Done'; d.doneAt = H.today(); S.put('dsr', d, 'Completed a privacy request'); H.render(); },
      export: function (el) { PeopleHelpers.exportPerson(S.get('people', el.dataset.id)); },
      erase: function (el) {
        if (!H.confirmBtn(el, 'Click again: delete permanently')) return;
        var p = S.get('people', el.dataset.id); erase(p); H.render(); H.toast('Their personal information has been deleted');
      },
      newbreach: function () {
        H.modal(H.dialogHead('Record an incident', 'What happened to whose information.') + '<div class="dlg-body"><label class="field">Date<input type="date" id="br-d" value="' + H.today() + '"></label><label class="field">What happened<textarea id="br-w" rows="3" placeholder="e.g. A printed roster with phone numbers was left at the coffee shop"></textarea></label>' +
          '<div class="two"><label class="field">People affected<input id="br-a" placeholder="e.g. 14 volunteers"></label><label class="field">Regulator told on<input type="date" id="br-r"></label></div><label class="field">People affected told on<input type="date" id="br-t"></label></div>' +
          '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="privacy:savebreach">Save</button></div>', 'Record an incident');
      },
      savebreach: function () {
        var v = function (id) { return document.getElementById(id).value.trim(); };
        if (!v('br-w')) return;
        S.put('breaches', { date: v('br-d'), what: v('br-w'), affected: v('br-a'), regulator: v('br-r'), told: v('br-t') }, 'Recorded a security incident');
        H.closeModal(); H.render();
      }
    }
  });
})();
