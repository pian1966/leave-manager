/* Church Hub – Import from Elvanto (People export as CSV). Later: direct import through the Elvanto API (server side). */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store;
  var FIELDS = [
    ['id', 'Elvanto ID', /^(person\s*)?id$|elvanto/i],
    ['firstName', 'First name *', /^first|given/i],
    ['lastName', 'Last name *', /^last|surname|family name$/i],
    ['preferredName', 'Known as', /prefer|nick/i],
    ['email', 'Email', /e-?mail/i],
    ['mobile', 'Mobile', /mobile|cell/i],
    ['phone', 'Other phone', /^(home\s*)?phone|telephone/i],
    ['birthDate', 'Birthday', /birth/i],
    ['family', 'Family (ID or name)', /family\s*(id|name)?$/i],
    ['relationship', 'Family relationship', /relationship|family\s*role/i],
    ['category', 'Category', /categor|status|member\s*type/i]
  ];
  var st = { rows: null, head: null, map: {}, fileName: '', done: null };

  /** CSV with quotes, commas and line breaks inside quotes. */
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }
  function guess(head) {
    var m = {};
    FIELDS.forEach(function (f) { var i = head.findIndex(function (h) { return f[2].test(h.trim()); }); if (i >= 0 && Object.keys(m).map(function (k) { return m[k]; }).indexOf(i) < 0) m[f[0]] = i; });
    return m;
  }
  function toISO(v) {
    v = String(v || '').trim(); if (!v) return '';
    var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(v))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);   // dd/mm/yyyy (South African)
    var d = new Date(v); return isNaN(d) ? '' : LeaveCore.iso(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  }
  function records() {
    return st.rows.map(function (r) {
      var o = {}; FIELDS.forEach(function (f) { o[f[0]] = st.map[f[0]] != null && st.map[f[0]] !== '' ? String(r[st.map[f[0]]] || '').trim() : ''; });
      o.birthDate = toISO(o.birthDate);
      var age = o.birthDate ? (new Date().getFullYear() - +o.birthDate.slice(0, 4)) : 99;
      o.child = /child|son|daughter/i.test(o.relationship) || age < 18;
      return o;
    }).filter(function (o) { return o.firstName || o.lastName; });
  }
  function matchExisting(o) {
    return S.find('people', function (p) {
      return (o.id && p.elvantoId === o.id) || (o.email && p.email && p.email.toLowerCase() === o.email.toLowerCase()) ||
        (!o.email && (p.firstName + ' ' + p.lastName).toLowerCase() === (o.firstName + ' ' + o.lastName).toLowerCase());
    })[0];
  }

  function render() {
    var h = '<div class="page-head"><div><h1>Import from Elvanto</h1><p class="lead">Bring your people and families across from Elvanto. Nothing is changed in Elvanto.</p></div></div>';
    if (st.done) {
      return h + '<div class="note ok"><b>Imported.</b> ' + st.done.added + ' added, ' + st.done.updated + ' updated, ' + st.done.families + ' families created.' + (st.done.noConsent ? ' ' + st.done.noConsent + ' people need consent recorded – see the to-do list on Home.' : '') + '</div><div class="btns"><a class="btn primary" href="#/people">Open People</a><button class="btn" data-act="import:again">Import another file</button></div>';
    }
    if (!st.rows) {
      return h + '<div class="grid2"><section class="panel"><h2>1. Export from Elvanto</h2><ol style="margin:0;padding-left:20px;line-height:1.7"><li>In Elvanto, open <b>People</b>.</li><li>Select everyone, then choose <b>Export</b> (as a CSV file).</li><li>Include name, email, mobile, birthday, family and family relationship.</li></ol>' +
        '<p class="hint">Keep the file safe and delete it once imported – it contains personal information.</p></section>' +
        '<section class="panel"><h2>2. Choose the file</h2><label class="field">Elvanto export (.csv)<input type="file" id="im-file" accept=".csv,text/csv"></label><p class="hint">Or <button class="link" data-act="import:sample">try it with a made-up sample file</button>.</p></section></div>' +
        '<section class="panel" style="margin-top:16px"><h2>Coming later: direct import</h2><p class="muted" style="margin:0">Once Church Hub runs on its own secure server, it can read Elvanto directly with your API key (groups, departments and families too), without a file.</p></section>';
    }
    var recs = records(), adds = 0, ups = 0, kids = recs.filter(function (r) { return r.child; }).length;
    recs.forEach(function (r) { if (matchExisting(r)) ups++; else adds++; });
    var fams = {}; recs.forEach(function (r) { if (r.family) fams[r.family] = 1; });
    h += '<div class="note info">File: <b>' + esc(st.fileName) + '</b> – ' + st.rows.length + ' rows. Check the matching below, then import.</div>';
    h += '<div class="grid2"><section class="panel"><h2>Match the columns</h2>' + FIELDS.map(function (f) {
      return '<label class="field">' + esc(f[1]) + '<select class="im-map" data-f="' + f[0] + '"><option value="">— not in the file —</option>' + st.head.map(function (c, i) { return '<option value="' + i + '"' + (st.map[f[0]] === i ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>';
    }).join('') + '</section>' +
      '<section class="panel"><h2>What will happen</h2><div class="stats"><div class="stat"><span>New people</span><b>' + adds + '</b></div><div class="stat"><span>Already here (updated)</span><b>' + ups + '</b></div><div class="stat"><span>Children</span><b>' + kids + '</b></div><div class="stat"><span>Families</span><b>' + Object.keys(fams).length + '</b></div></div>' +
      '<div class="table-wrap"><table class="simple"><thead><tr><th>Name</th><th>Email</th><th>Family</th></tr></thead><tbody>' + recs.slice(0, 8).map(function (r) { return '<tr><td>' + esc(r.firstName + ' ' + r.lastName) + (r.child ? ' <span class="tag" style="--c:#0E7490">Child</span>' : '') + '</td><td>' + esc(r.email) + '</td><td>' + esc(r.family) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (recs.length > 8 ? '<p class="hint">…and ' + (recs.length - 8) + ' more.</p>' : '') +
      '<label class="check" style="margin-top:10px"><input type="checkbox" id="im-consent"><span>Elvanto records show these people agreed to the church keeping their details. <span class="muted small">Only tick if that’s true – otherwise you’ll be reminded to ask them (POPIA).</span></span></label>' +
      '<div class="btns" style="margin-top:12px"><button class="btn primary" data-act="import:go"' + (st.map.firstName == null || st.map.lastName == null ? ' disabled' : '') + '>Import ' + recs.length + ' people</button><button class="btn" data-act="import:again">Start again</button></div></section></div>';
    return h;
  }

  function load(name, text) {
    var rows = parseCSV(text);
    if (rows.length < 2) { H.toast('That file has no rows to import', true); return; }
    st.head = rows[0]; st.rows = rows.slice(1); st.map = guess(st.head); st.fileName = name; st.done = null; H.render();
  }

  H.register({
    id: 'import', name: 'Import', desc: 'Bring people across from Elvanto', icon: H.ICON.import, tint: '#A16207', roles: ['admin'],
    render: function () { return H.can('*') ? render() : '<p class="empty">Only Administrators can import.</p>'; },
    after: function () {
      var f = document.getElementById('im-file');
      if (f) f.addEventListener('change', function () { var file = f.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { load(file.name, rd.result); }; rd.readAsText(file); });
      document.querySelectorAll('.im-map').forEach(function (s) { s.addEventListener('change', function () { st.map[s.dataset.f] = s.value === '' ? null : +s.value; H.render(); }); });
    },
    actions: {
      sample: function () {
        load('elvanto-people-sample.csv', 'Person ID,First Name,Last Name,Preferred Name,Email,Mobile,Birthday,Family ID,Family Relationship,Category\n' +
          'E-101,Brian,Fourie,,brian.fourie@example.com,083 111 2222,1975-03-12,FAM-9,Primary Contact,Member\n' +
          'E-102,Karen,Fourie,,karen.fourie@example.com,083 111 3333,1978-07-01,FAM-9,Spouse,Member\n' +
          'E-103,Mia,Fourie,,,,12/05/2014,FAM-9,Child,Member\n' +
          'E-104,"Sipho","Mahlangu",Sips,sipho.m@example.com,072 555 1234,,,,Visitor\n' +
          'E-105,Jason,Naidoo,,jason.naidoo@example.com,082 000 1370,,FAM-2,Primary Contact,Visitor\n');
      },
      again: function () { st = { rows: null, head: null, map: {}, fileName: '', done: null }; H.render(); },
      go: function () {
        var recs = records(), famIds = {}, out = { added: 0, updated: 0, families: 0, noConsent: 0 };
        var consent = document.getElementById('im-consent').checked;
        recs.forEach(function (r) {
          var fid = '';
          if (r.family) {
            if (!famIds[r.family]) {
              var ex = S.find('families', function (f) { return f.elvantoId === r.family || f.name === r.family; })[0];
              if (!ex) { ex = S.put('families', { name: (/^[A-Z]+-?\d+$/i.test(r.family) ? r.lastName : r.family.replace(/ family$/i, '')) + ' family', elvantoId: r.family }); out.families++; }
              famIds[r.family] = ex.id;
            }
            fid = famIds[r.family];
          }
          var p = matchExisting(r), isNew = !p;
          p = p ? JSON.parse(JSON.stringify(p)) : { active: true, appRole: 'member', keyDates: [], source: 'elvanto' };
          ['firstName', 'lastName', 'preferredName', 'email', 'mobile', 'birthDate'].forEach(function (k) { if (r[k]) p[k] = r[k]; });
          if (!p.mobile && r.phone) p.mobile = r.phone;
          if (r.id) p.elvantoId = r.id;
          if (fid) p.familyId = fid;
          p.familyRole = r.child ? 'child' : 'adult';
          if (r.category) p.category = /visit/i.test(r.category) ? 'Visitor' : /staff/i.test(r.category) ? 'Staff' : 'Member'; else p.category = p.category || 'Member';
          S.put('people', p);
          if (consent && !PeopleHelpers.hasConsent(p.id, 'Church records')) S.put('consents', { personId: p.id, purpose: 'Church records', given: true, date: H.today(), method: 'Carried over from Elvanto', recordedBy: H.name(H.user()), guardianId: '' });
          if (!PeopleHelpers.hasConsent(p.id, 'Church records')) out.noConsent++;
          if (isNew) out.added++; else out.updated++;
        });
        S.audit('Imported ' + recs.length + ' people from Elvanto (' + st.fileName + ')', 'people');
        st.done = out; st.rows = null; H.render(); H.toast('Import finished');
      }
    }
  });
})();
