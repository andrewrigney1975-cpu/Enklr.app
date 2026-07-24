const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the board card "depends" chip's hover popover — same hover-anchored popover pattern as
   the Org Chart's member popover, listing the tasks THIS task depends on, each key a real "#!/KEY"
   hashbang deep link. Uses the seeded Sample Project, where a known task depends on two others
   (same fixture depmap_test.js already relies on for its own edge-count assertions). */

(async () => {
  try {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  function currentProject(){
    var raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
    return raw.projects[raw.currentProjectId];
  }

  var project = currentProject();
  var tasks = Object.values(project.tasks);
  var depender = tasks.find(function(t){ return (t.dependencies || []).length === 2; });
  var zeroDepTask = tasks.find(function(t){ return (t.dependencies || []).length === 0; });
  log('seeded fixture has a task depending on exactly 2 others', !!depender);
  log('seeded fixture has a task with no dependencies', !!zeroDepTask);

  var expectedKeys = depender.dependencies.map(function(id){ return project.tasks[id].key; }).sort();
  var expectedTitles = depender.dependencies.map(function(id){ return project.tasks[id].title; });

  var card = doc.querySelector('.kf-card[data-task-id="' + depender.id + '"]');
  var chip = card.querySelector('.kf-dep-chip');
  log('the depending card’s chip shows a count of 2', chip.textContent.trim().indexOf('2') !== -1, chip.textContent);
  log('a non-zero chip has no native title attribute (the popover replaces it)', !chip.hasAttribute('title'));

  var popover = doc.getElementById('taskDepPopover');
  log('popover starts hidden', popover.classList.contains('hidden'));

  chip.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  log('hovering the chip opens the popover', !popover.classList.contains('hidden'));
  log('popover title reports "Depends on 2 tasks"', doc.getElementById('taskDepPopoverTitle').textContent === 'Depends on 2 tasks', doc.getElementById('taskDepPopoverTitle').textContent);

  var links = Array.from(popover.querySelectorAll('a.kf-dep-key'));
  log('popover lists exactly 2 dependency links', links.length === 2, links.length);
  var actualKeys = links.map(function(a){ return a.textContent; }).sort();
  log('links show the correct dependency keys', JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), actualKeys.join(','));
  log('each link is a real "#!/KEY" hashbang link', links.every(function(a){ return a.getAttribute('href') === '#!/' + encodeURIComponent(a.textContent); }));
  var listedTitles = expectedTitles.every(function(title){ return popover.textContent.indexOf(title) !== -1; });
  log('popover also shows each dependency’s title', listedTitles);

  var dots = Array.from(popover.querySelectorAll('.kf-dep-priority-dot'));
  log('each row has a priority-colored dot before its key', dots.length === 2, dots.length);
  log('every dot has a non-empty background colour set', dots.every(function(d){ return !!d.style.background; }), dots.map(function(d){ return d.style.background; }).join(' | '));
  log('a dot precedes its row’s key link (dot renders before the <a> in DOM order)',
      dots.every(function(d){ var next = d.nextElementSibling; return next && next.tagName === 'A' && next.classList.contains('kf-dep-key'); }));

  // --- Connector: hovering a specific dependency row draws a line from the source card to it ---
  // jsdom has no real layout engine (every element's getBoundingClientRect() is all-zero by
  // default), so a deterministic mock stands in for real column/card positions here — enough to
  // exercise computeTaskDepConnectorPoints' actual routing math, which real layout would otherwise
  // hide behind numbers this test can't control.
  var realGetRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function(){
    if(this.classList && this.classList.contains('kf-column')){
      var cols = Array.from(doc.querySelectorAll('#board > .kf-column'));
      var idx = cols.indexOf(this);
      var left = idx * 300;
      return {left: left, right: left + 280, top: 100, bottom: 700, width: 280, height: 600};
    }
    if(this.classList && this.classList.contains('kf-card')){
      var col = this.closest('.kf-column');
      var cols2 = Array.from(doc.querySelectorAll('#board > .kf-column'));
      var colIdx = cols2.indexOf(col);
      var cardsInCol = Array.from(col.querySelectorAll('.kf-card'));
      var rowIdx = cardsInCol.indexOf(this);
      var left2 = colIdx * 300 + 10;
      var top2 = 150 + rowIdx * 100;
      return {left: left2, right: left2 + 260, top: top2, bottom: top2 + 80, width: 260, height: 80};
    }
    return realGetRect.call(this);
  };

  var connectorLayer = doc.getElementById('taskDepConnectorLayer');
  log('connector layer starts hidden', connectorLayer.classList.contains('hidden'));

  var firstRow = doc.querySelector('#taskDepPopoverList [data-task-id]');
  var firstDepId = firstRow.getAttribute('data-task-id');
  var firstDepTask = project.tasks[firstDepId];
  var firstDepCol = project.columns.find(function(c){ return c.id === firstDepTask.columnId; });
  var expectedColor = firstDepCol && firstDepCol.done ? '#8993a4' : '#de350b';

  firstRow.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  log('hovering a dependency row draws the connector (layer un-hidden)', !connectorLayer.classList.contains('hidden'));
  var path = connectorLayer.querySelector('path');
  log('connector renders a real SVG path element', !!path);
  log('connector path has non-empty "d" data', !!(path && path.getAttribute('d') && path.getAttribute('d').length > 0), path && path.getAttribute('d'));
  log('connector color matches the dependency’s done/blocked state', path && path.getAttribute('stroke') === expectedColor, path && path.getAttribute('stroke') + ' vs expected ' + expectedColor);

  var expectedStartMarker = firstDepCol && firstDepCol.done ? 'url(#kf-taskdep-dot-start-done)' : 'url(#kf-taskdep-dot-start-blocked)';
  var expectedEndMarker = firstDepCol && firstDepCol.done ? 'url(#kf-taskdep-arrow-done)' : 'url(#kf-taskdep-arrow-blocked)';
  log('connector has a marker-start (hollow dot, on the dependency’s own end)', path.getAttribute('marker-start') === expectedStartMarker, path.getAttribute('marker-start'));
  log('connector has a marker-end (solid dot, arriving at the source task)', path.getAttribute('marker-end') === expectedEndMarker, path.getAttribute('marker-end'));
  log('both referenced marker defs actually exist in the document', !!doc.getElementById('kf-taskdep-dot-start-blocked') && !!doc.getElementById('kf-taskdep-arrow-blocked'));

  firstRow.dispatchEvent(new window.Event('mouseout', { bubbles: true, relatedTarget: popover }));
  await wait(10);
  log('moving off that row (into the popover itself, not another row) clears the connector', connectorLayer.classList.contains('hidden'));

  firstRow.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  log('connector redraws on re-hover', !connectorLayer.classList.contains('hidden'));
  popover.dispatchEvent(new window.Event('mouseleave', { bubbles: false }));
  await wait(10);
  log('closing the popover also clears any live connector', connectorLayer.classList.contains('hidden'));

  window.Element.prototype.getBoundingClientRect = realGetRect;

  // Re-open the popover (the mouseleave above closed it) before the grace-period section below,
  // which assumes a freshly-opened popover.
  chip.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);

  // Leaving the chip defers the close by a grace period (long enough to cross the gap into the
  // popover below it) rather than closing immediately — the whole point of this feature.
  chip.dispatchEvent(new window.Event('mouseout', { bubbles: true, relatedTarget: doc.body }));
  await wait(10);
  log('moving the mouse away does NOT immediately close the popover (grace period)', !popover.classList.contains('hidden'));

  popover.dispatchEvent(new window.Event('mouseenter', { bubbles: false }));
  await wait(400);
  log('hovering the popover itself cancels the pending close, even after the grace period elapses', !popover.classList.contains('hidden'));

  popover.dispatchEvent(new window.Event('mouseleave', { bubbles: false }));
  await wait(10);
  log('leaving the popover itself closes it right away', popover.classList.contains('hidden'));

  // Re-open, then let the grace period actually elapse with the mouse never reaching the popover.
  chip.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  log('popover re-opens on hover', !popover.classList.contains('hidden'));
  chip.dispatchEvent(new window.Event('mouseout', { bubbles: true, relatedTarget: doc.body }));
  await wait(400);
  log('if the mouse never reaches the popover, it closes once the grace period elapses', popover.classList.contains('hidden'));

  var zeroCard = doc.querySelector('.kf-card[data-task-id="' + zeroDepTask.id + '"]');
  var zeroChip = zeroCard.querySelector('.kf-dep-chip');
  log('a zero-dependency chip keeps its plain "No dependencies" title', zeroChip.getAttribute('title') === 'No dependencies');
  zeroChip.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  log('hovering a zero-dependency chip does NOT open the popover', popover.classList.contains('hidden'));

  // Re-open on the depending card, then click a link — should close the popover (it would
  // otherwise float on top of the task modal the click just opened).
  chip.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await wait(10);
  links = Array.from(popover.querySelectorAll('a.kf-dep-key'));
  links[0].dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await wait(10);
  log('clicking a dependency link closes the popover', popover.classList.contains('hidden'));

  console.log('Task dependency popover test complete.');
  process.exit(0);
  } catch(e){
    console.error('TASK DEP POPOVER TEST CRASHED:', e);
    process.exit(1);
  }
})();
