/* Church Hub – made-up sample data for the demo. No real people. */
function makeSampleData() {
  'use strict';
  var C = LeaveCore, today = new Date(), yr = today.getFullYear();
  var iso = function (d) { return C.iso(d); };
  var day0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  var off = function (n) { return iso(C.addDays(day0, n)); };
  // Next Sunday and the 7 after it
  var sun = C.addDays(day0, (7 - day0.getDay()) % 7 || 7);
  var sundays = []; for (var i = -2; i < 8; i++) sundays.push(iso(C.addDays(sun, i * 7)));

  var fam = [
    ['f1', 'Naidoo'], ['f2', 'Jacobs'], ['f3', 'Smith'], ['f4', 'Botha'], ['f5', 'Nkosi'], ['f6', 'van der Merwe'], ['f7', 'Mokoena']
  ].map(function (f) { return { id: f[0], name: f[1] + ' family' }; });

  // id, first, last, family, role, category, email?, mobile?, birth, staff [category, startYearsAgo, workDays?], role in app
  var P = [
    ['p01', 'Linda', 'Pillay', '', 'adult', 'staff', 'Administrator', 6, '', 'admin'],
    ['p02', 'Thandi', 'Mokoena', 'f7', 'adult', 'staff', 'Pastoral Staff', 8, '', 'pastor'],
    ['p03', 'Pieter', 'van Wyk', '', 'adult', 'staff', 'Pastoral Staff', 3, '', 'pastor'],
    ['p04', 'Grace', 'Ndlovu', '', 'adult', 'staff', 'Pastoral Staff', 2, '', 'kids'],
    ['p05', 'Sipho', 'Dlamini', '', 'adult', 'staff', 'Support Staff', 4, '', 'rosters'],
    ['p06', 'Lerato', 'Khumalo', '', 'adult', 'staff', 'Support Staff', 2, '', 'member'],
    ['p07', 'Nomvula', 'Zulu', '', 'adult', 'staff', 'Cleaning Staff', 1, '', 'member'],
    ['p08', 'Ruan', 'Botha', 'f4', 'adult', 'staff', 'Part-Time Technical Staff', 2, '', 'member'],
    ['p09', 'Anja', 'Botha', 'f4', 'adult', 'member'],
    ['p10', 'Jason', 'Naidoo', 'f1', 'adult', 'visitor'],
    ['p11', 'Priya', 'Naidoo', 'f1', 'adult', 'visitor'],
    ['p12', 'Aisha', 'Naidoo', 'f1', 'child', 'visitor', 2019],
    ['p13', 'Ravi', 'Naidoo', 'f1', 'child', 'visitor', 2022],
    ['p14', 'Tim', 'Jacobs', 'f2', 'adult', 'member'],
    ['p15', 'Clare', 'Jacobs', 'f2', 'adult', 'member'],
    ['p16', 'Liam', 'Jacobs', 'f2', 'child', 'member', 2011],
    ['p17', 'Megan', 'Smith', 'f3', 'adult', 'member'],
    ['p18', 'David', 'Smith', 'f3', 'adult', 'member'],
    ['p19', 'Sam', 'Peters', '', 'adult', 'member'],
    ['p20', 'Kavi', 'Govender', '', 'adult', 'member'],
    ['p21', 'Thabo', 'Nkosi', 'f5', 'adult', 'member'],
    ['p22', 'Ayanda', 'Nkosi', 'f5', 'adult', 'member'],
    ['p23', 'Johan', 'van der Merwe', 'f6', 'adult', 'member'],
    ['p24', 'Elsa', 'van der Merwe', 'f6', 'adult', 'member'],
    ['p25', 'Faith', 'Adams', '', 'adult', 'member'],
    ['p26', 'Bongani', 'Mthembu', '', 'adult', 'member'],
    ['p27', 'Ruth', 'Daniels', '', 'adult', 'member'],
    ['p28', 'Noah', 'Mokoena', 'f7', 'child', 'member', 2016]
  ];
  var people = P.map(function (r, i) {
    var staff = r[5] === 'staff';
    var p = {
      id: r[0], firstName: r[1], lastName: r[2], preferredName: '', familyId: r[3], familyRole: r[4],
      category: staff ? 'Staff' : r[5] === 'visitor' ? 'Visitor' : 'Member',
      email: r[4] === 'child' ? '' : (r[1] + '.' + r[2].replace(/ /g, '')).toLowerCase() + '@example.com',
      mobile: r[4] === 'child' ? '' : '082 000 ' + String(1000 + i * 37).slice(-4),
      birthDate: r[4] === 'child' ? (r[6] || 2015) + '-0' + (1 + (i % 9)) + '-1' + (i % 9) : '',
      keyDates: [], active: true, appRole: staff ? r[9] : 'member', source: 'sample'
    };
    if (staff) p.staff = { category: r[6], start: (yr - r[7]) + '-02-01', workDays: '' };
    if (r[0] === 'p10') p.keyDates = [{ label: 'First visit', date: off(-20) }];
    if (r[0] === 'p14') p.keyDates = [{ label: 'Baptised', date: '2015-04-05' }, { label: 'Wedding anniversary', date: '2008-11-22' }];
    return p;
  });
  people.filter(function (p) { return p.id === 'p12'; })[0].medical = { allergies: 'Nuts (carries an EpiPen)', notes: '' };
  people.filter(function (p) { return p.id === 'p13'; })[0].medical = { allergies: '', notes: 'Asthma pump in bag' };

  var consents = [];
  people.forEach(function (p, i) {
    var guardian = p.familyRole === 'child' ? people.filter(function (q) { return q.familyId === p.familyId && q.familyRole === 'adult'; })[0] : null;
    if (p.id === 'p27') return;                         // no consent yet: shows on the to-do list
    var add = function (purpose, given) { consents.push({ id: 'c' + p.id + purpose.replace(/\W/g, ''), personId: p.id, purpose: purpose, given: given, date: off(-200 + i), method: i % 2 ? 'Paper connect card' : 'Online form', recordedBy: 'Linda Pillay', guardianId: guardian ? guardian.id : '' }); };
    add('Church records', true);
    if (p.familyRole === 'adult') { add('Email', true); add('SMS', i % 3 !== 0); add('Church directory', i % 4 !== 0); add('Photos', i % 5 !== 0); }
    if (p.medical) add('Children’s medical notes', true);
  });

  var teams = [['welcome', 'Welcome'], ['worship', 'Worship'], ['tech', 'Technical'], ['kids', 'Children'], ['hosp', 'Hospitality']]
    .map(function (t) { return { id: t[0], name: t[1] }; });
  var positions = [
    ['door', 'welcome', 'Door', 2], ['greet', 'welcome', 'Greeter', 1],
    ['keys', 'worship', 'Keys', 1], ['guitar', 'worship', 'Guitar', 1], ['vocals', 'worship', 'Vocals', 2],
    ['sound', 'tech', 'Sound desk', 1], ['proj', 'tech', 'Projection', 1],
    ['ss', 'kids', 'Sunday School', 2],
    ['tea', 'hosp', 'Tea & coffee', 2]
  ].map(function (p) { return { id: p[0], teamId: p[1], name: p[2], needed: p[3] }; });
  var S = function (personId, positionId, f) { return { id: 'k' + personId + positionId, personId: personId, positionId: positionId, frequency: f || 'fortnightly' }; };
  var skills = [
    S('p10', 'door'), S('p11', 'tea'), S('p19', 'door'), S('p20', 'door'), S('p23', 'door', 'monthly'), S('p25', 'greet'), S('p26', 'greet'), S('p09', 'greet'),
    S('p02', 'keys', 'monthly'), S('p15', 'keys'), S('p03', 'guitar'), S('p21', 'guitar'), S('p22', 'vocals'), S('p24', 'vocals'), S('p17', 'vocals'), S('p06', 'vocals'),
    S('p08', 'sound', 'weekly'), S('p14', 'sound'), S('p16', 'proj'), S('p26', 'proj'),
    S('p04', 'ss'), S('p17', 'ss'), S('p18', 'ss'), S('p27', 'ss'), S('p09', 'ss'),
    S('p11', 'tea'), S('p24', 'tea'), S('p25', 'tea'), S('p07', 'tea', 'monthly'), S('p22', 'tea')
  ];
  var groups = [
    { id: 'g1', name: 'Naidoo family', kind: 'together', strength: 'must', memberIds: ['p10', 'p11'], note: 'Jason and Priya share one car.' },
    { id: 'g2', name: 'Tim & Liam Jacobs (father and son)', kind: 'together', strength: 'must', memberIds: ['p14', 'p16'], note: 'Liam is learning projection with his dad.' },
    { id: 'g3', name: 'Sam & Kavi', kind: 'together', strength: 'prefer', memberIds: ['p19', 'p20'], note: 'Friends who like to serve on the door together.' },
    { id: 'g4', name: 'Megan & David Smith', kind: 'apart', strength: 'must', memberIds: ['p17', 'p18'], note: 'One stays with the baby.' }
  ];
  var services = sundays.map(function (d, i) { return { id: 'sv' + i, date: d, time: '09:30', name: 'Morning service' }; });
  var A = function (sv, pos, person, status) { return { id: 'as' + sv + pos + person, serviceId: sv, positionId: pos, personId: person, status: status, source: 'manual' }; };
  var assignments = [
    // two past Sundays, so fair turns have history
    A('sv0', 'door', 'p19', 'accepted'), A('sv0', 'door', 'p20', 'accepted'), A('sv0', 'keys', 'p15', 'accepted'), A('sv0', 'sound', 'p08', 'accepted'), A('sv0', 'ss', 'p04', 'accepted'), A('sv0', 'tea', 'p24', 'accepted'),
    A('sv1', 'door', 'p23', 'accepted'), A('sv1', 'keys', 'p02', 'accepted'), A('sv1', 'sound', 'p14', 'accepted'), A('sv1', 'proj', 'p16', 'accepted'), A('sv1', 'tea', 'p25', 'accepted'),
    // next Sunday, partly filled
    A('sv2', 'keys', 'p15', 'accepted'), A('sv2', 'guitar', 'p03', 'pending'), A('sv2', 'vocals', 'p22', 'accepted'), A('sv2', 'sound', 'p08', 'accepted'), A('sv2', 'ss', 'p04', 'accepted'), A('sv2', 'greet', 'p25', 'declined')
  ];
  var blockouts = [
    { id: 'b1', personId: 'p19', from: sundays[4], to: sundays[4], reason: 'Away: family wedding' },
    { id: 'b2', personId: 'p26', from: sundays[2], to: sundays[3], reason: 'Away: work travel' }
  ];
  var notes = [{ id: 'n1', personId: 'p10', text: 'Moved from Durban in September. Looking for a home group near Howick.', by: 'Thandi Mokoena', at: off(-12) }];

  // Leave (same format and rules as Leave Manager)
  var staffPeople = people.filter(function (p) { return p.staff; });
  var plan = [
    ['p02', 'PSL', 3, 6, 'Approved', 'Family visit in George'], ['p05', 'SSL', 9, 3, 'Pending', 'Brother’s wedding'],
    ['p03', 'WO', 12, 2, 'Pending', 'Anniversary weekend'], ['p06', 'SSL', 15, 4, 'Approved', 'Drakensberg hike'],
    ['p04', 'SL', -4, 0, 'Approved', 'Flu'], ['p08', 'TSL', 20, 1, 'Approved', '']
  ];
  var leave = {
    settings: { CompanyName: 'Christ Church Howick (demo)', LeaveYearStartMonth: 1, OpenDays: 'Mon, Wed, Thu, Fri, Sat, Sun', TermsIncludeHolidays: 'TRUE', FirstLeaveYear: yr - 1, ProRata: 'TRUE', AllowNegative: 'FALSE' },
    rules: [{ name: 'Sunday cover', kind: 'Minimum on duty', category: 'Pastoral Staff', days: 'Sun', from: '', to: '', min: 1, action: 'Warn', message: 'At least one pastor must be on duty every Sunday.', active: true }],
    terms: [['Term 4 ' + (yr - 1), (yr - 1) + '-10-07', (yr - 1) + '-12-10'], ['Term 1 ' + yr, yr + '-01-14', yr + '-03-27'], ['Term 2 ' + yr, yr + '-04-08', yr + '-06-26'],
      ['Term 3 ' + yr, yr + '-07-21', yr + '-09-23'], ['Term 4 ' + yr, yr + '-10-06', yr + '-12-11'], ['Term 1 ' + (yr + 1), (yr + 1) + '-01-13', (yr + 1) + '-03-19']]
      .map(function (t) { return { name: t[0], start: t[1], end: t[2] }; }),
    types: [
      { code: 'PSL', name: 'Pastoral Staff Leave', colour: '#2F80C0', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
      { code: 'SSL', name: 'Support Staff Leave', colour: '#3A86A8', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
      { code: 'CSL', name: 'Cleaning Staff Leave', colour: '#4C9A6A', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
      { code: 'TSL', name: 'Technical Staff Leave', colour: '#B0527A', deducts: true, halfDay: true, proRata: true, needsApproval: true, unit: 'Days', useBy: '1 Feb' },
      { code: 'SL', name: 'Sick Leave', colour: '#D1495B', deducts: true, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' },
      { code: 'WO', name: 'Weekend Off (Fri–Sun)', colour: '#E09F3E', deducts: true, halfDay: false, proRata: false, needsApproval: true, unit: 'Weekends', allowedDays: 'Fri, Sat, Sun', perTerm: 1 },
      { code: 'WA', name: 'Working Away from Office', colour: '#2A9D8F', deducts: true, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' },
      { code: 'UL', name: 'Unpaid Leave', colour: '#64748B', deducts: false, halfDay: true, proRata: false, needsApproval: true, unit: 'Days' }
    ],
    levels: [
      { level: 'Pastoral Staff', label: 'Pastoral Staff', workDays: 'Mon, Wed, Thu, Fri, Sat, Sun', ent: { PSL: 24, SL: 7, WO: 4, WA: 21 } },
      { level: 'Support Staff', label: 'Support Staff', workDays: 'Mon, Wed, Thu, Fri', ent: { SSL: 20, SL: 7 } },
      { level: 'Cleaning Staff', label: 'Cleaning Staff', workDays: 'Fri', ent: { CSL: 3, SL: 7 } },
      { level: 'Part-Time Technical Staff', label: 'Part-Time Technical Staff', workDays: 'Mon, Wed, Thu, Fri, Sun', ent: { TSL: 20, SL: 7 } },
      { level: 'Administrator', label: 'Administrator', workDays: 'Mon, Wed, Thu, Fri', ent: {} }
    ],
    holidays: [yr - 1, yr, yr + 1].reduce(function (all, y) { return all.concat(C.saPublicHolidays(y)); }, []),
    adjustments: [],
    requests: plan.map(function (q, i) {
      var s = off(q[2]), e = off(q[2] + q[3]);
      if (q[1] === 'WO') { var d = C.parse(s); while (d.getDay() !== 5) d = C.addDays(d, 1); s = iso(d); e = iso(C.addDays(d, 2)); }
      return { id: 'L' + (100 + i), staffId: q[0], type: q[1], start: s, end: e, half: 'None', reason: q[5], status: q[4], submitted: off(-5), decidedBy: q[4] === 'Approved' ? 'Linda Pillay' : '', note: '', source: 'App' };
    })
  };

  return {
    version: 1,
    settings: {
      churchName: 'Christ Church Howick', demo: true,
      modules: { people: true, rosters: true, leave: true, privacy: true, import: true, settings: true },
      informationOfficer: { name: '[Information Officer]', email: '[email]', phone: '[phone]', registered: false, deputy: '' },
      retentionMonths: 24,
      privacyNotice: 'Christ Church Howick collects your personal information to keep church records, care for you, organise serving rosters and keep in touch. We only use it for these purposes, keep it secure, and store it in South Africa. You may ask to see, correct or delete your information at any time by contacting our Information Officer.'
    },
    people: people, families: fam, consents: consents, notes: notes, teams: teams, positions: positions, skills: skills,
    services: services, assignments: assignments, groups: groups, blockouts: blockouts,
    dsr: [{ id: 'd1', personId: 'p23', kind: 'Access', received: off(-6), due: off(24), status: 'Open', notes: 'Asked for a copy of everything we hold.' }],
    breaches: [], audit: [], leave: leave
  };
}
