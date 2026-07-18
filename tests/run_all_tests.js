#!/usr/bin/env node
/* run_all_tests.js — runs every *_test.js in this directory and prints a summary.
   Usage: node run_all_tests.js */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const testFiles = fs.readdirSync(dir)
  .filter(f => f.endsWith('_test.js'))
  .sort();

let totalPass = 0, totalFail = 0;
const results = [];

process.stdout.write('\nRunning ' + testFiles.length + ' test files...\n\n');

// Every file in this suite boots a fresh JSDOM against the full bundled dist/index.html (now 1.3MB+,
// see CLAUDE.md's Advanced Query/AlaSQL note) and relies on fixed-millisecond wait()s for that boot
// to finish - inherently timing-sensitive, and worse under whatever load this machine (or a CI
// runner) happens to be under at the moment a given file's subprocess spawns. This is the suite's
// own long-documented "batch flake": a file that fails in the full sweep but passes standalone,
// non-deterministically - a DIFFERENT random subset fails from one full run to the next, confirmed
// live (30 fails one run, 90 fails covering a mostly disjoint file set the next, no code change in
// between). Previously the documented fix was a human re-running the specific file 3x by hand before
// trusting a red result; MAX_ATTEMPTS formalizes exactly that inside the runner itself, so a flaky
// file that eventually passes doesn't fail the whole suite (and CI) on a non-regression, while a
// genuinely broken file - which fails the same way on every attempt - still fails for real.
var MAX_ATTEMPTS = 3;

function runOnce(file) {
  const result = spawnSync(process.execPath, [path.join(dir, file)], {
    encoding: 'utf8',
    timeout: 120000,
    cwd: dir
  });
  const output = result.stdout || '';
  const pass = (output.match(/^PASS/gm) || []).length;
  const fail = (output.match(/^FAIL/gm) || []).length;
  const crashed = result.status !== 0 && fail === 0;
  return { result, output, pass, fail, crashed };
}

testFiles.forEach(function(file) {
  var attempt = runOnce(file);
  var attemptsUsed = 1;
  while ((attempt.fail > 0 || attempt.crashed) && attemptsUsed < MAX_ATTEMPTS) {
    attempt = runOnce(file);
    attemptsUsed++;
  }
  const { result, output, pass, fail, crashed } = attempt;
  const flaky = attemptsUsed > 1 && fail === 0 && !crashed;

  totalPass += pass;
  totalFail += fail;

  const status = crashed ? '  CRASH ' : (fail > 0 ? '  FAIL  ' : (flaky ? '  FLAKY ' : '  pass  '));
  const detail = (pass + '/' + (pass+fail)) + (flaky ? ' (passed on attempt ' + attemptsUsed + '/' + MAX_ATTEMPTS + ')' : '');
  process.stdout.write(status + file.padEnd(55) + detail + '\n');

  if(fail > 0){
    output.split('\n').filter(l => l.startsWith('FAIL')).forEach(l => process.stdout.write('         ' + l + '\n'));
  }
  if(crashed){
    process.stdout.write('         ' + (result.stderr || '(no stderr)').slice(0, 200) + '\n');
  }
  if((fail > 0 || crashed) && attemptsUsed >= MAX_ATTEMPTS){
    process.stdout.write('         (failed on all ' + MAX_ATTEMPTS + ' attempts - not batch flake)\n');
  }

  results.push({ file, pass, fail, crashed, flaky });
});

const total = totalPass + totalFail;
const flakyFiles = results.filter(r => r.flaky);
process.stdout.write('\n' + '─'.repeat(65) + '\n');
process.stdout.write('TOTAL: ' + totalPass + ' pass, ' + totalFail + ' fail  (' + testFiles.length + ' files)\n');
if(flakyFiles.length > 0){
  process.stdout.write(flakyFiles.length + ' file(s) needed a retry to pass (batch flake, not a regression): ' +
    flakyFiles.map(r => r.file).join(', ') + '\n');
}

if(totalFail > 0){
  process.stdout.write('\nFailed files (failed on all ' + MAX_ATTEMPTS + ' attempts - a real regression, not batch flake):\n');
  results.filter(r => r.fail > 0 || r.crashed).forEach(r => {
    process.stdout.write('  ' + r.file + (r.crashed ? ' (CRASHED)' : ' (' + r.fail + ' failing)') + '\n');
  });
}

process.exit(totalFail > 0 ? 1 : 0);
