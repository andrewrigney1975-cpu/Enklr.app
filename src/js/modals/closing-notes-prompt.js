"use strict";

/* A small, optional, skippable prompt shown the moment a Task linked to a raised Form submission
   (FormSubmission.RaisedTaskId) is moved into a Done column — lets the assignee transcribe a
   closing summary straight onto the submission (FormSubmissionService.ResumeIfLinkedTaskDoneAsync's
   ClosingNotes param), without forcing them through it. Promise-based rather than the plain
   callback shape modals/confirm.js uses, since every caller here is already inside an async
   column-move flow and just wants to `await` a string-or-null result before continuing. Same static-
   overlay + pending-callback wiring convention as confirm.js otherwise (app.js wires the actual
   button clicks). */

var pendingResolve = null;

export function promptFormClosingNotes(){
  return new Promise(function(resolve){
    document.getElementById('closingNotesPromptInput').value = '';
    pendingResolve = resolve;
    document.getElementById('closingNotesPromptOverlay').classList.remove('hidden');
  });
}

function resolveAndClose(result){
  document.getElementById('closingNotesPromptOverlay').classList.add('hidden');
  var resolve = pendingResolve;
  pendingResolve = null;
  if(resolve) resolve(result);
}

// Skip, the X button, and an outside click are all the same "proceed with no notes" outcome — the
// column move itself is never blocked by this prompt either way.
export function skipFormClosingNotesPrompt(){ resolveAndClose(null); }

export function saveFormClosingNotesPrompt(){
  var value = document.getElementById('closingNotesPromptInput').value.trim();
  resolveAndClose(value || null);
}
