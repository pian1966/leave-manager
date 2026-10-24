/* Church Hub – Settings: church details, apps on/off, who has access, service times. */
(function () {
  'use strict';
  var H = Hub, esc = H.esc, S = Store;
  var MODS = [['people', 'People', 'Directory, families and consent'], ['rosters', 'Rosters', 'Serving rosters, teams and serving together'], ['leave', 'Leave', 'Staff leave (Leave Manager built in)'],
    ['privacy', 'Privacy', 'POPIA tools'], ['import', 'Import', 'Bring data across from Elvanto']];

  function render() {
    var st = S.settings(), on = st.modules || {};
    var byRole = {}; S.find('people', function (p) { return p.active !== false && p.familyRole !== 'child'; }).forEach(function (p) { (byRole[p.appRole || 'member'] = byRole[p.appRole || 'member'] || []).push(p); });
    var svcs = S.list('services').filter(function (s) { return s.date >= H.today(); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return '<div class="page-head"><div><h1>Settings</h1><p class="lead">Church details, which apps are switched on, who can see what, and service times.</p></div></div><div class="grid2">' +
      '<section class="panel"><h2>Church</h2><label class="field">Church name<input id="st-name" value="' + esc(st.churchName) + '"></label><button class="btn small" data-act="settings:name">Save</button></section>' +
      '<section class="panel"><h2>Apps</h2><p class="hint" style="margin-top:0">Switch off what you don’t use – its card disappears for everyone. Nothing is deleted.</p>' + MODS.map(function (m) {
        return '<label class="check"><input type="checkbox" class="st-mod" value="' + m[0] + '"' + (on[m[0]] !== false ? ' checked' : '') + '><span><b>' + esc(m[1]) + '</b><br><span class="muted small">' + esc(m[2]) + '</span></span></label>';
      }).join('') + '<p class="hint">More apps (groups, check-in, messages, calendar) arrive in later phases.</p></section>' +
      '<section class="panel"><h2>Who can see what</h2><div class="table-wrap"><table class="simple"><thead><tr><th>Access</th><th>Can</th><th>People</th></tr></thead><tbody>' +
      [['admin', 'Everything, including Privacy, Import and Settings'], ['pastor', 'People, families, pastoral notes, children'], ['rosters', 'Rosters and teams; names and contact details only'], ['kids', 'Children, guardians and medical notes'], ['member', 'Their own details, serving and leave; the church directory']].map(function (r) {
        return '<tr><td><b>' + esc(H.ROLES[r[0]].label) + '</b></td><td>' + esc(r[1]) + '</td><td>' + (byRole[r[0]] || []).length + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">Change someone’s access from their profile (People → Edit details).</p></section>' +
      '<section class="panel"><h2>Services that need a roster</h2>' + (svcs.length ? '<div class="list">' + svcs.slice(0, 6).map(function (s) { return '<div class="item"><span class="grow"><b>' + esc(H.fmt(s.date, true)) + '</b><small>' + esc(s.time + ' · ' + s.name) + '</small></span><button class="icon-btn ghost" data-act="settings:delsvc" data-id="' + s.id + '" aria-label="Remove this service">' + H.icon(H.ICON.trash, 18) + '</button></div>'; }).join('') + '</div>' + (svcs.length > 6 ? '<p class="hint">…and ' + (svcs.length - 6) + ' more.</p>' : '') : '<p class="muted">None planned.</p>') +
      '<div class="two" style="margin-top:12px"><label class="field">Every<select id="sv-day">' + H.DOW.map(function (d, i) { return '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] + '</option>'; }).join('') + '</select></label><label class="field">Time<input id="sv-time" type="time" value="09:30"></label></div>' +
      '<div class="two"><label class="field">Name<input id="sv-name" value="Morning service"></label><label class="field">For the next<select id="sv-n"><option>4</option><option selected>8</option><option>13</option></select></label></div>' +
      '<button class="btn small" data-act="settings:addsvc">Add these services</button></section></div>';
  }

  H.register({
    id: 'settings', name: 'Settings', desc: 'Church details, apps and access', icon: H.ICON.settings, tint: '#6B625A', roles: ['admin'],
    render: function () { return H.can('*') ? render() : '<p class="empty">Only Administrators can change settings.</p>'; },
    after: function () {
      document.querySelectorAll('.st-mod').forEach(function (b) {
        b.addEventListener('change', function () { var m = Object.assign({}, S.settings().modules); m[b.value] = b.checked; S.setSettings({ modules: m }, (b.checked ? 'Switched on ' : 'Switched off ') + b.value); H.toast(b.checked ? 'Switched on' : 'Switched off – its card is hidden'); H.render(); });
      });
    },
    actions: {
      name: function () { var n = document.getElementById('st-name').value.trim(); if (n) { S.setSettings({ churchName: n }, 'Renamed the church'); H.render(); H.toast('Saved'); } },
      addsvc: function () {
        var day = +document.getElementById('sv-day').value, time = document.getElementById('sv-time').value || '09:30', name = document.getElementById('sv-name').value.trim() || 'Service', n = +document.getElementById('sv-n').value;
        var d = LeaveCore.parse(H.today()); while (d.getDay() !== day) d = LeaveCore.addDays(d, 1);
        var added = 0;
        for (var i = 0; i < n; i++) {
          var iso = LeaveCore.iso(LeaveCore.addDays(d, i * 7));
          if (!S.find('services', function (s) { return s.date === iso && s.time === time; }).length) { S.put('services', { date: iso, time: time, name: name }); added++; }
        }
        S.audit('Added ' + added + ' services', 'services'); H.render(); H.toast(added + ' services added');
      },
      delsvc: function (el) { if (!H.confirmBtn(el, '✕?')) return; S.find('assignments', function (x) { return x.serviceId === el.dataset.id; }).forEach(function (x) { S.remove('assignments', x.id); }); S.remove('services', el.dataset.id, 'Removed a service'); H.render(); }
    }
  });
})();
