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
  reports `xlsx`. The remaining high advisories are dev-only (Jest's
  `update-notifier` chain); production audit is 1 moderate, 0 high.
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
cd /mnt/Storage/telos/backend-repo/BE && npm test          # 39 suites / 273 tests

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
