# Telos Studio — Roadmap & Backlog

A running list of what is done, what is waiting, and what to build next.
Written so we can pick it up cold tomorrow.

- **Live site:** https://team.telosstudio.games
- **Branch for backend work:** `temp-production-level-updates` on `M-Eskander/telos`
- **Frontend:** deployed from `frontend/telos/dist` to `/mnt/Storage/telos/dist`.
  Not versioned on GitHub (decision: the frontend source stays out of the repo),
  so it is snapshotted to `/home/m-eskander/backups/frontend-source-*.tar.gz`.
- **Database:** per-project configuration, never pushed to GitHub. Backups live in
  `/home/m-eskander/backups/db-*.sql.gz`.

---

## 1. Build next (in order of value)

| # | Item | Why it matters | Rough size |
|---|------|----------------|------------|
| 1 | **Task activity history** | Every task mutation is invisible today. A `task_activity` table written through on create/edit/move/delete, a per-task "History" panel, and a project-wide activity stream. This is the trust layer — without it nobody knows who moved a deadline. | Medium |
| 2 | **Google Sheets sync** | Import from a Google Sheet by URL and write changes back, so the sheet stays the single source of truth. Needs the Sheets API and a per-project OAuth connection. The in-app engine already calculates the sheet; this is only about living in Google's cloud. | Medium |
| 3 | **Project-scoped role assignment on the Team page** | The access presets exist (Owner-like, Project manager, Team member, Low-access member) and roles are created globally in `/access`, but a project manager cannot give a teammate a role *for their own project*. Needs a `PUT /api/projects/:id/members/:userId/role` endpoint plus a role dropdown per member on the Team page. | Medium |
| 4 | **Keyboard-first workflow** | The command palette (⌘K) navigates but does not act. Add a visible row cursor, Enter to open, Space to select, and real commands ("assign to me", "mark done", "new task in *Production: Alpha*"). | Medium |
| 5 | **Drag to set progress** | Progress is a number you type. A pencil stroke you drag along the bar would be the most tactile thing in the paper world. | Small–Medium |
| 6 | **Phase strip / production board** | One row per root task with its rolled-up progress, dates and risk — the "where is this project" view, one screen above the task tree. | Small |
| 7 | **Per-person load** | The "Who works on what" tab shows the load already; give it the same treatment as the revenue calculator (hours, points, share of the project). | Small |
| 8 | **Insert rows in the sheet** | Rows can be typed into the blank rows below the table, but there is no way to insert a row in the middle or copy a formula down a column. Duplicate a person row in the Team sheet and the formulas should follow. | Medium |
| 9 | **Comments and @mentions** | The single biggest missing collaboration feature. | Large |
| 10 | **Saved views** | "My tasks", "Late", "Unassigned", "This phase" as one-click chips instead of re-filtering by hand. | Small |
| 11 | **A "Today" view** | The home page shows the week; make "Today" a filter on it. | Small |
| 12 | **Paper-world craft pass** | Hand-drawn underline progress bar, a tilted "DONE" stamp, sticky notes for descriptions, torn paper between sections. | Small, iterative |
| 13 | **Undo everywhere** | Only the timeline drag has undo. Every mutation should be reversible for a few seconds. | Medium |
| 14 | **Offline tolerance** | The app dies mid-edit if the network drops. Optimistic writes + a retry queue. | Large |

## 2. Rules we agreed on (do not break these)

- Weight scale stays **0–12**. Priority is derived in three steps per level:
  0–3 low, 3–6 medium, 6–9 high, 9–12 critical.
- Progress drives status: 0 = to do, 1–99 = in progress, 100 = done.
- A parent derives weight (average of children), progress (weighted average),
  priority and status from its children. Priority and status are **never**
  hand-edited; a bulk edit that touches them is rejected with a 400.
- Subtasks may have subtasks, at any depth.
- Role presets are project-scoped. A global assignment is rejected. Role names
  stay free-form.
- Everything in the UI is derived from the server (`/api/meta/task-rules`,
  `/api/meta/access-presets`, `/api/attention`). No rules hard-coded in React.
- The live database and the frontend source are **not** pushed to GitHub.

## 3. Fixed in this session

### Reported bugs

- **Attention "and N more" was dead text.** It is now a real control: it expands
  the bucket and flips to "Show fewer".
