/*
 * Leave Manager → Elvanto robot.
 * Elvanto's API can't set "Unavailable Volunteers", so this logs into Elvanto with a browser and does it by hand,
 * like a person would: People → Volunteers → Unavailable Volunteers → Add Unavailability.
 *
 * Runs in GitHub Actions (.github/workflows/elvanto-robot.yml). The repository is public, so the log must never
 * contain names, dates or anything else personal: only request IDs, counts and the shape of Elvanto's pages.
 *
 *   MODE=check    – only ask Leave Manager whether there's work (no browser).   Prints "jobs=N".
 *   MODE=run      – do the work and report back to Leave Manager (which emails the Elvanto Administrator).
 *   MODE=explore  – log in and describe Elvanto's pages (field names, buttons) so the robot can be adjusted. Changes nothing.
 *
 * Env: ROBOT_SECRET, ELVANTO_USERNAME, ELVANTO_PASSWORD; API_URL read from assets/config.js.
 */
const fs = require('fs');
const path = require('path');
const MODE = process.env.MODE || 'run';
const NOTE = (id) => 'Leave Manager ' + id;

function apiUrl() {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'config.js'), 'utf8');
  const m = cfg.match(/API_URL:\s*'([^']+)'/);
  if (!m) throw new Error('No API_URL in assets/config.js');
  return m[1];
}
async function lm(action, extra) {
  const res = await fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({}, extra || {}, { action, secret: process.env.ROBOT_SECRET })), redirect: 'follow' });
  const j = await res.json();
  if (!j.ok) throw new Error('Leave Manager: ' + j.error);
  return j.data;
}
const log = (...a) => console.log(...a);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/* ------------------------------ page helpers ------------------------------ */
async function describe(page, title) {
  // Only structure: input names/types/placeholders/labels, buttons and menu words – never table contents.
  const info = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const lab = (e) => { const id = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); return (id && id.innerText) || (e.closest('label') && e.closest('label').innerText) || ''; };
    const fields = [...document.querySelectorAll('input, select, textarea')].filter(vis).slice(0, 60).map(e =>
      [e.tagName.toLowerCase(), e.type || '', 'name=' + (e.name || ''), 'id=' + (e.id || ''), 'ph=' + (e.placeholder || ''), 'label=' + lab(e).trim().slice(0, 40), 'class=' + String(e.className || '').slice(0, 60),
        e.tagName === 'SELECT' ? 'options=' + e.options.length : '', (e.type === 'text' || e.type === 'date') && /\d/.test(e.value) ? 'valueShape=' + e.value.replace(/\d/g, '9') : ''].filter(Boolean).join(' '));
    const buttons = [...document.querySelectorAll('button, input[type=submit], input[type=button], a.btn, a.button, [role=button]')].filter(vis).slice(0, 60)
      .map(e => (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').trim().slice(0, 40)).filter(t => t && !/@|\d{3,}/.test(t)).map(t => /^[A-Z][a-z]+ [A-Z][a-z]+/.test(t) && !/^(Add|Save|Delete|Remove|Edit|Log|Sign|Submit|Cancel|Unavailable|All)/.test(t) ? '(text)' : t);
    // Only show text that is clearly part of Elvanto's own interface (people's names must never reach the public log).
    const UI = /^(people|volunteers?|unavailab\w*|availab\w*|rosters?|schedul\w*|admin\w*|add\b.*|delete|remove|edit|save|submit|cancel|settings|dashboard|services|groups|reports?|calendar|name|dates?|start\b.*|end\b.*|from|to|notes?|reason|locations?|time|all day|repeat\w*|member|person|search|actions?|status|unavailable volunteers|add unavailability)$/i;
    const safe = (t) => UI.test(t) ? t : (t ? '(text)' : '');
    const links = [...document.querySelectorAll('a[href]')].filter(vis).map(a => ({ t: (a.innerText || '').trim().slice(0, 40), h: a.getAttribute('href') }))
      .filter(x => /people|volunteer|unavail|availab|roster|schedul|admin/i.test(x.h + ' ' + x.t)).slice(0, 40)
      .map(x => safe(x.t) + ' -> ' + x.h.replace(/[?#].*$/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/ig, '<id>').replace(/\d{3,}/g, '<n>'));
    const heads = [...document.querySelectorAll('h1,h2,h3,th,legend,.modal-title')].filter(vis).map(e => safe(e.innerText.trim().slice(0, 40))).filter(Boolean).slice(0, 30);
    const iframes = [...document.querySelectorAll('iframe')].map(f => f.src.replace(/\?.*$/, '')).slice(0, 5);
    return { fields, buttons: [...new Set(buttons)], links, heads, iframes };
  });
  log('\n=== ' + title + ' — ' + new URL(page.url()).pathname);
  log('headings:', JSON.stringify(info.heads));
  log('buttons:', JSON.stringify(info.buttons));
  if (info.links.length) log('links:', JSON.stringify(info.links));
  if (info.iframes.length) log('iframes:', JSON.stringify(info.iframes));
  info.fields.forEach(f => log('  field:', f));
}

async function login(page, base) {
  await page.goto(base + '/login/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const user = page.locator('input[type=email], input[name*=user i], input[name*=email i], input[name*=login i]:not([type=password]), input[type=text]').first();
  const pass = page.locator('input[type=password]').first();
  await user.fill(process.env.ELVANTO_USERNAME);
  await pass.fill(process.env.ELVANTO_PASSWORD);
  const btn = page.locator('button[type=submit], input[type=submit], button:has-text("Log In"), button:has-text("Login"), button:has-text("Sign In")').first();
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), btn.click()]);
  await page.waitForTimeout(3500);
  const stillLogin = await page.locator('input[type=password]').count();
  const body = (await page.locator('body').innerText()).toLowerCase();
  if (/verification code|two-factor|2fa|authenticat(or|ion) code|enter the code/.test(body)) throw new Error('Elvanto is asking for a verification code. Use a robot login without two-step verification.');
  if (stillLogin && /\/login/.test(page.url())) throw new Error('Elvanto login failed – check ELVANTO_USERNAME and ELVANTO_PASSWORD.');
}

