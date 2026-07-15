# Test Remediation

This document records the investigation and fixes carried out on branch `test-remediation` for
every test in `tests/` that was failing deterministically (i.e. reproducibly in isolation, not
just under the batch runner's sequential system load — see "Out of scope" at the bottom).

Starting point: `node run_all_tests.js` reported **90 failures across 15 files** (plus a further
set of files that only ever failed inside the full sequential sweep and passed 3/3 when re-run
alone — those are batch flakes, not covered here). Ending point: **2093 pass, 0 fail** across all
93 test files in a single clean run.

Two root causes account for the large majority of individual assertion failures, repeated across
many files:

- **The minified-CSS literal-string-search bug**: `build.js` bundles the app through esbuild,
  which minifies the inlined `<style>` block (strips whitespace, merges rules with identical
  bodies into comma-separated selector lists, drops leading zeros and trailing semicolons,
  normalizes quote style). Several tests were written assuming the CSS would appear close to its
  original, human-authored form and used plain string literals like
  `style.indexOf('@media (max-width: 1024px)')` — these silently return `-1` against the minified
  output, and in a few places that `-1` then fed into further `indexOf`/`slice` calls, corrupting
  downstream logic rather than failing loudly.
- **Stale expectations after legitimate product evolution**: several UI copy strings, CSS class
  names, and nav-menu item groupings changed intentionally as the app grew (App Settings modal
  redesign, Governance Map added to the side nav, Workflow moved from "Views" to "Tools", the
  "Enkl" → "Enkl Task" rename, a major version bump, etc.), and the tests that pinned exact old
  values were never updated to match.

---

## 1. `hidden_class_css_backing_test.js`

**Purpose:** Scans every element in the bundled `dist/index.html` that carries (statically or via
JS `classList.toggle`) a `hidden` class, and verifies a matching CSS rule actually exists to back
it — i.e. that toggling `hidden` really hides the element, rather than silently doing nothing
because no selector targets it.

**Root cause:** Two distinct causes, affecting 34 reported failures:
1. **(Test bug, ~28 of the 34)** The rule-matching regex required a `.hidden` selector to be
   *immediately* followed by `{`. esbuild's CSS minifier merges separate source rules that happen
   to share an identical body (`display:none`) into one big comma-separated selector list, e.g.
   `#a.hidden,#b.hidden,#c.hidden{display:none}` — so every selector except the last in such a
   group is actually followed by `,`, not `{`, producing a false "no rule found" for elements that
   were correctly backed all along.
2. **(Real product bug, 6 of the 34)** Six elements genuinely had no CSS rule backing their
   `hidden` toggle at all, matching this codebase's own documented recurring gotcha (no generic
   `.hidden { display:none }` utility exists — every component needs its own compound/ID selector):
   `serverLoginSsoBtn`, `ssoScimTokenReveal`, `projectTemplateField`, `workflowSaveBtn`,
   `newMemberEmailInput`, `principlesTabStrip`. Confirmed live-impact for two of them by tracing
   their JS: `principlesTabStrip` is supposed to hide the Library tab for local-only projects
   (`principles.js`), and `newMemberEmailInput` is supposed to hide the email field for local-only
   team members (`team.js`) — both were permanently visible regardless of the toggle.

**Remediation:**
- Test: rewrote `hasMatchingRule()`'s regexes to accept either `,` or `{` as the selector's
  terminator, correctly handling merged selector groups.
- Product (`src/css/styles.css`): added the 6 missing `#id.hidden { display: none; }` rules to the
  existing consolidated block of ID-scoped hidden rules.

---

## 2. `app_settings_test.js`

**Purpose:** Verifies the App Settings gear button's placement/labeling in the header, its mobile
responsive behavior, and that the App Settings modal opens with the correct heading/description.

**Root cause:** Three unrelated issues:
1. The mobile-media-query literal-string search bug (see intro).
2. `themeToggleBtn`/`appSettingsBtn` are nested inside a `#headerUtilityGroup` sub-wrapper that was
   introduced by a later header refactor — the test checked `#headerControls`'s direct children,
   which no longer contains these buttons at all (always reporting `-1`/`-1`).
