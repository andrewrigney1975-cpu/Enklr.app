"use strict";

import { TASK_SCORE_MIN, TASK_SCORE_MAX, MEMBER_PALETTE } from './config.js';

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

/* UTC ISO string -> a friendly local display string, or '' */
export function utcISOToLocalDisplayDate(iso){
  if(!iso) return '';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
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

export function memberColorForIndex(i){
  return MEMBER_PALETTE[i % MEMBER_PALETTE.length];
}

export function memberInitials(name){
  var parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length === 0) return '?';
  if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
