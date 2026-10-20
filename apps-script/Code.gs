/**
 * Leave Manager – Google Apps Script back end
 * ------------------------------------------------
 * Lives inside your Google Sheet (Extensions → Apps Script).
 * Provides:
 *   • a JSON API for the GitHub Pages web app (doPost)
 *   • a Google Form for requesting leave (created by setup)
 *   • email notifications with a one-click review page for managers (doGet ?action=review)
 *   • optional mirroring of approved leave into a shared Google Calendar
 *
 * Needs Core.gs (the shared LeaveCore rules) in the same project.
 */

var SHEET = {
  STAFF: 'Staff', LEVELS: 'Categories', TYPES: 'Leave Types', REQ: 'Requests',
  HOL: 'Public Holidays', ADJ: 'Adjustments', SET: 'Settings', TERMS: 'School Terms', HIST: 'History', RULES: 'Cover Rules'
};

var HEADERS = {
  'Staff': ['ID', 'Name', 'Email', 'Category', 'Working Days', 'Role', 'Manager Email', 'Start Date', 'PIN', 'Colour', 'Active'],
  'Categories': ['Category', 'Working Days', 'PSL', 'SSL', 'CSL', 'SL', 'WO', 'SAB', 'WA', 'TSL'],
  'Leave Types': ['Code', 'Name', 'Colour', 'Deducts Balance', 'Half Days', 'Pro Rata', 'Needs Approval',
    'Counted In', 'Allowed Days', 'Accumulates', 'Carry Over Max', 'Per Term Max', 'Max Balance', 'Use By (next year)'],
  'Requests': ['ID', 'Submitted', 'Staff ID', 'Staff Name', 'Type', 'Start', 'End', 'Half Day', 'Days', 'Reason',
    'Status', 'Decided By', 'Decided On', 'Manager Note', 'Source', 'Calendar Event', 'Cancelled By', 'Cancelled On'],
  'History': ['When', 'Action', 'Request ID', 'Staff', 'Leave Type', 'Dates', 'Days', 'Status', 'By', 'Note'],
  'Public Holidays': ['Date', 'Name'],
  'School Terms': ['Term', 'Start', 'End'],
  'Adjustments': ['Staff ID', 'Leave Year', 'Type', 'Days', 'Note'],
  'Settings': ['Key', 'Value', 'What it does'],
  'Cover Rules': ['Rule', 'Type', 'Category', 'Days', 'From', 'To', 'Minimum', 'Action', 'Message', 'Active']
};

/** Settings added after the first version; added to existing sheets automatically. */
var NEW_SETTINGS_ = [
  ['WeeklyEmail', 'Monday', 'Day the “Who’s away this week” email goes to all staff (about 6am). Blank = off'],
  ['ReminderDates', '1 Nov, 1 Dec, 15 Jan', 'Dates each year when staff with unused leave get a “use it or lose it” reminder, and the Administrator gets a summary. Blank = off'],
  ['StandInID', '', 'Stand-in approver: the Staff ID of the person who approves leave while the Administrator is away. Set it in the app (Dashboard)'],
  ['StandInFrom', '', 'First day the stand-in approves leave'],
  ['StandInTo', '', 'Last day the stand-in approves leave']
];

/** Example cover rules for a new Cover Rules tab. */
var EXAMPLE_RULES_ = [
  ['Sunday cover', 'Minimum on duty', 'Pastoral Staff', 'Sun', '', '', 1, 'Warn', 'At least one pastor must be on duty every Sunday.', true],
  ['Easter services', 'No leave', 'Pastoral Staff, Technical Staff', '', 'Easter-2', 'Easter+1', '', 'Warn', 'Good Friday to Family Day.', false],
  ['Christmas services', 'No leave', 'Pastoral Staff, Technical Staff', '', '24 Dec', '26 Dec', '', 'Warn', '', false]
];

/* ============================== MENU & SETUP ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Leave Manager')
    .addItem('1. Set up workbook and Google Form', 'setup')
    .addItem('Refresh form lists (after editing staff or leave types)', 'refreshForm')
    .addItem('Secure PINs now', 'hashPins')
    .addItem('Update public holidays and school terms now', 'updateCalendarsNow')
    .addItem('Colour the colour codes', 'paintColours')
    .addSeparator()
    .addItem('Preview the weekly “who’s away” email (sent to you only)', 'previewWeeklyEmail')
    .addItem('Preview the “use it or lose it” emails (sent to you only)', 'previewReminders')
    .addSeparator()
    .addItem('Show my links', 'showLinks')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  var P = PropertiesService.getScriptProperties();
  P.setProperty('SHEET_ID', ss.getId());
  if (!P.getProperty('SECRET')) P.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  var me = (Session.getActiveUser().getEmail() || 'you@example.com').toLowerCase();
  var yr = new Date().getFullYear();
  var palette = ['#2F6FB3', '#C2410C', '#7C3AED', '#0F766E', '#B45309', '#BE185D', '#4D7C0F', '#1D4ED8', '#9333EA', '#0E7490'];

  // Placeholder team – replace with your real staff. Leave "Working Days" blank to use the category's days.
  var staff = [['S01', 'Your Name', me, 'Administrator', '', 'Administrator', '', '', '1234', palette[0], true]];
  var cats = ['Pastoral Staff', 'Pastoral Staff', 'Pastoral Staff', 'Support Staff', 'Support Staff', 'Support Staff',
    'Support Staff', 'Support Staff', 'Cleaning Staff'];
  var days = ['', '', '', '', '', '', '', '', ''];
  for (var i = 2; i <= 10; i++) {
    staff.push(['S' + (i < 10 ? '0' : '') + i, 'Team Member ' + i, 'member' + i + '@example.com', cats[i - 2], days[i - 2],
      'Staff', '', yr - 1 + '-03-01', String(1000 + i * 7), palette[i - 1], true]);
  }

  build_(ss, SHEET.SET, [
    ['CompanyName', 'Our Church', 'Shown in the app header and emails'],
    ['LeaveYearStartMonth', 1, '1 = January … 3 = March. Balances reset at the start of this month'],
    ['FirstLeaveYear', yr, 'The first leave year recorded in this app. Unused leave from years before this is never counted. Record leave already taken this year as negative rows on Adjustments'],
    ['OpenDays', 'Mon, Wed, Thu, Fri, Sat, Sun', 'Days the church is open. Other days (Tuesday) are shaded as closed. Each person’s own working days are set on Categories, or per person on Staff'],
    ['TermsIncludeHolidays', 'TRUE', 'TRUE: a weekend in the school holidays counts towards the term that has just ended. FALSE: per-term leave (Weekend Off) can only be booked during term dates'],
    ['ProRata', 'TRUE', 'Pro-rate leave types marked “Pro Rata” for people who start part-way through a leave year'],
    ['AllowNegative', 'FALSE', 'TRUE lets people request more days than they have left'],
    ['MaxOffPerDay', 3, 'The wallchart highlights days when more people than this are away'],
    ['NotifyEmail', '', 'Optional: also copy every new request to this address (e.g. HR)'],
    ['AppURL', '', 'Your GitHub Pages address, e.g. https://you.github.io/leave-manager/ – used in emails'],
    ['CalendarId', '', 'Optional: a Google Calendar ID. Approved leave is added to it automatically'],
    ['AutoUpdateCalendars', 'TRUE', 'On the 1st of every month, add next year’s public holidays and fetch school term dates from gov.za'],
    ['SchoolCalendarURL', 'https://www.gov.za/about-sa/school-calendar', 'Where official school term dates are read from'],
    ['LastCalendarUpdate', '', 'Filled in automatically – what the last holiday/term update did'],
    ['FormId', '', 'Filled in by setup'],
    ['FormURL', '', 'Filled in by setup – share this with anyone who prefers a form']
  ]);
  // Code, Name, Colour, Deducts, Half days, Pro rata, Needs approval, Counted in, Allowed days, Accumulates, Carry over max, Per term max, Max balance, Use by
  build_(ss, SHEET.TYPES, [
    ['PSL', 'Pastoral Staff Leave', '#2F80C0', true, true, true, true, 'Days', '', false, 0, '', '', '1 Feb'],
    ['SSL', 'Support Staff Leave', '#3A86A8', true, true, true, true, 'Days', '', false, 0, '', '', '1 Feb'],
    ['CSL', 'Cleaning Staff Leave', '#4C9A6A', true, true, true, true, 'Days', '', false, 0, '', '', '1 Feb'],
    ['TSL', 'Technical Staff Leave', '#B0527A', true, true, true, true, 'Days', '', false, 0, '', '', '1 Feb'],
    ['SL', 'Sick Leave', '#D1495B', true, true, false, true, 'Days', '', false, 0, '', '', ''],
    ['WO', 'Weekend Off (Fri–Sun)', '#E09F3E', true, false, false, true, 'Weekends', 'Fri, Sat, Sun', false, 0, 1, '', ''],
    ['SAB', 'Sabbatical Leave', '#7B61C9', true, false, true, true, 'Calendar days', '', true, 0, '', 87.5, ''],
    ['WA', 'Working Away from Office', '#2A9D8F', true, true, false, true, 'Days', '', false, 0, '', '', ''],
    ['UL', 'Unpaid Leave', '#64748B', false, true, false, true, 'Days', '', false, 0, '', '', '']
  ]);
  // South African public school terms (learners' dates, gov.za). Later years are added automatically every month.
  build_(ss, SHEET.TERMS, [
    ['Term 4 2025', '2025-10-07', '2025-12-10'],
    ['Term 1 2026', '2026-01-14', '2026-03-27'], ['Term 2 2026', '2026-04-08', '2026-06-26'],
    ['Term 3 2026', '2026-07-21', '2026-09-23'], ['Term 4 2026', '2026-10-06', '2026-12-11'],
    ['Term 1 2027', '2027-01-13', '2027-03-19'], ['Term 2 2027', '2027-04-06', '2027-06-25'],
    ['Term 3 2027', '2027-07-20', '2027-10-01'], ['Term 4 2027', '2027-10-11', '2027-12-10']
  ]);
  // A blank cell means that leave type isn't available to that category.
  build_(ss, SHEET.LEVELS, [
    ['Pastoral Staff', 'Mon, Wed, Thu, Fri, Sat, Sun', 24, '', '', 7, 4, 12.5, 21, ''],
    ['Support Staff', 'Mon, Wed, Thu, Fri', '', 20, '', 7, '', '', '', ''],
    ['Cleaning Staff', 'Fri', '', '', 3, 7, '', '', '', ''],
    ['Technical Staff', 'Mon, Wed, Thu, Fri, Sun', '', '', '', 7, '', '', '', 20],   // like Support Staff, plus Sundays
    ['Administrator', 'Mon, Wed, Thu, Fri', '', '', '', '', '', '', '', '']   // approves all leave; doesn't take leave in Leave Manager
  ]);
  build_(ss, SHEET.STAFF, staff);
  build_(ss, SHEET.HOL, saHolidays_());
  build_(ss, SHEET.REQ, []);
  build_(ss, SHEET.ADJ, []);
  build_(ss, SHEET.HIST, []);
  buildRules_(ss);

  var problems = migrateToAdministrator_(ss);
  try { upgrade_(true); } catch (e) { problems.push('Upgrading: ' + (e && e.message || e)); }
  formatSheets_(ss);
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  if (!getSetting_('FormId')) createForm_();
  else refreshForm();
  installCalendarTrigger_();
  // The first holiday/school-term update reads gov.za, which can be slow – run it in the background a minute from now.
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'updateCalendarsOnce') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('updateCalendarsOnce').timeBased().after(60 * 1000).create();

  SpreadsheetApp.getUi().alert('Leave Manager is set up',
    'Next:\n\n1. Fill in the Staff sheet (names, emails, categories, working days, PINs). Give the person who approves leave the Category and Role “Administrator”.\n' +
    '2. Check Categories, Leave Types, Public Holidays, School Terms and Settings.\n' +
    '3. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).\n' +
    '4. Paste the web app URL into config.js on GitHub.\n\nThe README has the full walkthrough.' +
    (problems.length ? '\n\nSome updates could not be made:\n• ' + problems.join('\n• ') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Brings an existing workbook up to date: roles "Admin" → "Administrator", "Manager" → "Staff",
 * and adds the "Administrator" category if it's missing. Safe to run more than once.
 */
