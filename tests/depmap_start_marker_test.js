const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  doc.getElementById('depMapBtn').click();
  await wait(20);

  const svg = doc.querySelector('#depMapInner svg');
  const startBlocked = svg.querySelector('#kf-dot-start-blocked');
  const startDone = svg.querySelector('#kf-dot-start-done');
  log('"kf-dot-start-blocked" start marker exists', !!startBlocked);
  log('"kf-dot-start-done" start marker exists', !!startDone);

  [startBlocked, startDone].forEach(marker => {
    const circle = marker.querySelector('circle');
    log('"' + marker.id + '" marker contains a <circle> element', !!circle);
    log('"' + marker.id + '" circle is filled with var(--kf-surface)', circle.getAttribute('fill') === 'var(--kf-surface)', circle.getAttribute('fill'));
    log('"' + marker.id + '" circle has a stroke set (not "none")', !!circle.getAttribute('stroke') && circle.getAttribute('stroke') !== 'none', circle.getAttribute('stroke'));
    log('"' + marker.id + '" circle has a stroke-width set', !!circle.getAttribute('stroke-width'), circle.getAttribute('stroke-width'));
  });

  log('blocked start marker is stroked in the blocked/red color', startBlocked.querySelector('circle').getAttribute('stroke') === '#de350b');
  log('done start marker is stroked in the done/grey color', startDone.querySelector('circle').getAttribute('stroke') === '#8993a4');

  const paths = doc.querySelectorAll('#depMapInner path[marker-end]');
  log('every rendered edge has both a marker-start and a marker-end', paths.length > 0 &&
      Array.from(paths).every(p => !!p.getAttribute('marker-start') && !!p.getAttribute('marker-end')), paths.length);

  console.log('\nDependency graph start-marker test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
