# Organisational Portals

Branch: `feature/organisational-portals`. Gated by a new `Portals` App Setting under "Enterprise"
(App Settings modal) — opt-in, org-wide, Org-Admin-only to toggle, same shape as Forms & Workflow /
Portfolio Planner (see `Organisation.EnterpriseSettingsJson`). Built across all three backend tiers
plus the frontend, in the 6 phases described below (each phase left the app in a working, demoable
state, one commit per phase on this branch).

## What this is

A curated, Org-Admin-authored front door for org users who aren't necessarily members of any
Project — the place someone goes to fill in a request (a Form), track its status, and self-serve
answer their own questions before asking a human. Distinct from Forms & Workflow's existing
`ProjectMember`-gated fill-out surface: a Portal is reachable by **any authenticated org user**,
regardless of project membership, via its own human-readable hashbang URL (`#!/portal/<slug>`).

## Data model (all three tiers, same shape)

- **Portal** — `Id`, `OrganisationId`, `Name`, `Slug` (unique per org, human-readable,
  derive-then-uniquify like `Project.Key` — see `PortalSlugResolver`), `Description`, `Status`
  (`draft`/`published`/`archived`, plain string, no CHECK constraint), `ProjectId` (FK to its own
  auto-provisioned actioner Project, RESTRICT), `CreatedByUserId`, timestamps, `PublishedAt`. Only a
  `published` Portal is ever resolvable by slug to an end user — draft/archived are
  Org-Admin-preview-only.
- **PortalAccessGrant** — `Id`, `PortalId`, `Kind` (`namedUser`/`orgTeam`/`teamCommittee`/
  `allOrgMembers`), `Value` (the target id). **Closed by default**: a Portal with zero grants is
  invisible to every org user, matching this codebase's defensive-default convention (root
  `CLAUDE.md` §1). Mirrors the Form Workflow gate vocabulary (`{kind, value}`) for consistency, in
  its own table since grants need their own CRUD UI unlike gates edited inline in a workflow graph.
  - `orgTeam` is this feature's stand-in for "business unit" — reuses the existing SCIM-synced
    `OrgTeam` entity directly rather than adding a new attribute to the SCIM User wire shape (no live
    SCIM→Portal sync exists or is needed; a grant just names the `OrgTeam`, and access is checked
    live against `OrgTeamMember` on every request).
  - `teamCommittee` reuses the existing per-project `TeamCommittee`/`TeamCommitteeMember` join —
    access is checked live against whether the user is a `ProjectMember` linked into that
    `TeamCommittee`.
  - `allOrgMembers` has no specific target — `Value` is always forced server-side to the Portal's
    own `OrganisationId` (never the client-supplied value), so there's exactly one deterministic row
    per Portal rather than depending on a client-chosen placeholder. `PortalAccessService` re-derives
    BOTH the Portal's own `OrganisationId` and the checking user's `OrganisationId` and requires them
    to match — this is the one grant kind where getting that check wrong would turn into "anyone at
    all," not just "anyone in a foreign org," so it's re-verified on every single access check, never
    cached or assumed from the JWT alone.
- **PortalForm** — `Id`, `PortalId`, `FormGroupId` (no FK — `Form` is keyed by `Id`, one row per
  version; resolved at read time to whichever version is currently `published`, same resolution
  `FormService` already does org-wide), `Order`. Curates a subset of the org's published Forms; the
  `Form` entity itself is untouched.
- **PortalTopic** — `Id`, `PortalId`, `Title`, `Order`. Optional grouping heading for the Q&A rail.
- **PortalQaEntry** — `Id`, `PortalId`, `PortalTopicId` (nullable — ungrouped entries allowed),
  `Question`, `Answer` (markdown — reuses `src/js/rich-text/editor.js`/`markdown.js`, never raw HTML,
  same convention as `TaskItem.Description`), `Order`, `CreatedByUserId`, timestamps.

Migrations: `.NET` `20260729190152_AddPortals`; `php-api` `042_add_portals.sql`; `mariadb-api`
`023_add_portals.sql`.

## Provisioning: every Portal gets its own actioner Project

