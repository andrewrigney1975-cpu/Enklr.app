"use strict";

/* =========================================================
   BOARD LAYOUT — the 2560px+ widescreen Task-modal-docking logic, extracted from board.js
   (ARCHITECTURE-REVIEW.md finding #4, option 1: pure file split, zero behavior change — see
   CLAUDE.md for the two other approaches that were tried and reverted before this one). Genuinely
   unrelated to rendering or filtering: no imports needed at all, purely window/DOM geometry.
   ========================================================= */

export var WIDESCREEN_TASK_DOCK_QUERY = '(min-width: 2560px)';

/* Below the 2560px breakpoint a right-docked panel (the Task modal, or Chat's own pinned mode —
   see views/chat.js) is a centered/floating element sitting ON TOP of the board — the board
   underneath needs no changes at all. At 2560px+ it instead docks flush to the right as a
   full-height panel that shares the screen with the board. Everything above it needs to narrow in
   lockstep for this to read as a reveal rather than a broken layout: the header (a full-width
   sibling of the side nav/board, not a descendant of either) and .kf-main-content (the flex column
   holding BOTH toolbar rows and .kf-board-wrap — narrowing board-wrap alone left the toolbars
   stranded at their old full width, floating over/past the docked panel). Both are narrowed to end
   flush at the panel's own left edge — an instant resize, not animated. Measured live via
   getBoundingClientRect() rather than a fixed calc() specifically because .kf-main-content sits
   after the collapsible side nav (56px collapsed / 220px expanded) — a static CSS calc() has no way
   to know which state that's currently in, but a live measurement of .kf-main-content's own current
   left edge already reflects it automatically.

   Shared by both dock consumers below (fitBoardForTaskModal / fitBoardForChatPinned) since they claim
   the identical 700px-wide, full-height, flush-right geometry and — by construction, see chat.js's
   computeChatUiState — are never both active at once. Two real, only-visible-in-a-real-browser bugs
   were found and fixed here (jsdom runs neither CSS transitions nor real layout, so no test caught
   either):
     1. The docked panel's own CSS must never animate its position/size (see the `transition: none`
        on .kf-chat-panel.kf-chat-fullscreen/.kf-chat-pinned in styles.css) — measuring
        getBoundingClientRect() here can otherwise land mid-transition and compute a stale width that
        only self-corrects once some unrelated later re-render happens to fire after the animation
        actually finishes.
     2. Because both consumers write to the SAME inline styles, whichever one's "restore" call fires
        last wins — chat's own restore (fired reactively, from board-layout's own kf-task-dock-changed
        event) must not blindly clear these styles the instant a Task claims the dock, or it wipes out
        the Task's own narrowing that was just applied a moment earlier in the very same event. See
        the guard in restoreBoardAfterChatPinned below. */
function narrowBoardForDockedPanel(panelEl){
  var header = document.querySelector('.kf-header');
  var mainContent = document.querySelector('.kf-main-content');
  if(!header || !mainContent || !panelEl) return;

  var headerRect = header.getBoundingClientRect();
  var mainContentRect = mainContent.getBoundingClientRect();
  var panelRect = panelEl.getBoundingClientRect();

  // Each narrowed to its OWN available space up to the panel's left edge — the header starts at the
  // true left edge of the page, while .kf-main-content starts after the side nav, so they need
  // different target widths to end up flush with each other above/beside the same docked panel.
  var headerWidth = Math.max(200, Math.round(panelRect.left - headerRect.left));
  var mainContentWidth = Math.max(200, Math.round(panelRect.left - mainContentRect.left));
  header.style.width = headerWidth + 'px';
  mainContent.style.flexGrow = '0';
  mainContent.style.flexShrink = '0';
  mainContent.style.flexBasis = mainContentWidth + 'px';
}

function clearBoardInlineSizing(){
  var header = document.querySelector('.kf-header');
  var mainContent = document.querySelector('.kf-main-content');
  if(header) header.style.width = '';
  if(mainContent){
    mainContent.style.flexGrow = '';
    mainContent.style.flexShrink = '';
    mainContent.style.flexBasis = '';
  }
}

