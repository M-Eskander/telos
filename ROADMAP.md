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
| 2 | **Project-scoped role assignment on the Team page** | The access presets exist (Owner-like, Project manager, Team member, Low-access member) and roles are created globally in `/access`, but a project manager cannot give a teammate a role *for their own project*. Needs a `PUT /api/projects/:id/members/:userId/role` endpoint plus a role dropdown per member on the Team page. | Medium |
| 3 | **Keyboard-first workflow** | The command palette (⌘K) navigates but does not act. Add a visible row cursor, Enter to open, Space to select, and real commands ("assign to me", "mark done", "new task in *Production: Alpha*"). | Medium |
| 4 | **Drag to set progress** | Progress is a number you type. A pencil stroke you drag along the bar would be the most tactile thing in the paper world. | Small–Medium |
| 5 | **Phase strip / production board** | One row per root task with its rolled-up progress, dates and risk — the "where is this project" view, one screen above the task tree. | Small |
| 6 | **Per-person load** | On the Team page: how many tasks each person carries, how much progress they are responsible for, who is overloaded. | Small |
| 7 | **Comments and @mentions** | The single biggest missing collaboration feature. | Large |
| 8 | **Saved views** | "My tasks", "Late", "Unassigned", "This phase" as one-click chips instead of re-filtering by hand. | Small |
| 9 | **A "Today" view** | The sidebar assistant says something useful, but there is no page behind it: what is due today, what is late for *me*. | Medium |
| 10 | **Paper-world craft pass** | Hand-drawn underline progress bar, a tilted "DONE" stamp, sticky notes for descriptions, torn paper between sections. | Small, iterative |
| 11 | **Undo everywhere** | Only the timeline drag has undo. Every mutation should be reversible for a few seconds. | Medium |
| 12 | **Offline tolerance** | The app dies mid-edit if the network drops. Optimistic writes + a retry queue. | Large |

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

### Found while sweeping

- The **"Directing" department** had gone missing from the database — restored
  from the backup.
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
cd /mnt/Storage/telos/backend-repo/BE && npm test          # 34 suites / 231 tests

# frontend build + deploy
cd /home/m-eskander/telos-app/frontend/telos && npm run build
rsync -a --delete dist/ /mnt/Storage/telos/dist/

# sweep: no overflow, no console errors, 1440 / 1024 / 390 / 320
node /tmp/opencode/final-sweep.js
```

Checklist before calling a change done:

- [ ] `npm test` green in the backend.
- [ ] No `var(--token)` used without a definition.
- [ ] No horizontal overflow at 1440, 1024, 390 and 320.
- [ ] No console errors on any page.
- [ ] Data restored after any test that wrote to the database.
- [ ] Frontend snapshot refreshed in `/home/m-eskander/backups/`.