`PortalService.CreateAsync` (all 3 tiers) provisions a dedicated, **membership-free** Project via
`PortfolioService.CreateProjectAsync` — the same "an Org Admin sketching something out isn't
necessarily a member of it" reasoning that method's own doc comment already gives — then bootstraps
8 fixed columns, left-to-right via `Column.Order`: the 5 priority columns (`Trivial`, `Low`,
`Medium`, `High`, `Critical`, `Done = false`) followed by 3 lifecycle columns (`On Hold` — `Done =
false`, still active work, just paused; `Completed`/`Abandoned` — both `Done = true`, terminal). The
lifecycle columns are deliberately not priority-named, so they never collide with
`ExecuteActionNodeAsync`'s priority-field-driven column matching (§ below), which only ever matches
against the 5 known priority keys. Then inserts the `Portal` row referencing it. **.NET** wraps the
whole sequence in one explicit
transaction (`api/Enkl.Api/CLAUDE.md`'s standing rule for a service method that calls another
service's committing method and then writes again itself, mirroring `RetrospectiveService.PromoteItemAsync`).
**PHP tiers deliberately don't** — `PDO` has no native nested-transaction support and this call chain
doesn't need one beyond what's already covered by the caller's own single-statement writes.

Deleting a Portal removes it (cascading to its grants/forms/topics/Q&A) but **leaves its actioner
Project untouched** — any tasks already raised there, and the project itself, survive the Portal
front door being torn down.

## Backend surface — two controllers, two authorization shapes

- **`PortalsController`/`PortalService`** (`api/organisations/me/portals`) — Org-Admin authoring:
  create/update/publish/archive/delete, access-grant CRUD, form attach/detach, Q&A topic/entry CRUD.
  `[Authorize(Policy = "OrgAdmin")]`, same shape as `PortfolioController` — every id a client
  supplies is independently re-validated against the caller's own `OrganisationId` before anything is
  touched (cross-org isolation, root `CLAUDE.md` §4).
- **`PortalHomeController`/`PortalHomeService`** (`api/portals`) — the end-user surface:
  get-by-slug, available forms, my submissions (filtered to this Portal's attached forms), Q&A, and
  the actual draft/save/submit/delete form-fill flow (delegated into `FormSubmissionService`'s
  existing methods against the Portal's own `ProjectId`). **`[Authorize]`-only** — no
  `ProjectMember`/`OrgAdmin` policy, same shape as `WhiteboardController`/`ChatController`/
  `ToDoController` — a Portal must be reachable by an org user who belongs to zero projects.
  - `PortalAccessService.UserHasPortalAccessAsync` is the one shared predicate, independently
    re-deriving access from `PortalAccessGrant` rows on every call — reused by both controllers (so
    an Org Admin previewing "does user X have access" sees the same result a real user would) and
    never trusting a client-supplied claim.
  - Every read re-derives BOTH "is this Portal published" AND "does this user have a grant" before
    touching data — a nonexistent, unpublished, or ungranted Portal all return the identical 404, no
    enumeration oracle (root `CLAUDE.md` §1).
  - A Portal-user's form submission is only ever allowed against a `FormVersionId` whose `FormGroupId`
    is actually attached to that Portal (re-validated server-side) — having a route to the Portal's
    actioner Project via its own submission flow must never let a user submit any published org form
    just because they now have a path to that Project.

`FormSubmissionService.ToListItemDto` (all 3 tiers) was widened from private/private-static to
internal/public so `PortalHomeService` can build a `FormGroupId`-filtered "my submissions" list
without duplicating the workflow-node-label resolution logic it depends on.

`PortalFormDto` carries `FieldsJson` and the resolved Form's own `Id` (`FormVersionId`) alongside
`FormName`/`FormStatus` — the end-user surface has no `formsApi` (Org-Admin-only) access of its own
to fetch a form's fields a different way, so `PortalService.ResolvePortalFormDtosAsync` resolves them
server-side at the same time it resolves the display name.

## Form Workflow "raise task in Portal" action

A genuinely new mechanism — before this feature, Form Workflow nodes were limited to gating/routing
(`start`/`author`/`approval`/`end`), never side-effecting actions. A 4th node type, `action`
(`actionType: "raiseTaskInPortal"`, `config: {portalId, priorityColumn, assigneeGate, titleTemplate}`),
is **auto-executed the instant a submission's graph transitions into it** — no gating, no user action
needed, unlike Author/Approval — but, unlike a plain routing node, it then **pauses the submission
there** until the raised Task itself is completed (see "Task ↔ submission link" below); it is not a
fire-and-forget side effect on the way to whatever's next.

`FormSubmissionService.ApplyNextNodeAsync` (and its PHP twins' `applyNextNodeActions`) execute an
`action` node's side effect the instant the graph transitions into it, raising a Task:
- **Target Portal/Project — resolved dynamically, `config.portalId` is only a fallback default**:
  `ExecuteActionNodeAsync`/`executeActionNode` first checks whether the *submission's own*
  `ProjectId` is itself some Portal's actioner Project — it is exactly that whenever the submission
  was actually filled out through a Portal (`PortalHomeService.CreateSubmissionAsync` stamps every
  Portal submission with `portal.ProjectId` at creation, vs. `ProjectFormsController`'s own
  ordinary-project `ProjectId` for a direct, non-Portal fill-out — see that controller/service pair
  for the two paths). If that lookup finds a Portal, its Project *always* wins, regardless of what
  the workflow node's own `config.portalId` says — a Form attached to multiple Portals raises every
  submission's task into wherever THAT submission actually came from, never a single hardcoded one.
  Only when the submission's own project isn't any Portal's actioner project at all (a "free
  floating" Form filled out directly against an ordinary project, with no Portal involved) does
  `config.portalId` — the org-admin-configured default, picked once at workflow-authoring time in
  `views/form-workflow-editor.js`'s Portal picker — get looked up instead. No schema change was
  needed for this: `FormSubmission.ProjectId` already carried the exact signal needed, since every
  Portal has its own dedicated 1:1 actioner Project.
- **Column**: matched case-insensitively against `config.priorityColumn` ("trivial".."critical"),
  falling back to the lowest-`Order` column if the name doesn't match — never throws for a
  misconfigured value.
- **Assignee**: "assigned to the form's approver if known" — a `namedUser` `assigneeGate` always
  wins; otherwise the most recent `approved` trail entry's actor, or unassigned if none exists yet
  (e.g. an action node placed before any Approval node).
- **Title**: `config.titleTemplate` if set, else `"{FormName} — submission review"`.
- **Description**: leads with `**Submitted by:** {DisplayName} ({Username})` (looked up from
  `FormSubmission.SubmittedByUserId`), then every field's own label + entered answer, compiled into
  a Markdown block (`**Label:** value` per field, blank-line separated — rendered through the same
  Markdown rich-text editor every other Task description uses) via
  `BuildAnswersDescription`/`buildAnswersDescription` (all 3 tiers) — matches
  `features/form-answers.js`'s `renderAnswerReadOnlyHTML` value-formatting rules exactly (option ids
  resolved to their labels for checkbox/select/radio, `Yes`/`No` for a single-toggle radio, `—` for
  an unanswered field) just as plain text instead of HTML, so the raised task always carries the
  full submitted context, not just a title. Best-effort: unparsable `FieldsJson`/`AnswersJson`
  simply yields no field-answer block rather than throwing.

### Task ↔ submission link — the action node blocks until the Task is Done

`FormSubmission.RaisedTaskId` (nullable, `ON DELETE SET NULL`, indexed) is set the instant a
`raiseTaskInPortal` node raises its Task. Unlike every other node type, reaching an `action` node
does **not** auto-advance the graph afterward — `ApplyNextNodeAsync`/`applyNextNodeActions` fall
into the same `'inProgress'`-pinned-at-this-node branch an Approval node already uses, so the
submission stays paused there, `CurrentNodeId` pointing at the action node itself, until something
external resumes it.

That "something external" is `FormSubmissionService.ResumeIfLinkedTaskDoneAsync`/
`resumeIfLinkedTaskDone` (all 3 tiers) — called unconditionally from `TasksController.Update`/
`update()` right after **every** task PUT (the single choke point board.js's card-drag and the
task-edit modal's save both go through), not just ones known in advance to matter. This is
deliberately a cheap, always-on check rather than a targeted one: an indexed `WHERE RaisedTaskId =
:taskId AND Status = 'inProgress'` lookup that finds nothing for the overwhelming majority of task
updates in the app. When it DOES find a match and the Task's own Column is `Done`, it appends a
`taskCompleted` trail entry and re-calls the same `ApplyNextNodeAsync`/`applyNextNodeActions` with
the action node's own outgoing edge — walking the graph exactly one more step, reusing all the same
terminal-status logic every other transition already uses, with **one override**: reaching an End
node this way sets `Status = "completed"`, not `"approved"` — a distinct terminal value from a
human's own Approval decision (**"the form is marked as complete"**, the whole point of this
mechanism, but attributed to the linked Task, not a person). Reaching another Approval node instead
just moves the pause to a human gate; reaching a second consecutive action node fires and pauses
again (its own Task needs to complete too). The submitter gets notified via the same
`BroadcastFormSubmissionDecided` SSE event a human approval already triggers (`decision: "completed"`),
so a task-driven completion shows up the same way a decision does, just worded differently — see
`features/live-updates.js`'s `handleFormSubmissionDecidedEvent`, which skips the usual "by {actor}"
phrasing for this decision value since there's no person to attribute it to.

`FormSubmission.Status`'s full value set is now `draft | submitted | inProgress | approved | rejected
| completed | cancelled` (`cancelled` remains reserved/unused — see its own doc comment). The Portal
frontend's stepper (`modals/portal-home.js`'s `renderStepperHTML`) treats `completed` as reaching the
same final step index as `approved`, but relabels that step "Completed" and — since a
`start → author → action → end` workflow may never have had a real human Approval step at all —
deliberately leaves the "In review" step (index 2) unstyled/grey rather than marking it `done`, so a
task-driven completion doesn't visually imply a review happened that never did.

**Why this couldn't just be a `TaskService` dependency**: `FormSubmissionService` already depends on
`TaskService` to raise the task in the first place — injecting `FormSubmissionService` back into
`TaskService` would be a straight ASP.NET Core DI constructor cycle. Instead `TasksController`
depends on both (a clean one-way graph, not a cycle, since `TaskService` itself gains no new
dependency) and does the orchestration. PHP tiers mirror the same controller-level shape, matching
their own pre-existing "broadcast ownership stays at the controller" convention (`resolveNotifyTargets`
et al.) rather than introducing anything DI-specific, since neither PHP tier has a DI container to
begin with.

**Known gap, not solved this pass**: `AiAssistantService`/`MigrationEntityBuilder` write
`Task.ColumnId` directly, bypassing `TaskService.UpdateAsync`/`TasksController` entirely — a task
moved into Done through either of those paths won't trigger this resume.

**.NET** wraps the node-transition + task-raise + submission-save sequence (and, separately, the
resume-on-task-done sequence) in one explicit transaction each (same standing rule as Portal
provisioning above). **PHP tiers deliberately don't** — `TaskService::create()` already wraps itself
in its own transaction and PDO has no native nested-transaction support, so the Task row and the
`FormSubmissions` UPDATE are each independently atomic instead of one combined unit; an interruption
between the two is a narrow, accepted edge case given that constraint, not a silently-ignored gap.

Frontend: `features/form-workflow-engine.js`'s `computeNextNodeId` walks past action nodes too (pure,
UI-prediction only — it never executes anything itself, matching this module's own no-side-effects
doc comment). `views/form-workflow-editor.js` gets a 4th node type in its palette/popover (Portal
picker relabeled "Default Portal (optional)" with an inline hint explaining the dynamic-resolution/
fallback relationship, priority column, assignee, title template) — `formWorkflowEditorState.portals`,
loaded once per editor session via the new `portalsApi.list()`. The node's own canvas summary
(`gateSummary` in that file) reads `"Raise task · default Portal: {name}"` when one's configured, or
`"Raise task in the submitter's Portal"` when it isn't — never "No Portal selected yet," since an
unset default is a valid, common configuration now, not an incomplete one.

**Discoverability note**: the Action step button always sits in the workflow editor's toolbar, but a
**published** Form's workflow isn't directly editable — create a new version first (Forms admin's own
versioning flow), then its workflow editor becomes editable and the Action step can be added.

## Frontend

- **`src/js/modals/portals-admin.js`** — Org-Admin authoring, `kf-modal-lg`, same two-overlay shape
  as `modals/forms-admin.js` (a plain list/create picker, then a tabbed editor: Details / Access /
  Forms / Q&A). Access tab's `teamCommittee` grant kind takes a raw id (no cross-project
  `TeamCommittee` listing endpoint exists — each project owns its own — building one for this single,
  secondary grant kind was out of scope for this pass).
- **`src/js/modals/portal-home.js`** — the actual new UX surface, a genuine edge-to-edge fullscreen
  modal (`.kf-modal.kf-modal-full`, a new CSS tier alongside `sm`/`md`/`lg`, reserved for this
  front-end/end-user experience specifically — every other feature modal in the app, including
  `portals-admin.js` above, stays on the standard `kf-modal-lg` centered-dialog treatment). Three
  panes:
  - **Start a request** — the Portal's attached, currently-published forms, plain icon+label list
    (deliberately not numbered — these forms aren't a sequence).
  - **My requests** — the signature device this page is meant to be remembered by: a horizontal
    status **stepper** (Draft → Submitted → In review → Approved, with a distinct rejected state)
    replacing a plain status badge, directly encoding the submission's real state machine. Reused
    nowhere else in the app.
  - **Answers** — a knowledge-base-style Q&A accordion, grouped under small-caps topic labels (a real
    structural label, matching the side-nav "Views"/"Tools" section-label precedent).
  - A warm terracotta accent pair (`--kf-portal-accent`/`--kf-portal-accent-soft`, themed for both
    light/dark) is scoped to this page only — the header band, active-stepper state, and form-tile
    hover — signalling "a different room" from the board's own color vocabulary without touching it.
  - Filling out a form opens a layered `kf-modal-md` detail overlay
    (`#portalHomeFilloutOverlay`), mirroring `modals/forms-fillout.js`'s own detail shape (reusing
    `features/form-answers.js`'s pure field-rendering functions) but backed by `portalHomeApi`
    against the Portal's own actioner Project instead of `projectFormsApi`.
- **`src/js/features/hash-router.js`** — new `#!/portal/<slug>` route, nested/namespaced prefix
  (`PORTAL_HASH_PREFIX`) checked before the bare task-key parse, same `replaceState` idiom as the
  existing task/whiteboard routes. Server-resolved (async `portalHomeApi.getBySlug`), not a local-DB
  lookup — a Portal isn't in `state.db` at all, same as the Whiteboard join-code route. A task raised
  into a Portal's actioner Project needs **no new routing** — its Project is an ordinary Project, so
  the existing `#!/KEY` task hashbang already reaches it unchanged.
- **`src/js/api.js`** — new `portalsApi` (admin) and `portalHomeApi` (end-user) clients, route bases
  `/organisations/me/portals` and `/portals` respectively.
- Nav wiring (`views/board.js`'s `applyHeaderButtonVisibility`): `navPortalsBtn` (Org-Admin authoring
  entry, gated `isOrgAdmin() && visibility.portals`) and `navPortalsBrowseBtn` (member-facing entry,
  gated just `visibility.portals`). No "list every Portal I have access to" endpoint exists — a
  Portal is normally reached via its own shared link (same as a Whiteboard join code); the Browse nav
  entry is a fallback that prompts for a known slug.

## Live verification (2026-07-30, `.NET` tier, real docker-compose stack)

Containers rebuilt/force-recreated on this branch (`docker compose build api web && docker compose
up -d --force-recreate api web`); `AddPortals` migration applied cleanly against the running dev DB
(confirmed via `docker compose logs api`). Two throwaway orgs + four users created directly via SQL
(bcrypt hash generated the standing documented way, via a throwaway `node:20-alpine` + `bcryptjs`
container), all cleaned up afterward. Verified live, end-to-end:

- Closed-by-default: a Portal with a single `namedUser` grant returns 200 to the granted user, and
  an **identical 404** to (a) a same-org user with no grant, (b) a different-org user, and (c) a
  request for a genuinely nonexistent slug — no enumeration oracle between any of the three.
- Cross-org isolation on the admin surface too: an Org B admin fetching Org A's Portal by id via
  `PortalsController` also 404s.
- Portal creation actually provisions its actioner Project with the 5 fixed columns in the correct
  `Trivial → Low → Medium → High → Critical` order. **Extended 2026-08-03**: now 8 columns total —
  verified live that `On Hold`/`Completed`/`Abandoned` land at `Order` 5-7 with `Done` set correctly
  (`false`/`true`/`true`), right after `Critical`.
- `PortalFormDto`'s `FieldsJson`/`FormVersionId` (the fix described above) resolve correctly on the
  wire — confirmed a Portal end user can list an attached form's fields with no `formsApi` access of
  their own.
- The full "raise task in Portal" workflow action fired correctly on a real submit: a Form with
  `start → author → action(raiseTaskInPortal, priorityColumn:"high") → end` produced a real Task
  (`ITSE-1`) in the Portal's actioner Project's **High** column, unassigned (no approval node
  configured, so "assigned to the approver if known" correctly fell back to unassigned), with the
  Approval Trail recording a `raisedTask` entry carrying the new task's key as its comment — and the
  submission itself landed on `approved`/`n_end` in the same request.
- "My requests" correctly lists only submissions for forms actually attached to that Portal.

## Known gaps / deliberately out of scope for this pass

- No cross-project `TeamCommittee` listing endpoint — the Access tab's `teamCommittee` grant kind
  takes a raw id rather than a picker.
- **Resolved (2026-07-30)**: a "list every Portal I have access to" endpoint now exists
  (`PortalHomeService.ListAccessibleAsync` / `GET /api/portals`) — added for the side-nav icon
  feature, backs `loadAndRenderSideNavPortals` in `portal-home.js`. No raw-slug-prompt entry point
  remains.
- **Resolved (2026-07-30)**: `contract-tests/scenarios.js` now has a 13-scenario Portals chain
  (create/publish a Form and a Portal, attach, grant `allOrgMembers` access, publish, then the whole
  end-user surface — list-accessible, get-by-slug, list-available-forms, create/get/list
  submissions, `submissions/awaiting-me`, and an unconfigured-workflow submit rejection). Run live
  across all three tiers simultaneously (throwaway net/php Postgres + MariaDB, `.NET` on host,
  `php-api`/`mariadb-api` in Docker per their own CLAUDE.md recipes): **23/23 scenarios pass, no
  drift** — this is the first time `php-api`/`mariadb-api`'s Portals code has been exercised against
  a real, running instance rather than just lint-checked.
- A real approval-flow gap was found and fixed the same day (not caught by the original live
  verification above, since that pass only ever tested a workflow with no Approval node): a Portal
  submission that reached an Approval node was invisible and unactionable to everyone — the
  actioner Project is deliberately membership-free, so neither the regular Forms modal nor
  `PortalHomeController` had any route to it. Fixed across all three tiers:
  `PortalHomeService`/`PortalHomeController` gained `ListAwaitingMyActionAsync`/`ActOnApprovalAsync`
  (scoped through Portal access, delegating into the existing `FormSubmissionService` gate logic),
  `GetSubmissionAsync` now also allows a legitimate reviewer (not just the submitter) to read a
  submission, and `PortalService.CreateAsync` now auto-adds every current Org Admin as a Project
  Admin of the new actioner Project (so an `orgAdmin`-gated Approval node is satisfiable and someone
  can manage the back-office team). Frontend: `portal-home.js` gained an "Awaiting My Action"
  section + approve/reject review flow, and a read-only detail view for any non-Draft "My requests"
  card; `portals-admin.js` gained a Team tab (org-user picker, `memberApi.orgCandidates`) for
  managing the actioner Project's back-office members. Live-verified end-to-end on the `.NET` tier
  (org-admin-gated Approval node, submit as a non-admin member, approve as the auto-added admin);
  **not yet covered by an equivalent deep live pass on `php-api`/`mariadb-api`** — the contract-tests
  chain above proves the HTTP contract shape matches on all three tiers, but doesn't exercise an
  actual Approval-node transition, since the contract-tests Form is deliberately left with no
  workflow configured (see its own `portal-submit-unconfigured-workflow` scenario).
- `php-api`/`mariadb-api` are bare-metal-only deployments per their own `DEPLOYMENT-*.md`, so the
  richer live-verification pass above (real browser-adjacent curl flows, raise-task-in-Portal
  workflow action, cross-org isolation checks) still only exists for the `.NET` tier, which is the
  one wired into `docker-compose.yml`. The contract-tests run narrows this gap for the CRUD/access
  surface but doesn't replace it for anything workflow-transition-shaped.
