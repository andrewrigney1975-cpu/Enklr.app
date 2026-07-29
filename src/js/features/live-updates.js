"use strict";
import { getToken, getClientSessionId, isLoggedIn, clearToken, notifyAuthExpired } from '../api.js';
import { getCurrentProject } from '../store.js';
import { refreshProjectFromServer } from './migration.js';
import { renderBoard } from '../views/board.js';
import { toastWithAction } from '../ui.js';
import { handleChatMessageEvent, handleChatReactionEvent } from './chat.js';
import { pushDespatch } from './despatches.js';

/* Server-Sent Events client for Controllers/EventsController.cs's /api/events/stream — deliberately
   NOT the native EventSource API, since EventSource can't send an Authorization header and this app's
   auth is a bearer JWT in localStorage, not a cookie. fetch()'s streaming body reader gives the same
   effect with normal header-based auth, at the cost of having to hand-roll SSE framing and reconnect
   logic ourselves below. */

var RECONNECT_MIN_DELAY_MS = 2000;
var RECONNECT_MAX_DELAY_MS = 30000;

var _active = false; // true from connectEventStream() until disconnectEventStream()
var _abortController = null;
var _reconnectTimer = null;
var _reconnectDelay = RECONNECT_MIN_DELAY_MS;

var _openFormSubmission = function(){}; // (serverProjectId, submissionId, mode) => void — provided by app.js

export function setLiveUpdatesDeps(deps){
  if(deps.openFormSubmission) _openFormSubmission = deps.openFormSubmission;
}

function verbFor(changeType){
  if(changeType === 'created') return 'created';
  if(changeType === 'deleted') return 'deleted';
  return 'updated';
}

function handleTaskChangedEvent(payload){
  var message = payload.title + ' (' + payload.taskKey + ') was ' + verbFor(payload.changeType) +
    ' by ' + (payload.changedByDisplayName || 'someone') + '.';
  var project = getCurrentProject();
  var isOpenProject = !!(project && project.serverProjectId && project.serverProjectId === payload.projectId);

  // A deleted task has no live task to link to (its key wouldn't resolve via findTaskByKey), so this
  // despatch shows the same message but with no click-through target.
  pushDespatch({
    icon: 'ty_document',
    message: message,
    taskKey: payload.changeType === 'deleted' ? null : payload.taskKey
  });

  if(isOpenProject){
    toastWithAction(message, 'Reload', function(){
      refreshProjectFromServer(project.id).then(renderBoard);
    });
  } else {
    // Still worth knowing about (it's a project this user is a member of — see
    // SseBroadcaster.BroadcastTaskChanged), just nothing to reload since it's not the open project.
    toastWithAction(message, null, null);
  }
}

/* Enterprise Forms & Workflow, Phase 6 — pushed only to a single NAMED approver (see
   SseBroadcaster.BroadcastFormActionRequired's own doc comment for the deliberately narrow v1
   scope: a plain user-type gate has no one specific person to target).

   Phase 7 adds click-through: unlike handleTaskChangedEvent's own open-project-only toast action
   (a live board reload only makes sense for the project already on screen), opening a Form
   submission is a dedicated overlay, not a board reload — so the "Open" action always works,
   switching the local project to match the payload's serverProjectId first if it isn't already the
   current one (findProjectByServerId, via the openFormSubmission DI hook app.js wires here and into
   despatches.js identically), same as clicking the Despatches-panel row for this entry would do. */
function handleFormActionRequiredEvent(payload){
  var message = '"' + payload.formName + '" is awaiting your approval.';
  pushDespatch({
    icon: 'ty_document',
    message: message,
    formSubmission: {projectId: payload.projectId, submissionId: payload.submissionId, mode: 'approve'}
  });
  toastWithAction(message, 'Open', function(){
    _openFormSubmission(payload.projectId, payload.submissionId, 'approve');
  });
}

/* Phase 7/8 — pushed to the ORIGINAL SUBMITTER whenever their submission reaches a FINAL decision
   (payload.decision is 'approved' or 'rejected'), always and unconditionally — no gate-satisfaction
   "who" question like the approval-required push above, a decision has exactly one interested
   party. Approved and rejected share one handler/event (rather than two near-duplicate ones)
   specifically so the message always names BOTH the form and the result together — "which form,
   what happened" is the whole point of this notification, never one without the other. mode 'view'
   matches modals/forms-fillout.js's own doc comment for a submission reached via "a future
   notification link" — read-only fields + Approval Trail, no actions. */
