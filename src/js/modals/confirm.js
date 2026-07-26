"use strict";

var pendingConfirmAction = null;
// Optional — only fires from the dialog's own labeled Cancel button (see app.js), never from the X
// close button or an outside click, both of which stay a pure no-op abort for every existing caller
// (neither passes this 4th arg). Added for Advanced Query's "New" button, where the two dialog
// buttons mean "Save first" / "Discard" rather than the usual "Confirm" / "back out entirely".
var pendingCancelAction = null;

// `showIgnore` reveals a third button (#confirmIgnoreBtn) alongside Confirm/Cancel — always a pure
// no-op close, same as the X button/outside-click, just an explicitly labeled one for a dialog
// whose Confirm/Cancel both actively change something (views/timeline.js's drag conflict dialogs),
// where a user who wants neither still needs a button to say so rather than only an implicit close.
export function confirmDialog(title, message, onConfirm, onCancel, showIgnore){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  pendingConfirmAction = onConfirm;
  pendingCancelAction = onCancel || null;
  document.getElementById('confirmIgnoreBtn').classList.toggle('hidden', !showIgnore);
  document.getElementById('confirmOverlay').classList.remove('hidden');
}
export function closeConfirmDialog(){
  document.getElementById('confirmOverlay').classList.add('hidden');
  document.getElementById('confirmIgnoreBtn').classList.add('hidden');
  pendingConfirmAction = null;
  pendingCancelAction = null;
}
export function getPendingConfirmAction(){
  return pendingConfirmAction;
}
export function getPendingCancelAction(){
  return pendingCancelAction;
}
