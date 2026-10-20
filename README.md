# Leave Manager

A leave management web app for a church team of about 10 people, built only from free tools:

| Piece | What it does |
|---|---|
| **GitHub Pages** (`web/`) | The web app staff use: overview, wallchart, month calendar, year planner, approvals and team balances |
| **Google Sheets** | The database. Staff, categories, leave types, requests, public holidays and settings are ordinary tabs you can edit |
| **Google Apps Script** (`apps-script/`) | The back end: sign-in, balance checks, approvals, emails, optional Google Calendar sync |
| **Google Forms** | Created automatically. An alternative way to request leave that feeds the same Requests sheet |

Open `web/index.html` in a browser before you set anything up: with no API URL configured the app runs in **demo mode** with a sample team, so you can try every screen.

---

## Features

- **Wallchart** – everyone on one month grid, colour-coded by leave type. Pending leave is striped, half days fill half a cell, days a person doesn't work are shaded on their row, days the church is closed (Tuesday) are hatched, and a bottom row counts how many people are away each day (red when over your limit).
- **Calendar** – month view with names on each day; click a day for the full list.
- **Year planner** – a 12-month view per person with their balances and requests for that leave year.
- **Working days per person** – each staff category has default working days, and any person can have their own (Pastoral Staff work Mon and Wed–Sun, Support Staff Mon and Wed–Fri, Cleaning Staff Fridays only). Only a person's own working days come off their balance; public holidays never do.
- **No carry-over** – unused leave must be taken by 1 February of the next year, then it's lost.
- **Allowances by category** – Pastoral, Support, Technical and Cleaning Staff each get their own allowance per leave type. A blank cell means that leave type isn't offered to that category.
- **Weekend Off** – Pastoral Staff only: one weekend (Friday to Sunday) per school term, so 4 a year. School term dates live on the **School Terms** tab.
- **Sabbatical Leave** – Pastoral Staff only: 12.5 calendar days a year build up from each person's start date. After 7 years that's 87.5 calendar days, about 3 months. The saved balance stops growing at 87.5.
- **Reports** – everyone can print or save as PDF a formal leave report for any leave year (details, balances, every request, signature lines). The Administrator can also print any one employee's report, an all-staff summary, or a full report with a page per person.
- **Employees (admins only)** – pick anyone to see every date they've had off, grouped by month, with totals per leave type. Filter by leave year, leave type and status (taken, waiting, or everything including declined and cancelled). Click a date to open the request.
- **Administrator** – give a person the Category and Role `Administrator`. Every leave request is emailed to the Administrator(s), and only they can approve, decline, book leave for others, and see Approvals, Team balances and Employees. People in the Administrator category don't take leave in Leave Manager and don't appear on the wallchart.
- **Approvals** – managers see pending requests with the balance after approval and who else is away. They get an email with a **Review request** button and can approve from their phone without signing in.
- **Managers can book leave for their team** (auto-approved), and anyone can cancel their own future leave.
- **Unpaid Leave** shows on the calendar without using an allowance.
- **Google Form** for people who prefer it, with an email back if a request can't be booked (e.g. not enough days).
- **Holidays and school terms update themselves** every month. **Leave Manager → Update public holidays and school terms now** runs it on demand, and **LastCalendarUpdate** in Settings shows what it last did.
- **Google Calendar mirror** (optional) – approved leave appears in a shared calendar.
- Works on phones, has a dark mode, and needs no build step.

---

## Setup (about 20 minutes)

### 1. Create the Google Sheet and script