/** Finds the Unavailable Volunteers page by following Elvanto's own menu. */
async function openList(page, base) {
  const cached = process.env.ELV_LIST_PATH;
  const tryLinks = async () => {
    const h = await page.evaluate(() => { const a = [...document.querySelectorAll('a[href]')].find(a => /unavailab/i.test(a.getAttribute('href') + ' ' + a.innerText)); return a ? a.href : ''; });
    if (h) { await page.goto(h, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); return true; }
    return false;
  };
  if (cached) { await page.goto(base + cached, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); if (/unavailab/i.test(await page.locator('body').innerText())) return; }
  for (const p of ['/admin/', '/admin/people/', '/admin/people/volunteers/', '/admin/volunteers/']) {
    await page.goto(base + p, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
    if (await tryLinks()) return;
    for (const word of ['People', 'Volunteers']) {
      const l = page.locator(`a:text-is("${word}"), nav a:has-text("${word}")`).first();
      if (await l.count()) { await l.click().catch(() => {}); await page.waitForTimeout(1200); if (await tryLinks()) return; }
    }
  }
  throw new Error('Couldn’t find Unavailable Volunteers in Elvanto’s menus (step: open list).');
}

/** Elvanto shows dates in the church's chosen format; work it out from the field's placeholder or current value. */
function fmtDate(iso, shape) {
  const [y, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1];
  shape = String(shape || '').toLowerCase();
  if (/^yyyy-mm-dd|^9999-99-99/.test(shape)) return `${y}-${m}-${d}`;
  if (/^mm\/dd|^m\/d/.test(shape)) return `${m}/${d}/${y}`;
  if (/mmm|[a-z]{3} 9/.test(shape)) return `${+d} ${mon} ${y}`;
  return `${d}/${m}/${y}`;   // South African default: dd/mm/yyyy
}

async function fieldNear(scope, re) {
  // Inputs whose name, id, placeholder or label matches re.
  const all = scope.locator('input:visible, textarea:visible, select:visible');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const e = all.nth(i);
    const desc = await e.evaluate(el => {
      const id = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      const near = el.closest('.form-group, .field, tr, li, div');
      return [el.name, el.id, el.placeholder, id && id.innerText, near && near.querySelector('label') && near.querySelector('label').innerText].join(' ');
    });
    if (re.test(desc)) return e;
  }
  return null;
}