3. The App Settings modal's heading/description copy was intentionally rewritten from "Extended
   Project Modules" / "Choose which modules should be used in this Project" to "App and Project
   Settings" / "Choose which modules are switched on for this project." — the test still checked
   for the old strings.

**Remediation:** Fixed the media-query match to a tolerant regex; changed the sibling-check to use
`#headerUtilityGroup` instead of `#headerControls`; updated the expected heading/description
strings to the current, intentional copy.

---

## 3. `app_version_test.js`

**Purpose:** Verifies `APP_VERSION`'s format (`major.minor.yyyymmdd.hhmm`), that it's correctly
included in exported documents, and that importing a file with a spoofed/future version neither
blocks the import nor pollutes local state.

**Root cause:** Two issues:
1. esbuild's JS minifier renames module-scoped variables during bundling — `APP_VERSION` becomes an
   unpredictable short symbol (observed as `fo` in one build), and the declaration switches from
   `var APP_VERSION = '...'` to `var fo="...";` (double quotes, no spaces). A literal
   `html.match(/var APP_VERSION = '([^']+)'/)` can never match this, in this build or any future
   one — the renamed symbol isn't stable to pin to.
2. A `parts[0] === '1'` assertion pinned the major version to exactly `1` forever — the app's major
   version has since legitimately bumped to `2` (visible throughout this session's own version
   stamps), so the check was really testing "was 1 at the time this test was written," not anything
   meaningful going forward.

**Remediation:** Stopped trying to regex the minified source entirely — instead read `APP_VERSION`
from the *behavior* of the running app (the `appVersion` field of a real export triggered via
`exportBtn`), which is robust to whatever the minifier names the underlying variable. Applied the
same fix to the later "app's own version is unaffected by import" check, which had the exact same
problem plus a redundant one (it was re-matching the static `html` string, which never changes
during the test regardless of any import). Changed the major-version check to assert "a valid
positive integer" instead of "exactly 1."

---

## 4. `default_score_alert_test.js`

**Purpose:** Verifies the "you have unscored tasks" alert's message grammar is correct for a
singular task count.

**Root cause:** Stale wording expectation — the test checked for the contracted `"hasn't been
scored"`, but the current, intentional copy in `features/session-alerts.js` uses the full form,
`"has not been scored"` (with `"have not"` for the plural case) — both are grammatically correct;
the copy was just never contracted this way, or was changed since.

**Remediation:** Updated the expected substring to `"has not been scored"`, keeping the assertion's
real purpose (singular subject-verb agreement) intact.

---

## 5. `depmap_marker_opacity_test.js`

**Purpose:** Verifies the Dependency Map's node opacity CSS variable and arrow marker geometry.

**Root cause:** esbuild's CSS minifier strips a leading `0` before a decimal point (`0.8` → `.8`,
numerically and functionally identical) — the test's regex required the literal leading zero.

**Remediation:** Made the leading zero optional in the regex (`0?\.8`).

---

## 6. `drawer_spacing_test.js`

**Purpose:** Verifies the mobile drawer's "New Project" action group spacing matches the
project-picker's spacing, and that both correctly switch to a vertical column layout on mobile.

**Root cause:** The media-query literal-string search bug — and because `style.indexOf(...)`
silently returned `-1`, the subsequent `style.slice(-1)` returned just the stylesheet's *last
character* (not "nothing"), which is why all 4 downstream CSS checks failed at once from this one
cause.

**Remediation:** Same tolerant-regex fix as elsewhere.

---

## 7. `font_weight_test.js`

**Purpose:** Verifies a historical font-weight standardization pass (moving most bold text from
600/700 to 500, with `.kf-board-title` as a deliberate exception) is still intact.

**Root cause:** Stale test premise. The test asserted "exactly one `font-weight:600` remains in the
whole stylesheet" — a one-time snapshot proving that specific cleanup had succeeded, not a
sustainable ongoing rule. The stylesheet now has 19 occurrences, but 18 of them are legitimate,
unrelated uses added by later, independent features (e.g. Org Admin user-row name styling) that
have nothing to do with the original cleanup's scope.

**Remediation:** Removed the blanket "exactly one" assertion. What actually matters — that the
*specific* selectors the historical cleanup touched are still correctly at 500, not regressed back
to 600/700 — is already covered by the test's other, more targeted per-selector checks, which were
left unchanged.