1. Go to [sheets.new](https://sheets.new) and name the sheet, e.g. **Leave Manager**.
2. **Extensions → Apps Script**.
3. Rename the default `Code.gs` content: delete it and paste in the contents of **`apps-script/Code.gs`**.
4. Click **+ → Script**, name it `Core`, and paste in **`apps-script/Core.gs`**.
5. Click the cog (**Project Settings**) → tick **Show "appsscript.json" manifest file**. Back in the editor, open `appsscript.json` and replace it with **`apps-script/appsscript.json`** (change `timeZone` if you're not in South Africa).
6. Save (Ctrl/Cmd + S).

### 2. Run setup

1. Go back to the Google Sheet tab and **reload the page**. After a few seconds a **Leave Manager** menu appears next to *Help*.
2. Click **Leave Manager → 1. Set up workbook and Google Form**.
3. Google asks for permission. Click **Continue**, choose your account, then **Advanced → Go to Leave Manager (unsafe) → Allow**. ("Unsafe" just means Google hasn't reviewed your own script.)
4. Click the menu item again if nothing happened after allowing. When it finishes you'll see a "Leave Manager is set up" message and these tabs:

| Tab | What to fill in |
|---|---|
| **Staff** | One row per person: ID (S01…), name, work email, **Category**, **Working Days** (leave blank to use the category's days, or type e.g. `Wed` or `Sat, Sun`), role (`Staff` or `Administrator`), *Manager Email* (no longer used, leave blank), start date, a PIN, a colour, Active tick box. Put your real email on row S01, which is set up as the Administrator. |
| **Categories** | One row per category with its usual working days and the days per leave year for each leave type (columns are leave type codes). Leave a cell **blank** if that category doesn't get that leave type. |
| **Leave Types** | Code, name, colour, tick boxes for *Deducts Balance*, *Half Days*, *Pro Rata*, *Needs Approval*, plus *Counted In* (`Days` = working days, `Calendar days` = every date, `Weekends` = per booking), *Allowed Days* (e.g. `Fri, Sat, Sun`), *Accumulates* (unused days build up every year, for Sabbatical), *Per Term Max* (Weekend Off = 1), *Max Balance* (Sabbatical = 87.5) and *Use By (next year)* (1 Feb for the three staff-leave types). Ignore *Carry Over Max*; it's 0 because leave isn't carried over. To add a type, add a row here **and** a column with its code on Categories. |
| **School Terms** | SA public school term dates. **Updated automatically**: on the 1st of every month the script reads the official calendar on gov.za and adds new years. If next year's dates aren't published yet, it adds *estimated* dates (based on this year) and emails the admins, then swaps in the official dates once they appear. By default, a weekend in the school holidays counts towards the term that has just ended. Set **TermsIncludeHolidays** to FALSE in Settings to allow Weekend Off only during term time. |
| **Public Holidays** | **Updated automatically**: the script calculates South Africa's public holidays from the Public Holidays Act, including Easter dates and the Monday after a Sunday holiday, and adds next year's every month. Rows you add yourself are never removed, so add once-off days (e.g. an election day declared by the President) by hand. |
| **Adjustments** | Optional extra or fewer days for one person in one leave year (e.g. `S04, 2026, SSL, 2, Long service`). Use this for a part-time person who should get less than the category allowance, or to load sabbatical days someone already built up before you started using the app. |
| **Settings** | Church name, leave year start month, **OpenDays** (days the church is open), max people away per day, notification email, etc. Each row explains itself. |
| **Requests** | Filled in by the app and the form. You can edit statuses here directly if you need to. |

5. After editing Staff or Leave Types, use **Leave Manager → Refresh form lists** so the Google Form dropdowns match.

> **PINs:** type plain PINs in the Staff sheet. The first time someone signs in, their PIN is replaced with a secure hash. To reset a PIN, type a new plain one over the hash. **Leave Manager → Secure PINs now** hashes everyone immediately.

### 3. Deploy the back end

1. In Apps Script click **Deploy → New deployment**.
2. Click the cog next to *Select type* → **Web app**.
3. *Execute as*: **Me**. *Who has access*: **Anyone**. (Staff never see the sheet; the script checks their email and PIN.)
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 4. Put the web app on GitHub Pages

1. Create a new repository on GitHub, e.g. `leave-manager` (it can be public; there's no data in it).
2. Upload everything inside the **`web/`** folder (`index.html` and the `assets` folder) to the root of the repo.
3. Edit **`assets/config.js`** on GitHub and paste your URL:
   ```js
   window.LEAVE_CONFIG = {
     API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
     FORM_URL: '',   // optional – the Settings tab shows it after setup
     SHEET_URL: ''   // optional – lets Admins jump to the sheet
   };
   ```
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root → Save.**
5. After a minute your app is live at `https://YOUR-NAME.github.io/leave-manager/`.
6. Paste that address into **Settings → AppURL** in the sheet so email links point to it.

Using the GitHub command line instead:
```bash
cd web
git init && git add . && git commit -m "Leave Manager"
gh repo create leave-manager --public --source=. --push
gh api -X POST repos/{owner}/leave-manager/pages -f "source[branch]=main" -f "source[path]=/"
```

### 5. Tell the team

Send everyone the GitHub Pages link and their PIN. Share the Google Form link (Settings → FormURL, or **Leave Manager → Show my links**) with anyone who prefers a form.

---

## Day-to-day

- **Requesting:** *Request leave*, or click an empty day on your row of the wallchart. The app shows working days used and your balance afterwards before you send.
- **Approving:** every request is emailed to the Administrator(s), who approve it from the email or the **Approvals** page.
- **Year end:** there's nothing to do. Unused Pastoral, Support, Technical and Cleaning Staff Leave can still be taken until **1 February** of the next year. Leave taken in January uses up last year's days first, and anything left after 1 February is lost. Sick Leave, Weekend Off and Working Away reset on 1 January. Sabbatical keeps building up.
- **Starting part-way through the year:** **FirstLeaveYear** in Settings is the year you start using the app. For each person, add a negative row on Adjustments for leave they've already taken this year (e.g. `S03, 2026, PSL, -10, Taken before the app`) so their balance is right.
- **Leave year:** set **LeaveYearStartMonth** to `3` for a March–February leave year. Balances reset at the start of that month.
- **Google Calendar:** create a shared calendar, copy its ID (calendar settings → *Integrate calendar*) into **Settings → CalendarId**. Newly approved leave is added automatically.

## Updating the code later

- **Apps Script:** paste the new code, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.
- **Web app:** commit the changed files to GitHub. Keep `apps-script/Core.gs` and `web/assets/core.js` identical; they contain the shared balance rules.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the leave server" | Check `API_URL` in `config.js` ends in `/exec`, and the deployment's access is **Anyone**. |
| "That email and PIN don't match" | Email must match the Staff sheet exactly (case doesn't matter); the Active box must be ticked. |
| Changes to Code.gs have no effect | You must deploy a **New version** (see above). |
| Form submissions don't appear | Run **Leave Manager → Set up** again, or check *Triggers* (clock icon) in Apps Script has `onLeaveFormSubmit`. |
| A person's balance looks wrong | Check their Category, Working Days, Start Date (pro-rata and sabbatical build-up start from it), and any Adjustments rows for that leave year. |
| A leave type is missing from someone's list | Their category has a blank cell for it on the Categories tab. Put a number in to offer it. |

## Security notes

- The sheet is private to you; the web app only sees what the script returns. Staff see everyone's leave dates (needed for the calendar), but only their own balances, reasons and notes. Managers see these for their team.
- PINs are hashed with a secret stored in the script's properties. Sign-in sessions last 6 hours.
- Email review links are signed, so they can't be guessed or altered.
- This is designed for a small, trusted team. It isn't a replacement for an HR system's audit or payroll features.

## File map

```
apps-script/
  Code.gs            back end: API, setup, form, emails, calendar
  Core.gs            shared leave rules (same as web/assets/core.js)
  appsscript.json    manifest (time zone, web app settings, permissions)
web/                 upload this folder's contents to GitHub Pages
  index.html
  assets/config.js   ← your Apps Script URL goes here
  assets/core.js     shared leave rules
  assets/app.js      the app
  assets/app.css     styles (light + dark)
```