function migrateToAdministrator_(ss) {
  var problems = [];
  var step = function (name, fn) { try { fn(); } catch (e) { problems.push(name + ': ' + (e && e.message || e)); } };
  /** First row (from 2) after the last row with something in column A – tick-box columns make getLastRow() useless. */
  var nextFreeRow = function (sh) {
    if (sh.getLastRow() < 2) return 2;
    var a = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), last = 0;
    a.forEach(function (r, i) { if (String(r[0]).trim() !== '') last = i + 1; });
    return last + 2;
  };
  var staff = ss.getSheetByName(SHEET.STAFF);
  if (staff && staff.getLastRow() > 1) step('Updating roles', function () {
    var col = HEADERS['Staff'].indexOf('Role') + 1;
    var rng = staff.getRange(2, col, staff.getLastRow() - 1, 1);
    rng.clearDataValidations();   // the old list (Staff/Manager/Admin) would reject "Administrator"; formatSheets_ adds the new one
    rng.setValues(rng.getValues().map(function (r) {
      var v = String(r[0]).trim();
      return [/^admin$/i.test(v) ? 'Administrator' : /^manager$/i.test(v) ? 'Staff' : r[0]];
    }));
    staff.getRange('G1').setNote('No longer used: every leave request goes to the Administrator(s).');
  });
  var reqSh = ss.getSheetByName(SHEET.REQ);
  if (reqSh) step('Adding Cancelled By / Cancelled On columns', function () {
    var want = HEADERS['Requests'], have = reqSh.getRange(1, 1, 1, want.length).getValues()[0].map(String);
    want.forEach(function (h, i) { if (have[i] === '') reqSh.getRange(1, i + 1).setValue(h); });
  });
  var types = ss.getSheetByName(SHEET.TYPES);
  if (types && types.getLastRow() > 1) step('Adding Technical Staff Leave', function () {
    var codes = types.getRange(2, 1, types.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
    if (codes.indexOf('TSL') < 0) {
      var thead = types.getRange(1, 1, 1, types.getLastColumn()).getValues()[0].map(String);
      var trow = new Array(thead.length).fill('');
      var put = function (h, v) { var i = thead.indexOf(h); if (i >= 0) trow[i] = v; };
      put('Code', 'TSL'); put('Name', 'Technical Staff Leave'); put('Colour', '#B0527A');
      put('Deducts Balance', true); put('Half Days', true); put('Pro Rata', true); put('Needs Approval', true);
      put('Counted In', 'Days'); put('Accumulates', false); put('Carry Over Max', 0); put('Use By (next year)', '1 Feb');
      types.getRange(nextFreeRow(types), 1, 1, trow.length).setValues([trow]);
    }
  });
  var cats = ss.getSheetByName(SHEET.LEVELS);
  if (cats) step('Updating categories', function () {
    var names = cats.getLastRow() > 1 ? cats.getRange(2, 1, cats.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
    if (names.indexOf('administrator') < 0) {
      var row = new Array(cats.getLastColumn()).fill('');
      row[0] = 'Administrator'; row[1] = 'Mon, Wed, Thu, Fri';
      cats.getRange(nextFreeRow(cats), 1, 1, row.length).setValues([row]);
      names.push('administrator');
    }
    // Technical Staff: their own leave type (TSL), 20 days, plus 7 sick days.
    var head = cats.getRange(1, 1, 1, cats.getLastColumn()).getValues()[0].map(String);
    var tcol = head.indexOf('TSL');
    if (tcol < 0) { tcol = head.length; cats.getRange(1, tcol + 1).setValue('TSL'); head.push('TSL'); }
    var techAt = names.indexOf('technical staff');
    if (techAt < 0) {
      var tech = new Array(head.length).fill('');
      tech[0] = 'Technical Staff'; tech[1] = 'Mon, Wed, Thu, Fri, Sun';
      tech[tcol] = 20;
      if (head.indexOf('SL') >= 0) tech[head.indexOf('SL')] = 7;
      cats.getRange(nextFreeRow(cats), 1, 1, tech.length).setValues([tech]);
    } else {
      var rowNo = techAt + 2, ssl = head.indexOf('SSL');
      var tCell = cats.getRange(rowNo, tcol + 1);
      if (String(tCell.getValue()).trim() === '') {
        var was = ssl >= 0 ? cats.getRange(rowNo, ssl + 1).getValue() : '';
        tCell.setValue(was !== '' ? was : 20);
        if (ssl >= 0) cats.getRange(rowNo, ssl + 1).setValue('');
      }
    }
  });
  return problems;
}

/** Creates the Cover Rules tab with examples. Dates stay as text so "24 Dec" means every year. */
function buildRules_(ss) {
  var sh = ss.getSheetByName(SHEET.RULES);
  if (sh && sh.getLastRow() > 0) return sh;
  if (!sh) sh = ss.insertSheet(SHEET.RULES);
  var head = HEADERS[SHEET.RULES];
  sh.getRange('D:F').setNumberFormat('@');
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(2, 1, EXAMPLE_RULES_.length, head.length).setValues(EXAMPLE_RULES_);
  formatRules_(sh);
  return sh;
}
function formatRules_(sh) {
  var n = HEADERS[SHEET.RULES].length;
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#0F4F43').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange('D:F').setNumberFormat('@');
  sh.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Minimum on duty', 'No leave'], true).build());
  sh.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Warn', 'Block'], true).build());
  sh.getRange('J2:J').insertCheckboxes();
  sh.getRange('A1').setNote('A short name, shown in warnings, e.g. "Sunday cover".');
  sh.getRange('B1').setNote('Minimum on duty: at least this many people of the category must be working on matching days.\nNo leave: no leave for the category on matching days (e.g. Easter, Christmas).');
  sh.getRange('C1').setNote('Category from the Categories tab, or several separated by commas. Blank = all staff.');
  sh.getRange('D1').setNote('Days of the week, e.g. "Sun" or "Sat, Sun". Blank = every day.');
  sh.getRange('E1').setNote('Blank = all year. A date (2026-12-24), a date every year (24 Dec), or Easter-based: Easter-2 = Good Friday, Easter+1 = Family Day.');
  sh.getRange('F1').setNote('Last day the rule applies (same formats as From).');
  sh.getRange('G1').setNote('For "Minimum on duty": how many must be working. Default 1.');
  sh.getRange('H1').setNote('Warn: the request can be sent, with a warning for the Administrator.\nBlock: staff can’t send it. The Administrator can always override.');
  sh.getRange('I1').setNote('Optional: extra text added to the warning.');
  sh.getRange('J1').setNote('Untick to switch a rule off without deleting it.');
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 130); sh.setColumnWidth(3, 220); sh.setColumnWidth(9, 300);
}

/**
 * Brings the workbook up to date for new features, once (tracked in Script Properties).
 * Runs automatically on the first app request after an update, and from setup.
 */