async function addUnavailability(page, base, job) {
  await openList(page, base);
  const add = page.locator('a:has-text("Add Unavailability"), button:has-text("Add Unavailability"), a:has-text("Add Unavailable"), button:has-text("Add")').first();
  if (!(await add.count())) throw new Error('No “Add Unavailability” button (step: add).');
  await add.click(); await page.waitForTimeout(2000);
  const scope = page.locator('.modal:visible, form:visible').last();
  // 1. The person
  const who = (await fieldNear(scope, /member|person|people|volunteer|search|name/i)) || scope.locator('input[type=text]:visible').first();
  await who.click(); await who.fill('');
  await who.type(job.name.split(' ').slice(-1)[0], { delay: 60 });
  await page.waitForTimeout(1800);
  const first = job.name.split(' ')[0].toLowerCase(), last = job.name.split(' ').slice(-1)[0].toLowerCase();
  const opts = page.locator('.ui-autocomplete li:visible, [role=option]:visible, .tt-suggestion:visible, .select2-results li:visible, .autocomplete li:visible, .dropdown-menu li:visible, ul.results li:visible');
  const n = await opts.count(); let picked = false;
  for (let i = 0; i < n; i++) {
    const t = (await opts.nth(i).innerText()).toLowerCase();
    if (t.includes(last) && t.includes(first)) { await opts.nth(i).click(); picked = true; break; }
  }
  if (!picked) throw new Error('Couldn’t find this person in Elvanto’s search – check the Elvanto Name on the Elvanto tab (step: person, ' + n + ' suggestions).');
  await page.waitForTimeout(800);
  // 2. Dates
  const sd = await fieldNear(scope, /start|from|begin/i), ed = await fieldNear(scope, /end|to|until|finish/i);
  if (!sd || !ed) throw new Error('Couldn’t find the start/end date fields (step: dates).');
  for (const [f, v] of [[sd, job.start], [ed, job.end]]) {
    const type = await f.getAttribute('type');
    const shape = (await f.getAttribute('placeholder')) || (await f.inputValue()).replace(/\d/g, '9');
    await f.click(); await f.fill(type === 'date' ? v : fmtDate(v, shape)); await f.press('Tab').catch(() => {});
  }
  // 3. All day, every location
  const allDay = scope.locator('label:has-text("All Day") input, input[name*=all_day i], input[name*=allday i]').first();
  if (await allDay.count() && !(await allDay.isChecked())) await allDay.check().catch(() => {});
  const locs = scope.locator('input[type=checkbox][name*=location i]');
  for (let i = 0; i < await locs.count(); i++) if (!(await locs.nth(i).isChecked())) await locs.nth(i).check().catch(() => {});
  // 4. Note
  const note = (await fieldNear(scope, /note|comment|reason|description/i)) || scope.locator('textarea:visible').first();
  if (await note.count()) await note.fill(NOTE(job.id));
  // 5. Save
  const save = scope.locator('button:has-text("Submit"), input[type=submit], button:has-text("Save"), button:has-text("Add")').last();
  await save.click(); await page.waitForTimeout(3000);
  const err = await page.locator('.error:visible, .alert-danger:visible, .has-error:visible, .notification.error:visible').count();
  if (err) throw new Error('Elvanto showed an error after saving (step: save).');
}

const DEL = 'button:has-text("Delete"), a:has-text("Delete"), button:has-text("Remove"), a:has-text("Remove"), [title*=Delete i], [aria-label*=Delete i], [title*=Remove i], .fa-trash, .icon-trash';
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every way Elvanto might show a date in its list. */
function dateForms(iso) {
  const [y, m, d] = iso.split('-'); const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1];
  return [`${d}/${m}/${y}`, `${m}/${d}/${y}`, `${y}-${m}-${d}`, `${+d} ${mon} ${y}`, `${mon} ${+d}, ${y}`, `${+d} ${mon}`, `${mon} ${+d}`];
}
async function removeUnavailability(page, base, job) {
  await openList(page, base);
  const noteRe = new RegExp(esc(NOTE(job.id)));   // IDs all have the same length, so no ID is the start of another
  let rows = page.locator('tr').filter({ hasText: noteRe });
  let how = 'note';
  if ((await rows.count()) === 0) {
    // The note may not be shown in the list: the person's name plus the first day, exactly one match only.
    const [oldStart] = String(job.have).split(' to ');
    const first = job.name.split(' ')[0], last = job.name.split(' ').slice(-1)[0];
    const dateRe = new RegExp(dateForms(oldStart).map(esc).join('|'));
    rows = page.locator('tr').filter({ hasText: last }).filter({ hasText: first }).filter({ hasText: dateRe });
    how = 'name and date';
  }
  const n = await rows.count();
  if (n !== 1) return { check: true, message: (n ? 'Found ' + n + ' possible entries' : 'Couldn’t find the entry') + ' – please remove it by hand (note “' + NOTE(job.id) + '”).' };
  const row = rows.first();
  let del = row.locator(DEL).first();
  if (!(await del.count())) {
    // No delete button in the row: open the entry, and make sure it's the right one before deleting.
    await row.locator('a').first().click().catch(() => row.click());
    await page.waitForTimeout(1800);
    const scope = (await page.locator('.modal:visible').count()) ? page.locator('.modal:visible').last() : page.locator('body');
    const txt = await scope.innerText();
    const ok = how === 'note' ? noteRe.test(txt) || (await scope.locator('textarea, input').evaluateAll((els, t) => els.some(e => (e.value || '').includes(t)), NOTE(job.id))) : txt.includes(job.name.split(' ').slice(-1)[0]);
    if (!ok) return { check: true, message: 'Opened the entry but couldn’t confirm it was the right one – please remove it by hand (note “' + NOTE(job.id) + '”).' };
    del = scope.locator(DEL).first();
    if (!(await del.count())) throw new Error('No Delete button on the entry (step: remove).');
  }
  page.once('dialog', d => d.accept().catch(() => {}));
  await del.click(); await page.waitForTimeout(1500);
  const confirm = page.locator('.modal:visible button:has-text("Delete"), .modal:visible button:has-text("Yes"), .modal:visible button:has-text("OK"), .modal:visible button:has-text("Confirm"), .modal:visible a:has-text("Delete")').first();
  if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(1500); }
  // Check it's gone.
  await openList(page, base);
  const still = how === 'note' ? await page.locator('tr').filter({ hasText: noteRe }).count() : 0;
  if (still) throw new Error('The entry is still there after deleting (step: remove check).');
  return { message: how === 'note' ? '' : 'Removed the entry matching the person and first day (the note isn’t shown in Elvanto’s list).' };
}

