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
- **PortalAccessGrant** — `Id`, `PortalId`, `Kind` (`namedUser`/`orgTeam`/`teamCommittee`), `Value`
  (the target id). **Closed by default**: a Portal with zero grants is invisible to every org user,
  matching this codebase's defensive-default convention (root `CLAUDE.md` §1). Mirrors the Form
  Workflow gate vocabulary (`{kind, value}`) for consistency, in its own table since grants need
  their own CRUD UI unlike gates edited inline in a workflow graph.
  - `orgTeam` is this feature's stand-in for "business unit" — reuses the existing SCIM-synced
    `OrgTeam` entity directly rather than adding a new attribute to the SCIM User wire shape (no live
    SCIM→Portal sync exists or is needed; a grant just names the `OrgTeam`, and access is checked
    live against `OrgTeamMember` on every request).
  - `teamCommittee` reuses the existing per-project `TeamCommittee`/`TeamCommitteeMember` join —
    access is checked live against whether the user is a `ProjectMember` linked into that
    `TeamCommittee`.
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
5 fixed columns (`Trivial`, `Low`, `Medium`, `High`, `Critical`, left-to-right via `Column.Order`),
then inserts the `Portal` row referencing it. **.NET** wraps the whole sequence in one explicit
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
needed, unlike Author/Approval.

`FormSubmissionService.ApplyNextNodeAsync` (and its PHP twins' `applyNextNodeActions`) walk past any
consecutive `action` nodes on the way to the next real node, raising a Task in the target Portal's
actioner Project:
- **Column**: matched case-insensitively against `config.priorityColumn` ("trivial".."critical"),
  falling back to the lowest-`Order` column if the name doesn't match — never throws for a
  misconfigured value.
- **Assignee**: "assigned to the form's approver if known" — a `namedUser` `assigneeGate` always
  wins; otherwise the most recent `approved` trail entry's actor, or unassigned if none exists yet
  (e.g. an action node placed before any Approval node).
- **Title**: `config.titleTemplate` if set, else `"{FormName} — submission review"`.

**.NET** wraps the node-transition + task-raise + submission-save sequence in one explicit
transaction (same standing rule as Portal provisioning above). **PHP tiers deliberately don't** —
`TaskService::create()` already wraps itself in its own transaction and PDO has no native
nested-transaction support, so the Task row and the `FormSubmissions` UPDATE are each independently
atomic instead of one combined unit; an interruption between the two is a narrow, accepted edge case
given that constraint, not a silently-ignored gap.

Frontend: `features/form-workflow-engine.js`'s `computeNextNodeId` walks past action nodes too (pure,
UI-prediction only — it never executes anything itself, matching this module's own no-side-effects
doc comment). `views/form-workflow-editor.js` gets a 4th node type in its palette/popover (Portal
picker, priority column, assignee, title template) — `formWorkflowEditorState.portals`, loaded once
per editor session via the new `portalsApi.list()`.

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

## Known gaps / deliberately out of scope for this pass

- No cross-project `TeamCommittee` listing endpoint — the Access tab's `teamCommittee` grant kind
  takes a raw id rather than a picker.
- No "list every Portal I have access to" endpoint — the Browse nav entry prompts for a slug rather
  than showing a picker.
- Live curl-based cross-org isolation verification (two orgs, confirm a foreign/ungranted Portal
  404s identically to a nonexistent one) has not yet been run against a live stack — do this before
  considering the feature verified end-to-end, per root `CLAUDE.md`'s standing "live-verify
  security-sensitive changes" convention.
- `contract-tests/scenarios.js` has no Portals scenario yet.
- Containers have not yet been rebuilt/redeployed for this branch.
