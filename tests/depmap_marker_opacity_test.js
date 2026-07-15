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
  const blockedMarker = svg.querySelector('#kf-arrow-blocked');
  const doneMarker = svg.querySelector('#kf-arrow-done');
  log('"kf-arrow-blocked" marker exists', !!blockedMarker);
  log('"kf-arrow-done" marker exists', !!doneMarker);
  log('"kf-arrow-blocked" refX is 9.25', blockedMarker.getAttribute('refX') === '9.25', blockedMarker.getAttribute('refX'));
  log('"kf-arrow-done" refX is 9.25', doneMarker.getAttribute('refX') === '9.25', doneMarker.getAttribute('refX'));

  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  // build.js's CSS minifier strips a leading "0" before a decimal point (0.8 -> .8) — both are
  // identical, valid CSS values, so the leading zero must be optional here, not required.
  log('--kf-depnode-opacity CSS variable is defined as 0.8', /--kf-depnode-opacity:\s*0?\.8\s*;/.test(style),
      (style.match(/--kf-depnode-opacity:[^;]+;/) || [])[0]);

  function ruleFor(selector){
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[{};,])\\s*' + escaped + '\\{([^}]*)\\}', 'm');
    const m = style.match(re);
    return m ? m[2] : null;
  }
  const boxRule = ruleFor('.kf-depnode rect.kf-depnode-box');
  log('.kf-depnode-box uses var(--kf-depnode-opacity) for its opacity', boxRule && /opacity:\s*var\(--kf-depnode-opacity\)/.test(boxRule), boxRule);

  console.log('\nDependency graph marker/opacity test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
