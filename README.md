# MyExpense

A local-first personal expense tracker with Splitwise-style bill splitting, built as an installable Progressive Web App (PWA) for iPhone and Android. No App Store, no Play Store, no account, no backend, no analytics.

- Income and expenses with categories, payment methods, tags, filters and CSV export
- Monthly budgets with a recurring default and a warning threshold
- Friends, groups, shared expenses (equal, by amount, by percent), balances and recorded payments
- Weekly, monthly, yearly and custom reports
- Versioned JSON backup with validated import (replace or merge)
- Works offline after the first load
- Indian Rupees with Indian number grouping (₹1,23,456.50)

Plain HTML, CSS and JavaScript. Zero runtime dependencies, nothing loaded from a CDN, so nothing can break offline or leak data to a third party.

---

## 1. Project layout

```
index.html              App shell, strict Content-Security-Policy
manifest.webmanifest    PWA manifest (name, icons, standalone display)
sw.js                   Service worker: caches the app shell for offline use
css/styles.css          All styles, light and dark themes
js/core.js              Pure logic: money, dates, split maths, balances, validation, backup, CSV
js/db.js                IndexedDB storage with versioned schema and atomic writes
js/app.js               UI: screens, forms, import/export, PWA wiring
icons/                  App icons (192, 512, maskable, Apple touch, SVG)
tests/core.test.js      Automated tests for accounting, rounding, backup round trips
package.json            Convenience scripts (no dependencies)
```

## 2. Run it locally

You need any static file server. Two options:

```bash
# Python (built into macOS and most Linux)
python3 -m http.server 8080

# or Node
npx serve -l 8080 .
```

Open `http://localhost:8080`. Service workers are allowed on `localhost`, so offline behaviour can be tested on a laptop.

Run the logic tests (Node 18 or newer, no install step):

```bash
node --test tests/core.test.js
```

The suite covers the PRD dinner example, friend-paid bills, partial settlements, payer-not-participating, rounding for equal and percentage splits (including 500 randomised percentage cases), group nets, budget fallback, backup round trips, rejection of malformed backups, idempotent merges, cross-device merges with same-named categories, newer-wins merges and CSV escaping.

## 3. Hosting (HTTPS is required)

A PWA can only be installed and work offline when it is served over HTTPS. There is no way around this; some one-time hosting is needed. The app is just static files, so any HTTPS static host works, and the host never receives your financial data because all data stays in the phone's browser storage.

Pick one:

**GitHub Pages (free)**
1. Create a repository (it can be private on paid plans, or public; only app code is published, never your data).
2. Push the contents of this folder to the repository root.
3. Settings, Pages, Source: deploy from branch `main`, folder `/ (root)`.
4. Your app is at `https://<username>.github.io/<repo>/`.

**Netlify or Cloudflare Pages (free)**
Drag and drop this folder in the Netlify dashboard (Sites, Add new site, Deploy manually), or connect the repository in Cloudflare Pages with no build command and output directory `/`.

**Your own server**
Serve the folder from any HTTPS virtual host (nginx, Apache, Caddy). Recommended headers:

```
Cache-Control: no-cache                 for index.html, sw.js, manifest.webmanifest
Cache-Control: public, max-age=86400    for css/, js/, icons/
Content-Type: application/manifest+json for manifest.webmanifest
```

The app works from a sub-path (for example `/myexpense/`) because all paths are relative.

### Releasing an update

1. Change the files.
2. Bump `CACHE_VERSION` in `sw.js` (for example `myexpense-v1.0.1`) and `APP_VERSION` in `js/app.js`.
3. Deploy. Open phones show "A new version of MyExpense is ready" with an Update button. Data is not touched by updates.

If you ever change the shape of stored records, increase `SCHEMA_VERSION` in `js/core.js` and add a step to `MIGRATIONS` there. Existing data and imported older backups are migrated forward automatically. Newer backups are refused on older app versions with a clear message rather than being half-read.

## 4. Install on your phones

**iPhone (Safari)**
1. Open the HTTPS address in Safari.
2. Tap Share, then Add to Home Screen, then Add.
3. Open MyExpense from the home screen icon and use it from there.

Important on iPhone: the home-screen app has its own storage, separate from Safari tabs. Install first and enter data in the installed app. Anything typed into a normal Safari tab will not appear inside the installed app.

**Android (Chrome)**
1. Open the HTTPS address in Chrome.
2. Tap Install when prompted, or open the menu and tap Install app (or Add to Home screen). Settings in MyExpense also shows an Install button when Chrome offers one.

