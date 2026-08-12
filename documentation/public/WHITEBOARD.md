# Collaborative Whiteboard

Branch: `feature/collaborative-whiteboard`. Org-wide, real-time, no feature flag — any authenticated
org member can start or join a session. Built across all three backend tiers plus the frontend, in
the 8 phases described below (each phase left the app in a working, demoable state).

## Data model (all three tiers, same shape)

- **WhiteboardSession** — `Id`, `OrganisationId`, `HostUserId`, `JoinCode` (6-digit numeric, unique
  only among currently-**open** sessions, re-rolled on collision — not globally unique, same scoped-
  uniqueness convention as `Projects.Key`), `Title`, `Status` (`open`/`closed`, plain string, no
  CHECK constraint), `IsSaved`, `CreatedAt`, `ClosedAt`, `SavedAt`.
- **WhiteboardParticipant** — join/leave log; rows with `LeftAt IS NULL` are the "currently present"
  roster. Rejoining resets `LeftAt` to null on the existing row rather than inserting a new one.
- **WhiteboardElement** — one drawn object (pen stroke / shape / text box / connector).
  `ElementJson` is an opaque, server-unvalidated blob (same convention as `Form.FieldsJson`) — the
  frontend's drawing tools own interpreting the shape-specific payload entirely. Soft-deleted
  (`DeletedAt`), so "current board state" is always `WHERE DeletedAt IS NULL`.

Migrations: `.NET` `20260729083910_AddWhiteboardSessions`; `php-api`
`041_add_whiteboard_sessions.sql`; `mariadb-api` `022_add_whiteboard_sessions.sql`.

## "Scratch until saved" persistence model

While a session is **open**, its elements are durable (so a mid-session joiner or a reconnecting
participant always sees current state — this is a reliability requirement, not "saving"). If the
host closes the session **without** having clicked **Save** first, the session is eligible for
purge: `WhiteboardService`'s `CreateSessionAsync`/`createSession` opportunistically (1-in-20 chance
per call, same probability `RateLimitHits`/the MariaDB `Events` outbox already use) runs a bulk
delete of any session `WHERE Status='closed' AND IsSaved=false AND ClosedAt < now()-1h`.
`WhiteboardElement`/`WhiteboardParticipant` cascade-delete with their parent session (`ON DELETE
CASCADE` on every tier), so this is a single-statement sweep, not a fan-out. Clicking **Save**
(host-only, re-validated server-side against `HostUserId` — never a client-supplied flag) sets
`IsSaved=true`, making the session's content permanent.

## Backend endpoints (identical routes/contract across all 3 tiers)

`WhiteboardController`/`WhiteboardService`, `[Authorize]`-only (no `OrgAdmin`/`ProjectMember`
policy) — mirrors `ChatController`'s org-wide, no-extra-policy shape:

- `POST /api/whiteboard/sessions` — create + become host.
- `POST /api/whiteboard/sessions/join` `{joinCode}` — resolve code → session. Wrong code, a right
  code for a different org, and a closed session all return the identical 404 (no enumeration
  oracle). Creates/reactivates the caller's participant row; returns full current state (elements +
  roster) so a join/rejoin always renders the live board immediately.
- `GET /api/whiteboard/sessions/{id}` — resync (used after an SSE reconnect).
- `POST /api/whiteboard/sessions/{id}/elements` / `PATCH .../elements/{elementId}` /
  `DELETE .../elements/{elementId}` — add / update (move) / soft-delete (eraser). Caller must be a
  currently-present participant of an **open** session. `PATCH` takes `{elementJson}` and fully
  replaces the stored blob — same "server never interprets it" convention as `POST`'s own
  `elementJson`; the frontend computes the new (moved) JSON client-side via
  `whiteboard-draw.js`'s `translateElementData` before sending it.
