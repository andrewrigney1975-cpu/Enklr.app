"use strict";

import { TASK_SCORE_MIN, TASK_SCORE_MAX, TASK_PROGRESS_MIN, TASK_PROGRESS_MAX, MEMBER_PALETTE } from './config.js';

export function pad2(n){ return n < 10 ? '0' + n : '' + n; }

export function localDateValueFromDate(d){
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* "YYYY-MM-DD" (local, from a date input) -> UTC ISO string, or null */
export function localDateValueToUTCISO(value){
  if(!value) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!m) return null;
  var d = new Date(parseInt(m[1],10), parseInt(m[2],10) - 1, parseInt(m[3],10));
  if(isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* UTC ISO string -> "YYYY-MM-DD" (local, for a date input), or '' */
export function utcISOToLocalDateValue(iso){
  if(!iso) return '';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return localDateValueFromDate(d);
}

/* This app's internal representation of a "date-only" field (task/release/risk start/end dates etc.)
   is, perhaps surprisingly, a full UTC ISO datetime string — specifically, the UTC instant of LOCAL
   midnight on the intended calendar date (see localDateValueToUTCISO above). The server's equivalent
   fields are genuine DateOnly values, wire-formatted as a bare "YYYY-MM-DD" with no time or timezone
   component at all.

   Converting between the two must go through the LOCAL calendar date (utcISOToLocalDateValue —
   exactly what the <input type="date"> already shows), never by slicing the first 10 characters off
   the UTC ISO string directly. Slicing reads off the UTC calendar date instead, which only happens to
   match the local one for timezones behind UTC (roughly the Americas) — anywhere ahead of UTC
   (Australia included), local midnight has already rolled into the PREVIOUS UTC day, so the sliced
   date is one day earlier than what was actually entered. This was the cause of a real bug: task
   start/end dates silently shifting back a day for every server round-trip in AEST. */
export function isoToServerDateOnly(iso){
  if(!iso) return null;
  return utcISOToLocalDateValue(iso) || null;
}

/* Inverse of isoToServerDateOnly — a bare "YYYY-MM-DD" DateOnly string from the server back into this
   app's internal UTC-ISO-local-midnight representation. Same format as a date <input>'s value, so this
   is just localDateValueToUTCISO under a name that documents which direction/purpose it's used for. */
export function serverDateOnlyToIso(dateOnly){
  return localDateValueToUTCISO(dateOnly);
}

/* UTC ISO string -> a friendly local display string, or '' */
export function utcISOToLocalDisplayDate(iso){
  if(!iso) return '';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
}

/* UTC ISO string -> a friendly local date+time display string, or ''.
   Used for audit-trail timestamps, where the time of day (not just the
   day) is the point. */
export function utcISOToLocalDisplayDateTime(iso){
  if(!iso) return '';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'}) +
    ', ' + d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
}

export function defaultStartDateValue(){
  return localDateValueFromDate(new Date());
}

export function defaultEndDateValue(){
  var d = new Date();
  d.setDate(d.getDate() + 14);
  return localDateValueFromDate(d);
}

/* Guards against hand-edited/corrupted import files passing through
   garbage as a date string. */
export function isValidISODateString(v){
  return typeof v === 'string' && v.length > 0 && !isNaN(new Date(v).getTime());
}

/* Business Value and Task Cost are integers clamped to [1, 1000].
   Anything missing, non-numeric, or out of range falls back to the
   floor of the range (1) rather than being rejected outright, so a
   hand-edited or legacy file always yields a usable score. */
export function clampTaskScore(value){
  var n = Math.round(Number(value));
  if(!isFinite(n)) return TASK_SCORE_MIN;
  if(n < TASK_SCORE_MIN) return TASK_SCORE_MIN;
  if(n > TASK_SCORE_MAX) return TASK_SCORE_MAX;
  return n;
}

/* Progress is an integer percentage clamped to [0, 100]. Anything
   missing or non-numeric falls back to 0 (not yet started). */
export function clampProgress(value){
  var n = Math.round(Number(value));
  if(!isFinite(n)) return TASK_PROGRESS_MIN;
  if(n < TASK_PROGRESS_MIN) return TASK_PROGRESS_MIN;
  if(n > TASK_PROGRESS_MAX) return TASK_PROGRESS_MAX;
  return n;
}

/* Effort hours are decimal and non-negative, rounded to 2dp to avoid
   float drift. Anything missing, non-numeric, or negative falls back
   to 0 (not yet estimated/logged). */
export function clampEffortHours(value){
  var n = Number(value);
  if(!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function memberColorForIndex(i){
  return MEMBER_PALETTE[i % MEMBER_PALETTE.length];
}

/* Blends a "#rrggbb" color 14/15 of the way to white, e.g. #ff0000 ->
   #ffeeee, for use as a subtle background tint behind that color's
   accent border. Invalid input returns null so callers can skip
   applying a tint. */
export function lightenHexColor(hex){
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if(!m) return null;
  var num = parseInt(m[1], 16);
  var r = (num >> 16) & 255;
  var g = (num >> 8) & 255;
  var b = num & 255;
  function towardWhite(c){ return Math.round(c + (255 - c) * (14/15)); }
  function hex2(c){ var s = c.toString(16); return s.length < 2 ? '0' + s : s; }
  return '#' + hex2(towardWhite(r)) + hex2(towardWhite(g)) + hex2(towardWhite(b));
}

export function memberInitials(name){
  var parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length === 0) return '?';
  if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
