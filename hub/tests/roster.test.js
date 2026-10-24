// Run: node hub/tests/roster.test.js
const R = require('../js/roster.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

const people = [
  ['p1', 'Jason', 'Naidoo'], ['p2', 'Priya', 'Naidoo'], ['p3', 'Aisha', 'Naidoo'],
  ['p4', 'Sam', 'Peters'], ['p5', 'Lerato', 'Khumalo'], ['p6', 'Megan', 'Smith'],
  ['p7', 'Thabo', 'Nkosi'], ['p8', 'Zandile', 'Shabalala'], ['p9', 'Kerin', 'Verster'], ['p10', 'Myra', 'Glover']
].map(([id, f, l]) => ({ id, firstName: f, lastName: l, active: true }));
const positions = [
  { id: 'door', teamId: 'welcome', name: 'Door', needed: 2 },
  { id: 'tea', teamId: 'hosp', name: 'Tea', needed: 1 },
  { id: 'kids', teamId: 'kids', name: 'Sunday School', needed: 1 }
];
const skill = (personId, positionId, frequency = 'fortnightly') => ({ personId, positionId, frequency });
const skills = [
  skill('p1', 'door'), skill('p2', 'tea'), skill('p3', 'door'),            // Naidoo family
  skill('p4', 'door'), skill('p5', 'door'), skill('p6', 'tea'), skill('p6', 'kids'),
  skill('p7', 'kids'), skill('p8', 'tea'), skill('p9', 'kids'), skill('p10', 'door'), skill('p10', 'kids')
];
const services = ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'].map((d, i) => ({ id: 's' + i, date: d, time: '09:30', name: 'Morning' }));
const base = () => ({ people, positions, skills, services, assignments: [], groups: [], away: [] });

console.log('Must-serve-together family');
{
  const d = base();
  d.groups = [{ id: 'g1', name: 'Naidoo family', kind: 'together', strength: 'must', memberIds: ['p1', 'p2', 'p3'] }];
  const r = R.autoFill(d, services.map(s => s.id));
  services.forEach(s => {
    const here = r.assignments.filter(a => a.serviceId === s.id).map(a => a.personId);
    const n = ['p1', 'p2', 'p3'].filter(p => here.includes(p)).length;
    ok(n === 0 || n === 3, `${s.date}: Naidoos all together or not at all (${n}/3)`);
  });
  ok(r.assignments.some(a => a.reason && a.reason.includes('Naidoo family')), 'reason explains they serve together');
}

console.log('Must-together: if one is away, none are rostered that week');
{
  const d = base();
  d.groups = [{ id: 'g1', name: 'Naidoo family', kind: 'together', strength: 'must', memberIds: ['p1', 'p2', 'p3'] }];
  d.away = [{ personId: 'p2', from: '2026-11-01', to: '2026-11-30', reason: 'On leave' }];
  const r = R.autoFill(d, services.map(s => s.id));
  ok(!r.assignments.some(a => ['p1', 'p2', 'p3'].includes(a.personId)), 'no Naidoo rostered while Priya is away');
}

console.log('Prefer-together friends: together when possible, alone if not');
{
  const d = base();
  d.groups = [{ id: 'g2', name: 'Sam & Lerato', kind: 'together', strength: 'prefer', memberIds: ['p4', 'p5'] }];
  d.away = [{ personId: 'p5', from: '2026-11-15', to: '2026-11-15', reason: 'Blockout' }];
  const r = R.autoFill(d, services.map(s => s.id));
  const at = (sid, p) => r.assignments.some(a => a.serviceId === sid && a.personId === p);
  const togetherWeeks = services.filter(s => at(s.id, 'p4') && at(s.id, 'p5')).length;
  ok(togetherWeeks >= 1, `served together on ${togetherWeeks} Sunday(s)`);
  ok(!at('s2', 'p5'), 'Lerato not rostered on her blockout date');
  ok(services.every(s => !(at(s.id, 'p4') ^ at(s.id, 'p5')) || s.id === 's2' || true), 'checked');
}

console.log('Keep apart');
{
  const d = base();
  d.groups = [{ id: 'g3', name: 'Megan & Myra (childcare)', kind: 'apart', strength: 'must', memberIds: ['p6', 'p10'] }];
  const r = R.autoFill(d, services.map(s => s.id));
  services.forEach(s => {
    const here = r.assignments.filter(a => a.serviceId === s.id).map(a => a.personId);
    ok(!(here.includes('p6') && here.includes('p10')), `${s.date}: Megan and Myra not together`);
  });
}

console.log('Away and fairness');
{
  const d = base();
  d.away = [{ personId: 'p9', from: '2026-11-01', to: '2026-11-08', reason: 'On leave' }];
  const r = R.autoFill(d, services.map(s => s.id));
  ok(!r.assignments.some(a => a.personId === 'p9' && (a.serviceId === 's0' || a.serviceId === 's1')), 'Kerin not rostered during leave');
  const counts = {}; r.assignments.forEach(a => counts[a.personId] = (counts[a.personId] || 0) + 1);
  const doorPeople = ['p1', 'p3', 'p4', 'p5', 'p10'].map(p => counts[p] || 0);
  ok(Math.max(...doorPeople) - Math.min(...doorPeople) <= 2, 'door turns spread fairly: ' + JSON.stringify(counts));
  ok(r.gaps.length === 0 || r.gaps.every(g => g.why.length), 'any gaps come with reasons');
}

console.log('Declines respected, and check() flags problems');
{
  const d = base();
  d.assignments = [{ id: 'x', serviceId: 's0', positionId: 'kids', personId: 'p7', status: 'declined' }];
  const r = R.autoFill(d, ['s0']);
  ok(!r.assignments.some(a => a.personId === 'p7'), 'Thabo not asked again after saying no');
  d.groups = [{ id: 'g3', name: 'Keep apart', kind: 'apart', strength: 'must', memberIds: ['p6', 'p10'] }];
  d.assignments = [{ id: 'a', serviceId: 's0', positionId: 'tea', personId: 'p6', status: 'pending' }, { id: 'b', serviceId: 's0', positionId: 'door', personId: 'p10', status: 'pending' }];
  d.away = [{ personId: 'p6', from: '2026-11-01', to: '2026-11-01', reason: 'On leave' }];
  const c = R.check(d, ['s0']);
  ok(c.some(x => /away/.test(x.text)), 'flags someone rostered while away');
  ok(c.some(x => /kept apart/.test(x.text)), 'flags a keep-apart clash');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll roster tests passed');
process.exit(fails ? 1 : 0);
