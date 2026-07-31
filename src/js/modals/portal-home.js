"use strict";
import { toast } from '../ui.js';
import { escapeHTML, refreshSideNavPortalsSectionVisibility } from '../views/board.js';
import { portalHomeApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { renderAnswerInputHTML, renderAnswerReadOnlyHTML, collectAllAnswers, findMissingRequiredFields } from '../features/form-answers.js';
import { setPortalHash, clearPortalHash, parsePortalSlugFromHash } from '../features/hash-router.js';
import { iconSvg, hydrateIcons } from '../icons.js';
import { utcISOToLocalDisplayDateTime } from '../date-utils.js';
import { markdownToHtml } from '../rich-text/markdown.js';

/* Organisational Portals — the fullscreen, end-user experience (kf-modal-full, see PORTALS.md's own
   design brief for the token system this file's markup/CSS embody). Three panes: Start a request
   (available forms) / My requests (a status-stepper per submission, the signature device this page
   is meant to be remembered by) / Answers (a knowledge-base-style Q&A accordion). A form is filled
   out in a layered kf-modal-md detail overlay (#portalHomeFilloutOverlay), mirroring
   modals/forms-fillout.js's own detail shape but backed by portalHomeApi (this Portal's own
   actioner Project) instead of projectFormsApi. */

var _toast = toast;

var currentPortal = null; // PortalDto
var currentForms = [];
var currentRequests = [];
var currentAwaiting = [];
var currentQa = null; // {topics, entries}
var detail = null; // {mode: 'new'|'draft'|'approve', form, fields, submissionId, submission}
var expandedQaEntryIds = {};
/* Session-only — which entries this tab has already voted on, and which way, purely to disable the
   buttons after one vote and avoid accidental repeat clicks. Not persisted (a page reload lets the
   user vote again); the server enforces no per-user uniqueness at all (see
   PortalHomeService.VoteQaEntryNpsAsync's own doc comment — a deliberately simple tally, not a
   per-user ledger), so this is purely a UI courtesy, not a real restriction. */
var votedQaEntryIds = {};
var qaSearchTerm = '';
var formsSearchTerm = '';

var STEPPER_STEPS = ['Draft', 'Submitted', 'In review', 'Approved'];

// ---- Open/close ----

export function openPortalHomeBySlug(slug){
  portalHomeApi.getBySlug(slug).then(function(portal){
    currentPortal = portal;
    setPortalHash(portal.slug);
    document.getElementById('portalHomeOverlay').classList.remove('hidden');
    document.getElementById('portalHomeIconLarge').innerHTML = portal.iconName ? iconSvg(portal.iconName, 48) : '';
    document.getElementById('portalHomeGreeting').textContent = 'Welcome to the ' + portal.name + ' Portal';
    document.getElementById('portalHomeDesc').textContent = portal.description || '';
    qaSearchTerm = '';
    document.getElementById('portalHomeQaSearchInput').value = '';
    document.getElementById('portalHomeQaSearchClearBtn').classList.add('kf-vis-hidden');
    formsSearchTerm = '';
    document.getElementById('portalHomeFormsSearchInput').value = '';
    document.getElementById('portalHomeFormsSearchClearBtn').classList.add('kf-vis-hidden');
    loadAndRenderPortalHome();
  }, function(){
    _toast('That Portal isn\'t available.');
  });
}

/* Populates the side nav's dynamic "Portals" section — one icon button per published Portal this
   user actually has access to (server-side re-derived, PortalHomeService.ListAccessibleAsync).
   Called once at init() (after login), same call-site convention as openWhiteboardFromHashIfPresent/
   initChat — not re-run on every render, so a Portal published/granted mid-session only appears in
   the side nav after the next reload. */
export function loadAndRenderSideNavPortals(){
  portalHomeApi.listAccessible().then(function(portals){
    var list = document.getElementById('sideNavPortalsList');
    portals = portals || [];
    list.innerHTML = portals.map(function(p){
      return '<button type="button" class="kf-side-nav-item" data-portal-slug="' + escapeHTML(p.slug) + '" title="' + escapeHTML(p.name) + '">' +
        (p.iconName ? iconSvg(p.iconName, 21) : iconSvg('sparkle', 21)) +
        '<span class="kf-side-nav-text">' + escapeHTML(p.name) + '</span>' +
      '</button>';
    }).join('');
    list.querySelectorAll('[data-portal-slug]').forEach(function(btn){
      btn.addEventListener('click', function(){ openPortalHomeBySlug(btn.getAttribute('data-portal-slug')); });
    });
    // The section also holds the static "Forms" entry (see index.html's own comment) — its
    // visibility depends on the Forms App Setting, not this list, so re-check the combined
    // "show the section at all" state now that the list itself has finished populating.
    refreshSideNavPortalsSectionVisibility();
  }, function(){ /* Not server-authoritative / no server session — leave the section as-is. */ });
}
export function closePortalHomeOverlay(){
  document.getElementById('portalHomeOverlay').classList.add('hidden');
  clearPortalHash();
  currentPortal = null;
}

/* Called on hashchange AND once eagerly on initial app load (same two-call-site convention as
   openTaskFromHashIfPresent/openWhiteboardFromHashIfPresent in app.js). */
export function openPortalHomeFromHashIfPresent(){
  var slug = parsePortalSlugFromHash();
  if(!slug) return;
  openPortalHomeBySlug(slug);
}

function loadAndRenderPortalHome(){
  if(!currentPortal) return;
  var portalId = currentPortal.id;
  portalHomeApi.listAvailableForms(portalId).then(function(forms){
    currentForms = forms || [];
    renderPortalHomeForms();
  }, function(){});
  portalHomeApi.listMySubmissions(portalId).then(function(subs){
    currentRequests = subs || [];
    renderPortalHomeRequests();
  }, function(){});
  // A Portal-configured approver is never a ProjectMember of this Portal's actioner Project (it's
  // deliberately created membership-free), so they have no way to reach the regular project-scoped
  // Forms modal's own "awaiting-me" list for a submission that came in through this Portal — this is
  // the Portal-surface equivalent, same gate-evaluation logic underneath.
  portalHomeApi.listAwaitingMyAction(portalId).then(function(items){
    currentAwaiting = items || [];
    renderPortalHomeAwaiting();
  }, function(){});
  portalHomeApi.listQa(portalId).then(function(qa){
    currentQa = qa || {topics: [], entries: []};
    renderPortalHomeQa();
  }, function(){});
}

// ---- Left pane: available forms ----

/* Same case-insensitive substring filter as the Answers (Q&A) pane's own onPortalHomeQaSearchInput/
   clearPortalHomeQaSearch/renderPortalHomeQa, applied to the form's own name instead of a question/
   answer pair — kept as separate functions/state (formsSearchTerm, not qaSearchTerm) since the two
   panes filter independent lists that happen to share a search-box UI pattern, not a shared list. */
export function onPortalHomeFormsSearchInput(){
  var input = document.getElementById('portalHomeFormsSearchInput');
  formsSearchTerm = input.value.trim().toLowerCase();
  document.getElementById('portalHomeFormsSearchClearBtn').classList.toggle('kf-vis-hidden', input.value.length === 0);
  renderPortalHomeForms();
}

export function clearPortalHomeFormsSearch(){
  var input = document.getElementById('portalHomeFormsSearchInput');
  input.value = '';
  formsSearchTerm = '';
  document.getElementById('portalHomeFormsSearchClearBtn').classList.add('kf-vis-hidden');
  renderPortalHomeForms();
  input.focus();
}

function renderPortalHomeForms(){
  var searching = formsSearchTerm.length > 0;
  var forms = searching ? currentForms.filter(function(f){
    return (f.formName || '').toLowerCase().indexOf(formsSearchTerm) !== -1;
  }) : currentForms;

  document.getElementById('portalHomeFormsEmpty').classList.toggle('hidden', currentForms.length > 0);
  document.getElementById('portalHomeFormsNoMatches').classList.toggle('hidden', !searching || forms.length > 0);

  var list = document.getElementById('portalHomeFormsList');
  list.innerHTML = forms.map(function(f){
    return '<div class="kf-portal-home-form-tile" data-form-group-id="' + f.formGroupId + '">' +
      iconSvg('formFillOut', 18) +
      '<span>' + escapeHTML(f.formName || 'Untitled form') + '</span>' +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-form-group-id]').forEach(function(tile){
    tile.addEventListener('click', function(){ openNewPortalSubmission(tile.getAttribute('data-form-group-id')); });
  });
  hydrateIcons(list);
}

