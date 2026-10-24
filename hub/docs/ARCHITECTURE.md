# Church Hub – architecture

Church Hub replaces Elvanto for Christ Church Howick, learning from Elvanto, Planning Center and ChurchSuite.
It is built in phases; each phase is usable on its own. **Read this file first in every new working session.**

## Principles
1. **Clean and self-explanatory.** Every screen says what it is for in one line; every action is a plain-English button. No jargon, no hidden menus.
2. **Apps as cards.** Each area (People, Rosters, Leave, Privacy…) is a *module* that registers itself and appears as a card on Home. Modules can be switched on or off in Settings. New features = new modules, without touching the others.
3. **POPIA by design.** Privacy rules are part of the data model, not an add-on (see `POPIA.md`).
4. **Explainable rostering.** No random rostering. Families and friends who want to serve together are kept together; people who must not serve at the same time are kept apart; every suggestion says why.
5. **Phone first, works on a computer.** One web app, installable on phones; the Android app is the same wrapper as Leave Manager.

## Layers
```
hub/index.html            the single page app (no build step)
hub/css/hub.css           design tokens + components
hub/js/store.js           data layer: Store.get/put/remove/audit – today localStorage (demo), later Firebase
hub/js/roster.js          RosterCore: the rostering engine (pure functions, unit-tested)
../assets/core.js         LeaveCore: Leave Manager's leave rules, shared unchanged
hub/js/app.js             shell: sign-in, roles, router, Home, module registry, UI helpers
hub/js/mod-*.js           one file per module: people, rosters, leave, privacy, import, settings
hub/tests/*.test.js       node unit tests (run: node hub/tests/roster.test.js)
```

### Data layer contract
Reads are synchronous from an in-memory copy (`Store.list('people')`); writes (`Store.put`, `Store.remove`) update the copy immediately and persist in the background.
This is exactly how Firebase/Firestore works with its offline cache, so moving from the demo store to the real database changes only `store.js`.

### Collections
| Collection | Holds |
| --- | --- |
| `settings` | church name, modules on/off, Information Officer, retention period, privacy notice |
| `people` | name, contact, family, category, staff details (leave category, start date, working days), key dates, child medical notes (special personal information), Elvanto ID |
| `families` | family name |
| `consents` | per person and purpose: given/withdrawn, date, how, recorded by, guardian for children |
| `notes` | pastoral notes (restricted) |
| `teams`, `positions`, `skills` | who can serve where, and how often they'd like to |
| `services` | dates and times of services/events needing a roster |
| `assignments` | person × position × service, status pending/accepted/declined, why |
| `groups` | serve **together** (must/prefer) or keep **apart** |
| `blockouts` | away dates people enter themselves |
| `leave` | Leave Manager data in LeaveCore format (types, categories, requests, holidays, terms, adjustments, rules) |
| `dsr` | POPIA data-subject requests (access, correction, deletion, objection) |
| `breaches` | security-compromise register (POPIA s22) |
| `audit` | who viewed or changed sensitive information, and when |

### Roles (enforced in the UI now; in database security rules once on Firebase)
| Role | Can |
| --- | --- |
| Administrator | everything, including Privacy and Settings |
| Pastor | people, families, pastoral notes |
| Roster coordinator | rosters; people's names and contact details only |
| Children's ministry | children, guardians and medical notes |
| Member | own details, own serving, own leave (if staff) |

Leave approval follows Leave Manager: Administrators approve.

## Leave Manager inside the Hub
The Leave module uses `LeaveCore` (the same rules file as Leave Manager), so balances, pro-rata, carry-over, public holidays
and Sunday-holiday handling behave identically. Approved leave automatically makes a person unavailable for rosters.
Until the Hub is live, the existing Leave Manager keeps running; at switch-over its sheet data is imported.

## Elvanto import
Phase 1: Elvanto's People export (CSV) → column mapping → preview → import people and families, de-duplicated by email/name.
Later: direct import through the Elvanto API (server side, with the church's API key), including groups and departments.

## Hosting (target)
- Code: GitHub (`church-hub` repository); website: GitHub Pages.
- Data: Google Firebase (Firestore + Authentication), project owned by the church, data stored in Johannesburg (Firestore region `africa-south1`).
- Never put real church data in GitHub or in a Claude Project.
