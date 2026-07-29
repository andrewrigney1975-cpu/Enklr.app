"use strict";
import { whiteboardApi, getCurrentUserId } from '../api.js';
import { setWhiteboardHash, clearWhiteboardHash } from './hash-router.js';

/* Collaborative Whiteboard — org-wide, real-time state + API/SSE-handler module (mirrors
   features/chat.js's role: state + API calls + SSE handlers, kept separate from the modal's own
   render-heavy modals/whiteboard.js). See CLAUDE.md's Collaborative Whiteboard entry for the full
   architecture (session lifecycle across all 3 backend tiers, "scratch until saved" persistence,
   MariaDB tier deliberately not getting live cursors).

   Session state shape (mirrors WhiteboardSessionStateDto exactly):
   {id, joinCode, title, status, isSaved, isHost, hostUserId, hostDisplayName, createdAt,
    participants: [{userId, displayName, isHost, isOnline}], elements: [{id, elementType, elementJson, createdByUserId, createdAt}]} */
var _session = null;

// modals/whiteboard.js registers these once, when the modal opens — the render callback re-draws
// whatever changed (participants/elements), the closed callback tears the modal down entirely.
// Same DI-hook shape as live-updates.js's setLiveUpdatesDeps, for the same reason: this module
// must not import the modal module (that would be a circular import — the modal imports this one).
var _onStateChanged = function(){};
var _onSessionClosedRemotely = function(){};

export function setWhiteboardDeps(deps){
  if(deps.onStateChanged) _onStateChanged = deps.onStateChanged;
  if(deps.onSessionClosedRemotely) _onSessionClosedRemotely = deps.onSessionClosedRemotely;
}

export function getWhiteboardSession(){ return _session; }

/* True once the host has drawn something without having saved yet — the close-time "you'll lose
   this" warning's own trigger condition. Not tracked as a separate dirty flag: elements are
   durable server-side for the life of the session regardless (so a reconnect never loses
   anything mid-session), so "unsaved" just means "has content, and IsSaved is still false". */
export function whiteboardHasUnsavedChanges(){
  return !!(_session && !_session.isSaved && _session.status === 'open' && _session.elements.length > 0);
}

export async function createWhiteboardSession(title){
  _session = await whiteboardApi.create(title);
  setWhiteboardHash(_session.joinCode);
  return _session;
}

export async function joinWhiteboardSession(joinCode){
  var session = await whiteboardApi.join(joinCode);
  _session = session;
  setWhiteboardHash(session.joinCode);
  return session;
}

export async function leaveWhiteboardSession(){
  if(!_session) return;
  try { await whiteboardApi.leave(_session.id); } catch(e){ /* best-effort — closing the modal matters more than this succeeding */ }
  _session = null;
  clearWhiteboardHash();
}

export async function saveWhiteboardSession(){
  if(!_session) return;
  await whiteboardApi.save(_session.id);
  _session.isSaved = true;
  _onStateChanged();
}

export async function closeWhiteboardSession(){
  if(!_session) return;
  await whiteboardApi.close(_session.id);
  _session = null;
  clearWhiteboardHash();
}

export async function addWhiteboardElement(elementType, elementJson){
  if(!_session) return null;
  var element = await whiteboardApi.addElement(_session.id, elementType, elementJson);
  _session.elements.push(element);
  return element;
}

export async function removeWhiteboardElement(elementId){
  if(!_session) return;
  await whiteboardApi.removeElement(_session.id, elementId);
  _session.elements = _session.elements.filter(function(e){ return e.id !== elementId; });
}

/* Best-effort, fire-and-forget — only actually reaches a listener on the .NET/php-api tiers (see
   whiteboardApi.cursorMove's own doc comment); silently ignored here on any failure (a 404 from
   mariadb-api, a dropped request, whatever) since a missed cursor frame is purely cosmetic. */
export function sendWhiteboardCursorMove(x, y){
  if(!_session) return;
  whiteboardApi.cursorMove(_session.id, x, y).catch(function(){});
}

// ---- SSE handlers (wired from features/live-updates.js's dispatchEvent) ----

export function handleWhiteboardParticipantEvent(payload){
  if(!_session || payload.sessionId !== _session.id) return;
  if(payload.changeType === 'joined'){
    var already = _session.participants.some(function(p){ return p.userId === payload.userId; });
    if(!already){
      _session.participants.push({userId: payload.userId, displayName: payload.displayName, isHost: payload.userId === _session.hostUserId, isOnline: true});
    }
  } else if(payload.changeType === 'left'){
    _session.participants = _session.participants.filter(function(p){ return p.userId !== payload.userId; });
  }
  _onStateChanged();
}

export function handleWhiteboardElementEvent(payload){
  if(!_session || payload.sessionId !== _session.id) return;
  // The acting client's own tab is excluded server-side from this broadcast (excludeClientSessionId),
  // so there's no need to guard against re-applying our own optimistic change here.
  if(payload.changeType === 'added'){
    var already = _session.elements.some(function(e){ return e.id === payload.element.id; });
    if(!already) _session.elements.push(payload.element);
  } else if(payload.changeType === 'removed'){
    _session.elements = _session.elements.filter(function(e){ return e.id !== payload.element.id; });
  }
  _onStateChanged();
}

export function handleWhiteboardSessionClosedEvent(payload){
  if(!_session || payload.sessionId !== _session.id) return;
  _session = null;
  clearWhiteboardHash();
  _onSessionClosedRemotely();
}

// ---- Live cursors (.NET + php-api tiers only — see WHITEBOARD_CURSOR_THROTTLE_MS/config.js) ----

var _cursorHandlers = []; // (userId, displayName, x, y) => void, registered by modals/whiteboard.js

export function onWhiteboardCursorMoved(handler){
  _cursorHandlers.push(handler);
}

export function handleWhiteboardCursorMovedEvent(payload){
  if(!_session || payload.sessionId !== _session.id || payload.userId === getCurrentUserId()) return;
  _cursorHandlers.forEach(function(handler){ handler(payload.userId, payload.displayName, payload.x, payload.y); });
}
