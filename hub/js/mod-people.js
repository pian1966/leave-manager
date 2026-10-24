/* Church Hub – People: directory, families, profiles, consent (POPIA), restricted notes. */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store;
  var PURPOSES = ['Church records', 'Email', 'SMS', 'Church directory', 'Photos', 'Children’s medical notes'];
  var CATS = ['Member', 'Visitor', 'Staff', 'Former member'];
  var state = { q: '', f: 'all', audited: '' };

  function canSeeAll() { return H.can('people.view') || H.can('*'); }
  function canBasic() { return canSeeAll() || H.can('people.basic'); }
  function isMe(p) { var u = H.user(); return u && p && u.id === p.id; }
  function consentFor(pid, purpose) {
    return S.find('consents', function (c) { return c.personId === pid && c.purpose === purpose && !c.withdrawnAt; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
  }
  function hasConsent(pid, purpose) { var c = consentFor(pid, purpose); return !!(c && c.given); }
  function familyOf(p) { return p && p.familyId ? S.get('families', p.familyId) : null; }
  function members(fid) { return S.find('people', function (p) { return p.familyId === fid && p.active !== false; }); }
  function age(p) { if (!p.birthDate) return ''; var b = LeaveCore.parse(p.birthDate), t = new Date(); var a = t.getFullYear() - b.getFullYear(); if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) a--; return a; }

  /** Who may this user see in the directory? Members only see people who agreed to be in the church directory. */
  function visiblePeople() {
    var all = S.find('people', function (p) { return p.active !== false; });
    if (canBasic()) return H.can('children') || canSeeAll() ? all : all.filter(function (p) { return p.familyRole !== 'child'; });
    return all.filter(function (p) { return isMe(p) || (p.familyRole !== 'child' && hasConsent(p.id, 'Church directory')); });
  }

  /* ---------- list ---------- */
  function renderList() {
    var list = visiblePeople(), q = state.q.trim().toLowerCase();
    var filters = [['all', 'Everyone'], ['Member', 'Members'], ['Visitor', 'Visitors'], ['Staff', 'Staff'], ['child', 'Children']];
    if (!canBasic()) filters = [['all', 'Directory']];
    var shown = list.filter(function (p) {
      if (state.f === 'child' ? p.familyRole !== 'child' : (state.f !== 'all' && p.category !== state.f)) return false;
      return !q || (H.name(p) + ' ' + p.email + ' ' + (p.mobile || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName); });
    return '<div class="page-head"><div><h1>People</h1><p class="lead">' + (canBasic() ? 'Everyone connected to the church: members, visitors, staff and children.' : 'Church members who agreed to be in the directory.') + '</p></div>' +
      '<div class="btns">' + (canSeeAll() ? '<a class="btn" href="#/people/families">Families</a><button class="btn primary" data-act="people:add">' + H.icon(H.ICON.plus, 18) + 'Add person</button>' : '<a class="btn" href="#/people/p/' + H.user().id + '">My details</a>') + '</div></div>' +
      '<div class="row" style="margin-bottom:14px"><label class="search">' + H.icon(H.ICON.search, 18) + '<span class="sr">Search people</span><input id="pp-q" type="search" placeholder="Search by name, email or phone" value="' + esc(state.q) + '"></label>' +
      (filters.length > 1 ? '<div class="seg" role="group" aria-label="Show">' + filters.map(function (f) { return '<button data-act="people:filter" data-f="' + f[0] + '" class="' + (state.f === f[0] ? 'on' : '') + '" aria-pressed="' + (state.f === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>' : '') + '</div>' +
      '<p class="muted small" id="pp-count">' + shown.length + ' ' + (shown.length === 1 ? 'person' : 'people') + '</p>' +
      (shown.length ? '<div class="list">' + shown.map(function (p) {
        var fam = familyOf(p), tags = '';
        if (p.familyRole === 'child') tags += '<span class="tag" style="--c:#0E7490">Child' + (age(p) !== '' ? ', ' + age(p) : '') + '</span>';
        else tags += '<span class="tag grey">' + esc(p.staff ? p.staff.category : p.category) + '</span>';
        if (canSeeAll() && !hasConsent(p.id, 'Church records')) tags += ' <span class="tag bad">No consent</span>';
        return '<a class="item" href="#/people/p/' + p.id + '">' + H.avatar(p) + '<span class="grow"><b>' + esc(H.name(p)) + '</b><small>' + esc([fam ? fam.name : '', canBasic() || isMe(p) ? p.mobile : ''].filter(Boolean).join(' · ')) + '</small></span>' + tags + '</a>';
      }).join('') + '</div>' : '<p class="empty">No one matches. Try another name, or clear the search.</p>');
  }

  /* ---------- profile ---------- */
  function renderPerson(id) {
    var p = S.get('people', id), me = isMe(p);
    if (!p || (!canBasic() && !me && visiblePeople().indexOf(p) < 0)) return '<a class="crumb" href="#/people">' + H.icon(H.ICON.back, 16) + 'People</a><p class="empty">This person isn’t available to you.</p>';
    var full = canSeeAll() || me, fam = familyOf(p), child = p.familyRole === 'child';
    var seeMedical = child && (H.can('medical') || H.can('*'));
    var seeNotes = H.can('notes') || H.can('*');
    if (state.audited !== id && (seeMedical && p.medical || seeNotes)) {     // POPIA: log who viewed restricted information
      state.audited = id;
      if (seeNotes) S.audit('Viewed pastoral notes of ' + H.name(p), 'people/' + id);
      if (seeMedical && p.medical) S.audit('Viewed children’s medical notes of ' + H.name(p), 'people/' + id);
    }
    var tags = '<span class="tag grey">' + esc(p.staff ? p.staff.category : p.category) + '</span>' + (child ? ' <span class="tag" style="--c:#0E7490">Child' + (age(p) !== '' ? ', ' + age(p) : '') + '</span>' : '') +
      (p.source === 'elvanto' ? ' <span class="tag" style="--c:#7C3AED">From Elvanto</span>' : '');
    var html = '<a class="crumb" href="#/people">' + H.icon(H.ICON.back, 16) + 'People</a>' +
      '<div class="page-head"><div class="row">' + H.avatar(p, 64) + '<div><h1>' + esc(H.name(p)) + '</h1><div class="row" style="margin-top:6px">' + tags + '</div></div></div>' +
      '<div class="btns">' + (full || H.can('people.edit') ? '<button class="btn" data-act="people:edit" data-id="' + p.id + '">Edit details</button>' : '') +
      (H.can('*') ? '<button class="btn" data-act="people:export" data-id="' + p.id + '">' + H.icon(H.ICON.download, 18) + 'Export their data</button>' : '') + '</div></div>';

    html += '<div class="grid2">';
    // Contact
    html += '<section class="panel"><h2>Contact and details</h2><dl class="kv">' +
      (p.preferredName ? '<dt>Known as</dt><dd>' + esc(p.preferredName) + '</dd>' : '') +
      (!child ? '<dt>Email</dt><dd>' + (p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '<span class="muted">—</span>') + '</dd>' +
        '<dt>Mobile</dt><dd>' + (p.mobile ? '<a href="tel:' + esc(p.mobile.replace(/\s/g, '')) + '">' + esc(p.mobile) + '</a>' : '<span class="muted">—</span>') + '</dd>' : '') +
      (full && p.birthDate ? '<dt>Birthday</dt><dd>' + esc(H.fmt(p.birthDate, true)) + '</dd>' : '') +
      (full ? (p.keyDates || []).map(function (k) { return '<dt>' + esc(k.label) + '</dt><dd>' + esc(H.fmt(k.date, true)) + '</dd>'; }).join('') : '') +
      (p.staff && full ? '<dt>Staff</dt><dd>' + esc(p.staff.category) + ', since ' + esc(H.fmt(p.staff.start, true)) + ' · <a href="#/leave">Leave</a></dd>' : '') +
      (H.can('*') ? '<dt>App access</dt><dd>' + esc((H.ROLES[p.appRole] || H.ROLES.member).label) + '</dd>' : '') +
      '</dl></section>';
    // Family
    if (fam && (canBasic() || me)) {
      html += '<section class="panel"><h2>' + esc(fam.name) + '</h2><div class="list">' + members(fam.id).map(function (m) {
        return '<a class="item" href="#/people/p/' + m.id + '">' + H.avatar(m, 32) + '<span class="grow"><b>' + esc(H.name(m)) + '</b><small>' + (m.familyRole === 'child' ? 'Child' + (age(m) !== '' ? ', ' + age(m) : '') : 'Adult') + '</small></span></a>';
      }).join('') + '</div>' + (H.can('rosters.manage') || H.can('*') ? '<p class="hint">Want them to serve together? <a href="#/rosters/together">Set up a serving group</a>.</p>' : '') + '</section>';
    }
    // Consent (POPIA)
    if (full) {
      html += '<section class="panel"><div class="row"><h2 class="grow" style="margin:0">Consent</h2>' + H.icon(H.ICON.privacy, 18) + '</div><p class="hint" style="margin:4px 0 10px">What ' + (me ? 'you have' : esc(p.firstName) + ' has') + ' agreed to, as POPIA requires.' + (child ? ' A parent or guardian gives consent for children.' : '') + '</p>' +
        '<div class="list">' + PURPOSES.filter(function (x) { return child ? (x === 'Church records' || x === 'Photos' || x === 'Children’s medical notes') : x !== 'Children’s medical notes'; }).map(function (pur) {
          var c = consentFor(p.id, pur);
          return '<div class="item"><span class="grow"><b>' + esc(pur) + '</b><small>' + (c ? esc((c.given ? 'Agreed ' : 'Declined ') + H.fmt(c.date, true) + ' · ' + c.method + (c.guardianId ? ' · by ' + H.name(S.get('people', c.guardianId)) : '')) : 'Not asked yet') + '</small></span>' +
            (c ? (c.given ? '<span class="tag ok">Yes</span>' : '<span class="tag grey">No</span>') : '<span class="tag bad">Missing</span>') + '</div>';
        }).join('') + '</div><div class="btns" style="margin-top:12px"><button class="btn small" data-act="people:consent" data-id="' + p.id + '">' + (me ? 'Change my choices' : 'Record consent') + '</button></div></section>';
    }
    // Medical (children)
    if (seeMedical) {
      html += '<section class="panel"><div class="row"><h2 class="grow" style="margin:0">Medical and allergies</h2><span class="locked">' + H.icon(H.ICON.lock, 14) + 'Children’s ministry only</span></div>' +
        (p.medical && (p.medical.allergies || p.medical.notes) ? '<dl class="kv" style="margin-top:12px">' + (p.medical.allergies ? '<dt>Allergies</dt><dd><span class="tag bad">' + esc(p.medical.allergies) + '</span></dd>' : '') + (p.medical.notes ? '<dt>Notes</dt><dd>' + esc(p.medical.notes) + '</dd>' : '') + '</dl>' : '<p class="muted">None recorded.</p>') +
        (hasConsent(p.id, 'Children’s medical notes') ? '' : '<p class="note warn" style="margin-top:10px">No guardian consent for medical notes yet.</p>') + '</section>';
    }
    // Pastoral notes
    if (seeNotes && !me) {
      var notes = S.find('notes', function (n) { return n.personId === p.id; });
      html += '<section class="panel"><div class="row"><h2 class="grow" style="margin:0">Pastoral notes</h2><span class="locked">' + H.icon(H.ICON.lock, 14) + 'Pastors only · views are logged</span></div>' +
        (notes.length ? notes.map(function (n) { return '<div style="margin-top:12px"><p style="margin:0">' + esc(n.text) + '</p><p class="hint">' + esc(n.by + ', ' + H.fmt(n.at, true)) + '</p></div>'; }).join('') : '<p class="muted">No notes.</p>') +
        '<label class="field" style="margin-top:12px">Add a note<textarea id="pn-text" rows="2" placeholder="Only pastors can see this"></textarea></label><button class="btn small" data-act="people:note" data-id="' + p.id + '">Save note</button></section>';
    }
    // Serving
    if (!child) {
      var sk = S.find('skills', function (k) { return k.personId === p.id; }), pos = {};
      S.list('positions').forEach(function (x) { pos[x.id] = x; });
      var gr = S.find('groups', function (g) { return g.memberIds.indexOf(p.id) >= 0; });
      html += '<section class="panel"><h2>Serving</h2>' + (sk.length ? '<p style="margin:0 0 8px">' + sk.map(function (k) { return '<span class="tag" style="--c:#2F6FB3">' + esc((pos[k.positionId] || {}).name) + ' · ' + esc(k.frequency) + '</span>'; }).join(' ') + '</p>' : '<p class="muted">Not on any team yet.</p>') +
        gr.map(function (g) { return '<p class="hint">' + (g.kind === 'together' ? H.icon(H.ICON.link, 14) + ' Serves together with ' : H.icon(H.ICON.split, 14) + ' Kept apart from ') + esc(g.memberIds.filter(function (m) { return m !== p.id; }).map(function (m) { return H.name(S.get('people', m)); }).join(', ')) + ' (' + esc(g.strength === 'must' ? 'always' : 'when possible') + ')</p>'; }).join('') +
        '<div class="btns" style="margin-top:10px"><a class="btn small" href="#/rosters/' + (me ? 'mine' : 'teams') + '">' + (me ? 'My serving' : 'Teams') + '</a></div></section>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- families ---------- */
  function renderFamilies() {
    var fams = S.list('families').slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<a class="crumb" href="#/people">' + H.icon(H.ICON.back, 16) + 'People</a><div class="page-head"><div><h1>Families</h1><p class="lead">Households linked together. Children are always linked to a parent or guardian, who gives consent for them.</p></div>' +
      '<button class="btn primary" data-act="people:newfam">' + H.icon(H.ICON.plus, 18) + 'New family</button></div>' +
      '<div class="grid2">' + fams.map(function (f) {
        var ms = members(f.id);
        return '<section class="panel"><h2>' + esc(f.name) + '</h2>' + (ms.length ? '<div class="list">' + ms.map(function (m) { return '<a class="item" href="#/people/p/' + m.id + '">' + H.avatar(m, 32) + '<span class="grow"><b>' + esc(H.name(m)) + '</b><small>' + (m.familyRole === 'child' ? 'Child' : 'Adult') + '</small></span></a>'; }).join('') + '</div>' : '<p class="muted">No one in this family yet.</p>') + '</section>';
      }).join('') + '</div>';
  }

  /* ---------- edit dialogs ---------- */
  function editDialog(p) {
    var isNew = !p; p = p || { firstName: '', lastName: '', preferredName: '', email: '', mobile: '', birthDate: '', category: 'Visitor', familyId: '', familyRole: 'adult', appRole: 'member' };
    var admin = H.can('*'), me = isMe(p);
    var fams = S.list('families');
    var html = H.dialogHead(isNew ? 'Add a person' : 'Edit ' + H.name(p), isNew ? 'Only add what the church needs. Ask for consent when you add someone.' : '') +
      '<form id="pf" class="dlg-body" novalidate><input type="hidden" id="pf-id" value="' + esc(p.id || '') + '">' +
      '<div class="two"><label class="field">First name<input id="pf-first" required value="' + esc(p.firstName) + '" autocomplete="given-name"></label>' +
      '<label class="field">Last name<input id="pf-last" required value="' + esc(p.lastName) + '" autocomplete="family-name"></label></div>' +
      '<label class="field">Known as <small>(optional)</small><input id="pf-pref" value="' + esc(p.preferredName || '') + '"></label>' +
      '<div class="two"><label class="field">Email<input id="pf-email" type="email" value="' + esc(p.email || '') + '" autocomplete="email"></label>' +
      '<label class="field">Mobile<input id="pf-mobile" type="tel" value="' + esc(p.mobile || '') + '" autocomplete="tel"></label></div>' +
      (!me || admin ? '<div class="two"><label class="field">Birthday <small>(optional)</small><input id="pf-birth" type="date" value="' + esc(p.birthDate || '') + '"></label>' +
        '<label class="field">Category<select id="pf-cat">' + CATS.map(function (c) { return '<option' + (p.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="two"><label class="field">Family<select id="pf-fam"><option value="">No family</option>' + fams.map(function (f) { return '<option value="' + f.id + '"' + (p.familyId === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '<option value="__new">+ New family…</option></select></label>' +
        '<label class="field">In the family as<select id="pf-frole"><option value="adult"' + (p.familyRole !== 'child' ? ' selected' : '') + '>Adult</option><option value="child"' + (p.familyRole === 'child' ? ' selected' : '') + '>Child (under 18)</option></select></label></div>' : '') +
      (admin ? '<label class="field">App access<select id="pf-role">' + Object.keys(H.ROLES).map(function (r) { return '<option value="' + r + '"' + (p.appRole === r ? ' selected' : '') + '>' + esc(H.ROLES[r].label) + '</option>'; }).join('') + '</select><small>What they can see and do in Church Hub.</small></label>' : '') +
      '<p id="pf-err" class="note bad" hidden></p></form>' +
      '<div class="dlg-foot">' + (!isNew && admin ? '<button class="btn" style="margin-right:auto" data-act="people:archive" data-id="' + p.id + '">Mark as left</button>' : '') +
      '<button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="people:save">' + (isNew ? 'Add person' : 'Save') + '</button></div>';
    H.modal(html, isNew ? 'Add a person' : 'Edit person');
  }

  function consentDialog(p) {
    var child = p.familyRole === 'child', me = isMe(p);
    var guardians = child ? members(p.familyId).filter(function (m) { return m.familyRole === 'adult'; }) : [];
    var purposes = PURPOSES.filter(function (x) { return child ? (x === 'Church records' || x === 'Photos' || x === 'Children’s medical notes') : x !== 'Children’s medical notes'; });
    H.modal(H.dialogHead(me ? 'My privacy choices' : 'Consent for ' + H.name(p), 'Tick what ' + (me ? 'you agree' : 'they agree') + ' to. Unticking withdraws consent from today.') +
      '<div class="dlg-body">' + purposes.map(function (pur, i) {
        return '<label class="check"><input type="checkbox" class="cf-p" data-p="' + esc(pur) + '"' + (hasConsent(p.id, pur) ? ' checked' : '') + '><span><b>' + esc(pur) + '</b><br><span class="muted small">' + esc({
          'Church records': 'Keep their details on the church database.', 'Email': 'Church news and information by email.', 'SMS': 'Reminders and urgent news by SMS.',
          'Church directory': 'Name and phone visible to other members.', 'Photos': 'Photos at church events may be shared.', 'Children’s medical notes': 'Allergies and medical notes kept for safety at children’s church.' }[pur]) + '</span></span></label>';
      }).join('') +
      (!me ? '<div class="two" style="margin-top:8px"><label class="field">How it was given<select id="cf-method"><option>Paper connect card</option><option>Online form</option><option>In person (verbal)</option><option>Email</option></select></label>' +
        (child ? '<label class="field">Given by (parent/guardian)<select id="cf-guardian">' + guardians.map(function (g) { return '<option value="' + g.id + '">' + esc(H.name(g)) + '</option>'; }).join('') + '</select></label>' : '') + '</div>' : '') +
      '<p class="hint">' + esc(Store.settings().privacyNotice) + '</p></div>' +
      '<div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="people:saveconsent" data-id="' + p.id + '">Save</button></div>', 'Consent');
  }

  function exportPerson(p) {
    var pick = function (c) { return S.find(c, function (x) { return x.personId === p.id || (x.memberIds && x.memberIds.indexOf(p.id) >= 0); }); };
    var lv = Store.leave();
    var data = { exportedAt: Store.now(), by: H.name(H.user()), note: 'Everything Church Hub holds about this person (POPIA section 23).',
      person: p, family: familyOf(p), consents: pick('consents'), pastoralNotes: pick('notes'), serving: { skills: pick('skills'), assignments: pick('assignments'), groups: pick('groups'), awayDates: pick('blockouts') },
      leave: lv ? lv.requests.filter(function (r) { return r.staffId === p.id; }) : [], auditEntries: S.find('audit', function (a) { return a.target === 'people/' + p.id; }) };
    S.audit('Exported all data held about ' + H.name(p), 'people/' + p.id);
    H.download('church-hub-' + (p.firstName + '-' + p.lastName).toLowerCase().replace(/\W+/g, '-') + '.json', JSON.stringify(data, null, 2));
    H.toast('Downloaded everything held about ' + H.name(p));
  }

  H.register({
    id: 'people', name: 'People', desc: 'Directory, families and consent', icon: H.ICON.people, tint: '#7C3AED',
    stat: function () { return canBasic() ? S.find('people', function (p) { return p.active !== false; }).length + ' people · ' + S.list('families').length + ' families' : 'Church directory'; },
    todos: function (u) {
      if (!H.can('*') && !H.can('people.view')) return [];
      var missing = S.find('people', function (p) { return p.active !== false && !hasConsent(p.id, 'Church records'); });
      return missing.length ? [{ text: missing.length + ' ' + (missing.length === 1 ? 'person has' : 'people have') + ' no recorded consent', href: '#/people/p/' + missing[0].id, tag: 'POPIA' }] : [];
    },
    render: function (p) {
      if (p[0] === 'p') return renderPerson(p[1]);
      if (p[0] === 'families') return renderFamilies();
      return renderList();
    },
    after: function () {
      var q = document.getElementById('pp-q');
      if (q) q.addEventListener('input', function () { state.q = q.value; var pos = q.selectionStart; H.render(); var n = document.getElementById('pp-q'); n.focus(); n.setSelectionRange(pos, pos); });
    },
    actions: {
      filter: function (el) { state.f = el.dataset.f; H.render(); },
      add: function () { editDialog(null); },
      edit: function (el) { editDialog(S.get('people', el.dataset.id)); },
      consent: function (el) { consentDialog(S.get('people', el.dataset.id)); },
      export: function (el) { exportPerson(S.get('people', el.dataset.id)); },
      save: function () {
        var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : null; };
        var err = document.getElementById('pf-err'), id = g('pf-id');
        var p = id ? JSON.parse(JSON.stringify(S.get('people', id))) : { active: true, appRole: 'member', keyDates: [], source: 'manual' };
        if (!g('pf-first') || !g('pf-last')) { err.textContent = 'Please enter a first and last name.'; err.hidden = false; return; }
        if (g('pf-email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g('pf-email'))) { err.textContent = 'That email address doesn’t look right.'; err.hidden = false; return; }
        p.firstName = g('pf-first'); p.lastName = g('pf-last'); p.preferredName = g('pf-pref'); p.email = g('pf-email'); p.mobile = g('pf-mobile');
        if (g('pf-birth') !== null) p.birthDate = g('pf-birth');
        if (g('pf-cat') !== null) p.category = g('pf-cat');
        if (g('pf-frole') !== null) p.familyRole = g('pf-frole');
        if (g('pf-role') !== null) p.appRole = g('pf-role');
        var fam = g('pf-fam');
        if (fam === '__new') { var f = S.put('families', { name: p.lastName + ' family' }, 'Created family ' + p.lastName); fam = f.id; }
        if (fam !== null) p.familyId = fam;
        if (p.familyRole === 'child' && !p.familyId) { err.textContent = 'Children must be linked to a family, so a parent or guardian can give consent.'; err.hidden = false; return; }
        S.put('people', p, (id ? 'Updated details of ' : 'Added ') + p.firstName + ' ' + p.lastName);
        H.closeModal();
        if (!id) { H.go('people/p/' + p.id); setTimeout(function () { consentDialog(p); }, 50); } else H.render();
        H.toast(id ? 'Saved' : 'Added – now record their consent');
      },
      saveconsent: function (el) {
        var p = S.get('people', el.dataset.id), me = isMe(p);
        var method = document.getElementById('cf-method'), guardian = document.getElementById('cf-guardian');
        document.querySelectorAll('.cf-p').forEach(function (box) {
          var pur = box.dataset.p, had = hasConsent(p.id, pur);
          if (box.checked === had && consentFor(p.id, pur)) return;
          var old = consentFor(p.id, pur); if (old) { old.withdrawnAt = H.today(); S.put('consents', old); }
          S.put('consents', { personId: p.id, purpose: pur, given: box.checked, date: H.today(), method: me ? 'Changed in the app' : method.value, recordedBy: H.name(H.user()), guardianId: guardian ? guardian.value : '' },
            (box.checked ? 'Consent given: ' : 'Consent withdrawn: ') + pur + ' for ' + H.name(p));
        });
        H.closeModal(); H.render(); H.toast('Consent saved');
      },
      note: function (el) {
        var t = document.getElementById('pn-text').value.trim(); if (!t) return;
        S.put('notes', { personId: el.dataset.id, text: t, by: H.name(H.user()), at: H.today() }, 'Added a pastoral note');
        H.render(); H.toast('Note saved');
      },
      newfam: function () {
        H.modal(H.dialogHead('New family') + '<div class="dlg-body"><label class="field">Family name<input id="nf-name" placeholder="e.g. Naidoo family"></label></div><div class="dlg-foot"><button class="btn" data-act="hub:close">Cancel</button><button class="btn primary" data-act="people:savefam">Create</button></div>', 'New family');
      },
      savefam: function () { var n = document.getElementById('nf-name').value.trim(); if (!n) return; S.put('families', { name: /family$/i.test(n) ? n : n + ' family' }, 'Created family ' + n); H.closeModal(); H.render(); },
      archive: function (el) {
        if (!H.confirmBtn(el, 'Click again: mark as left')) return;
        var p = S.get('people', el.dataset.id); p.active = false; p.category = 'Former member'; p.archivedAt = H.today();
        S.put('people', p, 'Marked as left: ' + H.name(p)); H.closeModal(); H.go('people'); H.toast(H.name(p) + ' marked as left. Delete them later under Privacy → Retention.');
      }
    }
  });
  window.PeopleHelpers = { hasConsent: hasConsent, consentFor: consentFor, members: members, age: age, exportPerson: exportPerson };
})();