- **Clicking a task in Attention did not land on that task.** The Tasks page now
  reads `?task=`, opens the way to it, centres the row and flashes it.
- **To-do tasks were invisible in the timeline.** Root cause: `--ink-muted` was
  referenced ten times but never defined, so `background: var(--ink-muted)` was
  invalid at computed-value time and the bars fell back to transparent. All 33
  to-do bars now draw. Every `var(--x)` in the stylesheet is now defined
  (audited with a script).
- **Sign out turned white on hover.** The generic `button:hover` painted a light
  fill on the dark desk.
- **"At risk" was blue and a big stamped box.** Risk states are now amber chips
  with a dot, 21px tall, on task rows, project cards and the portfolio table.
- **The Select button and the checkboxes did not belong.** The button now
  matches the toolbar (46px, same as the search field and "Add task"), the
  checkboxes are drawn by the app instead of the OS, and they sit at the same
  22px as the fold button beside them. The checkbox also no longer takes its own
  grid column, which used to mangle the row.
- **The graph ruling behind the timeline stood still.** The ruling was painted
  on the scroll container, so the lines stayed while the bars slid. It is drawn
  on the track now, with a step that matches the ticks, so the paper travels
  with the plan.
- **The checkbox and the fold button sat a pixel apart.** Both are 22px and in
  the same flex row now.

### The paper of the studio

- **Terms and contracts are two different things.** The terms are the
  studio-wide paper every person signs to come aboard (per person, on the
  person page). A contract belongs to a project and is made from that
  project's layout and the person's row in the project sheet.
- **The end date is optional** on both, for terms and for contracts.
- **A project keeps its own spreadsheet.** Import `.xlsx` / `.xls` / `.csv`
  (the revenue share calculator works as it is), edit the cells in the app,
  export it back out. Every formula is worked out by the app itself — across
  sheets — on every edit, so the calculator is alive inside the portal rather
  than a picture of one. Formula cells are tinted, errors are red, the A1
  headers and formula bar behave like a spreadsheet, and every change saves on
  its own. Export writes the formulas, the answers and the number formats back
  into the workbook.
- **The quick grid wears the workbook's clothes.** Column widths, custom row
  heights, bold/italic type and sizes, font colours, fills, thin borders,
  horizontal and vertical alignment, wrapping, merged cells and the frozen
  heading all come from the uploaded file. Text that has empty cells to its
  right overflows the way it does in Excel (the Summary title, the note under
  it and the section labels were being clipped). Formula cells carry an `ƒ`
  mark and a blue paper tint; input cells stay plain. The paper colours, rules
  and type of the portal are unchanged.
- **Freeze choice (no stored panes in the calculator).** The workbook has no
  pane settings, so the importer chooses the first row with four or more filled
  cells within the top six rows as the heading, freezes that single row under
  the column letters, and freezes columns A–B (the label/Name column). The
  heading and Name column stay put on wide sheets; the row-number strip is
  sticky as before.
- **Truncation warnings are honest.** The quick grid still holds 400 rows, 60
  columns and 2,000 characters per cell. An import now warns when real values
  or formulas sit outside those limits (not when a file merely carries empty
  formatted rows); the warning is shown in the Sheet tab and stored with the
  sheet so it survives a reload. The full editor in Step 4 is the way to work
  past those limits.
