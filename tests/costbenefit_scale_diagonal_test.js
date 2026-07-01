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

  doc.getElementById('costBenefitBtn').click();
  await wait(20);

  // ── 1. CSS: scroll container provides at least 50px padding ──────────────
  const scrollStyles = (html.match(/\.kf-costbenefit-scroll\{([^}]*)\}/) || [])[1] || '';
  log('scroll container padding is 50px (was 28px)', /padding:\s*50px/.test(scrollStyles), scrollStyles);

  // ── 2. CSS: inner wrapper and SVG now render at native size (zoomable/scrollable, not stretched) ──
  const innerStyles = (html.match(/\.kf-costbenefit-inner\{([^}]*)\}/) || [])[1] || '';
  log('inner wrapper has no max-width cap anymore', !/max-width/.test(innerStyles), innerStyles);
  log('inner wrapper shrink-wraps to its native content size (display:inline-block), matching the zoomable Dependency Map pattern',
      /display:\s*inline-block/.test(innerStyles), innerStyles);

  const svgStyles = (html.match(/\.kf-costbenefit-inner svg\{([^}]*)\}/) || [])[1] || '';
  log('SVG has no forced 100%/100% sizing — its width/height attributes are set explicitly by the zoom logic instead',
      !/width:\s*100%/.test(svgStyles) && !/height:\s*100%/.test(svgStyles), svgStyles);
  log('SVG no longer uses height:auto', !/height:\s*auto/.test(svgStyles));

  // ── 3. The rendered <svg> element doesn't override preserveAspectRatio ───
  const svgEl = doc.querySelector('#costBenefitInner svg');
  log('rendered svg keeps the default preserveAspectRatio (scale-to-fit, centered)', !svgEl.hasAttribute('preserveAspectRatio'));
  log('rendered svg still declares its viewBox', svgEl.getAttribute('viewBox') === '0 0 880 680', svgEl.getAttribute('viewBox'));

  // ── 4. Diagonal dashed line from corner to corner is present ─────────────
  const lines = Array.from(svgEl.querySelectorAll('line'));
  const plotLeft = 76, plotRight = 880 - 30, plotTop = 44, plotBottom = 680 - 64;
  const diagonal = lines.find(l =>
    parseFloat(l.getAttribute('x1')) === plotLeft && parseFloat(l.getAttribute('y1')) === plotBottom &&
    parseFloat(l.getAttribute('x2')) === plotRight && parseFloat(l.getAttribute('y2')) === plotTop
  );
  log('a diagonal line runs from the bottom-left to the top-right plot corner', !!diagonal,
      diagonal ? diagonal.outerHTML : lines.map(l => `(${l.getAttribute('x1')},${l.getAttribute('y1')})->(${l.getAttribute('x2')},${l.getAttribute('y2')})`).join(' | '));
  log('the diagonal line is dashed', diagonal && diagonal.getAttribute('stroke-dasharray') === '5,4', diagonal && diagonal.getAttribute('stroke-dasharray'));
  log('the diagonal line matches the quadrant-divider style (stroke var, width)',
      diagonal && diagonal.style.stroke === 'var(--kf-border)' && diagonal.getAttribute('stroke-width') === '1.5',
      diagonal && (diagonal.style.stroke + ' / ' + diagonal.getAttribute('stroke-width')));

  const dashedLines = lines.filter(l => l.getAttribute('stroke-dasharray') === '5,4');
  log('there are now 3 dashed lines total (2 quadrant dividers + 1 new diagonal)', dashedLines.length === 3, dashedLines.length);

  // ── 5. Quadrant label renamed ──────────────────────────────────────────────
  const svgHTML = svgEl.innerHTML;
  log('"REVIEW DEMAND" label is present', svgHTML.indexOf('REVIEW DEMAND') !== -1);
  log('"THANKLESS TASKS" label no longer appears anywhere', svgHTML.indexOf('THANKLESS TASKS') === -1);
  log('the other three quadrant labels are unchanged', ['QUICK WINS','MAJOR PROJECTS','FILL-INS'].every(l => svgHTML.indexOf(l) !== -1));

  const texts = Array.from(svgEl.querySelectorAll('text'));
  const reviewDemandText = texts.find(t => t.textContent === 'REVIEW DEMAND');
  log('"REVIEW DEMAND" sits in the same bottom-right spot THANKLESS TASKS used to occupy',
      reviewDemandText && parseFloat(reviewDemandText.getAttribute('x')) === plotRight - 10 && parseFloat(reviewDemandText.getAttribute('y')) === plotBottom - 10,
      reviewDemandText ? (reviewDemandText.getAttribute('x') + ',' + reviewDemandText.getAttribute('y')) : 'not found');

  console.log('\nCost/Benefit Chart scaling/diagonal/label test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