var SCHEMA_VERSION_ = '3';
function upgrade_(force) {
  var P = PropertiesService.getScriptProperties();
  if (!force && P.getProperty('SCHEMA') === SCHEMA_VERSION_) return;
  var ss = ss_();
  buildRules_(ss);
  var set = ss.getSheetByName(SHEET.SET);
  if (set) {
    var have = readTable_(SHEET.SET).map(function (r) { return String(r.Key); });
    NEW_SETTINGS_.forEach(function (row) { if (have.indexOf(row[0]) < 0) set.appendRow(row); });
  }
  installDailyTrigger_();
  P.setProperty('SCHEMA', SCHEMA_VERSION_);
}

function build_(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  var head = HEADERS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  }
  return sh;
}

/* Colour cells: shade each hex code (e.g. #2F6FB3) in its own colour – Staff column J and Leave Types column C. */
var COLOUR_COLS_ = { 'Staff': 10, 'Leave Types': 3 };

function onEdit(e) {
  try {
    var sh = e.range.getSheet(), col = COLOUR_COLS_[sh.getName()];
    if (!col || e.range.getLastColumn() < col || e.range.getColumn() > col || e.range.getLastRow() < 2) return;
    var top = Math.max(2, e.range.getRow());
    paintRange_(sh.getRange(top, col, e.range.getLastRow() - top + 1, 1));
  } catch (err) { /* never block an edit */ }
}

function paintColours(ss) {
  if (!ss || !ss.getSheetByName) ss = SpreadsheetApp.getActive();
  Object.keys(COLOUR_COLS_).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) paintRange_(sh.getRange(2, COLOUR_COLS_[name], sh.getLastRow() - 1, 1));
  });
}

function paintRange_(rng) {
  var vals = rng.getDisplayValues();
  var bg = [], fg = [];
  vals.forEach(function (row) {
    var hex = String(row[0]).trim();
    if (/^#?[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/^#?(.)(.)(.)$/, '#$1$1$2$2$3$3');
    if (/^[0-9a-f]{6}$/i.test(hex)) hex = '#' + hex;
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
      bg.push([hex]); fg.push([(0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000000' : '#FFFFFF']);
    } else { bg.push([null]); fg.push([null]); }
  });
  rng.setBackgrounds(bg).setFontColors(fg);
}

function formatSheets_(ss) {
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var n = sh.getLastColumn();
    sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#0F4F43').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, n);
  });
  var staff = ss.getSheetByName(SHEET.STAFF);
  staff.getRange('I2:I').setNumberFormat('@');                 // PINs keep leading zeros
  staff.getRange('H2:H').setNumberFormat('yyyy-mm-dd');
  staff.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Staff', 'Administrator'], true).build());
  staff.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(SHEET.LEVELS).getRange('A2:A'), true).build());
  staff.getRange('K2:K').insertCheckboxes();
  staff.getRange('E1').setNote('Leave blank to use the category’s working days. Otherwise list the days, e.g. "Wed" or "Sat, Sun" or "Mon, Wed-Fri".');
  ss.getSheetByName(SHEET.LEVELS).getRange('C1').setNote('Days per leave year for each leave type code (see Leave Types). Leave a cell blank if that category doesn’t get that leave type.');
  ss.getSheetByName(SHEET.LEVELS).getRange('B2:B').setNumberFormat('@');
  staff.getRange('E2:E').setNumberFormat('@');

  var req = ss.getSheetByName(SHEET.REQ);
  req.getRange('F2:G').setNumberFormat('yyyy-mm-dd');
  req.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm');
  req.getRange('M2:M').setNumberFormat('yyyy-mm-dd hh:mm');
  req.getRange('R2:R').setNumberFormat('yyyy-mm-dd hh:mm');
  var hist = ss.getSheetByName(SHEET.HIST);
  if (hist) { hist.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm'); hist.setColumnWidth(2, 260); hist.setColumnWidth(10, 320); }
  req.getRange('K2:K').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'Approved', 'Declined', 'Cancelled'], true).build());
  var k = req.getRange('K2:K');
  var rules = [['Pending', '#FEF3C7', '#92400E'], ['Approved', '#DCFCE7', '#166534'],
    ['Declined', '#FEE2E2', '#991B1B'], ['Cancelled', '#F1F5F9', '#64748B']].map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(x[0]).setBackground(x[1]).setFontColor(x[2]).setRanges([k]).build();
  });
  req.setConditionalFormatRules(rules);

  ss.getSheetByName(SHEET.HOL).getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  paintColours(ss);
  var types = ss.getSheetByName(SHEET.TYPES);
  types.getRange('D2:G').insertCheckboxes();
  types.getRange('J2:J').insertCheckboxes();
  types.getRange('N2:N').setNumberFormat('@');
  types.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Days', 'Calendar days', 'Weekends', 'Bookings'], true).build());
  types.getRange('H1').setNote('Days: counts each working day off. Calendar days: counts every date, including weekends and holidays (Sabbatical: 12.5 a year = about 3 months after 7 years). Weekends/Bookings: each request counts as 1, however many days it covers.');
  types.getRange('I1').setNote('Optional: only allow these days of the week, e.g. "Fri, Sat, Sun".');
  types.getRange('J1').setNote('Ticked: unused days build up from year to year with no limit (e.g. Sabbatical).');
  types.getRange('N1').setNote('Optional: unused days of this leave can still be taken up to this date in the next year (e.g. "1 Feb"), then they are lost. Blank = unused days are lost at the end of the leave year.');
  types.getRange('M1').setNote('Optional, for accumulating leave: the most that can be saved up. Sabbatical stops building at 87.5 calendar days (about 3 months).');
  types.getRange('L1').setNote('Optional: most bookings of this type allowed in one school term (see the School Terms tab). Weekend Off is 1.');
  ss.getSheetByName(SHEET.TERMS).getRange('B2:C').setNumberFormat('yyyy-mm-dd');
  types.getRange('K1').setNote('Most unused days that “Carry over” (Leave Manager menu) moves into the next leave year.');
  ss.getSheetByName(SHEET.SET).setColumnWidth(2, 260).setColumnWidth(3, 520);
}

/* ===================== PUBLIC HOLIDAYS & SCHOOL TERMS (automatic) ===================== */

/** Public holiday rows for this year and the next, calculated from the Public Holidays Act. */
function saHolidays_() {
  var y = new Date().getFullYear(), rows = [];
  [y - 1, y, y + 1].forEach(function (yy) {
    LeaveCore.saPublicHolidays(yy).forEach(function (h) { rows.push([h.date, h.name]); });
  });
  return rows;
}

var SCHOOL_CALENDAR_URLS = ['https://www.gov.za/about-sa/school-calendar', 'https://www.gov.za/node/64'];
var MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Reads term dates from the text of the government school-calendar page.
 * Returns { 2027: [{ term: 1, start: '2027-01-13', end: '2027-03-19' }, … 4 terms], … } – only complete, sensible years.
 */
function parseSchoolTerms_(html) {
  var text = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|tr|table|caption|section)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;|&mdash;|&#821[12];/g, '–').replace(/&amp;/g, '&')
    .replace(/\(\s*\d{1,2}\s*\)/g, ' ');            // alternative dates shown in brackets
  var found = {}, year = null;
  text.split('\n').forEach(function (raw) {
    var line = raw.replace(/\s+/g, ' ').trim();
    if (!line) return;
    var monthWord = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
    var ym = line.match(/\b(20\d\d)\b/);
    if (ym && line.length <= 60 && !monthWord.test(line) && !/term/i.test(line)) { year = +ym[1]; return; }
    var re = /term\s*([1-4])\D{0,6}?(\d{1,2})\s+([a-z]+)(?:\s+(20\d\d))?\s*(?:–|-|—|to)\s*(\d{1,2})\s+([a-z]+)(?:\s+(20\d\d))?/gi, m;
    while ((m = re.exec(line))) {
      var m1 = MONTHS_[m[3].slice(0, 3).toLowerCase()], m2 = MONTHS_[m[6].slice(0, 3).toLowerCase()];
      var y1 = m[4] ? +m[4] : year, y2 = m[7] ? +m[7] : (m[4] ? +m[4] : year);
      if (!m1 || !m2 || !y1 || !y2) continue;
      var key = y1;
      (found[key] || (found[key] = {}))[+m[1]] = { term: +m[1], start: LeaveCore.iso(new Date(y1, m1 - 1, +m[2], 12)), end: LeaveCore.iso(new Date(y2, m2 - 1, +m[5], 12)) };
    }
  });
  var out = {};
  Object.keys(found).forEach(function (y) {
    var t = found[y], list = [1, 2, 3, 4].map(function (n) { return t[n]; });
    if (list.some(function (x) { return !x; })) return;
    var ok = list.every(function (x, i) {
      return x.start <= x.end && x.start.slice(0, 4) === String(y) && (i === 0 || x.start > list[i - 1].end);
    });
    if (ok && list[0].start.slice(5, 7) === '01') out[y] = list;
  });
  return out;
}

function fetchSchoolTerms_() {
  var urls = [String(getSetting_('SchoolCalendarURL') || '')].concat(SCHOOL_CALENDAR_URLS).filter(String);
  for (var i = 0; i < urls.length; i++) {
    try {
      var res = UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) continue;
      var terms = parseSchoolTerms_(res.getContentText());
      if (Object.keys(terms).length) return terms;
    } catch (e) { console.warn('School calendar fetch failed for ' + urls[i] + ': ' + e); }
  }
  return {};
}

/** Same term dates a year later, moved to the same weekday (52 or 53 weeks on). */
function estimateTerms_(prevYearTerms, year) {
  return prevYearTerms.map(function (t) {
    var shift = function (s) {
      var d = LeaveCore.parse(s), best = LeaveCore.addDays(d, 364);   // same weekday, 1–2 days earlier
      var target = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 12);
      if ((target - best) / 864e5 > 3) best = LeaveCore.addDays(d, 371);
      return LeaveCore.iso(best);
    };
    return { term: t.term, start: shift(t.start), end: shift(t.end) };
  });
}