/* ------------------------------ main ------------------------------ */
(async () => {
  if (!process.env.ROBOT_SECRET) { log('Robot not set up (no ROBOT_SECRET).'); if (MODE === 'check') console.log('jobs=0'); return; }
  const work = await lm('robot-jobs');
  if (MODE === 'check') { log('jobs=' + work.jobs.length); fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 'jobs=' + work.jobs.length + '\n'); return; }
  const base = work.url;
  if (!base) throw new Error('ElvantoURL is not set on the Settings tab.');
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'en-GB', timezoneId: 'Africa/Johannesburg' });
  page.setDefaultTimeout(15000);
  const results = []; let fatal = null, listPath = '';
  try {
    await login(page, base);
    log('Logged in.');
    if (MODE === 'explore') {
      await describe(page, 'After login');
      await openList(page, base); listPath = new URL(page.url()).pathname; await describe(page, 'Unavailable Volunteers');
      const add = page.locator('a:has-text("Add Unavailability"), button:has-text("Add Unavailability"), a:has-text("Add")').first();
      if (await add.count()) { await add.click(); await page.waitForTimeout(2500); await describe(page, 'Add Unavailability form'); }
      log('\nExplore finished. Nothing was changed. List page: ' + listPath);
      await browser.close(); return;
    }
    for (const job of work.jobs) {
      const res = { id: job.id, want: job.want, start: job.start, end: job.end, ok: false, message: '' };
      try {
        const needRemove = job.have && (job.want === 'Removed' || job.have !== job.start + ' to ' + job.end);
        let extra = '';
        if (needRemove) { const r = await removeUnavailability(page, base, job); if (r.check) { Object.assign(res, { ok: true, check: true, message: r.message }); results.push(res); log(job.id, 'check'); continue; } extra = r.message || ''; }
        if (job.want === 'Unavailable') await addUnavailability(page, base, job);
        res.ok = true;
        res.message = (job.want === 'Unavailable' ? (needRemove ? 'Old dates removed and new dates added.' : 'Added.') : 'Removed.') + (extra ? ' ' + extra : '');
        if (!listPath) listPath = new URL(page.url()).pathname;
        log(job.id, 'done');
      } catch (e) {
        res.message = String(e.message || e).slice(0, 250);
        log(job.id, 'failed at', (res.message.match(/step: [a-z ]+/) || ['?'])[0]);
      }
      results.push(res);
    }
  } catch (e) {
    fatal = String(e.message || e).slice(0, 250);
    log('Stopped:', fatal.replace(/[\w.+-]+@[\w.-]+/g, '<email>'));
  }
  await browser.close();
  if (MODE === 'run') await lm('robot-result', { results, fatal, listUrl: listPath ? base + listPath : '' });
  log('Reported', results.length, 'result(s) to Leave Manager.');
})().catch(e => { console.log('Robot error:', String(e.message || e).replace(/[\w.+-]+@[\w.-]+/g, '<email>')); process.exit(1); });