---

## 8. `header_more_menu_test.js`

**Purpose:** Verifies the header's "More…" consolidation menu (when 3+ optional modules are
enabled) and its App-Settings ordering/mobile behavior.

**Root cause:** Two issues:
1. The media-query literal-string search bug (affecting 4 of the 5 failures).
2. The App Settings modal was restructured into categorized `.kf-setting-row` rows at some point —
   the test still queried the old `.kf-risk-doc-picker-row` class, which no longer exists anywhere.

**Remediation:** Tolerant media-query regex (plus a trailing-semicolon-optional fix for the
`.kf-header-consolidated{display:none}` check, since the minifier also drops a rule's only
declaration's trailing semicolon); updated the selector to `.kf-setting-row`.

---

## 9. `health_button_rename_test.js`

**Purpose:** Verifies the Health Dashboard button's icon/label after a rename, and that its
App Settings row appears in the correct position relative to the other module toggles.

**Root cause:** Same stale `.kf-risk-doc-picker-row` → `.kf-setting-row` class rename as
`header_more_menu_test.js`.

**Remediation:** Updated the selector to `.kf-setting-row`.

---

## 10. `mobile_menu_layout_test.js`

**Purpose:** Verifies the mobile drawer's movable-nav-group column layout, border removal on
relocated view/tools buttons, and consistent padding across button types.

**Root cause:** The media-query literal-string search bug — again, the silent `-1` corrupted
`mobileBlock` (via `style.slice(-1)`), breaking all 8 downstream checks from one root cause.

**Remediation:** Same tolerant-regex fix.

---

## 11. `private_task_test.js`

**Purpose:** End-to-end private/encrypted task flow — setting a key, wrong-key rejection,
unlocking, and the reduced ("continue without a key") view.

**Root cause:** Test bug — checked whether the Save button had class `hidden`, but
`showTaskFullFields()` (`modals/task.js`) actually toggles a *different*, purpose-specific utility
class, `kf-vis-hidden` (`display:none !important`), for this exact element. The plain `hidden`
class was never applied to this button at all, so the check failed regardless of the button's
actual (correct) visibility.

**Remediation:** Changed the check to look for `kf-vis-hidden`, matching what the code actually
does.

*(Note: this file is also subject to a separate, pre-existing, purely environmental flake — its
"matching key"/"wrong key" steps depend on a real WebCrypto key-derivation operation completing
within a fixed `wait(600)`, which can occasionally run long under heavy system load. That flake is
unrelated to the fix above and is not something a test-code change can eliminate — see "Out of
scope.")*

---

## 12. `projects_dropdown_test.js`

**Purpose:** Verifies the desktop "Projects…" dropdown's contents and behavior, and its responsive
show/hide behavior relative to the original 3 standalone project-action buttons.

**Root cause:** Four issues:
1. The media-query literal-string search bug.
2. Stale "exactly 3 links" assumption — the panel legitimately grew to 5 entries after "Migrate to
   Server" and "Save as Template…" were added later.
3. The same merged-selector-list issue as `hidden_class_css_backing_test.js`, applied to
   `.kf-header-nav-projectaction{display:none}`: the minifier merged it into a much larger
   comma-separated group (`.kf-header-nav-projectaction,.kf-drawer-section-label,...{display:none}`),
   so `display:none` no longer sits immediately after this specific selector.
4. A `.kf-projects-menu-wrap` class the test assumed exists but never did — the actual wrapper
   (`#projectsMenuWrap`) uses a shared, generic class, `.kf-desktop-menu-wrap` (also used by the
   Account menu), not a dedicated one.

**Remediation:** Tolerant media-query regex; updated the expected link count/list to the current 5
items; rewrote the rule-matching logic to locate a selector's *own* rule body (from wherever its
real opening brace turns out to be, to the next closing brace) instead of assuming the selector is
immediately followed by its properties; corrected the class name to `.kf-desktop-menu-wrap`.

---

## 13. `rebrand_test.js`

**Purpose:** Verifies the app's branding (tab title, header logo), that no legacy brand name
remnants exist, that internal storage keys stayed backward-compatible, and that the Inter font is
correctly loaded and applied.

**Root cause:** Three unrelated issues:
1. The tab title/header logo were intentionally renamed from `"Enkl"` to `"Enkl Task"` after this
   test was written.
2. Same JS-minifier variable-renaming issue as `app_version_test.js`: `STORAGE_KEY`/
   `THEME_STORAGE_KEY` become unpredictable short symbols in the minified bundle, so a literal
   `"STORAGE_KEY = '...'"` search can never match.
3. esbuild's CSS minifier normalizes quote style — the source's `--kf-font: 'Inter', ...` (single
   quotes) becomes `--kf-font: "Inter", ...` (double quotes) in the bundle; both are identical,
   valid CSS, but the test's check was quote-specific.

**Remediation:** Updated the expected title/logo text to `"Enkl Task"`. Replaced the storage-key
checks with checks against the *running app's actual localStorage behavior* (confirming the seeded
data loads under `kanbanflow_v1_db`, and that clicking the real `themeToggleBtn` persists under
`kanbanflow_theme`) rather than grepping minified variable names. Made the font-family quote check
accept either quote character.

