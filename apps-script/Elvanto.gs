/* ============================== ELVANTO ==============================
 * Keeps Elvanto up to date with approved leave:
 *  1. Calendar: approved leave appears as an event on an Elvanto calendar (Elvanto API, straight away).
 *  2. Unavailable Volunteers: Elvanto's API can't do this, so a robot (GitHub Actions + a browser,
 *     see robot/ in the repository) logs into Elvanto every 15 minutes and enters, changes or removes
 *     the unavailability. It picks up its work from the "Elvanto" tab and reports back here.
 *  3. Email: after each robot run, the Elvanto Administrator gets a summary of what was done and is asked to check.
 *
 * Settings tab:  ElvantoURL, ElvantoAdminEmail, ElvantoCalendarId, ElvantoSync
 * Secrets (Script Properties, set with Leave Manager → Connect Elvanto…):  ELVANTO_API_KEY, ROBOT_SECRET
 */
var ELV_SHEET_ = 'Elvanto';
var ELV_HEAD_ = ['Request ID', 'Staff', 'Elvanto Name', 'Start', 'End', 'Should Be', 'In Elvanto', 'Robot Status', 'Robot Note',
  'Updated', 'Calendar Event', 'Calendar Note'];
var ELV_SETTINGS_ = [
  ['ElvantoSync', 'FALSE', 'TRUE: put approved leave into Elvanto (calendar event + Unavailable Volunteers). Set up with Leave Manager → Connect Elvanto…'],
  ['ElvantoURL', '', 'Your Elvanto address, e.g. https://christchurchhowick.elvanto.eu'],
  ['ElvantoAdminEmail', '', 'Who gets the “what the robot did” emails and checks Elvanto (also the organiser of the calendar events)'],
  ['ElvantoCalendarId', '', 'Elvanto calendar for staff leave events. Blank = no calendar events. Leave Manager → Connect Elvanto… lists your calendars']
];

function elvOn_(data) { return /^true$/i.test(String((data || {}).settings ? data.settings.ElvantoSync : getSetting_('ElvantoSync'))); }
function elvSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(ELV_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(ELV_SHEET_);
    sh.getRange(1, 1, 1, ELV_HEAD_.length).setValues([ELV_HEAD_]).setFontWeight('bold').setBackground('#FCE8D9');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); sh.getRange('D:E').setNumberFormat('@');
    var notes = {
      'Request ID': 'The leave request this row is for (Requests tab).',
      'Staff': 'Name in Leave Manager.',
      'Elvanto Name': 'The person’s name exactly as in Elvanto. Filled in from Elvanto by email when possible; correct it if the robot can’t find the person, then set Robot Status to Waiting.',
      'Start': 'First day of the unavailability (yyyy-mm-dd).',
      'End': 'Last day of the unavailability.',
      'Should Be': '“Unavailable” = the leave is approved and should be in Elvanto. “Removed” = the leave was cancelled or needs approval again.',
      'In Elvanto': 'What the robot last entered in Elvanto (dates), or blank if nothing is there.',
      'Robot Status': 'Waiting = the robot will do it on its next run (every 15 minutes). Done, Failed, or Check. To make the robot try again, type Waiting.',
      'Robot Note': 'What the robot did, or why it couldn’t.',
      'Updated': 'When this row last changed.',
      'Calendar Event': 'The Elvanto calendar event ID for this leave.',
      'Calendar Note': 'Result of the last calendar update.'
    };
    ELV_HEAD_.forEach(function (h, i) { sh.getRange(1, i + 1).setNote(notes[h] || ''); });
  }
  return sh;
}
function elvRows_() {
  var sh = elvSheet_(), vals = sh.getDataRange().getValues(), head = vals[0].map(String), out = [];
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    var o = { _row: i + 1 };
    head.forEach(function (h, j) { o[h] = vals[i][j] instanceof Date ? Utilities.formatDate(vals[i][j], tz_(), 'yyyy-MM-dd') : String(vals[i][j]); });
    out.push(o);
  }
  return out;
}
function elvWrite_(row, obj) {
  var sh = elvSheet_(), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (!row) { row = sh.getLastRow() + 1; }
  Object.keys(obj).forEach(function (k) { var c = head.indexOf(k); if (c >= 0) sh.getRange(row, c + 1).setValue(obj[k]); });
  sh.getRange(row, head.indexOf('Updated') + 1).setValue(nowStr_());
  return row;
}