function renderPortalHomeAwaiting(){
  var section = document.getElementById('portalHomeAwaitingSection');
  section.classList.toggle('hidden', currentAwaiting.length === 0);
  document.getElementById('portalHomeAwaitingList').innerHTML = currentAwaiting.map(function(item){
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
  document.querySelectorAll('#portalHomeAwaitingList [data-review]').forEach(function(btn){
    btn.addEventListener('click', function(){ openPortalApprovalReview(btn.getAttribute('data-review')); });
  });
}

/* Opens someone else's in-flight submission for review — PortalHomeService.GetSubmissionAsync only
   returns it if the caller is currently a legitimate reviewer (same gate check as the awaiting-list
   itself), so this reuses the exact same fetch as re-opening one's own draft. */
function openPortalApprovalReview(submissionId){
  var item = currentAwaiting.filter(function(r){ return r.id === submissionId; })[0];
  if(!item) return;
  var f = currentForms.filter(function(x){ return x.formVersionId === item.formVersionId; })[0];
  portalHomeApi.getSubmission(currentPortal.id, submissionId).then(function(submission){
    detail = {mode: 'approve', formVersionId: item.formVersionId, formName: item.formName, fields: f ? parseFieldsJson(f.fieldsJson) : [], submissionId: submissionId, submission: submission};
    renderPortalFilloutDetail();
  }, function(e){ _toast('Could not load this submission: ' + (e.message || 'unknown error')); });
}

// ---- Middle pane: my requests, the status-stepper ----

function stepIndexForStatus(status){
  if(status === 'draft') return 0;
  if(status === 'submitted') return 1;
  if(status === 'inProgress') return 2;
  if(status === 'approved') return 3;
  if(status === 'rejected') return 2;
  return 0;
}
function renderStepperHTML(status){
  var current = stepIndexForStatus(status);
  var rejected = status === 'rejected';
  return '<div class="kf-portal-stepper">' + STEPPER_STEPS.map(function(label, i){
    var cls = i < current ? 'done' : (i === current ? (rejected ? 'rejected' : 'current') : '');
    var stepLabel = (rejected && i === current) ? 'Rejected' : label;
    return '<div class="kf-portal-stepper-step ' + cls + '">' +
      '<div class="kf-portal-stepper-line"></div>' +
      '<div class="kf-portal-stepper-dot"></div>' +
      '<div class="kf-portal-stepper-label">' + escapeHTML(stepLabel) + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function renderPortalHomeRequests(){
  document.getElementById('portalHomeRequestsEmpty').classList.toggle('hidden', currentRequests.length > 0);
  var list = document.getElementById('portalHomeRequestsList');
  list.innerHTML = currentRequests.map(function(r){
    return '<div class="kf-portal-request-card" data-submission-id="' + r.id + '" data-status="' + r.status + '">' +
      '<div class="kf-portal-request-name">' + escapeHTML(r.formName) + '</div>' +
      renderStepperHTML(r.status) +
    '</div>';
  }).join('');
  list.querySelectorAll('[data-submission-id]').forEach(function(card){
    card.addEventListener('click', function(){
      var id = card.getAttribute('data-submission-id');
      if(card.getAttribute('data-status') === 'draft') openExistingPortalSubmission(id);
      else openPortalSubmissionView(id);
    });
  });
}

/* Read-only detail for anything past Draft (submitted/in review/approved/rejected) — reuses the
   same fillout overlay in 'view' mode (renderPortalFilloutDetail's own editable flag already treats
   any non-new/non-draft mode as read-only, with the Approval Trail shown and no action buttons). */
function openPortalSubmissionView(submissionId){
  var item = currentRequests.filter(function(r){ return r.id === submissionId; })[0];
  if(!item) return;
  var f = currentForms.filter(function(x){ return x.formVersionId === item.formVersionId; })[0];
  portalHomeApi.getSubmission(currentPortal.id, submissionId).then(function(submission){
    detail = {mode: 'view', formVersionId: item.formVersionId, formName: item.formName, fields: f ? parseFieldsJson(f.fieldsJson) : [], submissionId: submissionId, submission: submission};
    renderPortalFilloutDetail();
  }, function(e){ _toast('Could not load this submission: ' + (e.message || 'unknown error')); });
}

// ---- Right pane: Q&A accordion ----

/* The search box filters entries whose question OR answer contains the term (case-insensitive) and
   auto-expands every match — a matched entry ignores its own manual expandedQaEntryIds state while a
   search is active, so results are immediately readable rather than requiring a second click. A
   topic heading survives only if at least one of its entries still matches; clearing the box reverts
   to the normal full list with whatever accordion state the user had before searching (never reset
   by the act of searching itself). */
export function onPortalHomeQaSearchInput(){
  var input = document.getElementById('portalHomeQaSearchInput');
  qaSearchTerm = input.value.trim().toLowerCase();
  document.getElementById('portalHomeQaSearchClearBtn').classList.toggle('kf-vis-hidden', input.value.length === 0);
  renderPortalHomeQa();
}

export function clearPortalHomeQaSearch(){
  var input = document.getElementById('portalHomeQaSearchInput');
  input.value = '';
  qaSearchTerm = '';
  document.getElementById('portalHomeQaSearchClearBtn').classList.add('kf-vis-hidden');
  renderPortalHomeQa();
  input.focus();
}

function renderPortalHomeQa(){
  var topics = currentQa.topics || [], allEntries = currentQa.entries || [];
  var searching = qaSearchTerm.length > 0;
  var entries = searching ? allEntries.filter(function(e){
    return (e.question || '').toLowerCase().indexOf(qaSearchTerm) !== -1 ||
      (e.answer || '').toLowerCase().indexOf(qaSearchTerm) !== -1;
  }) : allEntries;

  document.getElementById('portalHomeQaEmpty').classList.toggle('hidden', allEntries.length > 0);
  document.getElementById('portalHomeQaNoMatches').classList.toggle('hidden', !searching || entries.length > 0);

  var topicTitleById = {};
  topics.forEach(function(t){ topicTitleById[t.id] = t.title; });

  var grouped = topics.map(function(t){ return {title: t.title, entries: entries.filter(function(e){ return e.portalTopicId === t.id; })}; })
    .filter(function(g){ return g.entries.length > 0; });
  var ungrouped = entries.filter(function(e){ return !e.portalTopicId; });
  if(ungrouped.length > 0) grouped.push({title: null, entries: ungrouped});

  var list = document.getElementById('portalHomeQaList');
  list.innerHTML = grouped.map(function(g){
    return (g.title ? '<div class="kf-portal-qa-topic">' + escapeHTML(g.title) + '</div>' : '') +
      g.entries.map(function(e){ return renderPortalQaEntryHTML(e, searching); }).join('');
  }).join('');

  list.querySelectorAll('[data-qa-entry-id]').forEach(function(q){
    q.addEventListener('click', function(){
      var id = q.getAttribute('data-qa-entry-id');
      expandedQaEntryIds[id] = !expandedQaEntryIds[id];
      renderPortalHomeQa();
    });
  });
  list.querySelectorAll('[data-vote-qa-entry]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-vote-qa-entry');
      var direction = btn.getAttribute('data-vote-direction');
      portalHomeApi.voteQaEntryNps(currentPortal.id, id, direction).then(function(){
        votedQaEntryIds[id] = direction;
        toast('Thanks for your feedback!');
        renderPortalHomeQa();
      }, function(err){ toast('Could not record your feedback: ' + (err.message || 'unknown error')); });
    });
  });
  hydrateIcons(list);
}

function renderPortalQaEntryHTML(e, forceExpanded){
  var expanded = forceExpanded || !!expandedQaEntryIds[e.id];
  var voted = votedQaEntryIds[e.id]; // undefined | 'up' | 'down'
  return '<div class="kf-portal-qa-entry' + (expanded ? ' expanded' : '') + '">' +
    '<div class="kf-portal-qa-question" data-qa-entry-id="' + e.id + '">' +
      '<span>' + escapeHTML(e.question) + '</span>' +
      iconSvg('chevronRight', 14) +
    '</div>' +
    '<div class="kf-portal-qa-answer' + (expanded ? '' : ' hidden') + '">' +
      '<div class="kf-richtext-content">' + markdownToHtml(e.answer || '') + '</div>' +
      '<div class="kf-portal-qa-feedback">' +
        '<span>Was this helpful?</span>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm' + (voted === 'up' ? ' kf-portal-qa-voted' : '') + '" data-vote-qa-entry="' + e.id + '" data-vote-direction="up" title="Yes" ' + (voted ? 'disabled' : '') + '>' + iconSvg('thumbsUp', 14) + '</button>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm' + (voted === 'down' ? ' kf-portal-qa-voted' : '') + '" data-vote-qa-entry="' + e.id + '" data-vote-direction="down" title="No" ' + (voted ? 'disabled' : '') + '>' + iconSvg('thumbsDown', 14) + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ---- Form fill-out detail (mirrors modals/forms-fillout.js's own shape, backed by portalHomeApi) ----

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

/* currentForms entries are PortalFormDto — id/formGroupId/formName/formStatus/fieldsJson, the last
   resolved server-side from whichever Form version is currently published for that group (see
   PortalService.ResolvePortalFormDtosAsync's own doc comment for why FieldsJson had to be added
   there: this Portal-facing surface has no Org-Admin-only formsApi access of its own to fetch it a
   different way). No submission is created until the user actually clicks Submit/Save Draft below —
   opening the picker is a pure read. */
function openNewPortalSubmission(formGroupId){
  var f = currentForms.filter(function(x){ return x.formGroupId === formGroupId; })[0];
  if(!f) return;
  detail = {mode: 'new', formVersionId: f.formVersionId, formName: f.formName, formGroupId: formGroupId, fields: parseFieldsJson(f.fieldsJson), submissionId: null, submission: null};
  renderPortalFilloutDetail();
}

/* The "My requests" list item alone has no AnswersJson (FormSubmissionListItemDto is a display-only
   summary row) — must re-fetch the full submission via portalHomeApi.getSubmission before rendering,
   or the form would always render blank on reopen even though the answers are safely persisted
   server-side (this was a real bug: detail.submission was previously left null here). */
function openExistingPortalSubmission(submissionId){
  var item = currentRequests.filter(function(r){ return r.id === submissionId; })[0];
  if(!item) return;
  var f = currentForms.filter(function(x){ return x.formVersionId === item.formVersionId; })[0];
  portalHomeApi.getSubmission(currentPortal.id, submissionId).then(function(submission){
    detail = {mode: 'draft', formVersionId: item.formVersionId, formName: item.formName, fields: f ? parseFieldsJson(f.fieldsJson) : [], submissionId: submissionId, submission: submission};
    renderPortalFilloutDetail();
  }, function(e){ _toast('Could not load your saved draft: ' + (e.message || 'unknown error')); });
}

var FILLOUT_STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', inProgress: 'In Review', approved: 'Approved', rejected: 'Rejected'
};

function renderPortalFilloutDetail(){
  var editable = detail.mode === 'new' || detail.mode === 'draft';
  var statusLabel = detail.submission ? (FILLOUT_STATUS_LABELS[detail.submission.status] || detail.submission.status) : null;
  document.getElementById('portalHomeFilloutTitle').textContent = detail.formName + (statusLabel ? ' — ' + statusLabel : '');
  document.getElementById('portalHomeFilloutMissingWarning').classList.add('hidden');
  var answers = detail.submission ? parseAnswersJson(detail.submission.answersJson) : {};
  document.getElementById('portalHomeFilloutFields').innerHTML = detail.fields.map(function(field){
    return editable ? renderAnswerInputHTML(field, answers[field.id]) : renderAnswerReadOnlyHTML(field, answers[field.id]);
  }).join('');

  var trail = detail.submission ? parseTrailJson(detail.submission.approvalTrailJson) : [];
  document.getElementById('portalHomeFilloutTrailSection').classList.toggle('hidden', trail.length === 0);
  document.getElementById('portalHomeFilloutTrailList').innerHTML = trail.map(function(t){
    var when = utcISOToLocalDisplayDateTime(t.timestamp) || t.timestamp || '';
    return '<div class="kf-form-admin-row-desc">' + escapeHTML(t.action) + ' — ' + escapeHTML(when) + (t.comment ? ': ' + escapeHTML(t.comment) : '') + '</div>';
  }).join('');

  document.getElementById('portalHomeFilloutSaveDraftBtn').classList.toggle('hidden', !editable);
  document.getElementById('portalHomeFilloutSubmitBtn').classList.toggle('hidden', !editable);
  document.getElementById('portalHomeFilloutDeleteBtn').classList.toggle('hidden', detail.mode !== 'draft');
  document.getElementById('portalHomeFilloutApproveBtn').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('portalHomeFilloutRejectBtn').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('portalHomeFilloutCommentField').classList.toggle('hidden', detail.mode !== 'approve');
  document.getElementById('portalHomeFilloutCommentInput').value = '';

  document.getElementById('portalHomeFilloutOverlay').classList.remove('hidden');
}
export function closePortalHomeFilloutOverlay(){
  document.getElementById('portalHomeFilloutOverlay').classList.add('hidden');
  detail = null;
}

/* Mirrors modals/forms-fillout.js's own saveFormFilloutDraft — a brand-new submission
   (detail.submissionId still null) is created outright; an existing Draft is just updated. */
export function savePortalHomeFilloutDraft(){
  if(!detail) return;
  var fieldsRoot = document.getElementById('portalHomeFilloutFields');
  var answersJson = JSON.stringify(collectAllAnswers(detail.fields, fieldsRoot));

  var request = detail.submissionId
    ? portalHomeApi.updateSubmission(currentPortal.id, detail.submissionId, answersJson)
    : portalHomeApi.createSubmission(currentPortal.id, detail.formVersionId, answersJson);

  request.then(function(submission){
    _toast('Draft saved.');
    detail.submissionId = submission.id;
    detail.submission = submission;
    detail.mode = 'draft';
    closePortalHomeFilloutOverlay();
    loadAndRenderPortalHome();
  }, function(e){ _toast('Could not save draft: ' + (e.message || 'unknown error')); });
}

export function submitPortalHomeFillout(){
  if(!detail) return;
  var fieldsRoot = document.getElementById('portalHomeFilloutFields');
  var answers = collectAllAnswers(detail.fields, fieldsRoot);
  var missing = findMissingRequiredFields(detail.fields, answers);
  if(missing.length > 0){
    var el = document.getElementById('portalHomeFilloutMissingWarning');
    el.textContent = 'Please fill in: ' + missing.map(function(f){ return f.label; }).join(', ');
    el.classList.remove('hidden');
    return;
  }
  var answersJson = JSON.stringify(answers);
  var afterSaved = function(submissionId){
    portalHomeApi.submitSubmission(currentPortal.id, submissionId).then(function(){
      _toast('Submitted.');
      closePortalHomeFilloutOverlay();
      loadAndRenderPortalHome();
    }, function(e){ _toast('Could not submit: ' + (e.message || 'unknown error')); });
  };

  if(detail.submissionId){
    portalHomeApi.updateSubmission(currentPortal.id, detail.submissionId, answersJson).then(function(){
      afterSaved(detail.submissionId);
    }, function(e){ _toast('Could not save answers before submitting: ' + (e.message || 'unknown error')); });
  } else {
    portalHomeApi.createSubmission(currentPortal.id, detail.formVersionId, answersJson).then(function(submission){
      afterSaved(submission.id);
    }, function(e){ _toast('Could not create submission: ' + (e.message || 'unknown error')); });
  }
}

export function deletePortalHomeFilloutDraft(){
  if(!detail || !detail.submissionId) return;
  confirmDialog('Delete this draft?', 'This cannot be undone.', function(){
    portalHomeApi.deleteSubmission(currentPortal.id, detail.submissionId).then(function(){
      _toast('Draft deleted.');
      closePortalHomeFilloutOverlay();
      loadAndRenderPortalHome();
    }, function(e){ _toast('Could not delete draft: ' + (e.message || 'unknown error')); });
  });
}

function actOnPortalApproval(action){
  var comment = document.getElementById('portalHomeFilloutCommentInput').value.trim();
  portalHomeApi.actOnApproval(currentPortal.id, detail.submissionId, action, comment || null).then(function(){
    _toast(action === 'approve' ? 'Approved.' : 'Rejected.');
    closePortalHomeFilloutOverlay();
    loadAndRenderPortalHome();
  }, function(e){
    _toast('Could not ' + action + ': ' + (e.message || 'unknown error'));
  });
}
export function approvePortalHomeFillout(){ actOnPortalApproval('approve'); }
export function rejectPortalHomeFillout(){ actOnPortalApproval('reject'); }