/**
 * Runs every month (and from the menu). Adds missing public holidays for this year and next,
 * and fetches official school terms from gov.za. If next year's terms aren't published yet,
 * it adds estimated dates (marked "estimated") and emails the admins once.
 */
function updateCalendars() {
  var ss = ss_(), log = [];
  if (/^false$/i.test(String(getSetting_('AutoUpdateCalendars')))) return 'Automatic updates are switched off in Settings.';
  var y = new Date().getFullYear();

  // 1. Public holidays – add any that are missing; never remove rows you typed yourself.
  var hs = ss.getSheetByName(SHEET.HOL);
  var have = {};
  readTable_(SHEET.HOL).forEach(function (r) { if (r.Date) have[String(r.Date).slice(0, 10)] = 1; });
  var add = [];
  [y, y + 1].forEach(function (yy) {
    LeaveCore.saPublicHolidays(yy).forEach(function (h) { if (!have[h.date]) add.push([h.date, h.name]); });
  });
  if (add.length) {
    hs.getRange(hs.getLastRow() + 1, 1, add.length, 2).setValues(add);
    log.push(add.length + ' public holiday(s) added');
  }
  if (hs.getLastRow() > 2) hs.getRange(2, 1, hs.getLastRow() - 1, 2).sort(1);

  // 2. School terms.
  var ts = ss.getSheetByName(SHEET.TERMS);
  var rows = readTable_(SHEET.TERMS);
  var byYear = {};
  rows.forEach(function (r) {
    var m = String(r.Term).match(/term\s*([1-4])\s*(20\d\d)/i);
    if (m) (byYear[m[2]] || (byYear[m[2]] = [])).push({ row: r._row, estimated: /estimated/i.test(r.Term), term: +m[1], start: r.Start, end: r.End });
  });
  var official = fetchSchoolTerms_();
  var replaceYear = function (yy, list, label) {
    var old = (byYear[yy] || []).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
    old.forEach(function (rw) { ts.deleteRow(rw); });
    list.forEach(function (t) { ts.appendRow(['Term ' + t.term + ' ' + yy + (label ? ' (' + label + ')' : ''), t.start, t.end]); });
    rows = readTable_(SHEET.TERMS);
    byYear = {};
    rows.forEach(function (r) {
      var m = String(r.Term).match(/term\s*([1-4])\s*(20\d\d)/i);
      if (m) (byYear[m[2]] || (byYear[m[2]] = [])).push({ row: r._row, estimated: /estimated/i.test(r.Term), term: +m[1], start: r.Start, end: r.End });
    });
  };
  [y, y + 1, y + 2].forEach(function (yy) {
    var cur = byYear[yy] || [];
    var off = official[yy];
    if (!off) return;
    var same = cur.length === 4 && !cur.some(function (x) { return x.estimated; }) && off.every(function (t) {
      return cur.some(function (c) { return c.term === t.term && c.start === t.start && c.end === t.end; });
    });
    if (!same) { replaceYear(yy, off, ''); log.push('School terms for ' + yy + ' updated from gov.za'); }
  });
  // Next year must always have terms so Weekend Off keeps working.
  [y, y + 1].forEach(function (yy) {
    if ((byYear[yy] || []).length >= 4) return;
    var prev = byYear[yy - 1];
    if (!prev || prev.length < 4) return;
    var est = estimateTerms_(prev.sort(function (a, b) { return a.term - b.term; }), yy);
    replaceYear(yy, est, 'estimated');
    log.push('School terms for ' + yy + ' ESTIMATED – official dates not found yet');
    var P = PropertiesService.getScriptProperties(), flag = 'termsEstimateMailed_' + yy;
    if (!P.getProperty(flag)) {
      P.setProperty(flag, '1');
      var to = adminEmails_();
      if (to) MailApp.sendEmail({ to: to, subject: 'Leave Manager: please check the ' + yy + ' school term dates',
        htmlBody: mailShell_(loadData_(), '<p>The official ' + yy + ' school calendar wasn’t found on gov.za yet, so the Leave Manager has added <b>estimated</b> term dates (based on ' + (yy - 1) + ') to the School Terms tab.</p>' +
          '<p>The app will replace them automatically once the Department of Basic Education publishes the calendar. If you already know the real dates, type them over the estimated rows and remove “(estimated)” from the name.</p>') });
    }
  });
  if (ts.getLastRow() > 2) ts.getRange(2, 1, ts.getLastRow() - 1, 3).sort(2);

  var msg = log.length ? log.join('; ') : 'Everything was already up to date';
  setSetting_('LastCalendarUpdate', nowStr_() + ' – ' + msg);
  return msg;
}

function adminEmails_() {
  var d = loadData_();
  var list = d.staff.filter(function (s) { return LeaveCore.isAdmin(s) && s.active && s.email.indexOf('@example.com') < 0; }).map(function (s) { return s.email; });
  if (d.settings.NotifyEmail) list.push(String(d.settings.NotifyEmail));
  return list.join(',');
}

/** One-off background run scheduled by setup; removes its own trigger. */
function updateCalendarsOnce() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'updateCalendarsOnce') ScriptApp.deleteTrigger(tr);
  });
  updateCalendars();
}

/** Menu item. */
function updateCalendarsNow() {
  var msg = updateCalendars();
  SpreadsheetApp.getUi().alert('Holidays and school terms', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Runs updateCalendars on the 1st of every month at about 6am. */
function installCalendarTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'updateCalendars') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('updateCalendars').timeBased().onMonthDay(1).atHour(6).create();
}

/* ================================ DATA ================================ */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}
function tz_() { return Session.getScriptTimeZone() || 'Africa/Johannesburg'; }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function readTable_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  var h = v.shift().map(String);
  var tz = tz_();
  var out = [];
  v.forEach(function (r, i) {
    if (r.join('') === '') return;
    var o = { _row: i + 2 };
    h.forEach(function (key, j) {
      var x = r[j];
      if (x instanceof Date) {
        x = (x.getHours() || x.getMinutes()) ? Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm') : Utilities.formatDate(x, tz, 'yyyy-MM-dd');
      }
      o[key] = x;
    });
    out.push(o);
  });
  return out;
}

function loadData_() {
  var settings = {};
  readTable_(SHEET.SET).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var B = LeaveCore.truthy;
  var types = readTable_(SHEET.TYPES).filter(function (r) { return r.Code; }).map(function (r) {
    return {
      code: String(r.Code).trim(), name: String(r.Name), colour: String(r.Colour || '#64748B'),
      deducts: B(r['Deducts Balance']), halfDay: B(r['Half Days']), proRata: B(r['Pro Rata']), needsApproval: B(r['Needs Approval']),
      unit: String(r['Counted In'] || 'Days'), allowedDays: String(r['Allowed Days'] || ''), accumulates: B(r.Accumulates),
      carryMax: Number(r['Carry Over Max'] || 0), perTerm: Number(r['Per Term Max'] || 0), maxBalance: Number(r['Max Balance'] || 0),
      useBy: r['Use By (next year)'] instanceof Date ? Utilities.formatDate(r['Use By (next year)'], tz_(), 'MM-dd') : String(r['Use By (next year)'] || '')
    };
  });
  var codes = types.map(function (t) { return t.code; });
  var levels = readTable_(SHEET.LEVELS).filter(function (r) { return String(r.Category).trim() !== ''; }).map(function (r) {
    var ent = {};
    codes.forEach(function (c) { if (r[c] !== undefined && String(r[c]).trim() !== '') ent[c] = Number(r[c]); });
    var name = String(r.Category).trim();
    return { level: name, label: name, workDays: String(r['Working Days'] || ''), ent: ent };
  });
  var staff = readTable_(SHEET.STAFF).filter(function (r) { return r.ID; }).map(function (r) {
    return {
      id: String(r.ID), name: String(r.Name), email: String(r.Email).trim().toLowerCase(), level: String(r.Category).trim(),
      workDays: String(r['Working Days'] || ''),
      role: String(r.Role || 'Staff'), manager: String(r['Manager Email'] || '').trim().toLowerCase(),
      start: String(r['Start Date'] || '').slice(0, 10), colour: String(r.Colour || ''),
      active: r.Active === '' ? true : B(r.Active), _pin: String(r.PIN), _row: r._row
    };
  });
  var holidays = readTable_(SHEET.HOL).filter(function (r) { return r.Date; }).map(function (r) {
    return { date: String(r.Date).slice(0, 10), name: String(r.Name) };
  });
  var requests = readTable_(SHEET.REQ).filter(function (r) { return r.ID; }).map(function (r) {
    return {
      id: String(r.ID), submitted: String(r.Submitted), staffId: String(r['Staff ID']), type: String(r.Type),
      start: String(r.Start).slice(0, 10), end: String(r.End).slice(0, 10), half: String(r['Half Day'] || 'None'),
      days: Number(r.Days) || 0, reason: String(r.Reason || ''), status: String(r.Status || 'Pending'),
      decidedBy: String(r['Decided By'] || ''), decidedOn: String(r['Decided On'] || ''), note: String(r['Manager Note'] || ''),
      source: String(r.Source || ''), eventId: String(r['Calendar Event'] || ''),
      cancelledBy: String(r['Cancelled By'] || ''), cancelledOn: String(r['Cancelled On'] || ''), _row: r._row
    };
  });
  var terms = readTable_(SHEET.TERMS).filter(function (r) { return r.Start && r.End; }).map(function (r) {
    return { name: String(r.Term), start: String(r.Start).slice(0, 10), end: String(r.End).slice(0, 10) };
  });
  var adjustments = readTable_(SHEET.ADJ).filter(function (r) { return r['Staff ID']; }).map(function (r) {
    return { staffId: String(r['Staff ID']), year: Number(r['Leave Year']), type: String(r.Type), days: Number(r.Days) || 0, note: String(r.Note || '') };
  });
  var rules = readTable_(SHEET.RULES).filter(function (r) { return String(r.Rule || r.Type).trim() !== ''; }).map(function (r) {
    var txt = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v == null ? '' : v).trim(); };
    return { name: String(r.Rule || '').trim(), kind: String(r.Type || '').trim(), category: String(r.Category || '').trim(),
      days: txt(r.Days), from: txt(r.From), to: txt(r.To), min: Number(r.Minimum) || 0, action: String(r.Action || 'Warn').trim(),
      message: String(r.Message || '').trim(), active: r.Active === '' ? true : B(r.Active) };
  });
  var data = { settings: settings, types: types, levels: levels, staff: staff, holidays: holidays, terms: terms, requests: requests, adjustments: adjustments, rules: rules };
  LeaveCore.applyStandIn(data, todayStr_());
  return data;
}