/* ---------- Elvanto API ---------- */
function elvApi_(method, params) {
  var key = PropertiesService.getScriptProperties().getProperty('ELVANTO_API_KEY');
  if (!key) throw new Error('No Elvanto API key yet (Leave Manager → Connect Elvanto…).');
  var res = UrlFetchApp.fetch('https://api.elvanto.com/v1/' + method + '.json', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(params || {}), muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':x') }
  });
  var j; try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('Elvanto replied with HTTP ' + res.getResponseCode()); }
  if (j.status !== 'ok') throw new Error('Elvanto: ' + ((j.error && (j.error.message || j.error.code)) || res.getResponseCode()));
  return j;
}
/** The person's name as Elvanto knows it, looked up by email (blank if not found). */
function elvNameFor_(st) {
  if (!st || !realEmail_(st)) return '';
  try {
    var j = elvApi_('people/search', { search: { email: st.email } });
    var p = j.people && j.people.person && j.people.person[0];
    if (p) return ((p.preferred_name || p.firstname || '') + ' ' + (p.lastname || '')).trim();
  } catch (e) { console.warn('Elvanto name lookup: ' + e); }
  return '';
}
function elvOrganizer_() {
  var P = PropertiesService.getScriptProperties(), id = P.getProperty('ELV_ORGANIZER');
  if (id) return id;
  var email = String(getSetting_('ElvantoAdminEmail') || '').trim();
  if (!email) throw new Error('Set ElvantoAdminEmail on the Settings tab (the calendar events need an organiser in Elvanto).');
  var j = elvApi_('people/search', { search: { email: email } });
  var p = j.people && j.people.person && j.people.person[0];
  if (!p) throw new Error('No one in Elvanto has the email ' + email + ' (ElvantoAdminEmail).');
  P.setProperty('ELV_ORGANIZER', p.id);
  return p.id;
}
/** Dates are sent mid-day so the event lands on the right days whatever time zone Elvanto uses. */
function elvEventParams_(name, start, end, id) {
  return {
    name: name + ' – away', calendar_id: String(getSetting_('ElvantoCalendarId')), all_day: 'yes', status: 'private',
    start: start + ' 07:00:00', end: end + ' 15:00:00', organizer: elvOrganizer_(),
    description: 'Staff leave from Leave Manager (' + id + '). Kept up to date automatically – please change it in Leave Manager, not here.',
    color: '#E8590C'
  };
}
function elvCalendar_(row, r, staffName) {
  if (!getSetting_('ElvantoCalendarId') || !PropertiesService.getScriptProperties().getProperty('ELVANTO_API_KEY')) return {};
  var ev = row ? row['Calendar Event'] : '';
  try {
    if (r) {
      var params = elvEventParams_(staffName, r.start, r.end, r.id);
      if (ev) { params.event_id = ev; elvApi_('calendar/events/edit', params); return { 'Calendar Note': 'Updated ' + nowStr_() }; }
      var j = elvApi_('calendar/events/create', params);
      return { 'Calendar Event': j.event.id, 'Calendar Note': 'Added ' + nowStr_() };
    }
    if (ev) { elvApi_('calendar/events/remove', { event_id: ev }); return { 'Calendar Event': '', 'Calendar Note': 'Removed ' + nowStr_() }; }
    return {};
  } catch (e) {
    return { 'Calendar Note': 'Failed: ' + String(e.message || e).slice(0, 200) };
  }
}

/**
 * Called whenever approved leave appears, changes or goes away.
 * r = the request as it is now (null-safe); approved = whether it should be in Elvanto.
 */
function elvantoSync_(data, r, st, approved) {
  try {
    if (!elvOn_(data) || !r || !st || !LeaveCore.tracksLeave(st)) return;
    var rows = elvRows_(), row = rows.filter(function (x) { return x['Request ID'] === r.id; })[0];
    if (!row && !approved) return;   // never was in Elvanto
    var want = approved ? 'Unavailable' : 'Removed';
    var same = row && row['Should Be'] === want && (!approved || (row.Start === r.start && row.End === r.end));
    if (same) return;
    var upd = { 'Request ID': r.id, 'Staff': st.name, 'Start': r.start, 'End': r.end, 'Should Be': want,
      'Robot Status': 'Waiting', 'Robot Note': approved ? (row ? 'Dates changed – the robot will update Elvanto.' : 'Approved – the robot will add it to Elvanto.') : 'Cancelled or needs approval again – the robot will remove it from Elvanto.' };
    if (!row || !row['Elvanto Name']) upd['Elvanto Name'] = elvNameFor_(st) || st.name;
    var cal = elvCalendar_(row, approved ? r : null, st.name);
    Object.keys(cal).forEach(function (k) { upd[k] = cal[k]; });
    elvWrite_(row ? row._row : null, upd);
  } catch (e) { console.warn('Elvanto sync skipped: ' + e); }
}

