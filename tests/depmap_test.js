const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('../dist/index.html', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  url: 'http://localhost/',
  pretendToBeVisual: true
});
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // Open the dependency map for the seeded Sample Project (5 tasks: t4 depends on t2 AND t3, and
  // t5 is a sub-task of t1 \u2014 see storage.js's createSeedDB)
  doc.getElementById('depMapBtn').click();
  await wait(20);

  const overlayHidden = doc.getElementById('depMapOverlay').classList.contains('hidden');
  log('dependency map overlay opens', !overlayHidden);

  const svg = doc.querySelector('#depMapInner svg');
  log('svg element rendered', !!svg);

  const nodes = doc.querySelectorAll('.kf-depnode');
  log('5 nodes rendered (no duplication, unlike tree export)', nodes.length === 5, 'got ' + nodes.length);

  const allPaths = doc.querySelectorAll('#depMapInner path[marker-end]');
  // dependency edges: t2->t1(1), t3->t2(1), t4->t2 + t4->t3 (2) = 4; plus 1 sub-task edge (t5->t1).
  log('5 edges rendered total (4 dependency + 1 sub-task)', allPaths.length === 5, 'got ' + allPaths.length);

  const paths = Array.from(allPaths).filter(p => p.getAttribute('stroke') !== '#6554c0');
  const subtaskPaths = Array.from(allPaths).filter(p => p.getAttribute('stroke') === '#6554c0');
  log('4 of those are dependency edges (not the purple sub-task one)', paths.length === 4, paths.length);
  log('exactly 1 is the purple sub-task edge', subtaskPaths.length === 1, subtaskPaths.length);
  log('the sub-task edge is dashed', subtaskPaths[0] && subtaskPaths[0].getAttribute('stroke-dasharray') === '5 4');

  // Arrowheads (end) should be stroked, solid-filled circles; start markers
  // should be stroked circles filled with the surface var (hollow-looking).
  // 3 pairs of markers exist now that the seed data has a real sub-task edge too (blocked/done/subtask).
  const markerCircles = doc.querySelectorAll('#depMapInner marker circle');
  log('marker defs use circle elements for both end and start markers', markerCircles.length === 6, markerCircles.length);

  const endMarkerCircles = doc.querySelectorAll('#depMapInner marker[id^="kf-arrow-"] circle');
  log('end-marker circles are filled using their state color (not hollow)',
      endMarkerCircles.length === 3 && Array.from(endMarkerCircles).every(c => c.getAttribute('fill') !== 'none' && c.getAttribute('fill') === c.getAttribute('stroke')),
      endMarkerCircles.length);

  const startMarkerCircles = doc.querySelectorAll('#depMapInner marker[id^="kf-dot-start-"] circle');
  log('start-marker circles are filled with the surface var (hollow-looking against the stroke)',
      startMarkerCircles.length === 3 && Array.from(startMarkerCircles).every(c => c.getAttribute('fill') === 'var(--kf-surface)'),
      Array.from(startMarkerCircles).map(c => c.getAttribute('fill')).join(','));
  log('start-marker circles are stroked with their state color, matching the corresponding end marker',
      Array.from(startMarkerCircles).every(c => !!c.getAttribute('stroke') && c.getAttribute('stroke') !== 'none'),
      Array.from(startMarkerCircles).map(c => c.getAttribute('stroke')).join(','));

  log('marker circles have a stroke color set', Array.from(markerCircles).every(c => !!c.getAttribute('stroke')));
  const markerTriangles = doc.querySelectorAll('#depMapInner marker path');
  log('no leftover triangle-path arrowheads remain', markerTriangles.length === 0, markerTriangles.length);

  // Check that blocked edges (target not yet Done) are colored red and resolved ones green
  let redCount = 0, greyCount = 0;
  paths.forEach(p => {
    const stroke = p.getAttribute('stroke');
    if (stroke === '#de350b') redCount++;
    if (stroke === '#8993a4') greyCount++;
  });
  log('dependency edges colored by blocked/resolved state', redCount + greyCount === 4, 'red=' + redCount + ' grey=' + greyCount);

  log('every edge also has a marker-start attribute (not just marker-end)',
      Array.from(allPaths).every(p => !!p.getAttribute('marker-start')), Array.from(allPaths).map(p => p.getAttribute('marker-start')).join(','));
  log('each dependency edge\u2019s start marker is correctly paired with its stroke color (blocked->blocked dot, done->done dot)',
      paths.every(p => {
        const stroke = p.getAttribute('stroke');
        const startMarker = p.getAttribute('marker-start');
        if (stroke === '#de350b') return startMarker === 'url(#kf-dot-start-blocked)';
        if (stroke === '#8993a4') return startMarker === 'url(#kf-dot-start-done)';
        return false;
      }));
  log('the sub-task edge\u2019s start marker is the purple sub-task dot',
      subtaskPaths[0] && subtaskPaths[0].getAttribute('marker-start') === 'url(#kf-dot-start-subtask)');

  // Legend present
  const legendText = doc.getElementById('depMapLegend').textContent;
  log('legend explains blocked vs completed', legendText.indexOf('Blocking') !== -1 && legendText.indexOf('Completed') !== -1);

  // Zoom controls
  const zoomLabelBefore = doc.getElementById('depMapZoomLabel').textContent;
  doc.getElementById('depMapZoomInBtn').click();
  await wait(10);
  const zoomLabelAfter = doc.getElementById('depMapZoomLabel').textContent;
  log('zoom in changes zoom label', zoomLabelBefore !== zoomLabelAfter, zoomLabelBefore + ' -> ' + zoomLabelAfter);

  const svgWidthAttr = parseInt(doc.querySelector('#depMapInner svg').getAttribute('width'), 10);
  log('zoom in increases rendered svg width', svgWidthAttr > 0);

  doc.getElementById('depMapResetBtn').click();
  await wait(10);
  log('reset restores 100% zoom label', doc.getElementById('depMapZoomLabel').textContent === '100%');

  // Clicking a node opens the task edit modal and closes the dependency map
  const firstNode = doc.querySelector('.kf-depnode[data-task-id]');
  const clickedTaskId = firstNode.getAttribute('data-task-id');
  firstNode.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);

  const depMapHiddenAfterClick = doc.getElementById('depMapOverlay').classList.contains('hidden');
  log('clicking a node closes the dependency map', depMapHiddenAfterClick);
  const taskOverlayHiddenAfterClick = doc.getElementById('taskOverlay').classList.contains('hidden');
  log('clicking a node opens the task modal', !taskOverlayHiddenAfterClick);
  log('task modal title field is populated', doc.getElementById('taskTitleInput').value.length > 0, doc.getElementById('taskTitleInput').value);

  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // Empty-project case: switch to a brand-new empty project and open the map again
  doc.getElementById('newProjectBtn').click();
  await wait(10);
  doc.getElementById('projectNameInput').value = 'Empty Co';
  doc.getElementById('projectKeyInput').value = 'EMP';
  doc.getElementById('projectSaveBtn').click();
  await wait(10);

  doc.getElementById('depMapBtn').click();
  await wait(20);
  const emptyMsg = doc.getElementById('depMapInner').textContent;
  log('empty project shows friendly empty state', emptyMsg.indexOf('No tasks yet') !== -1, emptyMsg);
  doc.getElementById('depMapClose').click();
  await wait(10);
  log('close button hides overlay', doc.getElementById('depMapOverlay').classList.contains('hidden'));

  console.log('\nDependency map test complete.');
  process.exit(0);
})().catch(e => {
  console.error('TEST CRASHED:', e);
  process.exit(1);
});
