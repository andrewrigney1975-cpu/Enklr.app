"use strict";
import { toast } from '../ui.js';
import { escapeHTML } from '../views/board.js';
import { formsApi, projectFormsApi, isOrgAdmin, isProjectAdmin } from '../api.js';
import { confirmDialog } from './confirm.js';
import { renderAnswerInputHTML, renderAnswerReadOnlyHTML, collectAllAnswers, findMissingRequiredFields } from '../features/form-answers.js';
import { canUserStartForm } from '../features/form-workflow-engine.js';
import { getCurrentProject } from '../store.js';
import { utcISOToLocalDisplayDateTime } from '../date-utils.js';

/* Enterprise Forms & Workflow — member-facing fill-out UI (Phase 5). Two overlays:
   #formsFilloutOverlay (picker: Available Forms to start / My Submissions / Awaiting My Action) and
   #formFilloutDetailOverlay (one submission's own fields, read/write depending on context, plus its
   Approval Trail once it has left Draft status). Unlike modals/forms-admin.js's builder, there's no
   in-memory-edit-then-single-PUT flow here — every button (Save Draft/Submit/Approve/Reject/Delete
   Draft) is its own immediate API call, since each represents a real state transition a project
   member is deliberately choosing to make, not a batch of edits to stage.

   detail.mode:
     'new'     — a fresh submission not yet created, fields editable, Save Draft/Submit shown.
     'draft'   — the caller's own existing Draft, fields editable (pre-filled), same buttons + Delete.
     'approve' — an Awaiting-My-Action item, fields READ-ONLY, Approve/Reject + trail shown.
     'view'    — anything else (a submitted/approved/rejected submission, or someone else's Draft
                 reached via a future notification link) — fields READ-ONLY, trail shown, no actions. */

var _toast = toast;

var projectId = null;
var publishedForms = [];
var mySubmissions = [];
var awaitingMe = [];
var detail = null; // {mode, form, fields, submissionId, submission}

var STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', inProgress: 'In Progress',
  approved: 'Approved', rejected: 'Rejected', completed: 'Completed', cancelled: 'Cancelled'
};

