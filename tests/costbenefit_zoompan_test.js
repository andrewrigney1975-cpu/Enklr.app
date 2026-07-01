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
  const scroll = doc.getElementById('costBenefitScroll');

  scroll.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });

  const zoomLabel = () => doc.getElementById('costBenefitZoomLabel').textContent;
  const before = zoomLabel();
  log('starts at 100%', before === '100%', before);

  let wheelUp = new window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true });
  scroll.dispatchEvent(wheelUp);
  await wait(10);
  const afterUp = zoomLabel();
  log('wheel up (negative deltaY) zooms in', parseInt(afterUp) > parseInt(before), before + ' -> ' + afterUp);

  let wheelDown = new window.WheelEvent('wheel', { deltaY: 100, clientX: 400, clientY: 300, bubbles: true, cancelable: true });
  scroll.dispatchEvent(wheelDown);
  scroll.dispatchEvent(wheelDown);
  await wait(10);
  const afterDown = zoomLabel();
  log('wheel down (positive deltaY) zooms back out below the zoomed-in level', parseInt(afterDown) < parseInt(afterUp), afterUp + ' -> ' + afterDown);

  for (let i = 0; i < 40; i++) {
    scroll.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  }
  await wait(10);
  const maxed = parseInt(zoomLabel());
  log('zooming in repeatedly is clamped to a sane maximum (<=250%)', maxed <= 250, maxed);

  for (let i = 0; i < 60; i++) {
    scroll.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  }
  await wait(10);
  const minned = parseInt(zoomLabel());
  log('zooming out repeatedly is clamped to a sane minimum (>=30%)', minned >= 30, minned);

  let prevented = false;
  const testEvt = new window.WheelEvent('wheel', { deltaY: -50, clientX: 400, clientY: 300, bubbles: true, cancelable: true });
  const origPD = testEvt.preventDefault.bind(testEvt);
  testEvt.preventDefault = () => { prevented = true; origPD(); };
  scroll.dispatchEvent(testEvt);
  await wait(10);
  log('wheel handler calls preventDefault (page/container default scroll suppressed)', prevented);

  doc.getElementById('costBenefitResetBtn').click();
  await wait(10);
  log('reset button returns to 100%', zoomLabel() === '100%', zoomLabel());

  doc.getElementById('costBenefitZoomInBtn').click();
  await wait(10);
  log('zoom-in button increases zoom', zoomLabel() === '110%', zoomLabel());

  doc.getElementById('costBenefitZoomOutBtn').click();
  doc.getElementById('costBenefitZoomOutBtn').click();
  await wait(10);
  log('zoom-out button decreases zoom below the zoomed-in level', parseInt(zoomLabel()) < 110, zoomLabel());

  doc.getElementById('costBenefitResetBtn').click();
  await wait(10);

  Object.defineProperty(scroll, 'scrollLeft', { value: 50, writable: true });
  Object.defineProperty(scroll, 'scrollTop', { value: 50, writable: true });

  log('cursor shows grab affordance before any drag', !scroll.classList.contains('kf-costbenefit-panning'));

  scroll.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, clientX: 300, clientY: 300, bubbles: true }));
  await wait(5);
  log('panning class applied while mouse is held down', scroll.classList.contains('kf-costbenefit-panning'));

  doc.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 250, clientY: 280, bubbles: true }));
  await wait(5);
  log('dragging updates scrollLeft (panned)', scroll.scrollLeft === 50 - (250 - 300), 'scrollLeft=' + scroll.scrollLeft);
  log('dragging updates scrollTop (panned)', scroll.scrollTop === 50 - (280 - 300), 'scrollTop=' + scroll.scrollTop);

  doc.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await wait(5);
  log('panning class removed after mouse up', !scroll.classList.contains('kf-costbenefit-panning'));

  const point = doc.querySelector('.kf-cb-point');
  scroll.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
  doc.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 140, clientY: 140, bubbles: true }));
  doc.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  point.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
  log('a real drag does not open the task modal even if it ends over a point',
      doc.getElementById('taskOverlay').classList.contains('hidden'));
  log('cost/benefit chart stays open after a drag (not accidentally closed)',
      !doc.getElementById('costBenefitOverlay').classList.contains('hidden'));

  scroll.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, clientX: 200, clientY: 200, bubbles: true }));
  doc.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  point.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
  log('a plain click (no drag) on a point still opens the task modal',
      !doc.getElementById('taskOverlay').classList.contains('hidden'));
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  doc.getElementById('costBenefitBtn').click();
  await wait(20);
  doc.getElementById('costBenefitZoomInBtn').click();
  doc.getElementById('costBenefitZoomInBtn').click();
  await wait(10);
  log('zoom changed within this session', zoomLabel() !== '100%', zoomLabel());
  doc.getElementById('costBenefitClose').click();
  await wait(10);
  doc.getElementById('costBenefitBtn').click();
  await wait(20);
  log('reopening the modal resets zoom back to 100%', zoomLabel() === '100%', zoomLabel());

  console.log('\nCost/Benefit Chart zoom/pan test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