Each phone keeps completely separate data. Nothing syncs.

## 5. Offline behaviour

- The first visit must be online. The service worker then caches the app shell (HTML, CSS, JS, icons).
- After that, opening, adding, editing, deleting, reports and backup export all work without a network.
- Settings, This device shows "Works offline: Yes" once the cache is active. If it says "Not yet", open the app once more while online.
- If you open the app offline before it was ever cached, the browser shows its own offline page; there is nothing on the device yet for the app to show. Once cached, an in-app message is shown instead if anything is missing.
- The app makes no network requests for data at all. The Content-Security-Policy in `index.html` sets `connect-src 'self'`, which blocks any request to another origin.

## 6. Where data lives, and its limits

- All records are stored in IndexedDB in the browser on that device. The app asks the browser to mark storage as persistent; Settings shows whether it was granted.
- MyExpense does not encrypt data. It is protected by your phone's lock screen and the browser's per-site isolation, nothing more.
- The OS or browser can delete site data: clearing browsing data, uninstalling the home screen app, low storage, or (for Safari websites that are not installed to the home screen) long periods without use. Installed home screen apps on iPhone are not subject to Safari's seven-day cleanup of website storage, but they are still deleted if you remove the app.
- Local storage is not a backup. The home screen reminds you if you have not exported a backup in 30 days.
- No PIN lock is included. A PIN screen in a web app would only hide the interface; the data would remain readable to anyone with access to the unlocked browser. Rely on your phone lock instead.

## 7. Backup, restore and moving data between phones

**Export a backup**
Settings, Backup and restore, Export full backup (JSON). On phones this opens the share sheet: choose Save to Files, iCloud Drive, Google Drive, email to yourself, and so on. On a laptop it downloads. The file contains transactions, categories, budgets, budget settings, friends, groups, shared expenses with every person's exact share, and payments. MyExpense never uploads the file anywhere itself.

**Import a backup**
Settings, Import a backup, choose the `.json` file. The file is fully checked before anything changes: format, schema version, every amount, date and ID, every reference (categories, friends, groups), and that each split adds up to its total. If any check fails, nothing is changed and the problems are listed.

A preview shows record counts, then two choices:

- **Replace all data**: this device ends up with exactly what is in the file. If the device already has data, it offers to export a pre-import backup first and asks you to type REPLACE. The replace is a single atomic database transaction, so a failure leaves your old data intact.
- **Merge into this device**: records are matched by their permanent IDs. New records are added; if the same record was edited on both phones, the version with the later edit time wins; categories with the same name are combined; budgets match by month. Merging the same file twice changes nothing, so no duplicates. Deletions are not carried over by a merge, and this device's settings are kept. After merging, the whole dataset is validated again; if it would be inconsistent the merge is refused.

**Moving from one phone to another**: export on phone A, send the file to yourself, import on phone B with Replace (exact copy) or Merge (combine both).

**CSV exports** (for Excel): all transactions, the current filtered transaction list, split history, and the current report. Files include a UTF-8 BOM so Excel shows ₹ and names correctly, and cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them as formulas.

### Backup format (schema 1)

```json
{
  "format": "myexpense-backup",
  "app": "MyExpense",
  "schemaVersion": 1,
  "exportedAt": "2026-10-26T07:33:00.000Z",
  "currency": "INR",
  "amountUnit": "paise",
  "data": {
    "settings": { "defaultBudget": 4000000, "warnThreshold": 80 },
    "transactions": [], "categories": [], "budgets": [], "friends": [],
    "groups": [], "sharedExpenses": [], "settlements": []
  }
}
```

All amounts are whole numbers of paise (₹1 = 100 paise), so no rounding error is ever introduced by storage. The person ID `"me"` always means the phone's owner.

## 8. Accounting rules

These are the rules the dashboard, reports and budget all follow.

- **Personal spending** = expense transactions marked personal + your own share of every shared expense, whoever paid.
- **Cash you paid for a split bill** is stored as a transaction marked Split, linked to the shared expense. It is shown in Transactions (with "your share" and "paid for friends") and in Reports as "Cash paid for split bills", but only your share counts as spending.
- **Money friends owe you** is a receivable, not income.
- **Recorded payments (settlements)** change balances only. They are never income or spending.
- **Budget remaining** = the month's budget minus personal spending as defined above. A month uses its own budget if set, otherwise the default budget.