- `POST /api/whiteboard/sessions/{id}/leave` — participant leaves; session keeps running.
- `POST /api/whiteboard/sessions/{id}/save` — host-only, flips `IsSaved`.
- `POST /api/whiteboard/sessions/{id}/close` — host-only, ends the session for everyone.
- `POST /api/whiteboard/sessions/{id}/cursor` — **`.NET`/`php-api` only, not `mariadb-api`** (see
  below). Ephemeral, no DB write at all — purely a broadcast.

## Real-time transport — reused, not reinvented

Five new SSE event names on each tier's existing broadcast mechanism (`.NET`'s in-memory
`SseBroadcaster`, `php-api`'s Postgres `LISTEN`/`NOTIFY`, `mariadb-api`'s polling `Events` outbox):
`whiteboard-participant-changed`, `whiteboard-element-changed`, `whiteboard-session-closed`, and
(`.NET`/`php-api` only) `whiteboard-cursor-moved`. `src/js/features/live-updates.js`'s
`dispatchEvent` routes all of them to handlers in `src/js/features/whiteboard.js`.
`whiteboard-element-changed`'s own `changeType` is `"added" | "updated" | "removed"` — `"updated"`
(the Select tool's move) reuses the exact same event shape as `"added"`, just with the element's new
`elementJson`; no new event name was needed for it.

**MariaDB tier deliberately has no live cursor sharing** — a documented trade-off, not a bug (see
`mariadb-api/CLAUDE.md` §4.10). That tier's whole SSE stream is a 2-second poll of the `Events`
table; a cursor position is inherently a high-frequency signal, and polling it at that cadence would
show cursors jumping in visible steps rather than moving smoothly — materially worse than the
feature simply not existing there. `whiteboardApi.cursorMove` 404s harmlessly against that tier's
router; `sendWhiteboardCursorMove` in `features/whiteboard.js` swallows the failure silently.
Drawing sync (elements/participants/session lifecycle) works identically on all three tiers — only
the mouse-cursor overlay is absent on a `mariadb-api`-served board.

## Deep-link joining

A join code isn't globally unique (scoped only to currently-open sessions), same shape of problem
Forms' own deep-link handling explicitly avoided by not reusing the task-key hashbang route. This
feature still uses a hashbang per explicit request: `#!/whiteboard/{code}`, parsed by
`parseWhiteboardCodeFromHash()` (`features/hash-router.js`) — checked **before** falling through to
task-key parsing, its own distinct prefix so the two never collide. `openWhiteboardFromHashIfPresent()`
(`modals/whiteboard.js`) joins directly by code — no project switch needed first, since this is an
org-wide feature, not a project one (unlike Forms' `findProjectByServerId` dance).

## Frontend structure

- `src/js/features/whiteboard.js` — session state, `whiteboardApi` calls, SSE handlers (mirrors
  `features/chat.js`'s role).
- `src/js/features/whiteboard-draw.js` — SVG element construction (`renderElementSvg`,
  `clientPointToSvgPoint`) — genuinely new freehand-path code (no prior freehand/path-accumulation
  code existed anywhere in the app). The connector tool reuses `views/dependency-map.js`'s
  `roundedOrthogonalPathD` and its dot-marker `<defs>` styling directly, per explicit request to
  match the workflow-designer/dependency-graph connector look — just fed a straight 2-point path
  (start/end of the user's drag) rather than dependency-map's own multi-column routing, since a
  whiteboard connector runs between two freely-placed points, not fixed board columns.
  `translateElementData(type, data, dx, dy)` is the one place that knows how to shift each
  element type's own elementJson shape by an (dx, dy) offset (pen/curve points, text x/y, connector
  x1/y1/x2/y2 + optional corner, shape-* x/y) — the Select tool's move handling is the only caller.

### Select tool (move shapes, single or multi)

`wbToolSelect` (`data-tool="select"`, reuses the `cursorArrow` icon already built for the remote-
cursor overlay) in `modals/whiteboard.js`: click an element to select it (dashed outline drawn into
`#wbSelectionLayer`, a plain sibling `<g>` after `#wbElementsLayer` in the canvas SVG); drag a
selected element to move it. **Shift-click toggles an element in/out of a multi-element selection**
(`_selectedElementIds`, an array, not a single id) instead of replacing it, so a run of shift-clicks
builds up a group; a plain (non-Shift) click on an element already part of that group keeps the
whole group selected and drags it together, while a plain click on an element outside the group (or
on empty canvas) collapses back to a single selection (or none). Each selected element gets its own
outline `<rect data-selection-for="{id}">`, sized from that element's own live `getBBox()` rather
than a per-type analytic bounding-box calculation — simpler, and the only way to get an accurate box
for `text` (whose rendered width isn't otherwise knowable without a DOM measurement). During the
drag, every selected element's own `<g>` **and** its own outline rect get the same plain SVG
`transform="translate(dx,dy)"` for live feedback (`getBBox()` reports an element's bounds in its own
local space, unaffected by its own `transform` — that's what makes reusing each element's pre-drag
bbox for its outline correct throughout the drag, even for a multi-element group where each element
started at a different position); the real `elementJson` mutations only happen once, on pointerup,
one `translateElementData` + `whiteboardApi.updateElement` (`PATCH .../elements/{id}`) call per
selected element, fired in parallel (`Promise.all`) then a single `renderWhiteboardState()` — each
persisted move broadcasts its own `whiteboard-element-changed` event with `changeType: "updated"` to
every other participant (so a 3-shape group move arrives to other tabs as 3 separate update events,
not one batched one — no batch/multi-element update endpoint exists). `handleWhiteboardElementEvent`
in `features/whiteboard.js` replaces the element in place by id, same shape as the existing
`"added"`/`"removed"` handling. Selection state is local/session-only, same as Grid/Snap — never
broadcast, never persisted; `renderSelectionOutline` drops any selected id whose element no longer
exists in the live DOM (removed locally, erased/moved-away by another participant, or a session/
project switch triggers a full re-render) rather than leaving a stale entry selected forever.
**Delete/Backspace erases the current selection** (`deleteSelectedElements` in the same file's
keydown handler, alongside the pre-existing Space-ends-curve binding) — one `removeWhiteboardElement`
call per selected id, same shape as `handleClearAllClicked`'s own bulk erase just scoped to the
selection, no confirmation dialog (same precedent as the Eraser tool's own single-click erase, which
this is functionally equivalent to for a multi-element group). Guarded on the Select tool being
active with a non-empty selection so it never fires from a stray Delete/Backspace elsewhere on the
page.
- `src/js/modals/whiteboard.js` — the modal: entry view (Start/Join) + canvas view (header toolbar +
  left rail — the first modal in this app with rail-based controls rather than header-row-only,
  per explicit design request), participant list, drawing-tool pointer handlers, remote-cursor
  rendering, Save/Export/Exit-or-Close wiring.
- `#whiteboardOverlay` in `src/index.html` — `.kf-modal.kf-modal-lg`, same shell as the Dependency
  Map/Org Chart overlays. Export reuses `features/svg-export.js`'s `exportSvgElementAsSvgFile`
  unchanged, wired via the same `.kf-export-as-wrap`/`.kf-export-as-panel` pattern ~13 other overlays
  already use.
- `WHITEBOARD_PALETTE` (16 colours) and drawing-tool defaults live in `src/js/config.js` — no
  existing swatch-grid picker or suitable palette constant existed before this (`MEMBER_PALETTE` only
  has 10 colours and is used programmatically, never rendered as a picker).
- Entry point: a new `navWhiteboardBtn` side-nav item (Tools section), gated only on
  `isServerLoggedIn()` — org-wide, not per-project, so it doesn't key off any project setting the
  way most other nav items do (see `applyHeaderButtonVisibility` in `views/board.js`).

## Standalone tool variant (`enklr.app/tools/whiteboard`, added 2026-08-12)

A genuinely separate page, **not** this feature — no login, no `WhiteboardSession`/backend of any
kind, no SSE/broadcast to other participants. Exists for the "just want a quick local sketchpad, no
account needed" case, sitting alongside (not replacing) the collaborative in-app version documented
above.

- `src/tools/whiteboard/index.html` + `src/tools/whiteboard/app.js`, built by a **third**,
  independent build script — `build-whiteboard-tool.js` — into a single self-contained
  `dist/tools/whiteboard/index.html`, same "inline CSS + JS, one portable file" shape as the main
  app's own `build.js` (see CLAUDE.md §2's repo layout — this is a sibling to `build.js`/
  `build-help-site.js`, run manually, output committed).
- **Reuses `features/whiteboard-draw.js`'s pure SVG-construction exports directly** (`renderElementsLayer`,
  `clientPointToSvgPoint`, `computeConnectorCorner`, `connectorCurvePathD`, `smoothPathD`,
  `translateElementData`), plus `views/dependency-map.js`'s `roundedOrthogonalPathD`/
  `DEPMAP_CORNER_RADIUS` for connector routing (already a transitive dependency of the file above) —
  the same drawing engine, not a reimplementation. What's genuinely rewritten is everything
  `features/whiteboard.js` (session/API/SSE state) and most of `modals/whiteboard.js` (participants,
  Start/Join entry view, Save/Exit-session, remote cursors) used to own — replaced with a plain
  in-memory `_elements` array persisted synchronously to this browser's own
  `localStorage['enklr_standalone_whiteboard_v1']` on every mutation, so there is no "unsaved
  changes" state to warn about on close the way the in-app version has.
- Renders as `.kf-overlay.kf-overlay-full > .kf-modal.kf-modal-full` — the same fullscreen shell
  PORTALS.md's own end-user Portal home page uses (no backdrop-dismiss, since this page **is** the
  whole browser tab) — rather than the in-app feature's `.kf-modal-lg` floating-modal shell. No
  entry/join view, no left rail (nothing to put there with no session/participants) — canvas view is
  shown immediately; `.kf-wb-body`'s CSS gained a `justify-content: center` rule to center the
  canvas now that there's no rail beside it (a no-op for the in-app version, whose modal width is
  already JS-fitted to content).
