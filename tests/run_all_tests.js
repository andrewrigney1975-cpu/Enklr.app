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

testFiles.forEach(function(file) {
  const result = spawnSync(process.execPath, [path.join(dir, file)], {
    encoding: 'utf8',
    timeout: 120000,
    cwd: dir
  });
  const output = result.stdout || '';
  const pass = (output.match(/^PASS/gm) || []).length;
  const fail = (output.match(/^FAIL/gm) || []).length;
  totalPass += pass;
  totalFail += fail;
  const crashed = result.status !== 0 && fail === 0;

  const status = crashed ? '  CRASH ' : (fail > 0 ? '  FAIL  ' : '  pass  ');
  const detail = crashed ? result.stderr.split('\n').slice(0, 2).join(' ') : (fail > 0 ? (pass + '/' + (pass+fail)) : (pass + '/' + (pass+fail)));
  process.stdout.write(status + file.padEnd(55) + detail + '\n');

  if(fail > 0){
    output.split('\n').filter(l => l.startsWith('FAIL')).forEach(l => process.stdout.write('         ' + l + '\n'));
  }
  if(crashed){
    process.stdout.write('         ' + (result.stderr || '(no stderr)').slice(0, 200) + '\n');
  }

  results.push({ file, pass, fail, crashed });
});

const total = totalPass + totalFail;
process.stdout.write('\n' + '─'.repeat(65) + '\n');
process.stdout.write('TOTAL: ' + totalPass + ' pass, ' + totalFail + ' fail  (' + testFiles.length + ' files)\n');

if(totalFail > 0){
  process.stdout.write('\nFailed files:\n');
  results.filter(r => r.fail > 0 || r.crashed).forEach(r => {
    process.stdout.write('  ' + r.file + (r.crashed ? ' (CRASHED)' : ' (' + r.fail + ' failing)') + '\n');
  });
  process.stdout.write('\nNote: if a test fails in the full sweep but passes alone, it is a jsdom\n');
  process.stdout.write('batch flake — re-run the specific file 3 times to confirm:\n');
  process.stdout.write('  for i in 1 2 3; do node <file>.js | grep -c "^FAIL"; done\n');
}

process.exit(totalFail > 0 ? 1 : 0);