/* ---------- The robot's side (called from doPost with the shared secret) ---------- */
function elvRobot_(b) {
  var secret = PropertiesService.getScriptProperties().getProperty('ROBOT_SECRET');
  if (!secret || String(b.secret || '') !== secret) throw new Error('Not allowed.');
  if (b.action === 'robot-jobs') {
    return {
      url: String(getSetting_('ElvantoURL') || '').replace(/\/+$/, ''),
      jobs: elvOn_() ? elvRows_().filter(function (x) { return x['Robot Status'] === 'Waiting'; }).map(function (x) {
        return { id: x['Request ID'], name: x['Elvanto Name'] || x.Staff, start: x.Start, end: x.End, want: x['Should Be'], have: x['In Elvanto'] };
      }) : []
    };
  }
  if (b.action === 'robot-result') {
    if (b.listUrl) PropertiesService.getScriptProperties().setProperty('ELV_LIST_URL', String(b.listUrl).slice(0, 300));
    var rows = elvRows_(), done = [];
    (b.results || []).forEach(function (res) {
      var row = rows.filter(function (x) { return x['Request ID'] === res.id; })[0];
      if (!row) return;
      // The leave changed again while the robot was working: leave it Waiting for the next run.
      if (res.want && (res.want !== row['Should Be'] || res.start !== row.Start || res.end !== row.End)) return;
      var done_ = res.ok && !res.check;
      elvWrite_(row._row, { 'Robot Status': res.ok ? (res.check ? 'Check' : 'Done') : 'Failed', 'Robot Note': String(res.message || '').slice(0, 300),
        'In Elvanto': done_ ? (row['Should Be'] === 'Unavailable' ? row.Start + ' to ' + row.End : '') : row['In Elvanto'] });
      done.push({ row: row, res: res });
    });
    // A robot that can't log in tries every 15 minutes: only email about that every 6 hours.
    var P = PropertiesService.getScriptProperties(), lastFatal = Number(P.getProperty('ELV_FATAL_AT') || 0);
    var sendFatal = b.fatal && (Date.now() - lastFatal > 6 * 3600 * 1000);
    if (sendFatal) P.setProperty('ELV_FATAL_AT', String(Date.now()));
    if (done.length) elvMail_(done, sendFatal ? b.fatal : null);
    else if (sendFatal) elvMail_([], b.fatal);
    return { saved: done.length };
  }
  throw new Error('Unknown robot action');
}

function elvMail_(done, fatal) {
  var to = String(getSetting_('ElvantoAdminEmail') || '').trim() || adminEmails_();
  if (!to) return;
  var base = String(getSetting_('ElvantoURL') || '').replace(/\/+$/, '');
  var listUrl = PropertiesService.getScriptProperties().getProperty('ELV_LIST_URL') || base;
  var link = listUrl ? '<p><a href="' + esc_(listUrl) + '" style="color:#C2410C">Open Elvanto</a> → People → Volunteers → Unavailable Volunteers</p>' : '';
  var line = function (d) {
    var r = d.row, ok = d.res.ok, rng = LeaveCore.niceRange({ start: r.Start, end: r.End });
    var what = r['Should Be'] === 'Unavailable' ? (r['In Elvanto'] && r['In Elvanto'] !== r.Start + ' to ' + r.End ? 'Changed to' : 'Added:') : 'Removed:';
    return '<li style="margin:6px 0">' + (ok ? '✅ ' : '⚠️ ') + '<b>' + esc_(r['Elvanto Name'] || r.Staff) + '</b> – ' + (ok ? what + ' unavailable ' + rng : 'couldn’t ' + (r['Should Be'] === 'Unavailable' ? 'add unavailable ' : 'remove unavailable ') + rng + ' – please do it by hand') +
      (d.res.message ? '<br><span style="color:#5B6B67;font-size:13px">' + esc_(d.res.message) + '</span>' : '') +
      (r['Calendar Note'] ? '<br><span style="color:#5B6B67;font-size:13px">Calendar: ' + esc_(r['Calendar Note']) + '</span>' : '') + '</li>';
  };
  var bad = done.filter(function (d) { return !d.res.ok; }).length;
  var html = '<p>Leave Manager’s robot has updated Elvanto’s <b>Unavailable Volunteers</b> list for approved, changed or cancelled leave:</p>' +
    (fatal ? '<div style="background:#FEF3C7;border-left:4px solid #D97706;padding:10px 14px;margin:12px 0"><b>The robot couldn’t finish:</b> ' + esc_(fatal) + '</div>' : '') +
    (done.length ? '<ul style="padding-left:18px">' + done.map(line).join('') + '</ul>' : '') +
    '<p><b>Please check these in Elvanto</b>' + (bad ? ', and enter the ones marked ⚠️ yourself' : '') + '.</p>' + link +
    '<p style="color:#5B6B67;font-size:13px">Each entry has the note “Leave Manager &lt;request ID&gt;”. Change leave in Leave Manager rather than in Elvanto, otherwise the robot can’t keep it up to date. The <b>Elvanto</b> tab of the Leave Manager sheet shows every entry and its status.</p>';
  MailApp.sendEmail({ to: to, subject: (bad || fatal ? '⚠️ ' : '') + 'Elvanto unavailability updated by Leave Manager (' + done.length + ')', htmlBody: mailShell_(loadData_(), html) });
}