function setCells_(sheetName, row, values) {
  var sh = ss_().getSheetByName(sheetName);
  var head = HEADERS[sheetName];
  Object.keys(values).forEach(function (k) {
    var col = head.indexOf(k) + 1;
    if (col > 0) sh.getRange(row, col).setValue(values[k]);
  });
}
function getSetting_(key) {
  var row = readTable_(SHEET.SET).filter(function (r) { return r.Key === key; })[0];
  return row ? row.Value : '';
}
function setSetting_(key, value) {
  var row = readTable_(SHEET.SET).filter(function (r) { return r.Key === key; })[0];
  if (row) setCells_(SHEET.SET, row._row, { 'Value': value });
  else ss_().getSheetByName(SHEET.SET).appendRow([key, value, '']);
}

/* ================================ API ================================ */

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    try { upgrade_(false); } catch (ue) { console.warn('Upgrade skipped: ' + ue); }
    out = { ok: true, data: route_(body) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'review') return reviewPage_(p);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: { service: 'Leave Manager', status: 'running' } }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(b) {
  if (b.action === 'login') return login_(b);
  var data = loadData_();
  var user = auth_(b.token, data);
  switch (b.action) {
    case 'bootstrap':
      return LeaveCore.publicView(data, user);
    case 'history':
      if (!LeaveCore.isAdmin(user)) throw new Error('Only an Administrator can see the History log.');
      return readHistory_();
    case 'request':
      createRequest_(user, b, 'App');
      break;
    case 'decide':
      decide_(user, b.id, b.decision, b.note);
      break;
    case 'cancel':
      cancel_(user, b.id);
      break;
    case 'prefs':
      savePrefs_(user, b);
      break;
    case 'standin':
      saveStandIn_(user, b, data);
      break;
    case 'emails':
      saveEmailSettings_(user, b);
      break;
    default:
      throw new Error('Unknown action: ' + b.action);
  }
  return LeaveCore.publicView(loadData_(), user);
}

function login_(b) {
  var data = loadData_();
  if (b.google) {
    var gEmail = googleEmail_(String(b.google));
    var gs = data.staff.filter(function (s) { return s.email === gEmail && s.active; })[0];
    if (!gs) throw new Error('Your Google account (' + gEmail + ') isn’t on the staff list. Ask the Administrator to put this address in the Staff sheet, or sign in with your email and PIN.');
    return startSession_(data, gs);
  }
  var email = String(b.email || '').trim().toLowerCase();
  var st = data.staff.filter(function (s) { return s.email === email && s.active; })[0];
  if (!st || !checkPin_(st, String(b.pin || '').trim())) {
    Utilities.sleep(700);
    throw new Error('That email and PIN don’t match. Ask your leave administrator to check the Staff sheet.');
  }
  return startSession_(data, st);
}

function startSession_(data, st) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, st.id, 21600); // 6 hours
  return { token: token, data: LeaveCore.publicView(data, st) };
}

/* ---------- Sign in with Google ----------
   The Google sign-in client ID (from Google Cloud → Google Auth Platform → Clients, type "Web application").
   It isn't secret. Extra IDs can be added on the Settings tab as GoogleClientID (comma-separated). */
var GOOGLE_CLIENT_ID = '322205667113-v67fa17marrtvq3v9rpep2cnk83pcosp.apps.googleusercontent.com';

function googleClientIds_() {
  var ids = [GOOGLE_CLIENT_ID];
  try { String(getSetting_('GoogleClientID') || '').split(',').forEach(function (x) { ids.push(x); }); } catch (e) { /* no setting */ }
  return ids.map(function (x) { return String(x || '').trim(); }).filter(String);
}

/** Checks a Google sign-in token with Google and returns the verified email address. */
function googleEmail_(idToken) {
  var ids = googleClientIds_();
  if (!ids.length) throw new Error('Sign in with Google isn’t switched on yet. Use your email and PIN.');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Google couldn’t confirm your sign-in. Please try again.');
  var t = JSON.parse(res.getContentText());
  if (ids.indexOf(String(t.aud)) < 0) throw new Error('This Google sign-in wasn’t made for Leave Manager.');
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(String(t.iss)) < 0) throw new Error('This Google sign-in didn’t come from Google.');
  if (Number(t.exp) * 1000 < Date.now()) throw new Error('Your Google sign-in has expired. Please try again.');
  if (String(t.email_verified) !== 'true' || !t.email) throw new Error('Your Google account’s email address isn’t verified.');
  return String(t.email).trim().toLowerCase();
}

function auth_(token, data) {
  var id = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  var st = id && LeaveCore.staffById(data, id);
  if (!st || !st.active) throw new Error('AUTH: Your session has ended. Please sign in again.');
  return st;
}

function hash_(pin) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET') || '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret + ':' + pin, Utilities.Charset.UTF_8);
  return 'h:' + Utilities.base64Encode(bytes);
}
function checkPin_(st, pin) {
  var stored = st._pin;
  if (!stored || !pin) return false;
  if (stored.indexOf('h:') === 0) return stored === hash_(pin);
  if (stored === pin) { setCells_(SHEET.STAFF, st._row, { 'PIN': hash_(pin) }); return true; } // upgrade to a hash on first use
  return false;
}

/** Menu: replace any plain-text PINs with hashes. To reset a PIN, just type a new plain one in the sheet. */
function hashPins() {
  var n = 0;
  loadData_().staff.forEach(function (s) {
    if (s._pin && s._pin.indexOf('h:') !== 0) { setCells_(SHEET.STAFF, s._row, { 'PIN': hash_(s._pin) }); n++; }
  });
  SpreadsheetApp.getUi().alert(n + ' PIN(s) secured. Staff sign in with the same PINs as before.');
}