- Routed via nginx **before** the SPA catch-all, same pattern as `/help/`: `web/nginx.conf`'s
  `location /tools/whiteboard`. **PROD's `nginx-active.conf` is a separately hand-maintained,
  bind-mounted copy** (see `DEPLOYMENT-AWS-DETAILS.md` §7) — this required a manual, matching edit
  there too, in both app-serving server blocks, not just a `web/nginx.conf` change + image rebuild.
- No jsdom coverage (same "real pointer/drag semantics jsdom can't exercise" reasoning as the in-app
  feature above) — verified via a local `docker compose` smoke test (redirect/200/title/no-network-
  calls) and a live PROD curl pass after deploy; see `RELEASE-NOTES-PRIVATE.md`'s 2026-08-12 entry
  for the full verification list.

## Known gaps / deferred (not done in this pass)

- No jsdom black-box test coverage was added — this feature is real-time, canvas/pointer-driven, and
  cross-tab by nature, the same category of feature `views/board.js`'s own diffing postmortems
  (CLAUDE.md §6) found jsdom fundamentally can't exercise (no real drag/pointer-capture semantics,
  no multi-connection SSE simulation). A future pass adding coverage should budget for real-browser
  (Playwright) testing across multiple tabs, matching that postmortem's own "verify live" precedent,
  rather than assuming a jsdom suite can cover the interesting behavior here.
- No live curl/DB/multi-tab verification was performed as part of this build — the standard
  "actually create two orgs, actually watch it happen" verification pass this codebase's CLAUDE.md
  calls for elsewhere is still outstanding before this branch should be considered production-ready.
- Containers were not rebuilt/redeployed as part of this pass.
