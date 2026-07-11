"use strict";

/* Bucket-boundary logic for the dashboard's activity/revenue charts. Mirrors the
   startFn/stepFn/labelFn shape used by the main app's timeline view (src/js/views/timeline.js),
   but operates on UTC midnight dates so it lines up exactly with the "YYYY-MM-DD" day keys
   returned by the /dashboard/activity and /dashboard/revenue endpoints (no local-timezone drift). */

export function parseISODateUTC(iso){
  var parts = iso.split('-');
  return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
}

export function toISODateUTC(d){
  return d.toISOString().slice(0, 10);
}

export function addDaysUTC(d, n){
  var r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonthsUTC(d, n){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function addYearsUTC(d, n){
  return new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1));
}

function startOfWeekMondayUTC(d){
  var r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var day = r.getUTCDay();
  var diff = (day === 0) ? -6 : (1 - day);
  return addDaysUTC(r, diff);
}

function startOfMonthUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function startOfYearUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); }

function pad2(n){ return n < 10 ? '0' + n : String(n); }
// Numeric dd/mm — shorter than a "11 Jun"-style locale string, which matters once each chart
// is half-width and packing many bucket labels along the x-axis.
function formatDDMM(d){ return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1); }
function formatMMYYYY(d){ return pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); }

export var GRANULARITY_CONFIG = {
  day: {
    label: 'Day',
    startFn: function(d){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); },
    stepFn: function(d){ return addDaysUTC(d, 1); },
    labelFn: formatDDMM
  },
  week: {
    label: 'Week',
    startFn: startOfWeekMondayUTC,
    stepFn: function(d){ return addDaysUTC(d, 7); },
    labelFn: formatDDMM
  },
  fortnight: {
    label: 'Fortnight',
    startFn: startOfWeekMondayUTC,
    stepFn: function(d){ return addDaysUTC(d, 14); },
    labelFn: formatDDMM
  },
  month: {
    label: 'Month',
    startFn: startOfMonthUTC,
    stepFn: function(d){ return addMonthsUTC(d, 1); },
    labelFn: formatMMYYYY
  },
  quarter: {
    label: 'Quarter',
    startFn: startOfMonthUTC,
    stepFn: function(d){ return addMonthsUTC(d, 3); },
    labelFn: function(d){
      var endM = addMonthsUTC(d, 2);
      return formatMMYYYY(d) + '–' + formatMMYYYY(endM);
    }
  },
  // "Year to Date" reuses a plain calendar-year bucket — the current (partial) year's bucket is
  // necessarily "to date" since it can't contain days that haven't happened yet.
  year: {
    label: 'Year to Date',
    startFn: startOfYearUTC,
    stepFn: function(d){ return addYearsUTC(d, 1); },
    labelFn: function(d){ return String(d.getUTCFullYear()); }
  }
};

export var GRANULARITY_ORDER = ['day', 'week', 'fortnight', 'month', 'quarter', 'year'];

/* Builds the list of buckets spanning [rangeStart, rangeEnd] (inclusive UTC dates), each with
   {start, end (exclusive), label}. */
export function buildBuckets(rangeStart, rangeEnd, granularity){
  var cfg = GRANULARITY_CONFIG[granularity] || GRANULARITY_CONFIG.month;
  var rangeEndExclusive = addDaysUTC(rangeEnd, 1);
  var buckets = [];
  var cursor = cfg.startFn(rangeStart);
  var guard = 0;
  while(cursor.getTime() < rangeEndExclusive.getTime() && guard < 2000){
    var next = cfg.stepFn(cursor);
    buckets.push({start: cursor, end: next, label: cfg.labelFn(cursor)});
    cursor = next;
    guard++;
  }
  if(buckets.length === 0){
    var next2 = cfg.stepFn(cursor);
    buckets.push({start: cursor, end: next2, label: cfg.labelFn(cursor)});
  }
  return buckets;
}

/* Sums a daily series (array of {date: 'YYYY-MM-DD', ...valueKey}) into the buckets spanning
   [rangeStart, rangeEnd]. Returns an array of {label, start, end, value} aligned to buildBuckets. */
export function bucketDailySeries(dailyPoints, valueKey, rangeStart, rangeEnd, granularity){
  var byDate = new Map();
  (dailyPoints || []).forEach(function(p){ byDate.set(p.date, p[valueKey] || 0); });

  var buckets = buildBuckets(rangeStart, rangeEnd, granularity);
  return buckets.map(function(bucket){
    var value = 0;
    for(var d = bucket.start; d.getTime() < bucket.end.getTime(); d = addDaysUTC(d, 1)){
      value += byDate.get(toISODateUTC(d)) || 0;
    }
    return {label: bucket.label, start: bucket.start, end: bucket.end, value: value};
  });
}