function handleFormSubmissionDecidedEvent(payload){
  var verb = payload.decision === 'approved' ? 'approved' : 'rejected';
  var message = '"' + payload.formName + '" was ' + verb + ' by ' + (payload.actedByDisplayName || 'someone') +
    (payload.comment ? ': "' + payload.comment + '"' : '') + '.';
  pushDespatch({
    icon: payload.decision === 'approved' ? 'check' : 'ty_document',
    message: message,
    formSubmission: {projectId: payload.projectId, submissionId: payload.submissionId, mode: 'view'}
  });
  toastWithAction(message, 'Open', function(){
    _openFormSubmission(payload.projectId, payload.submissionId, 'view');
  });
}

function dispatchEvent(eventName, data){
  if(eventName !== 'task-changed' && eventName !== 'chat-message' && eventName !== 'chat-reaction' &&
     eventName !== 'form-action-required' && eventName !== 'form-submission-decided') return;
  try {
    if(eventName === 'task-changed') handleTaskChangedEvent(JSON.parse(data));
    else if(eventName === 'chat-message') handleChatMessageEvent(JSON.parse(data));
    else if(eventName === 'chat-reaction') handleChatReactionEvent(JSON.parse(data));
    else if(eventName === 'form-action-required') handleFormActionRequiredEvent(JSON.parse(data));
    else handleFormSubmissionDecidedEvent(JSON.parse(data));
  } catch(e){ /* malformed event payload — ignore rather than break the stream */ }
}

/* Turns a stream of decoded text chunks into individual SSE frames (blank-line separated, each made
   of "field: value" lines) and calls onEvent(eventName, data) per frame. Comment lines (starting with
   ":" — the server's heartbeat pings) and frames with no "data:" line are ignored. Buffers a trailing
   partial frame across chunk boundaries, since a chunk can end mid-frame. */
function makeSseFrameFeeder(onEvent){
  var buffer = '';
  return function(chunkText){
    buffer += chunkText;
    var frames = buffer.split('\n\n');
    buffer = frames.pop();
    frames.forEach(function(frame){
      var eventName = 'message';
      var dataLines = [];
      frame.split('\n').forEach(function(line){
        if(!line || line.charAt(0) === ':') return;
        var idx = line.indexOf(':');
        if(idx === -1) return;
        var field = line.slice(0, idx);
        var value = line.slice(idx + 1).replace(/^ /, '');
        if(field === 'event') eventName = value;
        else if(field === 'data') dataLines.push(value);
      });
      if(dataLines.length) onEvent(eventName, dataLines.join('\n'));
    });
  };
}

async function streamOnce(signal){
  var res = await fetch('/api/events/stream', {
    headers: {
      'Authorization': 'Bearer ' + getToken(),
      'X-Client-Session-Id': getClientSessionId(),
      'Accept': 'text/event-stream'
    },
    signal: signal
  });

  if(res.status === 401 || res.status === 403){
    // Session expired/revoked — matches apiFetch's handling in api.js, including surfacing the login
    // modal (see setOnAuthExpired in app.js): this long-lived stream can be the first thing to notice
    // an expired token during an otherwise idle session, well before any other request would. Stop
    // entirely rather than hammering the server with a reconnect loop that will just keep getting 401s.
    clearToken();
    notifyAuthExpired();
    disconnectEventStream();
    return;
  }
  if(!res.ok || !res.body){
    throw new Error('Event stream request failed with status ' + res.status);
  }

  _reconnectDelay = RECONNECT_MIN_DELAY_MS; // connected successfully — reset backoff for next time

  var reader = res.body.getReader();
  var decoder = new TextDecoder();
  var feed = makeSseFrameFeeder(dispatchEvent);
  while(true){
    var chunk = await reader.read();
    if(chunk.done) return;
    feed(decoder.decode(chunk.value, {stream: true}));
  }
}

function scheduleReconnect(){
  if(!_active) return;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(connectLoop, _reconnectDelay);
  _reconnectDelay = Math.min(_reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
}

function connectLoop(){
  if(!_active || !isLoggedIn()) return;
  _abortController = new AbortController();
  streamOnce(_abortController.signal).then(
    function(){ scheduleReconnect(); }, // server closed the stream (or we did) — reconnect if still active
    function(err){
      if(err && err.name === 'AbortError') return; // disconnectEventStream() called this — don't reconnect
      scheduleReconnect();
    }
  );
}

export function connectEventStream(){
  if(_active || !isLoggedIn()) return; // already running, or nothing to authenticate the stream with
  _active = true;
  _reconnectDelay = RECONNECT_MIN_DELAY_MS;
  connectLoop();
}

export function disconnectEventStream(){
  _active = false;
  clearTimeout(_reconnectTimer);
  if(_abortController){ _abortController.abort(); _abortController = null; }
}