- **SheetJS 0.18.5 was replaced with 0.20.3 from the official SheetJS CDN.**
  The npm build has two high-severity advisories (CVE-2023-30533 prototype
  pollution, CVE-2024-22363 ReDoS) and no npm fix; `npm audit` no longer
  reports `xlsx`. `fflate` was bumped to 0.8.3 for its ZIP64 parse-loop
  advisory. `npm audit --omit=dev` is clean (0 vulnerabilities); the remaining
  high advisories are dev-only (Jest's `update-notifier` chain).
- **Export is the uploaded file, patched.** The original `.xlsx` is kept byte
  for byte per project (`project_workbooks`, one row per project, 8 MB cap) and
  saved in the same transaction as the imported sheets. Export opens that
  package and rewrites only the `<sheetData>` cells whose value or formula
  moved. Every other part of the file is left alone: `styles.xml`, number
  formats, column widths, row heights, merges, data-validation dropdowns,
  conditional formatting, freeze panes and shared formulas. A text edit becomes
  an inline string; a date stays a serial date; a changed formula becomes a
  normal formula. If nothing moved, the original bytes come back untouched.
  The `meta.imported` rows/columns recorded at import are the boundary: cells
  outside it are never cleared. If the template is missing (legacy sheets,
  `.xls`/`.csv` imports) or damaged, export falls back to the plain SheetJS
  workbook rather than failing. The live sheets imported before this change
  have no stored template yet; re-importing them once is what turns on the
  styled grid and the faithful export.
- **A formula edit can rewrite a whole shared group.** Excel stores one
  shared formula plus offsets. If the master changes, the exporter writes the
  group as normal formulas, including members outside the quick grid's imported
  window, using the template's cached values. This is the only case where an
  export writes cells beyond the one that moved; leaving a dangling shared
  reference would corrupt the workbook.
- **Sheet proof (Step 3).** Export tests use a synthetic workbook with a
  shared formula, a date, a percentage, a merge, a dropdown and a conditional
  format. They assert that only the moved cells and their dependants change,
  shared masters survive value edits, new rows inherit the style above, dates
  and rates keep their formats, and cells outside the imported window stay
  byte-identical. The real calculator was exported with `Settings!C5`
  100000 → 120000: `styles.xml` and `sharedStrings.xml` byte-identical, 0
  formula and 0 number-format differences, `<cols>`/`<mergeCells>`/
  `<dataValidations>`/`<conditionalFormatting>` unchanged on all six sheets,
  shared `E6`/`E7` preserved, `calcPr fullCalcOnLoad="1"`, and the file
  re-imported cleanly. A one-label edit changed exactly one cell across all six
  sheets. Verified copy:
  `/home/m-eskander/backups/Telos_Revenue_Share_Calculator-exported-2026-10-22.xlsx`.
- **The test database enforces SQLite foreign keys.** `knexfile.js` sets
  `PRAGMA foreign_keys = ON`, so the `project_workbooks → projects` cascade is
  exercised instead of assumed. The suite is **42 suites / 298 tests**
  (including the Step 4 ONLYOFFICE tests).
- **Database dumps for the sheet work:**
  `/home/m-eskander/backups/telos_db-2026-10-22-pre-sheet-meta.sql` (before
  `project_sheets.meta`) and
  `/home/m-eskander/backups/telos_db-2026-10-22-pre-workbook-template.sql`
  (before `project_workbooks`).
- **The engine speaks the calculator's language.** `COUNTIF`, `SUMIF`,
  `SUMPRODUCT`, `VLOOKUP`, `IF`, `IFERROR`, `OR`, `LEFT`, `TEXT`, `SUM`, `MIN`,
  `MAX`, `AVERAGE`, `COUNT` and the common arithmetic, text and lookup extras.
  Array behaviour inside `SUMPRODUCT` (comparisons and `LEFT` over ranges,
  array criteria in `SUMIF`) is covered, because that is how the bonus formula
  is written. A circular reference shows `#CIRC!` instead of hanging. Number
  formats (`\$#,##0`, `0.0`, `0.00%`, `0%`, `General`) are kept on import and
  written back on export.
- **The proof is the studio's own files.** The engine was checked cell for cell
  against the answers Excel stored in both calculators: **397 of 397** formulas
  on `Telos_Revenue_Share_Calculator.xlsx` and **349 of 349** on the demo, with
  zero differences. A full import → export → re-import round trip keeps 650
  cells, 397 formulas and 445 number formats unchanged. 24 engine unit tests
  plus 4 end-to-end sheet tests (read, edit, cross-sheet recalculation, export)
  cover the language, the array behaviour and a miniature of the calculator
  chain.
- **A project keeps its own contract layout.** The text of the contract with
  `{{Name}}`, `{{Department}}`, `{{Role}}`, `{{Hours}}`, `{{Share}}`,
  `{{Project}}`, `{{Studio}}`, `{{StartDate}}` and `{{EndDate}}` in it. The
  default layout is the studio's project contract, ready to edit.
- **Contracts are made from the sheet**, the same way the studio's Apps Script
  did it: the Team sheet gives the name, department, roles and weekly hours
  (roles joined with " & "), the Summary sheet gives the base revenue share,
  and people with no hours are left out (and counted).
- **The project contract is the studio's Word file.** Upload the `.docx` once
  per project; the app fills `{{Name}}`, `{{Department}}`, `{{Role}}`,
  `{{Hours}}` and `{{Share}}` in the document, headers and footers, then turns
  each one into a PDF with LibreOffice (fonts embedded, design untouched). Each
  contract downloads as Word and as PDF. If a project has no Word file, the
  text layout is used instead.
- **A person can join without verifying.** "Do not ask for email verification
  yet" on the add-person form marks the account as verified and sends no mail,
  so the whole team can be added while the studio is still being tested.

### The full editor (Step 4)

- **The Sheet tab can open the workbook in a real spreadsheet editor.** Managers
  see "Open full editor" next to Import/Export. It opens
  `/projects/:id/sheet/editor`, a full-viewport page outside the app shell, and
  loads a self-hosted ONLYOFFICE Docs 9.4.0.1 editor. Read-only members keep the
  quick grid and the export. If the editor cannot start, the page says why
  (permission, missing configuration, no workbook, network, script failure) and
  offers "Back to the quick grid"; it never leaves the Sheet tab broken.
- **The original file stays the source of truth.** The config endpoint exports
  the current workbook through the same template-preserving path as Export: the
  stored original `.xlsx` with the quick grid's changed cells, or a plain
  workbook for a legacy project with no stored template. ONLYOFFICE opens that
  file. Its save callback returns the exact edited `.xlsx`; the backend checks
  the ZIP signature and the 8 MB cap, parses and recalculates it, then replaces
  the sheets and stores the edited file as the new template in one transaction.
  A contract generated after the save reads the recalculated sheet values. The
  next editor session gets a new document key.
- **Saves are signed and serialized.** The browser only gets a session-guarded
  config with an HS256 token. The document and callback URLs carry short-lived
  signed path tokens (12 h and 7 d). The callback must also carry ONLYOFFICE's
  own JWT in the body or `Authorization` header; forged callbacks fail with 401.
  Status 2 (changes ready) and 6 (forced save) are saved; 4 and other statuses
  are acknowledged without touching the sheet. Two callbacks for one project
  are chained so the later file wins in arrival order.
- **The save fetch is fenced.** The callback URL is rebuilt only from the
  internal Document Server origin and is limited to `/cache/` or `/doc/`. An
  unknown hostname is rejected. If the Document Server names itself with a
  private IP literal, the path is fetched through the app's own public origin
  (which Caddy routes back to the Document Server), never from the private
  address directly. The download has a 25 s timeout and an 8 MB cap.
- **ONLYOFFICE is same-origin and self-hosted.** `docker-compose.yml` adds
  `onlyoffice/documentserver:9.4.0.1` with JWT enabled, the shared secret, and
  `ALLOW_PRIVATE_IP_ADDRESS=true` so it can fetch the internal
  `http://backend:5000` document and callback URLs. It is not published to the
  host. Caddy proxies `/web-apps`, `/sdkjs`, `/sdkjs-plugins`, `/hosting`,
  `/cache`, `/doc`, `/coauthoring`, `/fonts`, `/themes`, `/info`, `/plugins` and
  `/healthcheck` to `onlyoffice:80` on both the tunnel and public Caddyfiles.
  This avoids a second hostname and a cross-site session cookie; the tunnel
  ingress is dashboard-managed, so a `docs.` subdomain was not available to
  configure locally.
- **Deployment files (not committed to GitHub):** `docker-compose.yml`,
  `Caddyfile.tunnel`, `Caddyfile`, and the `ONLYOFFICE_JWT_SECRET` line in
  `.env` live in `/mnt/Storage/telos`. No database migration was added, so no
  new DB dump was required for Step 4.
- **Verified (Step 4):** `42 suites / 298 tests` pass (including 13 new
  ONLYOFFICE unit/integration tests: signed links, config, document serving,
  save, recalculation, template replacement, key rotation, forged/foreign
  callbacks, legacy fallback, missing-secret 503). `npm audit --omit=dev` is
  clean. Live: the public `api.js` is 200; `/healthcheck` is 200; the editor
  page is served; `/doc/abc` and `/cache/...` reach the Document Server;
  `/coauthoring/CommandService.ashx` reaches it too. A signed document URL
  fetched from inside the `onlyoffice` container returns 200 with a 67,627-byte
  `PK` workbook; the config and document endpoints without a valid token are
  401; a POST to a bad callback token is 401. ONLYOFFICE reports version 9.4.0
  build 129 and `/healthcheck` = `true`. Idle memory: ONLYOFFICE 383 MiB,
  backend 55 MiB.
- **Not verified live:** the actual browser editor session, iframe, WebSocket
  and a real ONLYOFFICE callback save, because there are no live login
  credentials and screenshots must be checked by the user. Also unverified:
  the callback host the Document Server actually returns under a real session
  (the IP-literal fallback is coded and unit-tested, but not observed), a
  contract generated after a real editor save, and the same-origin tunnel under
  a live editing session (the static and service paths pass). The live project
  sheets still have no stored templates; re-import the six original `.xlsx`
  files once to enable the styled grid and template-preserving export. Until
  then the editor opens a plain fallback workbook. Do not save that fallback
  over a live sheet before re-importing the original: it would replace the
  project's template with the plain workbook.
- **Capacity:** the official ONLYOFFICE Docs recommendation is a dual-core
  2 GHz CPU, **4 GB RAM or more**, 2-4 GB swap and **40 GB HDD** (Docker Hub
  lists 4 GB RAM / 2 GB swap / 2 GB HDD). This host has 15.32 GiB RAM and about
  15 GB free disk; the image is 4.86 GB. Idle use is 383 MiB, but the disk is
  below the recommended production headroom. Monitor it before a large rollout.
- **Licence:** the image is the unmodified upstream build. ONLYOFFICE Docs is
  AGPLv3 plus Additional Terms (Copyright 2009-2026 Ascensio System SIA): keep
  notices; modified versions must say so and name the original; interactive
  UIs must identify ONLYOFFICE, say the version may be modified, and link the
  licence; no trademark rights; non-code content is CC BY-SA 4.0. The image
  carries `LICENSE.txt`; `THIRD_PARTY_NOTICES.md` quotes the terms, and the
  editor footer links the licence, source and trademark policy. No ONLYOFFICE
  code was modified. See `THIRD_PARTY_NOTICES.md` for the full text and contact.
- **Decision log:** same-origin Caddy paths instead of a subdomain (tunnel
  ingress is dashboard-managed); pin 9.4.0.1; internal Document Server URLs plus
  `ALLOW_PRIVATE_IP_ADDRESS`; 12 h document tokens and 7 d callback tokens; the
  editor page is outside the Shell for full viewport; the IP-literal save fetch
  goes through the public origin rather than the private address.

### Full editor follow-up (2026-10-23)

- **The editor never started because Caddy served the Telos SPA for the
  Document Server's versioned iframe path.** ONLYOFFICE loads
  `/9.4.0-<build>/web-apps/...` and `/9.4.0-<build>/doc/...`; the Caddy matcher
  only covered bare `/web-apps/*` and `/doc/*`, so the versioned URL fell
  through to `try_files /index.html`. The iframe was the Telos app (hence
  `/api/auth/me` 401s inside it), the Document Server never created a session,
  and `onAppReady`/`onDocumentReady` never fired. Caddy now proxies any
  `/<x.y.z>-<build>/...` prefix to `onlyoffice:80`; its nginx strips the prefix.
- **The config also used the wrong API document type.** ONLYOFFICE expects
  `documentType: 'cell'` for spreadsheets, not `'spreadsheet'`; the browser
  logged that warning. Both changes are required.
- **The JWT and transport were not the cause.** Backend and Document Server
  secret hashes match; `JWT_ENABLED=true`, `JWT_IN_BODY=true`, browser tokens
  enabled; the public `/doc` WebSocket upgrades with 101 through Cloudflare and
  Caddy. Caddy now also sets `flush_interval -1` and `stream_timeout 0s` on the
  ONLYOFFICE upstream. A real headless Chromium session against the public URL
  reached `onAppReady` at 2.5 s, opened the versioned `wss://.../doc/...`
  socket with 101, and reached `onDocumentReady` at 18.2 s.
- **Fonts were not missing from the build.** The three files were present in
  both `public/fonts` and `dist/fonts`; Caddy's `/fonts/*` ONLYOFFICE matcher
  was intercepting the app's font requests, and the Document Server 404ed
  looking under its own `fonts/` directory. The app fonts now have exact Caddy
  routes before the ONLYOFFICE matcher. The build runs
  `scripts/copy-fonts.mjs` after Vite to copy and verify all three files on
  every build, and the CSS uses `?v=2` to bypass the earlier Cloudflare 404
  objects. Those bare URLs were cached by Cloudflare with
  `max-age=31536000, immutable`; a one-time Cloudflare purge of
  `/fonts/comfortaa-latin.woff2`,
  `/fonts/amaticsc-400.woff2` and `/fonts/amaticsc-700.woff2` is still needed
  for the bare URLs. The app no longer requests them.
- **The timeout crash was React owning the editor node.** The editor container
  was conditionally rendered by React; ONLYOFFICE moved/replaced its children,
  and React's later `removeChild` threw `NotFoundError` and the error boundary
  showed "Telos UI crashed". The page now has a stable ref'd host with an
  imperatively created child, so React never sees the iframe; teardown is in
  try/catch. The editor/config timeout is 30 s and the fallback is a visible
  overlay with "Back to the quick grid"; the config fetch also has a 30 s
  timeout.
- **Scope still manual:** the authenticated app flow/screenshots and the
  Cloudflare bare-font purge. A temporary diagnostic project was used for the
  real browser check, then deleted; immediately after cleanup the live counts
  were 6 sheets / 0 workbooks / 0 meta. A separate live workbook import then
  ran concurrently (5 sheets / 1 workbook / 5 meta); it was left untouched.
  No migration was added.

### The studio day to day

- **A home page** (`/`) — everything assigned to you across every project, the
  week ahead, and your projects.
- **A meetings page** (`/meetings`) — the meetings you are part of this week,
  what is coming, and every meeting in the studio.
- **Meetings are planned inside a project**: a name, a first date, a time, a
  length, how often it repeats (once, daily, weekly with chosen days, monthly
  on a chosen day), when it stops, and who comes. Everyone invited sees it on
  their meetings page.
- **"Who works on what"** — a project tab with every person, their open work,
  and the tasks nobody owns.

### Found while sweeping

- The **"Directing" department** had gone missing from the database — restored
  from the backup.
- **An imported sheet could land one row and one column off.** The old reader
  started the grid at the file's used range (`B2`) instead of at `A1`, so the
  formulas stayed in A1 terms while the cells moved. Every imported sheet now
  anchors at `A1`. The six demo sheets in the live database were imported under
  the old reader and are being shifted back once, after which they match the
  demo file cell for cell.
- **Dependency arrows never drew** in the gantt: the flat timeline list did not
  load dependencies. Fixed in `task.repo.js` (`findDatedByProject`).
- The gantt's label column was 250px in CSS but 260px in the chart maths — a
  10px offset between the bars and the arrows. Both are now 260px.
- Leaf tasks showed a bare "100" while parents showed a bar plus "100%". Every
  row now has the pencil bar, and the number on a leaf is still editable.
- The gantt's mobile view was a plain list, not a timeline. It is now a real
  gantt: the names hold still on the left, the plan scrolls sideways under
  them, the dates sit under the names, and the zoom opens on a readable scale.
- The "Details / Add subtask" links were at 32% opacity and looked disabled.

## 4. Verification routine

```bash
# backend
cd /mnt/Storage/telos/backend-repo/BE && npm test          # 42 suites / 298 tests

# frontend build + deploy
cd /home/m-eskander/telos-app/frontend/telos && npm run build
rsync -a --delete dist/ /mnt/Storage/telos/dist/

# sweep: no overflow, no console errors, 1440 / 1024 / 390 / 320
node /tmp/opencode/final-sweep.js
```

The backend image needs LibreOffice Writer and a few fonts to turn contracts
into PDFs:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
```

Without it, contracts still fill and download as Word files; the PDFs are
skipped and the app says so. Contract files live on the `contracts` volume
(`/data/contracts`), and the app deletes them when a contract is deleted or
made again — nothing is left behind.

Checklist before calling a change done:

- [ ] `npm test` green in the backend.
- [ ] No `var(--token)` used without a definition.
- [ ] No horizontal overflow at 1440, 1024, 390 and 320.
- [ ] No console errors on any page.
- [ ] Data restored after any test that wrote to the database.
- [ ] Frontend snapshot refreshed in `/home/m-eskander/backups/`.