/** My settings: a person can change their own colour (Staff tab, column J). */
function savePrefs_(user, b) {
  var hex = String(b.colour || '').trim();
  if (/^#?[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/^#?(.)(.)(.)$/, '#$1$1$2$2$3$3');
  if (/^[0-9a-f]{6}$/i.test(hex)) hex = '#' + hex;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('That isn’t a colour code. Pick one of the colours shown.');
  hex = hex.toUpperCase();
  withLock_(function () {
    setCells_(SHEET.STAFF, user._row, { 'Colour': hex });
    var sh = ss_().getSheetByName(SHEET.STAFF);
    paintRange_(sh.getRange(user._row, COLOUR_COLS_['Staff'], 1, 1));
  });
}

/* ============================ LEAVE ACTIONS ============================ */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function createRequest_(actor, b, source) {
  return withLock_(function () {
    var data = loadData_();
    var p = LeaveCore.prepareRequest(data, actor, b);
    var r = p.req;
    r.id = 'L' + Utilities.formatDate(new Date(), tz_(), 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    var now = nowStr_();
    var sh = ss_().getSheetByName(SHEET.REQ);
    sh.appendRow([r.id, now, r.staffId, p.staff.name, r.type, r.start, r.end, r.half, r.days, r.reason,
      r.status, r.decidedBy, r.status === 'Approved' ? now : '', '', source, '', '', '']);
    r._row = sh.getLastRow();
    var byOther = p.staff.id !== actor.id;
    logHistory_(byOther ? 'Booked by Administrator' : (r.status === 'Approved' ? 'Requested (no approval needed)' : 'Requested') +
      (source === 'Form' ? ' via Google Form' : ''), r, p.staff.name, p.type.name, actor.name, r.reason);
    if (r.status === 'Approved') {
      syncCalendar_(data, r, p.staff, p.type);
      if (p.staff.id !== actor.id) mailDecision_(data, r, p.staff, p.type, actor.name);
    } else {
      mailNewRequest_(data, r, p.staff, p.type);
    }
    return r;
  });
}

function decide_(actor, id, decision, note) {
  return withLock_(function () {
    var data = loadData_();
    var p = LeaveCore.prepareDecision(data, actor, id, decision);
    var r = p.req;
    setCells_(SHEET.REQ, r._row, { 'Status': decision, 'Decided By': actor.name, 'Decided On': nowStr_(), 'Manager Note': String(note || '').slice(0, 500) });
    r.status = decision; r.note = String(note || '');
    logHistory_(decision, r, p.staff.name, p.type.name, actor.name, r.note);
    if (decision === 'Approved') syncCalendar_(data, r, p.staff, p.type);
    mailDecision_(data, r, p.staff, p.type, actor.name);
    return r;
  });
}

function cancel_(actor, id) {
  return withLock_(function () {
    var data = loadData_();
    var p = LeaveCore.prepareCancel(data, actor, id, todayStr_());
    var r = p.req, wasApproved = r.status === 'Approved';
    setCells_(SHEET.REQ, r._row, { 'Status': 'Cancelled', 'Cancelled By': actor.name, 'Cancelled On': nowStr_() });
    r.status = 'Cancelled';
    logHistory_('Cancelled (was ' + (wasApproved ? 'approved' : 'waiting for approval') + ')', r, p.staff.name, p.type.name, actor.name, '');
    removeCalendar_(data, r);
    if (wasApproved && actor.id === p.staff.id) {
      var to = managerEmails_(data, p.staff);
      if (to) MailApp.sendEmail({ to: to, subject: p.staff.name + ' cancelled ' + p.type.name + ' (' + range_(r) + ')',
        htmlBody: mailShell_(data, '<p><b>' + esc_(p.staff.name) + '</b> cancelled approved ' + esc_(p.type.name) + ' for ' + range_(r) + '.</p>') });
    }
    return r;
  });
}

/** The History tab for the app, newest first (up to 2,000 entries). */
function readHistory_() {
  return readTable_(SHEET.HIST).filter(function (r) { return r.When; }).map(function (r) {
    return { when: String(r.When), action: String(r.Action || ''), requestId: String(r['Request ID'] || ''), staff: String(r.Staff || ''),
      type: String(r['Leave Type'] || ''), dates: String(r.Dates || ''), days: r.Days === '' ? '' : Number(r.Days), status: String(r.Status || ''),
      by: String(r.By || ''), note: String(r.Note || '') };
  }).reverse().slice(0, 2000);
}

/** Adds one line to the History tab. Never stops the action it records if logging fails. */
function logHistory_(action, r, staffName, typeName, by, note) {
  try {
    var ss = ss_(), sh = ss.getSheetByName(SHEET.HIST) || build_(ss, SHEET.HIST, []);
    sh.appendRow([nowStr_(), action, r.id || '', staffName || '', typeName || '', r.start ? range_(r) : '',
      r.days != null && r.days !== '' ? r.days : '', r.status || '', by || '', String(note || '').slice(0, 500)]);
  } catch (e) { console.warn('History log failed: ' + e); }
}

/* ================================ EMAIL ================================ */

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function range_(r) { return LeaveCore.niceRange(r); }   // e.g. "Sun 21 Jun – Thu 25 Jun 2026"
function sig_(id) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET') || '';
  return Utilities.computeHmacSha256Signature(id, secret).map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('').slice(0, 32);
}
/** Every leave request goes to the Administrator(s). */
function managerEmails_(data, st) {
  return approvers_(data, st).map(function (s) { return s.email; }).join(',');
}
/** Administrators, plus the stand-in approver while active (never the person asking). */
function approvers_(data, st) {
  return data.staff.filter(function (s) {
    return s.active && s.id !== st.id && (LeaveCore.isAdmin(s) || s.standIn) && s.email && s.email.indexOf('@example.com') < 0;
  });
}
function reviewLink_(r, by) {
  var url = ScriptApp.getService().getUrl();
  if (!url) return '';
  return url + '?action=review&id=' + encodeURIComponent(r.id) + '&by=' + encodeURIComponent(by.id) + '&sig=' + sig_(r.id + '|' + by.id);
}
function warningsHtml_(list) {
  if (!list || !list.length) return '';
  return '<div style="background:#FEF3C7;border-left:4px solid #D97706;padding:10px 14px;margin:14px 0;border-radius:4px">' +
    '<b>Cover warning</b><br>' + list.map(esc_).join('<br>') + '</div>';
}
function mailShell_(data, inner) {
  var app = data.settings.AppURL ? '<p style="margin-top:24px"><a href="' + esc_(data.settings.AppURL) + '" style="color:#0F6E5C">Open Leave Manager</a></p>' : '';
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#14211F;max-width:560px">' + inner + app +
    '<p style="color:#5B6B67;font-size:12px;margin-top:24px">' + esc_(data.settings.CompanyName || 'Team') + ' · Leave Manager</p></div>';
}

function mailNewRequest_(data, r, st, t) {
  var who = approvers_(data, st);
  if (!who.length) return;
  var c = LeaveCore.ctx(data);
  var b = LeaveCore.balances(data, st.id, LeaveCore.lyOf(r.start, c.S))[t.code];
  var amt = LeaveCore.amount(r, t, c);
  var warn = r.warnings || (function () { var w = LeaveCore.coverCheck(data, st, r, r.id); return w.block.concat(w.warn); })();
  who.forEach(function (ap, i) {
  var review = reviewLink_(r, ap);
  var html = '<p><b>' + esc_(st.name) + '</b> has requested <b>' + esc_(t.name) + '</b>.</p>' + warningsHtml_(warn) +
    (ap.standIn ? '<p style="color:#5B6B67">You’re receiving this as the stand-in approver.</p>' : '') +
    '<table style="border-collapse:collapse">' +
    row_('Dates', range_(r)) + row_('Days away', LeaveCore.fmtAmount({ unit: 'Days' }, r.days)) +
    (LeaveCore.isDayUnit(t) ? '' : row_('Uses', LeaveCore.fmtAmount(t, amt))) +
    (b && b.entitled != null ? row_('Balance after approval', LeaveCore.fmtAmount(t, b.remaining - amt) + ' of ' + LeaveCore.fmtDays(b.entitled)) : '') +
    (r.reason ? row_('Note', esc_(r.reason)) : '') + '</table>' +
    (review ? '<p style="margin-top:20px"><a href="' + review + '" style="background:#0F6E5C;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review request</a></p>' : '');
  var opt = { to: ap.email, subject: (warn.length ? '⚠ ' : '') + 'Leave request: ' + st.name + ' – ' + t.name + ' (' + range_(r) + ')', htmlBody: mailShell_(data, html), replyTo: st.email };
  if (i === 0 && data.settings.NotifyEmail) opt.cc = String(data.settings.NotifyEmail);
  MailApp.sendEmail(opt);
  });
}
function row_(k, v) { return '<tr><td style="padding:4px 16px 4px 0;color:#5B6B67">' + k + '</td><td style="padding:4px 0">' + v + '</td></tr>'; }

function mailDecision_(data, r, st, t, by) {
  if (!st.email || st.email.indexOf('@example.com') > 0) return;
  var html = '<p>Your ' + esc_(t.name) + ' for <b>' + range_(r) + '</b> has been <b>' + r.status.toLowerCase() + '</b> by ' + esc_(by) + '.</p>' +
    (r.note ? '<p>Note: ' + esc_(r.note) + '</p>' : '');
  MailApp.sendEmail({ to: st.email, subject: 'Leave ' + r.status.toLowerCase() + ': ' + t.name + ' (' + range_(r) + ')', htmlBody: mailShell_(data, html) });
}

/* ===================== ONE-CLICK REVIEW PAGE (from email) ===================== */

function reviewPage_(p) {
  var data = loadData_();
  var r = LeaveCore.findReq(data, String(p.id || ''));
  var byId = String(p.by || '');
  var ok = r && String(p.sig) === (byId ? sig_(r.id + '|' + byId) : sig_(r.id));
  var st = r && LeaveCore.staffById(data, r.staffId);
  var t = r && LeaveCore.type(data, r.type);
  var body;
  if (!ok) body = '<h1>Link not valid</h1><p>Open Leave Manager to review requests.</p>';
  else if (r.status !== 'Pending') body = '<h1>Already ' + r.status.toLowerCase() + '</h1><p>' + esc_(st.name) + '’s request for ' + range_(r) + ' was ' + r.status.toLowerCase() + (r.decidedBy ? ' by ' + esc_(r.decidedBy) : '') + '.</p>';
  else body = '<h1>' + esc_(st.name) + '</h1><p class="t">' + esc_(t.name) + ' · ' + range_(r) + ' · ' + LeaveCore.fmtAmount({ unit: 'Days' }, r.days) + ' away</p>' +
    (r.reason ? '<p>“' + esc_(r.reason) + '”</p>' : '') + warningsHtml_((function () { var w = LeaveCore.coverCheck(data, st, r, r.id); return w.block.concat(w.warn); })()) +
    '<label>Note to ' + esc_(st.name.split(' ')[0]) + ' (optional)<textarea id="n" rows="3"></textarea></label>' +
    '<div class="b"><button class="ok" onclick="go(\'Approved\')">Approve</button><button onclick="go(\'Declined\')">Decline</button></div><p id="m"></p>' +
    '<script>function go(d){document.querySelectorAll("button").forEach(function(b){b.disabled=true});document.getElementById("m").textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(x){document.getElementById("m").textContent=x}).withFailureHandler(function(e){document.getElementById("m").textContent=e.message;document.querySelectorAll("button").forEach(function(b){b.disabled=false})})' +
    '.reviewDecision(' + JSON.stringify(r.id) + ',' + JSON.stringify(String(p.sig)) + ',d,document.getElementById("n").value,' + JSON.stringify(byId) + ')}</script>';
  var html = '<style>body{font-family:Arial,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#14211F}h1{font-size:22px;margin:0 0 4px}.t{color:#5B6B67}' +
    'textarea{display:block;width:100%;margin-top:6px;font:inherit;padding:8px;box-sizing:border-box}label{display:block;margin-top:16px}' +
    '.b{display:flex;gap:8px;margin-top:16px}button{font:inherit;padding:10px 18px;border-radius:6px;border:1px solid #C9D3D0;background:#fff;cursor:pointer}' +
    'button.ok{background:#0F6E5C;color:#fff;border-color:#0F6E5C}</style>' + body;
  return HtmlService.createHtmlOutput(html).setTitle('Review leave request').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from the review page. The signed link proves it came from the notification email. */
function reviewDecision(id, sig, decision, note, byId) {
  byId = String(byId || '');
  if (String(sig) !== (byId ? sig_(String(id) + '|' + byId) : sig_(String(id)))) throw new Error('This link is not valid.');
  var data = loadData_();
  var r = LeaveCore.findReq(data, id);
  if (!r) throw new Error('That request no longer exists.');
  var st = LeaveCore.staffById(data, r.staffId);
  var actor = byId ? LeaveCore.staffById(data, byId) : null;
  if (actor && !LeaveCore.canManage(actor, st)) throw new Error(actor.standIn === false && !LeaveCore.isAdmin(actor) ? 'Your time as stand-in approver has ended.' : 'You can’t approve this request.');
  if (!actor) actor = data.staff.filter(function (s) { return LeaveCore.isAdmin(s) && s.active; })[0];
  if (!actor) throw new Error('No Administrator is set up on the Staff sheet.');
  decide_(actor, id, decision, note);
  return 'Done – the request is ' + decision.toLowerCase() + ' and ' + st.name.split(' ')[0] + ' has been emailed.';
}

/* ============================ GOOGLE CALENDAR ============================ */

function syncCalendar_(data, r, st, t) {
  var calId = data.settings.CalendarId;
  if (!calId) return;
  try {
    var cal = CalendarApp.getCalendarById(String(calId));
    if (!cal) return;
    var title = st.name + ' – ' + t.name + (r.half && r.half !== 'None' ? ' (' + (r.half === 'AM' ? 'morning' : 'afternoon') + ')' : '');
    var ev = cal.createAllDayEvent(title, LeaveCore.parse(r.start), LeaveCore.addDays(LeaveCore.parse(r.end), 1));
    setCells_(SHEET.REQ, r._row, { 'Calendar Event': ev.getId() });
  } catch (e) { console.warn('Calendar sync failed: ' + e); }
}
function removeCalendar_(data, r) {
  if (!data.settings.CalendarId || !r.eventId) return;
  try {
    var ev = CalendarApp.getCalendarById(String(data.settings.CalendarId)).getEventById(r.eventId);
    if (ev) ev.deleteEvent();
  } catch (e) { console.warn('Calendar removal failed: ' + e); }
}

/* ============================== GOOGLE FORM ============================== */

var FORM_Q = { NAME: 'Your name', TYPE: 'Leave type', START: 'First day of leave', END: 'Last day of leave', HALF: 'Half day?', NOTE: 'Note for your manager' };

function createForm_() {
  var data = loadData_();
  var form = FormApp.create((data.settings.CompanyName || 'Team') + ' – Leave request');
  form.setDescription('Book leave here or in the Leave Manager app. Only your own working days are counted – days you don’t work and public holidays are not. Weekend Off must be Friday to Sunday, one per school term. ' +
    'You will get an email when the Administrator decides.');
  form.setCollectEmail(true);
  form.setConfirmationMessage('Thanks – your request has been sent to the Administrator. If something is wrong (for example not enough days left) you will get an email explaining why.');
  form.addListItem().setTitle(FORM_Q.NAME).setRequired(true);
  form.addListItem().setTitle(FORM_Q.TYPE).setRequired(true);
  form.addDateItem().setTitle(FORM_Q.START).setRequired(true);
  form.addDateItem().setTitle(FORM_Q.END).setRequired(true).setHelpText('Same as the first day for a single day.');
  form.addMultipleChoiceItem().setTitle(FORM_Q.HALF).setChoiceValues(['No – full day(s)', 'Morning only', 'Afternoon only'])
    .setHelpText('Only for single-day requests.');
  form.addParagraphTextItem().setTitle(FORM_Q.NOTE);
  setSetting_('FormId', form.getId());
  setSetting_('FormURL', form.getPublishedUrl());
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'onLeaveFormSubmit') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('onLeaveFormSubmit').forForm(form).onFormSubmit().create();
  refreshForm();
}

/** Keeps the form's name and leave-type dropdowns in step with the sheet. */
function refreshForm() {
  var id = getSetting_('FormId');
  if (!id) return createForm_();
  var data = loadData_();
  var form = FormApp.openById(String(id));
  form.getItems().forEach(function (it) {
    if (it.getTitle() === FORM_Q.NAME) it.asListItem().setChoiceValues(data.staff.filter(function (s) { return s.active; }).map(function (s) { return s.name; }));
    if (it.getTitle() === FORM_Q.TYPE) it.asListItem().setChoiceValues(data.types.map(function (t) { return t.name; }));
  });
}

function onLeaveFormSubmit(e) {
  var data = loadData_();
  var resp = e.response;
  var email = String(resp.getRespondentEmail() || '').trim().toLowerCase();
  var a = {};
  resp.getItemResponses().forEach(function (ir) { a[ir.getItem().getTitle()] = ir.getResponse(); });
  var st = data.staff.filter(function (s) { return s.active && s.email === email; })[0] ||
    data.staff.filter(function (s) { return s.active && s.name === a[FORM_Q.NAME]; })[0];
  var t = data.types.filter(function (x) { return x.name === a[FORM_Q.TYPE]; })[0];
  var half = { 'Morning only': 'AM', 'Afternoon only': 'PM' }[a[FORM_Q.HALF]] || 'None';
  var note = String(a[FORM_Q.NOTE] || '');
  if (st && email && email !== st.email) note += ' [submitted on the form by ' + email + ']';
  try {
    if (!st) throw new Error('We couldn’t match you to the Staff sheet. Ask your leave administrator to add ' + (email || 'your email') + '.');
    createRequest_(st, { type: t ? t.code : '', start: a[FORM_Q.START], end: a[FORM_Q.END] || a[FORM_Q.START], half: half, reason: note }, 'Form');
  } catch (err) {
    logHistory_('Google Form request not booked', { start: String(a[FORM_Q.START] || ''), end: String(a[FORM_Q.END] || a[FORM_Q.START] || ''), status: '' },
      st ? st.name : (email || 'Unknown'), String(a[FORM_Q.TYPE] || ''), st ? st.name : email, err.message);
    var to = email || (st && st.email);
    if (to) MailApp.sendEmail({ to: to, subject: 'Your leave request could not be booked',
      htmlBody: mailShell_(data, '<p>Your request for ' + esc_(a[FORM_Q.TYPE]) + ' from ' + esc_(a[FORM_Q.START]) + ' to ' + esc_(a[FORM_Q.END]) +
        ' wasn’t booked:</p><p><b>' + esc_(err.message) + '</b></p><p>Please adjust it and try again.</p>') });
  }
}

/* ============================== YEAR END ============================== */

/** Menu: copies unused leave (up to each leave type's "Carry Over Max") into Adjustments for the next leave year.
 *  Accumulating types (e.g. Sabbatical) carry forward automatically and are skipped. */
function carryOver() {
  var ui = SpreadsheetApp.getUi();
  var data = loadData_();
  var S = LeaveCore.ctx(data).S;
  var cur = LeaveCore.lyOf(todayStr_(), S);
  var res = ui.prompt('Carry over leave', 'Carry unused leave FROM which leave year? (e.g. ' + cur + ')', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var y = Number(res.getResponseText());
  if (!y) return ui.alert('Enter a year such as ' + cur + '.');
  var types = data.types.filter(function (t) { return t.deducts && !t.accumulates && t.carryMax > 0; });
  if (!types.length) return ui.alert('No leave types have a “Carry Over Max” above 0 on the Leave Types tab, so there is nothing to carry over.');
  var already = data.adjustments.some(function (a) { return a.year === y + 1 && /Carried over/.test(a.note); });
  if (already) return ui.alert('Carry-over into ' + LeaveCore.lyLabel(y + 1, S) + ' has already been done. Remove those Adjustments rows first to redo it.');
  var sh = ss_().getSheetByName(SHEET.ADJ), n = 0;
  data.staff.filter(function (s) { return s.active; }).forEach(function (s) {
    var bal = LeaveCore.balances(data, s.id, y);
    types.forEach(function (t) {
      var b = bal[t.code];
      if (!b || b.remaining == null) return;
      var carry = Math.min(Math.max(0, b.remaining), t.carryMax);
      if (carry > 0) { sh.appendRow([s.id, y + 1, t.code, carry, 'Carried over from ' + LeaveCore.lyLabel(y, S)]); n++; }
    });
  });
  ui.alert('Added ' + n + ' carry-over row(s) into the ' + LeaveCore.lyLabel(y + 1, S) + ' leave year.');
}

function showLinks() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert('Your links',
    'Web app API (paste into config.js):\n' + (url || 'Not deployed yet – use Deploy → New deployment → Web app') +
    '\n\nGoogle Form:\n' + (getSetting_('FormURL') || 'Run setup first') +
    '\n\nWeb app on GitHub Pages:\n' + (getSetting_('AppURL') || 'Add it to Settings → AppURL'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================ STAND-IN APPROVER ============================ */

/** Administrator only: choose (or clear) who approves leave while they're away. */
function saveStandIn_(user, b, data) {
  if (!LeaveCore.isAdmin(user)) throw new Error('Only an Administrator can choose a stand-in approver.');
  var id = String(b.staffId || '').trim(), from = String(b.from || '').slice(0, 10), to = String(b.to || '').slice(0, 10);
  if (id) {
    var st = LeaveCore.staffById(data, id);
    if (!st || !st.active) throw new Error('Choose someone from the staff list.');
    if (LeaveCore.isAdmin(st)) throw new Error(st.name + ' is already an Administrator.');
    if (!LeaveCore.isISO(from) || !LeaveCore.isISO(to)) throw new Error('Choose the first and last day of the stand-in period.');
    if (to < from) throw new Error('The last day is before the first day.');
  } else { from = ''; to = ''; }
  withLock_(function () {
    setSetting_('StandInID', id); setSetting_('StandInFrom', from); setSetting_('StandInTo', to);
  });
  logHistory_(id ? 'Stand-in approver set' : 'Stand-in approver removed', {}, id ? LeaveCore.staffById(data, id).name : '', '',
    user.name, id ? LeaveCore.niceRange({ start: from, end: to }) : '');
  if (id) {
    var si = LeaveCore.staffById(data, id);
    if (si.email && si.email.indexOf('@example.com') < 0) {
      MailApp.sendEmail({ to: si.email, subject: 'You’re the stand-in leave approver (' + LeaveCore.niceRange({ start: from, end: to }) + ')',
        htmlBody: mailShell_(data, '<p>Hi ' + esc_(si.name.split(' ')[0]) + ',</p><p>' + esc_(user.name) + ' has asked you to approve leave requests from <b>' +
          LeaveCore.niceRange({ start: from, end: to }) + '</b>.</p><p>During that time new requests are emailed to you, and an <b>Approvals</b> page appears in Leave Manager. You can’t approve your own leave.</p>') });
    }
  }
}

/* ============================ SCHEDULED EMAILS ============================ */

/** Runs dailyJobs every morning at about 6am. */
function installDailyTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'dailyJobs') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('dailyJobs').timeBased().everyDays(1).atHour(6).create();
}

/** Every morning: the weekly "who's away" email on its day, and "use it or lose it" reminders on their dates. */
function dailyJobs() {
  var data = loadData_(), today = todayStr_(), d = LeaveCore.parse(today);
  var day = String(data.settings.WeeklyEmail || '').trim();
  if (day && LeaveCore.parseDays(day, []).indexOf(d.getDay()) >= 0) {
    try { sendWeeklyEmail_(data, today, null); } catch (e) { console.warn('Weekly email failed: ' + e); }
  }
  var dates = String(data.settings.ReminderDates || '').split(',').map(function (x) { return LeaveCore.parseMonthDay(x.trim()); }).filter(Boolean);
  if (dates.some(function (md) { return md[0] === d.getMonth() + 1 && md[1] === d.getDate(); })) {
    try { sendReminders_(data, today, null); } catch (e) { console.warn('Reminders failed: ' + e); }
  }
}

function realEmail_(s) { return s && s.email && s.email.indexOf('@') > 0 && s.email.indexOf('@example.com') < 0; }
function me_() { return String(Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || ''); }

/** Menu: send this week's email to yourself only. */
function previewWeeklyEmail() {
  var to = me_();
  sendWeeklyEmail_(loadData_(), todayStr_(), to);
  SpreadsheetApp.getUi().alert('Sent a preview of the weekly email to ' + to + '.');
}
/** Menu: send the reminders that would go out today to yourself only. */
function previewReminders() {
  var to = me_();
  var n = sendReminders_(loadData_(), todayStr_(), to);
  SpreadsheetApp.getUi().alert(n ? 'Sent ' + n + ' preview email(s) to ' + to + '.' : 'Nobody has unused leave to remind them about right now. The Administrator summary was sent to ' + to + '.');
}

/** "Who's away this week": Monday–Sunday from the given day, to every active staff member (or to `onlyTo`). */
function sendWeeklyEmail_(data, today, onlyTo) {
  var c = LeaveCore.ctx(data), start = LeaveCore.parse(today);
  while (start.getDay() !== 1) start = LeaveCore.addDays(start, -1);   // back to Monday
  var end = LeaveCore.addDays(start, 6);
  var sIso = LeaveCore.iso(start), eIso = LeaveCore.iso(end);
  var breaches = LeaveCore.coverBreaches(data, sIso, eIso);
  var rows = '', anyone = 0;
  for (var d = start, i = 0; i < 7; i++, d = LeaveCore.addDays(d, 1)) {
    var ds = LeaveCore.iso(d), hol = c.hol[ds], open = LeaveCore.isOpen(d, c);
    var away = data.requests.filter(function (r) {
      if (r.status !== 'Approved') return false;
      var st = LeaveCore.staffById(data, r.staffId);
      if (!st || !st.active) return false;
      return LeaveCore.dayList(r, c).some(function (x) { return x.date === ds; });
    }).map(function (r) {
      var st = LeaveCore.staffById(data, r.staffId);
      return esc_(st.name) + (r.half === 'AM' ? ' (morning)' : r.half === 'PM' ? ' (afternoon)' : '');
    });
    var pending = data.requests.filter(function (r) {
      return r.status === 'Pending' && LeaveCore.dayList(r, c).some(function (x) { return x.date === ds; });
    }).length;
    anyone += away.length;
    var cover = breaches.filter(function (b) { return b.date === ds; }).map(function (b) {
      return '<div style="color:#B45309">⚠ ' + esc_(b.rule.name) + ': ' + b.onDuty + ' of ' + b.min + ' ' + esc_(b.rule.category || 'staff') + ' on duty</div>';
    }).join('');
    var what = hol ? '<i>' + esc_(hol) + ' (public holiday)</i>' : !open ? '<i style="color:#5B6B67">Church closed</i>' :
      (away.length ? away.join(', ') : '<span style="color:#5B6B67">Everyone in</span>');
    rows += '<tr><td style="padding:8px 14px 8px 0;vertical-align:top;white-space:nowrap;border-top:1px solid #E3E9E7"><b>' + LeaveCore.DAYS[d.getDay()] + '</b> ' +
      d.getDate() + ' ' + LeaveCore.niceDate(ds).split(' ')[2] + '</td><td style="padding:8px 0;border-top:1px solid #E3E9E7">' + what +
      (pending ? ' <span style="color:#92400E;font-size:12px">+ ' + pending + ' waiting for approval</span>' : '') + cover + '</td></tr>';
  }
  var title = 'Who’s away this week · ' + LeaveCore.niceRange({ start: sIso, end: eIso });
  var html = '<h2 style="font-size:18px;margin:0 0 4px">Who’s away this week</h2><p style="color:#5B6B67;margin:0 0 14px">' + LeaveCore.niceRange({ start: sIso, end: eIso }) + '</p>' +
    '<table style="border-collapse:collapse;width:100%">' + rows + '</table>' +
    (anyone ? '' : '<p>Nobody has leave booked this week.</p>');
  var to = onlyTo ? [onlyTo] : data.staff.filter(function (s) { return s.active && realEmail_(s); }).map(function (s) { return s.email; });
  if (!to.length) return 0;
  MailApp.sendEmail({ to: to[0], bcc: to.slice(1).join(','), subject: title, htmlBody: mailShell_(data, html) });
  return 1;
}

/** "Use it or lose it": one email per person with unused leave, plus a summary for the Administrator(s). */
function sendReminders_(data, today, onlyTo) {
  var sent = 0, summary = [];
  data.staff.forEach(function (st) {
    var items = LeaveCore.useItOrLoseIt(data, st.id, today);
    if (!items.length) return;
    var total = items.reduce(function (s, x) { return s + x.left; }, 0);
    summary.push({ st: st, items: items, total: total });
    if (!onlyTo && !realEmail_(st)) return;
    var list = items.map(function (x) {
      return '<li><b>' + LeaveCore.fmtAmount(x.type, x.left) + '</b> of ' + esc_(x.type.name) + ' – take by <b>' + LeaveCore.niceDate(x.until, true) + '</b></li>';
    }).join('');
    var html = '<p>Hi ' + esc_(st.name.split(' ')[0]) + ',</p><p>A friendly reminder that you still have leave to take. Unused days are lost after the date shown:</p><ul>' + list + '</ul>' +
      '<p>Book it in Leave Manager soon, so your time off can be planned around services and events.</p>';
    MailApp.sendEmail({ to: onlyTo || st.email, subject: 'Reminder: you have ' + LeaveCore.fmtDays(total) + ' day' + (total === 1 ? '' : 's') + ' of leave to take', htmlBody: mailShell_(data, html) });
    sent++;
  });
  summary.sort(function (a, b) { return b.total - a.total; });
  var admins = onlyTo ? [onlyTo] : data.staff.filter(function (s) { return LeaveCore.isAdmin(s) && s.active && realEmail_(s); }).map(function (s) { return s.email; });
  if (admins.length) {
    var rows = summary.map(function (x) {
      return '<tr><td style="padding:6px 14px 6px 0;border-top:1px solid #E3E9E7">' + esc_(x.st.name) + '</td><td style="padding:6px 0;border-top:1px solid #E3E9E7">' +
        x.items.map(function (i) { return LeaveCore.fmtAmount(i.type, i.left) + ' ' + esc_(i.type.code) + ' by ' + LeaveCore.niceDate(i.until, true); }).join('<br>') + '</td></tr>';
    }).join('');
    MailApp.sendEmail({ to: admins.join(','), subject: 'Leave still to be taken: ' + summary.length + ' staff',
      htmlBody: mailShell_(data, '<p>These staff were reminded today to use their leave before it’s lost:</p>' +
        (rows ? '<table style="border-collapse:collapse">' + rows + '</table>' : '<p>Nobody has unused leave right now.</p>') +
        '<p>The Dashboard in Leave Manager shows the latest figures.</p>') });
  }
  return sent;
}


/** Administrator: switch the weekly "who's away" email and the "use it or lose it" reminders on or off. */
function saveEmailSettings_(user, b) {
  if (!LeaveCore.isAdmin(user)) throw new Error('Only an Administrator can change the automatic emails.');
  var weekly = String(b.weekly || '').trim(), rem = String(b.reminders || '').trim();
  if (weekly && !LeaveCore.parseDays(weekly, []).length) throw new Error('Choose a day of the week for the weekly email.');
  withLock_(function () { setSetting_('WeeklyEmail', weekly); setSetting_('ReminderDates', rem); });
  logHistory_('Automatic emails changed', {}, '', '', user.name, 'Weekly email: ' + (weekly || 'off') + ' · Reminders: ' + (rem || 'off'));
}