function parseFieldsJson(json){
  if(!json) return [];
  try { var parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed : []; }
  catch(e){ return []; }
}
function parseAnswersJson(json){
  if(!json) return {};
  try { var parsed = JSON.parse(json); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch(e){ return {}; }
}
function parseTrailJson(json){
  if(!json) return [];
  try { var parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed : []; }
  catch(e){ return []; }
}

// ---- Picker ----

export function openFormsFilloutOverlay(){
  var project = getCurrentProject();
  if(!project || !project.serverProjectId){ _toast('This project has no server connection.'); return; }
  projectId = project.serverProjectId;
  document.getElementById('formsFilloutOverlay').classList.remove('hidden');
  loadAndRenderFilloutPicker();
}
export function closeFormsFilloutOverlay(){
  document.getElementById('formsFilloutOverlay').classList.add('hidden');
}

function loadAndRenderFilloutPicker(){
  Promise.all([
    projectFormsApi.listPublished(projectId),
    projectFormsApi.listMySubmissions(projectId),
    projectFormsApi.listAwaitingMyAction(projectId)
  ]).then(function(results){
    // FormService.ListPublishedAsync itself is deliberately org-wide (its own doc comment: "the
    // per-project gate is purely the Forms App Setting, not a per-form per-project opt-in") — this
    // is the actual per-user filter on top of that: only forms whose own workflow Author gates this
    // specific user actually satisfies, using the identical Start->Author-node walk
    // FormSubmissionService.SubmitAsync performs server-side, so nothing shown here as "available"
    // could ever be rejected by the server on submit for a gate reason. A form with no workflow
    // configured yet, or whose Start doesn't lead to a real Author node, can't be started by anyone
    // and is filtered out the same way.
    var actingUser = {isOrgAdmin: isOrgAdmin(), isProjectAdmin: isProjectAdmin(projectId), isProjectMember: true};
    publishedForms = (results[0] || []).filter(function(f){ return canUserStartForm(f, actingUser); });
    mySubmissions = results[1] || [];
    awaitingMe = results[2] || [];
    renderFilloutPicker();
  }, function(e){
    _toast('Could not load forms: ' + (e.message || 'unknown error'));
  });
}

function renderFilloutPicker(){
  var awaitingSection = document.getElementById('formsFilloutAwaitingSection');
  awaitingSection.classList.toggle('hidden', awaitingMe.length === 0);
  document.getElementById('formsFilloutAwaitingList').innerHTML = awaitingMe.map(function(item){
    return '<div class="kf-form-admin-row" data-awaiting-id="' + item.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(item.formName) + '</span>' +
        '<span class="kf-form-admin-row-version">from ' + escapeHTML(item.submittedByDisplayName) + '</span>' +
      '</div>' +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-review="' + item.id + '">Review</button>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('formsFilloutAvailableEmpty').classList.toggle('hidden', publishedForms.length > 0);
  document.getElementById('formsFilloutAvailableList').innerHTML = publishedForms.map(function(f){
    return '<div class="kf-form-admin-row" data-form-id="' + f.id + '">' +
      '<div class="kf-form-admin-row-main"><span class="kf-form-admin-row-name">' + escapeHTML(f.name) + '</span></div>' +
      (f.description ? '<div class="kf-form-admin-row-desc">' + escapeHTML(f.description) + '</div>' : '') +
      '<div class="kf-form-admin-row-actions">' +
        '<button type="button" class="kf-btn kf-btn-secondary kf-btn-sm" data-fill-out="' + f.id + '">Fill Out</button>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('formsFilloutMineEmpty').classList.toggle('hidden', mySubmissions.length > 0);
  document.getElementById('formsFilloutMineList').innerHTML = mySubmissions.map(function(item){
    return '<div class="kf-form-admin-row" data-mine-id="' + item.id + '">' +
      '<div class="kf-form-admin-row-main">' +
        '<span class="kf-form-admin-row-name">' + escapeHTML(item.formName) + '</span>' +
        '<span class="kf-form-status-badge kf-form-status-' + statusBadgeClass(item.status) + '">' + (STATUS_LABELS[item.status] || item.status) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  document.querySelectorAll('[data-review]').forEach(function(btn){
    btn.addEventListener('click', function(){ openApprovalReview(btn.getAttribute('data-review')); });
  });
  document.querySelectorAll('[data-fill-out]').forEach(function(btn){
    btn.addEventListener('click', function(){ openNewSubmission(btn.getAttribute('data-fill-out')); });
  });
  document.querySelectorAll('[data-mine-id]').forEach(function(row){
    row.addEventListener('click', function(){ openMySubmission(row.getAttribute('data-mine-id')); });
  });
}

/* draft/submitted/inProgress/approved/rejected don't map 1:1 onto Form's own draft/published/
   archived status vocabulary, but reuse the same three visual classes (draft=neutral,
   published=success-green, archived=faint) rather than inventing a 4th/5th CSS variant. */
function statusBadgeClass(status){
  if(status === 'approved' || status === 'completed') return 'published';
  if(status === 'draft') return 'draft';
  return 'archived';
}

// ---- Starting a new submission ----

function openNewSubmission(formId){
  var form = publishedForms.filter(function(f){ return f.id === formId; })[0];
  if(!form) return;
  detail = {mode: 'new', form: form, fields: parseFieldsJson(form.fieldsJson), submissionId: null, submission: null};
  renderFilloutDetail();
}

function openMySubmission(submissionId){
  var item = mySubmissions.filter(function(s){ return s.id === submissionId; })[0];
  if(!item) return;
  loadSubmissionDetail(submissionId, item.status === 'draft' ? 'draft' : 'view');
}

function openApprovalReview(submissionId){
  loadSubmissionDetail(submissionId, 'approve');
}

/* Deep-link entry point for a Despatches-panel click or a live SSE toast's "Open" action
   (features/despatches.js's openForm hook / features/live-updates.js's openFormSubmission hook,
   both wired from app.js) — assumes the caller has already switched the LOCAL project to match and
   called openFormsFilloutOverlay() (which sets the module-local projectId this relies on), same
   two-step shape as this file's own row-click handlers just skipping the picker UI itself. mode is
   'approve' for a form-action-required push, 'view' for a form-submission-decided one (fields
   read-only + trail shown, no actions) — the exact "future notification link" case this file's own
   top-of-file doc comment already anticipated for mode 'view'. */
export function openFormSubmissionDetail(submissionId, mode){
  loadSubmissionDetail(submissionId, mode);
}

function loadSubmissionDetail(submissionId, mode){
  projectFormsApi.getSubmission(projectId, submissionId).then(function(submission){
    formsApi.get(submission.formVersionId).then(function(form){
      detail = {mode: mode, form: form, fields: parseFieldsJson(form.fieldsJson), submissionId: submissionId, submission: submission};
      renderFilloutDetail();
    }, function(e){ _toast('Could not load form: ' + (e.message || 'unknown error')); });
  }, function(e){ _toast('Could not load submission: ' + (e.message || 'unknown error')); });
}

// ---- Detail overlay ----

function renderFilloutDetail(){
  var editable = detail.mode === 'new' || detail.mode === 'draft';
  var answers = detail.submission ? parseAnswersJson(detail.submission.answersJson) : {};

  document.getElementById('formFilloutDetailTitle').textContent = detail.form.name +
    (detail.submission ? ' — ' + (STATUS_LABELS[detail.submission.status] || detail.submission.status) : '');

  document.getElementById('formFilloutDetailMissingWarning').classList.add('hidden');
  document.getElementById('formFilloutDetailFields').innerHTML = detail.fields.map(function(field){
    return editable ? renderAnswerInputHTML(field, answers[field.id]) : renderAnswerReadOnlyHTML(field, answers[field.id]);
  }).join('');

  var trail = detail.submission ? parseTrailJson(detail.submission.approvalTrailJson) : [];
  document.getElementById('formFilloutTrailSection').classList.toggle('hidden', trail.length === 0);
  document.getElementById('formFilloutTrailList').innerHTML = trail.map(function(t){
    var when = utcISOToLocalDisplayDateTime(t.timestamp) || t.timestamp || '';
    return '<div class="kf-form-admin-row-desc">' + escapeHTML(t.action) + ' — ' + escapeHTML(when) + (t.comment ? ': ' + escapeHTML(t.comment) : '') + '</div>';
  }).join('');

  // Closing Notes is a Form/Task-integration-only concept — a submission whose workflow never
  // raises a Task (no RaisedTaskId) has nothing for an approver to close out on behalf of a task
  // assignee, so neither the read-only display nor the approver's own input field applies to it.
  var hasRaisedTask = !!(detail.submission && detail.submission.raisedTaskId);
  var closingNotes = detail.submission ? detail.submission.closingNotes : null;
  document.getElementById('formFilloutClosingNotesDisplay').classList.toggle('hidden', !hasRaisedTask || !closingNotes);
  document.getElementById('formFilloutClosingNotesDisplayValue').textContent = closingNotes || '';

  document.getElementById('formFilloutSaveDraftBtn').classList.toggle('hidden', !editable);
  document.getElementById('formFilloutSubmitBtn').classList.toggle('hidden', !editable);
  document.getElementById('formFilloutDeleteDraftBtn').classList.toggle('hidden', detail.mode !== 'draft');
  document.getElementById('formFilloutApproveBtn').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('formFilloutRejectBtn').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('formFilloutCommentField').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('formFilloutCommentInput').value = '';
  document.getElementById('formFilloutClosingNotesField').classList.toggle('hidden', detail.mode !== 'approve' || !hasRaisedTask);
  document.getElementById('formFilloutClosingNotesInput').value = '';

  document.getElementById('formFilloutDetailOverlay').classList.remove('hidden');
}
export function closeFormFilloutDetailOverlay(){
  document.getElementById('formFilloutDetailOverlay').classList.add('hidden');
  detail = null;
}

function showMissingRequiredWarning(missing){
  var el = document.getElementById('formFilloutDetailMissingWarning');
  el.textContent = 'Please fill in: ' + missing.map(function(f){ return f.label; }).join(', ');
  el.classList.remove('hidden');
}

export function saveFormFilloutDraft(){
  var fieldsRoot = document.getElementById('formFilloutDetailFields');
  var answersJson = JSON.stringify(collectAllAnswers(detail.fields, fieldsRoot));

  var request = detail.submissionId
    ? projectFormsApi.updateSubmission(projectId, detail.submissionId, {answersJson: answersJson})
    : projectFormsApi.createSubmission(projectId, {formVersionId: detail.form.id, answersJson: answersJson});

  request.then(function(submission){
    _toast('Draft saved.');
    detail.submissionId = submission.id;
    detail.submission = submission;
    detail.mode = 'draft';
    closeFormFilloutDetailOverlay();
    loadAndRenderFilloutPicker();
  }, function(e){
    _toast('Could not save draft: ' + (e.message || 'unknown error'));
  });
}

export function submitFormFillout(){
  var fieldsRoot = document.getElementById('formFilloutDetailFields');
  var answers = collectAllAnswers(detail.fields, fieldsRoot);
  var missing = findMissingRequiredFields(detail.fields, answers);
  if(missing.length > 0){ showMissingRequiredWarning(missing); return; }

  var answersJson = JSON.stringify(answers);
  var afterSaved = function(submissionId){
    projectFormsApi.submit(projectId, submissionId).then(function(){
      _toast('Form submitted.');
      closeFormFilloutDetailOverlay();
      loadAndRenderFilloutPicker();
    }, function(e){
      _toast('Could not submit: ' + (e.message || 'unknown error'));
    });
  };

  if(detail.submissionId){
    projectFormsApi.updateSubmission(projectId, detail.submissionId, {answersJson: answersJson}).then(function(){
      afterSaved(detail.submissionId);
    }, function(e){ _toast('Could not save answers before submitting: ' + (e.message || 'unknown error')); });
  } else {
    projectFormsApi.createSubmission(projectId, {formVersionId: detail.form.id, answersJson: answersJson}).then(function(submission){
      afterSaved(submission.id);
    }, function(e){ _toast('Could not create submission: ' + (e.message || 'unknown error')); });
  }
}

export function deleteFormFilloutDraft(){
  if(!detail.submissionId) return;
  confirmDialog(
    'Delete this draft?',
    'This cannot be undone.',
    function(){
      projectFormsApi.deleteSubmission(projectId, detail.submissionId).then(function(){
        _toast('Draft deleted.');
        closeFormFilloutDetailOverlay();
        loadAndRenderFilloutPicker();
      }, function(e){ _toast('Could not delete draft: ' + (e.message || 'unknown error')); });
    }
  );
}

function actOnApproval(action){
  var comment = document.getElementById('formFilloutCommentInput').value.trim();
  var closingNotes = document.getElementById('formFilloutClosingNotesInput').value.trim();
  projectFormsApi.approvalAction(projectId, detail.submissionId, action, comment || null, closingNotes || null).then(function(){
    _toast(action === 'approve' ? 'Approved.' : 'Rejected.');
    closeFormFilloutDetailOverlay();
    loadAndRenderFilloutPicker();
  }, function(e){
    _toast('Could not ' + action + ': ' + (e.message || 'unknown error'));
  });
}
export function approveFormFillout(){ actOnApproval('approve'); }
export function rejectFormFillout(){ actOnApproval('reject'); }