/** Hourly: if the robot hasn't done something within 2 hours, tell the Elvanto Administrator so it can be done by hand. */
function elvantoWatchdog() {
  if (!elvOn_()) return;
  var late = elvRows_().filter(function (x) {
    if (x['Robot Status'] !== 'Waiting' || /reminder sent/i.test(x['Robot Note'])) return false;
    var t = new Date(String(x.Updated).replace(' ', 'T') + ':00');
    return (Date.now() - t.getTime()) > 2 * 3600 * 1000;
  });
  if (!late.length) return;
  late.forEach(function (x) { elvWrite_(x._row, { 'Robot Note': x['Robot Note'] + ' (reminder sent)' }); });
  elvMail_(late.map(function (x) { return { row: x, res: { ok: false, message: 'The robot hasn’t managed this for over 2 hours (it may not be set up, or Elvanto may be asking it for a verification code).' } }; }), null);
}

/* ---------- Setup ---------- */
function connectElvanto() {
  var ui = SpreadsheetApp.getUi(), P = PropertiesService.getScriptProperties();
  var set = ss_().getSheetByName(SHEET.SET), have = readTable_(SHEET.SET).map(function (r) { return String(r.Key); });
  ELV_SETTINGS_.forEach(function (row) { if (have.indexOf(row[0]) < 0) set.appendRow(row); });
  elvSheet_();
  var url = ui.prompt('Connect Elvanto (1 of 3)', 'Your Elvanto web address, e.g. https://christchurchhowick.elvanto.eu', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  if (url.getResponseText().trim()) setSetting_('ElvantoURL', url.getResponseText().trim().replace(/\/+$/, ''));
  var em = ui.prompt('Connect Elvanto (2 of 3)', 'Email of the Elvanto Administrator who should get the robot’s reports and check Elvanto:', ui.ButtonSet.OK_CANCEL);
  if (em.getSelectedButton() !== ui.Button.OK) return;
  if (em.getResponseText().trim()) { setSetting_('ElvantoAdminEmail', em.getResponseText().trim()); P.deleteProperty('ELV_ORGANIZER'); }
  var key = ui.prompt('Connect Elvanto (3 of 3)', 'Elvanto API key, for the calendar events (an Elvanto administrator can create one in Elvanto’s settings, under API). It’s stored privately in the script, not on the sheet. Leave blank to keep the current key, or to skip calendar events.', ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() !== ui.Button.OK) return;
  if (key.getResponseText().trim()) P.setProperty('ELVANTO_API_KEY', key.getResponseText().trim());
  var cals = '';
  if (P.getProperty('ELVANTO_API_KEY')) {
    try {
      var j = elvApi_('calendar/getAll', {});
      var list = (j.calendars && j.calendars.calendar) || [];
      cals = list.map(function (c) { return c.name + ':  ' + c.id; }).join('\n');
    } catch (e) { cals = 'Couldn’t read your calendars: ' + e.message; }
  }
  if (!P.getProperty('ROBOT_SECRET')) P.setProperty('ROBOT_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  setSetting_('ElvantoSync', 'TRUE');
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'elvantoWatchdog'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('elvantoWatchdog').timeBased().everyHours(1).create();
  ui.alert('Elvanto is connected',
    'Approved leave will now go to Elvanto.\n\n' +
    (cals ? 'Your Elvanto calendars (copy the ID of the one for staff leave into ElvantoCalendarId on the Settings tab):\n' + cals + '\n\n' : '') +
    'Robot: in GitHub → leave-manager → Settings → Secrets and variables → Actions, add these repository secrets:\n' +
    '• ROBOT_SECRET = ' + P.getProperty('ROBOT_SECRET') + '\n' +
    '• ELVANTO_USERNAME and ELVANTO_PASSWORD = an Elvanto login the robot can use (one without a verification code)\n\n' +
    'Keep the robot secret private. You can show it again with this menu item.', ui.ButtonSet.OK);
}