/* (This used to also scroll the board to center the task's own column, but that turned out to be
   an annoying surprise in practice — reopening a task shouldn't yank the board's scroll position —
   so it was removed; only the width narrowing remains.) */
export function fitBoardForTaskModal(){
  if(!window.matchMedia || !window.matchMedia(WIDESCREEN_TASK_DOCK_QUERY).matches) return;
  var modalEl = document.querySelector('#taskOverlay .kf-modal');
  if(!modalEl) return;
  narrowBoardForDockedPanel(modalEl);

  // The chat bubble/panel are position:fixed (viewport-anchored, so they never drift when the board
  // itself scrolls horizontally — see styles.css's .kf-chat-bubble/.kf-chat-panel) rather than layout
  // participants of .kf-main-content, so they don't narrow "for free" the way the header/board do
  // above — this class is what actually moves them left, clear of the docked panel's own 700px width.
  // Chat's own pinned-right mode claims that exact same slot, so it listens for this event to shrink
  // itself back to normal size the instant a Task claims the dock, and to re-expand once it's freed
  // again — done via a plain DOM event rather than an import specifically to keep this file
  // import-free (see its own top-of-file note). Deliberately NOT reused for Chat's own pinned mode
  // (see fitBoardForChatPinned below) — this class specifically means "a Task is docked," both to
  // that shift-left rule and to chat.js's own computeChatUiState() check; reusing it there would make
  // chat think a Task had claimed the dock the moment chat claimed it itself.
  document.body.classList.add('kf-task-panel-docked');
  window.dispatchEvent(new Event('kf-task-dock-changed'));
}

/* Undoes fitBoardForTaskModal's inline sizing once the Task modal closes, handing the board back to
   its normal CSS-driven flex:1 width. Harmless no-op if the modal never actually docked (below the
   breakpoint, or fitBoardForTaskModal was never called this session). */
export function restoreBoardAfterTaskModal(){
  clearBoardInlineSizing();
  document.body.classList.remove('kf-task-panel-docked');
  window.dispatchEvent(new Event('kf-task-dock-changed'));
}

/* Called from app.js's window resize handler so dragging the browser across the 2560px threshold —
   or just resizing while already past it — keeps the board correctly narrowed/widened without
   requiring the Task modal to be closed and reopened. A no-op whenever the modal isn't currently
   open. */
export function refitBoardForOpenTaskModal(){
  var overlay = document.getElementById('taskOverlay');
  if(!overlay || overlay.classList.contains('hidden')) return;
  if(!window.matchMedia || !window.matchMedia(WIDESCREEN_TASK_DOCK_QUERY).matches){
    restoreBoardAfterTaskModal();
    return;
  }
  fitBoardForTaskModal();
}

/* Chat's own pinned-right mode (views/chat.js's chatUiState === 'pinned') claims the identical dock
   slot the Task modal does, so it needs the same header/main-content narrowing — but deliberately
   does NOT touch kf-task-panel-docked (see fitBoardForTaskModal's own note on why). Chat decides for
   itself, on every render, whether it's currently pinned and calls the matching one of these two —
   no body class is needed for that decision since chat.js already tracks it in chatUiState. */
export function fitBoardForChatPinned(){
  if(!window.matchMedia || !window.matchMedia(WIDESCREEN_TASK_DOCK_QUERY).matches) return;
  var panelEl = document.getElementById('chatPanel');
  if(!panelEl) return;
  narrowBoardForDockedPanel(panelEl);
}

export function restoreBoardAfterChatPinned(){
  // A Task claiming the dock (kf-task-panel-docked) already re-narrowed these same shared inline
  // styles for ITSELF, just before dispatching the event that leads here (see the note atop this
  // file) — clearing them now would wipe out the Task's own narrowing the instant it opens. Only
  // clear if the dock is genuinely free, i.e. nothing else still needs this narrowing.
  if(document.body.classList.contains('kf-task-panel-docked')) return;
  clearBoardInlineSizing();
}