PRD example: dinner ₹3,000, you and two friends, you paid, equal split. Your spending goes up by ₹1,000, each friend owes you ₹1,000, and Reports shows ₹3,000 cash paid of which ₹2,000 was for friends. If a friend had paid instead, your spending would still be ₹1,000 and you would owe that friend ₹1,000.

**Balances** are always calculated from shared expenses and recorded payments; no running totals are stored, so they cannot drift. Every participant owes the payer their share. A payment from A to B cancels that much of A's debt to B. Balances are only changed by recording a payment; nothing is ever silently marked settled. Group screens show balances from records tagged with that group, plus a "fewest payments" suggestion that you can choose to record.

**Split rounding**: shares are calculated in whole paise and always add up exactly to the bill.
- Equal: leftover paise go one each to participants in a fixed order (by person ID), so the same bill always splits the same way.
- By amount: shares must match the total to the paisa.
- By percent: percentages may have two decimals and must total 100% within 0.01% (so 33.33 + 33.33 + 33.33 is accepted). Paise are assigned with the largest-remainder method.

Editing or deleting a shared expense or payment recalculates every affected balance immediately. Deleting a friend is only allowed when they have no shared expenses or payments; otherwise archive them, which keeps all history.

## 9. Contacts

Phone contact access in a web app depends on the browser:

- **Android, Chrome**: supported through the Contact Picker API. Tap Choose from contacts on the Add friend screen. Android shows its own picker; MyExpense receives only the one name and number you pick, never the address book, and stores it only on the phone.
- **iPhone, Safari**: the Contact Picker API is not enabled by default, so the button is not shown. Type the name and (optionally) the number instead.
- Permission is only requested when you tap the button. If it is denied or unsupported, manual entry always works.

If full address book access on iPhone becomes a hard requirement, it needs a native or hybrid wrapper (for example Capacitor with a contacts plugin), which in turn needs either App Store distribution or the Apple developer sideloading route. That is a scope change from this PWA.

## 10. Privacy and security notes

- No accounts, sign-in, backend, analytics, ads, trackers, remote fonts or third-party scripts.
- Content-Security-Policy restricts scripts, styles and network connections to the app's own origin.
- Nothing financial is written to the browser console.
- No payment processing, bank linking or UPI access.

## 11. Acceptance checklist

Automated (`node --test tests/core.test.js`) plus a headless mobile Chromium run of the UI flows were used during development. Items marked "device" must be checked on your real phones, because iOS Safari behaviour cannot be fully emulated.

| # | Requirement | How to verify |
|---|---|---|
| 1 | Install without stores | Device: follow section 4 on iPhone and Android |
| 2 | Add, edit, delete, filter transactions | Transactions tab, Filters, tap a row to edit or delete |
| 3 | Dashboard maths | Tests: PRD example, settlements; Home screen figures |
| 4 | Categories and monthly budgets | Settings, Categories, Manage; Home, Set a monthly budget |
| 5 | Friends and groups | Split tab, Add friend, Groups, New group |
| 6 | Equal, amount and percent splits | Split, Shared expense, Split options |
| 7 | Shares add up after rounding | Tests: equal and randomised percent cases |
| 8 | Who owes whom, record payments | Friend and group screens, Record payment |
| 9 | Payments update balances | Tests: settlements; friend screen after recording |
| 10 | No double counting | Tests: PRD example, friend pays, payer not participating |
| 11 | Category, monthly, yearly reports | Reports tab: Week, Month, Year, Custom |
| 12 | Offline after caching | Device: open once online, enable airplane mode, reopen |
| 13 | Persists across restarts | Device: force-close and reopen |
| 14 | JSON backup and CSV export | Settings, Backup and restore |
| 15 | Validated, confirmed import | Settings, Import a backup (try an edited, broken file too) |
| 16 | Import keeps friends, groups, splits, payments | Tests: backup round trip; device: export then import |
| 17 | Phones stay separate | Device: add on one phone, check the other is unchanged |
| 18 | No account, no data sent | No sign-in exists; CSP `connect-src 'self'`; check browser network tab |
| 19 | Contacts only where supported | Device: Android shows the button, iPhone shows manual entry |
| 20 | Small screens, clear errors | Tested at 320px width; try empty and invalid inputs |

## 12. Known platform limitations

- iPhone home screen apps and Safari tabs do not share storage (see section 4).
- iPhone does not show an automatic install prompt; installation is always through Share, Add to Home Screen.
- On some Android versions the share sheet does not accept JSON files; the app then downloads the file to Downloads instead.
- Browser storage can be cleared by the OS or user. Keep backups.
