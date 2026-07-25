/* Pure unit coverage for features/sort-filter.js — no DOM/JSDOM needed, since the module itself
   never touches the document. Run directly with `node sort_filter_unit_test.js` from tests/. */
const path = require('path');

function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

(async () => {
  const mod = await import(path.join('..', 'src', 'js', 'features', 'sort-filter.js').replace(/\\/g, '/'));
  const { inferValueType, compareValues, sortRows, parseFilterExpression, createRowFilter } = mod;

  // ---- inferValueType ------------------------------------------------------
  log('inferValueType: blank string is "empty"', inferValueType('') === 'empty');
  log('inferValueType: null is "empty"', inferValueType(null) === 'empty');
  log('inferValueType: a plain integer string is "number"', inferValueType('42') === 'number');
  log('inferValueType: a negative number is "number"', inferValueType('-5') === 'number');
  log('inferValueType: an ISO date string is "date"', inferValueType('2026-07-01') === 'date');
  log('inferValueType: an ISO datetime string is "date"', inferValueType('2026-07-01T10:00:00.000Z') === 'date');
  log('inferValueType: a short/non-ISO string is not misread as a date', inferValueType('26-07') === 'string');
  log('inferValueType: free text is "string"', inferValueType('Configure project modules') === 'string');

  // ---- compareValues --------------------------------------------------------
  log('compareValues: numeric compare (as numbers, not strings)', compareValues('9', '10') < 0);
  log('compareValues: string-only numeric compare would get this wrong (sanity check)', '9' > '10');
  log('compareValues: date compare is chronological', compareValues('2026-01-01', '2026-02-01') < 0);
  log('compareValues: blank always sorts after non-blank', compareValues('', 'anything') > 0);
  log('compareValues: two blanks are equal', compareValues('', null) === 0);
  log('compareValues: falls back to numeric-aware string compare', compareValues('Task 9', 'Task 10') < 0);

  // ---- sortRows ---------------------------------------------------------------
  {
    const rows = [{v: '100'}, {v: '9'}, {v: '20'}];
    sortRows(rows, r => r.v, 1);
    log('sortRows: ascending numeric sort ("9" before "20" before "100")', rows.map(r => r.v).join(',') === '9,20,100', rows.map(r => r.v).join(','));
    sortRows(rows, r => r.v, -1);
    log('sortRows: descending numeric sort', rows.map(r => r.v).join(',') === '100,20,9', rows.map(r => r.v).join(','));
  }
  {
    const rows = [{v: '2026-03-01'}, {v: ''}, {v: '2026-01-01'}];
    sortRows(rows, r => r.v, 1);
    log('sortRows: blanks sort last ascending', rows[rows.length - 1].v === '', rows.map(r => r.v).join('|'));
    sortRows(rows, r => r.v, -1);
    log('sortRows: blanks sort last descending too', rows[rows.length - 1].v === '', rows.map(r => r.v).join('|'));
  }

  // ---- parseFilterExpression: ranges ------------------------------------------
  {
    const test = parseFilterExpression('10..50');
    log('range: value inside an inclusive numeric range matches', test('25') === true);
    log('range: value at the lower bound matches (inclusive)', test('10') === true);
    log('range: value at the upper bound matches (inclusive)', test('50') === true);
    log('range: value outside the range does not match', test('51') === false);
  }
  {
    const test = parseFilterExpression('2026-01-01..2026-02-01');
    log('date range: a date inside the range matches', test('2026-01-15') === true);
    log('date range: a date outside the range does not match', test('2026-03-01') === false);
  }

  // ---- parseFilterExpression: comparators -------------------------------------
  {
    log('comparator >: matches strictly greater', parseFilterExpression('>100')('150') === true);
    log('comparator >: excludes equal value', parseFilterExpression('>100')('100') === false);
    log('comparator >=: includes equal value', parseFilterExpression('>=100')('100') === true);
    log('comparator <: matches strictly less', parseFilterExpression('<100')('50') === true);
    log('comparator <=: includes equal value', parseFilterExpression('<=100')('100') === true);
    log('comparator !=: excludes the equal value', parseFilterExpression('!=100')('100') === false);
    log('comparator !=: matches a different value', parseFilterExpression('!=100')('99') === true);
    log('comparator =: exact numeric match', parseFilterExpression('=100')('100') === true);
    log('comparator applies to dates too (>)', parseFilterExpression('>2026-01-01')('2026-06-01') === true);
  }

  // ---- parseFilterExpression: plain terms --------------------------------------
  {
    log('plain numeric term is an exact match, not a substring match',
        parseFilterExpression('80')('180') === false);
    log('plain numeric term matches the exact number', parseFilterExpression('80')('80') === true);
    log('plain text term is a case-insensitive substring match',
        parseFilterExpression('config')('Configure project modules') === true);
    log('plain text term with no match fails', parseFilterExpression('zzz')('Configure project modules') === false);
    log('blank expression matches everything', parseFilterExpression('')('anything') === true);
  }

  // ---- comparator/range operand that cannot be read as number/date falls back to substring -----
  {
    // ">foo" against a non-numeric, non-date value: falls back to a literal substring match on
    // the raw expression text rather than silently excluding the row.
    const test = parseFilterExpression('>foo');
    log('unparsable comparator operand falls back to substring match (present)', test('a foo bar') === true);
    log('unparsable comparator operand falls back to substring match (absent)', test('nothing here') === false);
  }

  // ---- createRowFilter: combining multiple column filters (AND) -----------------
  {
    const rows = [
      {title: 'Alpha task', cost: '80'},
      {title: 'Beta task', cost: '120'},
      {title: 'Alpha follow-up', cost: '200'}
    ];
    const getValue = (row, field) => row[field];
    const predicate = createRowFilter({title: 'alpha', cost: '>100'}, getValue);
    const matched = rows.filter(predicate).map(r => r.title);
    log('createRowFilter ANDs multiple column conditions together',
        matched.length === 1 && matched[0] === 'Alpha follow-up', matched.join(','));

    const noFilters = createRowFilter({}, getValue);
    log('createRowFilter with no active filters matches everything', rows.every(noFilters));

    const blankOnly = createRowFilter({title: '   '}, getValue);
    log('createRowFilter treats a whitespace-only filter as inactive', rows.every(blankOnly));
  }

  console.log('Sort/filter unit test complete.');
})().catch(e => { console.error('FAIL - unexpected error', e); process.exit(1); });
