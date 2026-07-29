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
- `POST /api/whiteboard/sessions/{id}/elements` / `DELETE .../elements/{elementId}` — add / soft-
  delete (eraser). Caller must be a currently-present participant of an **open** session.
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
