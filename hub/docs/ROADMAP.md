# Church Hub – roadmap

Status key: ✅ done · 🟡 in progress · ⬜ planned

## Phase 1 – Foundation (demo with sample data) 🟡 – demo done, database connection next
- ✅ Architecture, data model, POPIA design (`ARCHITECTURE.md`, `POPIA.md`)
- ✅ Rostering engine: together (must/prefer), keep apart, away dates and leave, fair turns, reasons (`js/roster.js`, tested)
- ✅ App shell: sign-in as a role, Home with app cards and to-do list, modules on/off
- ✅ People: directory, families, profile, consent, key dates, restricted pastoral and medical notes
- ✅ Rosters: monthly matrix, assign/change, auto-fill with reasons, teams & positions, serving together/apart, away dates, "My serving"
- ✅ Leave (Leave Manager built in, same rules): balances, request with balance box, approvals; approved leave blocks rostering
- ✅ Privacy: Information Officer, consent overview, requests register, export/delete a person, retention review, breach register, audit log
- ✅ Import from Elvanto (People CSV)
- ⬜ Connect to Firebase (church account, Johannesburg) with sign-in and security rules

## Phase 2 – People and pastoral care
Smart lists, follow-up workflows (newcomer "connect" form starts them), birthdays and key-date reminders, background-check tracking, forms, members updating their own details (with approval).

## Phase 3 – Rostering and services (complete)
Accept/decline by email and app, swap requests, reminders, sign-up sheets, run sheets / order of service, matrix across several services, Leave Manager switch-over (import sheet data).

## Phase 4 – Groups, attendance and check-in
Groups and attendance, kids check-in on a tablet with medical alerts and leader ratios, headcounts, volunteer check-in.

## Phase 5 – Communication and calendar
Email (consent-aware, with opt-out), SMS via a South African provider, app notifications, church calendar and website embeds.

## Phase 6 – Member app and extras
Church Center-style member app, Android build, Elvanto API import (groups, departments), NFC tags, AI help, leadership insights.

## Working method
One phase per fresh chat in the Claude Project "Church Hub", with the repository attached. Update this file at the end of each session.