---

## 14. `side_nav_test.js`

**Purpose:** Verifies the collapsible side navigation's structure, sections, item ordering, and
responsive (mobile-hides, desktop-shows) CSS.

**Root cause:** Three issues:
1. The media-query literal-string search bug — with more severe knock-on effects here than
   elsewhere: the same broken index fed into a *brace-depth-counting* loop meant to find the
   media query's matching closing brace, and then into `.slice()` calls with a negative start
   index (which counts from the *end* of the string in JS). The net effect was a `mediaBlock` that
   ended up empty and a `beforeMedia` that ended up a near-duplicate of almost the entire
   stylesheet — silently, rather than throwing — which is why only some (not all) of the
   CSS-dependent checks in this file failed.
2. Stale nav-item-order expectations: "Workflow" moved out of the "Views" section into "Tools"
   (with "Governance Map" added to Views in its old spot), and "To-Do", "Portfolio Planner", and
   "Retrospectives" were added to "Tools" — all since this test's expected lists were written.
3. The same merged-selector-list issue as elsewhere, in this file's own `ruleFor()` helper.

**Remediation:** Tolerant media-query regex; updated the expected Views/Tools item lists to the
current, correct ordering; rewrote `ruleFor()` to locate a selector's actual rule body (real opening
brace to matching close) instead of assuming immediate adjacency, fixing every call site in the
file at once.

---

## 15. `view_buttons_relocation_test.js`

**Purpose:** Verifies the toolbar's "Views"/"Tools" button groups correctly relocate between the
desktop toolbar rows and the mobile drawer sections, in both directions, across a resize.

**Root cause:** The same stale grouping issue as `side_nav_test.js`, applied to the toolbar/drawer
relocation feature: `workflowBtn` moved from the Views group to the Tools group, `governanceMapBtn`
was added to Views, and `todoBtn` was added to Tools.

**Remediation:** Updated the `VIEWS_BTN_IDS`/`TOOLS_BTN_IDS` constants (and the matching descriptive
log-label strings) to the current, correct groupings.

---

## Out of scope: environmental batch flakiness

A separate set of test files (`app_icon_square_design_test.js`, `archived_test.js`,
`bulk_edit_release_test.js`, `bulk_edit_task_type_test.js`, `costbenefit_archive_size_test.js`,
`css_source_order_test.js`, `depmap_archive_toggle_test.js`, `task_type_icon_picker_floating_test.js`,
`team_member_role_test.js`, and occasionally others, `timeline_test.js` included) intermittently
crash or fail **only** when run as part of the full ~93-file sequential sweep, and pass cleanly
every time when re-run individually (confirmed 3× each in isolation during this investigation).
`run_all_tests.js` runs each file as its own `spawnSync` child process, one at a time (not in
parallel) — the instability is a real characteristic of this Windows dev environment under the
cumulative load of ~90 back-to-back Node/jsdom process spawns (matching an already-documented
pattern of occasional Node.js-internal crashes under sustained load), not a deterministic bug in any
specific test or the app itself. There is no code-level root cause to fix for these; they were
deliberately left out of scope rather than papering over them with retry logic that could mask a
future, genuine regression.
