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

  const logoSvg = doc.querySelector('#kfLogoIcon svg');
  log('header logo renders an inline SVG', !!logoSvg);

  const faviconMatch = html.indexOf("rect x='0' y='0' width='24' height='24' fill='%230c66e4'") !== -1;
  log('favicon source with the badge design is present (sanity check)', faviconMatch);

  const rects = logoSvg.querySelectorAll('rect');
  log('logo has exactly 4 rects (1 background + 3 bars), matching the touch-icon', rects.length === 4, rects.length);

  const bg = rects[0];
  log('background rect fills the full canvas edge-to-edge with no rounded corners (x=0,y=0,w=24,h=24,no rx)',
      bg.getAttribute('x') === '0' && bg.getAttribute('y') === '0' && bg.getAttribute('width') === '24' &&
      bg.getAttribute('height') === '24' && !bg.getAttribute('rx'));
  log('background rect uses the same blue fill (#0c66e4) as the touch-icon', bg.getAttribute('fill') === '#0c66e4', bg.getAttribute('fill'));

  const bar1 = rects[1], bar2 = rects[2], bar3 = rects[3];
  log('bar 1 matches the touch-icon (x=5,y=6,w=4,h=12, full opacity white)',
      bar1.getAttribute('x') === '5' && bar1.getAttribute('height') === '12' && bar1.getAttribute('fill') === '#fff' && !bar1.getAttribute('opacity'));
  log('bar 2 matches the touch-icon (x=10.5,y=6,w=4,h=7, opacity .85)',
      bar2.getAttribute('x') === '10.5' && bar2.getAttribute('height') === '7' && bar2.getAttribute('opacity') === '.85');
  log('bar 3 matches the touch-icon (x=16,y=6,w=4,h=10, opacity .7)',
      bar3.getAttribute('x') === '16' && bar3.getAttribute('height') === '10' && bar3.getAttribute('opacity') === '.7');

  log('logo SVG uses the same 0 0 24 24 viewBox as the touch-icon', logoSvg.getAttribute('viewBox') === '0 0 24 24');

  log('logo no longer renders the old generic "board" line icon (no stroke-based path)', !logoSvg.querySelector('path'));

  log('"Enkl" text still appears next to the logo icon', doc.querySelector('.kf-logo').textContent.indexOf('Enkl') !== -1);

  console.log('\nHeader logo / touch-icon design match test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
