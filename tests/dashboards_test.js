const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

/* Self-Service Dashboard module (root CLAUDE.md's plan) — Phase 4 coverage: app-setting visibility
   gating, the picker/viewer/widget-form CRUD flow, and the table+text widgets' actual render output.
   Same mock-fetch-dispatcher convention as tests/portfolio_planner_bars_test.js. */
function makeMockFetch(state){
  return async function(url, options){
    var method = (options && options.method) || 'GET';
    if(url === '/health') return {ok: true, status: 200, json: async () => ({status: 'ok'})};
    if(url === '/api/projects' && method === 'GET') return {ok: true, status: 200, json: async () => ([])};

    if(url === '/api/projects/p1/dashboards' && method === 'GET'){
      return {ok: true, status: 200, json: async () => state.dashboards.map(function(d){
        return {id: d.id, name: d.name, description: d.description, widgetCount: d.widgets.length, dateCreated: d.dateCreated, dateLastModified: d.dateLastModified};
      })};
    }
    if(url === '/api/projects/p1/dashboards' && method === 'POST'){
      var body = JSON.parse(options.body);
      var d = {id: 'dash' + (state.dashboards.length + 1), name: body.name, description: body.description, widgets: [], dateCreated: '2026-01-01T00:00:00Z', dateLastModified: '2026-01-01T00:00:00Z'};
      state.dashboards.push(d);
      return {ok: true, status: 201, json: async () => d};
    }
    var getMatch = url.match(/^\/api\/projects\/p1\/dashboards\/([^/]+)$/);
    if(getMatch && method === 'GET'){
      var found = state.dashboards.find(function(x){ return x.id === getMatch[1]; });
      return found ? {ok: true, status: 200, json: async () => found} : {ok: false, status: 404, json: async () => ({message: 'not found'})};
    }
    if(getMatch && method === 'DELETE'){
      state.dashboards = state.dashboards.filter(function(x){ return x.id !== getMatch[1]; });
      return {ok: true, status: 204, json: async () => ({})};
    }

    var widgetsMatch = url.match(/^\/api\/projects\/p1\/dashboards\/([^/]+)\/widgets$/);
    if(widgetsMatch && method === 'POST'){
      var dash = state.dashboards.find(function(x){ return x.id === widgetsMatch[1]; });
      var wbody = JSON.parse(options.body);
      var w = Object.assign({id: 'widget' + (state.widgetSeq++)}, wbody);
      dash.widgets.push(w);
      return {ok: true, status: 201, json: async () => w};
    }
    var widgetMatch = url.match(/^\/api\/projects\/p1\/dashboards\/([^/]+)\/widgets\/([^/]+)$/);
    if(widgetMatch && method === 'PUT'){
      var dash2 = state.dashboards.find(function(x){ return x.id === widgetMatch[1]; });
      var w2 = dash2.widgets.find(function(x){ return x.id === widgetMatch[2]; });
      Object.assign(w2, JSON.parse(options.body));
      return {ok: true, status: 200, json: async () => w2};
    }
    if(widgetMatch && method === 'DELETE'){
      var dash3 = state.dashboards.find(function(x){ return x.id === widgetMatch[1]; });
      dash3.widgets = dash3.widgets.filter(function(x){ return x.id !== widgetMatch[2]; });
      return {ok: true, status: 204, json: async () => ({})};
    }

    return {ok: false, status: 404, json: async () => ({message: 'not found (unhandled mock url in test): ' + method + ' ' + url})};
  };
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  var proj = {
    id: 'p1', serverProjectId: 'p1', name: 'Server Project', key: 'SRV', taskCounter: 2,
    columns: [{id: 'col1', name: 'To Do', done: false, order: ['t1', 't2']}, {id: 'col2', name: 'Done', done: true, order: []}],
    tasks: {
      t1: {id: 't1', key: 'SRV-1', title: 'First Task', priority: 'high', columnId: 'col1', dependencies: [], archived: false, businessValue: 800, taskCost: 150},
      t2: {id: 't2', key: 'SRV-2', title: 'Second Task', priority: 'low', columnId: 'col1', dependencies: [], archived: false, businessValue: 200, taskCost: 700}
    },
    members: [], releases: [], taskTypes: [],
    savedQueries: [
      {id: 'sq1', name: 'All Tasks', sql: 'SELECT key, title, priority FROM tasks', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq2', name: 'Completion Pct', sql: 'SELECT 75 AS pct FROM tasks LIMIT 1', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq3', name: 'Task Count', sql: 'SELECT 8 AS taskCount FROM tasks LIMIT 1', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq4', name: 'Cost vs Value', sql: 'SELECT key, title, priority, taskCost, businessValue FROM tasks', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq5', name: 'Task Schedule', sql: "SELECT title AS label, '2026-01-01' AS s, '2026-03-01' AS e FROM tasks LIMIT 1", dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq6', name: 'Count by Priority', sql: 'SELECT priority AS prio, COUNT(*) AS n FROM tasks GROUP BY priority', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false}
    ],
    startDate: null, endDate: null, description: '',
    headerButtonVisibility: {dashboards: true},
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
  };
  var db = {projects: {p1: proj}, projectOrder: ['p1'], currentProjectId: 'p1'};
  var state = {dashboards: [], widgetSeq: 1};

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(db));
      w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: JSON.stringify([{ProjectId: 'p1', Role: 'member', IsProjectAdmin: true}])}));
      w.fetch = makeMockFetch(state);
    }
  });
  await wait(800);
  const doc = dom.window.document;

  // ── App setting gating: this project has opted in (seeded above) ─────────────────────────
  log('Dashboards nav button shown once the app setting is on', !doc.getElementById('navDashboardsBtn').classList.contains('kf-vis-hidden'));

  doc.getElementById('appSettingsBtn') && doc.getElementById('appSettingsBtn').click();
  await wait(50);
  var dashCheckbox = doc.getElementById('settingsShowDashboardsBtn');
  log('Dashboards app-setting checkbox exists and reflects the on state', dashCheckbox !== null && dashCheckbox.checked === true);
  doc.getElementById('appSettingsClose') && doc.getElementById('appSettingsClose').click();
  await wait(50);

  // ── Picker: create a dashboard ────────────────────────────────────────────────────────────
  doc.getElementById('navDashboardsBtn').click();
  await wait(200);
  log('Dashboards picker overlay opens', !doc.getElementById('dashboardsPickerOverlay').classList.contains('hidden'));
  log('empty state shown', doc.getElementById('dashboardsPickerGrid').textContent.indexOf('No dashboards yet') !== -1);

  doc.getElementById('dashboardsPickerNewBtn').click();
  await wait(20);
  doc.getElementById('dashboardFormNameInput').value = 'Sprint Overview';
  doc.getElementById('dashboardFormDescInput').value = 'Sprint health at a glance';
  doc.getElementById('dashboardFormSaveBtn').click();
  await wait(150);
  log('dashboard created and appears as a tile', doc.getElementById('dashboardsPickerGrid').textContent.indexOf('Sprint Overview') !== -1);

  // ── Viewer: open, add a table widget ──────────────────────────────────────────────────────
  doc.querySelector('[data-dashboard-id]').click();
  await wait(150);
  log('Dashboard viewer overlay opens', !doc.getElementById('dashboardViewerOverlay').classList.contains('hidden'));
  log('viewer title matches', doc.getElementById('dashboardViewerTitle').textContent === 'Sprint Overview');
  log('Edit Layout button visible for a Project Admin', !doc.getElementById('dashboardViewerEditBtn').classList.contains('hidden'));

  doc.getElementById('dashboardViewerEditBtn').click();
  await wait(20);
  log('Add Widget button visible in edit mode', !doc.getElementById('dashboardViewerAddWidgetBtn').classList.contains('hidden'));

  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  log('widget form opens', !doc.getElementById('dashboardWidgetFormOverlay').classList.contains('hidden'));
  log('Saved Query field visible by default (table type)', !doc.getElementById('dashboardWidgetSavedQueryField').classList.contains('hidden'));

  doc.getElementById('dashboardWidgetTitleInput').value = 'All Tasks Table';
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq1';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  log('widget form closes after save', doc.getElementById('dashboardWidgetFormOverlay').classList.contains('hidden'));

  var widgetBody = doc.querySelector('.kf-dashboard-widget-body');
  log('table widget rendered with a header row', widgetBody && widgetBody.textContent.indexOf('title') !== -1, widgetBody && widgetBody.textContent);
  log('table widget shows both task rows', widgetBody && widgetBody.textContent.indexOf('First Task') !== -1 && widgetBody.textContent.indexOf('Second Task') !== -1);

  var exportBtn = doc.querySelector('[data-widget-export-header]');
  log('CSV export button shown for a Project Admin in edit mode', exportBtn !== null);
  log('CSV export button lives in the widget header, not the body', exportBtn && exportBtn.closest('.kf-dashboard-widget-header') !== null);
  log('CSV export button is labeled "Export as CSV"', exportBtn && exportBtn.textContent.trim() === 'Export as CSV', exportBtn && exportBtn.textContent);
  // Real bug caught live in QA: dynamically-rendered buttons used the data-icon PLACEHOLDER
  // convention (which needs a later hydrateIcons() call) instead of calling iconSvg() directly —
  // hydrateIcons() only ever runs once, on static markup, at app init (root CLAUDE.md §6's "don't
  // mix icon conventions" gotcha). The placeholder rendered as an empty, invisible <span> with no
  // <svg> inside, so every dynamically-added icon in this modal silently never appeared. Assert the
  // real <svg> is there, not just the wrapping .kf-icon span (which existed even with the bug).
  log('CSV export button has a real rendered icon (not an empty data-icon placeholder)', exportBtn && exportBtn.querySelector('.kf-icon svg') !== null);

  // ── Pagination: default page size, page-size options, prev/next ──────────────────────────────
  var pageSizeSelect = doc.querySelector('[data-widget-page-size]');
  log('pagination page-size selector exists', pageSizeSelect !== null);
  log('page-size options are 10/20/50/100/All', Array.from(pageSizeSelect.options).map(function(o){ return o.textContent; }).join(',') === '10,20,50,100,All');
  log('default page size is 20', pageSizeSelect.value === '20');
  log('page range shows both rows on one page', doc.querySelector('.kf-dashboard-table-pagerange').textContent.trim() === '1–2 of 2', doc.querySelector('.kf-dashboard-table-pagerange').textContent);

  pageSizeSelect.value = '10';
  pageSizeSelect.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  log('prev button disabled on page size change (still page 1)', doc.querySelector('[data-widget-page-prev]').hasAttribute('disabled'));
  log('next button disabled when everything fits on one page', doc.querySelector('[data-widget-page-next]').hasAttribute('disabled'));
  log('prev/next pagination buttons have real rendered icons', doc.querySelector('[data-widget-page-prev] svg') !== null && doc.querySelector('[data-widget-page-next] svg') !== null);

  // Verify prev/next + range recompute using a real, already-wired interaction: filtering the
  // 2-row dataset down to 1 row via the key column.
  var keyFilterInput = doc.querySelector('[data-widget-filter-col="key"]');
  keyFilterInput.value = 'SRV-1';
  keyFilterInput.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  keyFilterInput.dispatchEvent(new dom.window.Event('blur', {bubbles: true}));
  await wait(20);
  log('filtering to one row updates the page range', doc.querySelector('.kf-dashboard-table-pagerange').textContent.trim() === '1–1 of 1', doc.querySelector('.kf-dashboard-table-pagerange').textContent);
  keyFilterInput = doc.querySelector('[data-widget-filter-col="key"]');
  keyFilterInput.value = '';
  keyFilterInput.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  keyFilterInput.dispatchEvent(new dom.window.Event('blur', {bubbles: true}));
  await wait(20);

  // ── Add a text widget ─────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Notes';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'text';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  log('Saved Query field hidden for a text widget', doc.getElementById('dashboardWidgetSavedQueryField').classList.contains('hidden'));
  log('Text editor field shown for a text widget', !doc.getElementById('dashboardWidgetTextField').classList.contains('hidden'));
  var widthOptions = Array.from(doc.getElementById('dashboardWidgetWidthSelect').options).map(function(o){ return o.value; });
  log('width options include the new 2/3 option', widthOptions.indexOf('twoThird') !== -1, widthOptions.join(','));
  doc.getElementById('dashboardWidgetWidthSelect').value = 'twoThird';
  doc.getElementById('dashboardWidgetTextEditor').innerHTML = '<p>Hello dashboard</p>';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);

  var widgetTitles = Array.from(doc.querySelectorAll('.kf-dashboard-widget-title')).map(function(e){ return e.textContent; });
  log('both widgets now present', widgetTitles.indexOf('All Tasks Table') !== -1 && widgetTitles.indexOf('Notes') !== -1, widgetTitles.join(','));
  log('text widget renders its markdown content', doc.body.textContent.indexOf('Hello dashboard') !== -1);
  var notesCard = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Notes';
  });
  log('2/3-width widget gets the two-third layout class', notesCard.classList.contains('kf-dashboard-widget-two-third'));

  // ── Widget Order list: a dedicated compact reorder view alongside each card's own arrows ────
  log('Widget Order section visible in edit mode', !doc.getElementById('dashboardWidgetOrderSection').classList.contains('hidden'));
  var orderRows = doc.querySelectorAll('.kf-dashboard-order-row');
  log('Widget Order list has one row per widget', orderRows.length === 2, orderRows.length);
  log('Widget Order rows show widget titles in order', Array.from(orderRows).map(function(r){ return r.querySelector('.kf-dashboard-order-row-title').textContent; }).join(',') === 'All Tasks Table,Notes');
  log('Widget Order list also exposes its own move-up control', doc.querySelector('[data-order-move-up]') !== null);
  log('Widget Order list buttons have real rendered icons', doc.querySelector('[data-order-move-up] svg') !== null && doc.querySelector('[data-order-move-down] svg') !== null);

  // ── Reorder: move the second widget up (per-card arrow) ───────────────────────────────────
  var moveUpBtn = doc.querySelector('[data-move-widget-up]');
  log('a move-up button exists for the non-first widget', moveUpBtn !== null);
  log('per-card move/edit buttons have real rendered icons', moveUpBtn && moveUpBtn.querySelector('svg') !== null && doc.querySelector('[data-edit-widget] svg') !== null);
  if(moveUpBtn) moveUpBtn.click();
  await wait(150);
  var titlesAfterMove = Array.from(doc.querySelectorAll('.kf-dashboard-widget-title')).map(function(e){ return e.textContent; });
  log('reordering swapped the two widgets', titlesAfterMove[0] === 'Notes' && titlesAfterMove[1] === 'All Tasks Table', titlesAfterMove.join(','));

  // ── Remove a widget ────────────────────────────────────────────────────────────────────────
  var removeBtn = doc.querySelector('[data-remove-widget]');
  removeBtn.click();
  await wait(150);
  var titlesAfterRemove = Array.from(doc.querySelectorAll('.kf-dashboard-widget-title')).map(function(e){ return e.textContent; });
  log('widget removed', titlesAfterRemove.length === 1, titlesAfterRemove.join(','));

  // ── Gauge widget ───────────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Completion';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'gauge';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq2';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="valueColumn"]').value = 'pct';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var gaugeBody = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Completion';
  }).querySelector('.kf-dashboard-widget-body');
  log('gauge widget renders the resolved percentage', gaugeBody.textContent.indexOf('75%') !== -1, gaugeBody.textContent);

  // ── Bar Gauge widget ───────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Tasks Done';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'barGauge';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq3';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="valueColumn"]').value = 'taskCount';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="maxValue"]').value = '10';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="orientation"]').value = 'vertical';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var barGaugeWidget = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Tasks Done';
  });
  log('bar gauge widget renders with the vertical orientation class', barGaugeWidget.querySelector('.kf-dashboard-bargauge-vertical') !== null);
  log('bar gauge widget shows the raw value / max label', barGaugeWidget.textContent.indexOf('8 / 10') !== -1, barGaugeWidget.textContent);
  var fillEl = barGaugeWidget.querySelector('.kf-dashboard-bargauge-fill');
  log('bar gauge fill height reflects 80%', fillEl.getAttribute('style').indexOf('height:80%') !== -1, fillEl.getAttribute('style'));

  // ── Cost/Benefit widget ────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Cost vs Value';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'costBenefit';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq4';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var cbWidget = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Cost vs Value';
  });
  log('costBenefit widget renders an SVG scatter chart', cbWidget.querySelector('svg') !== null);
  log('costBenefit widget plots a point per row', cbWidget.querySelectorAll('.kf-cb-point').length === 2, cbWidget.querySelectorAll('.kf-cb-point').length);
  log('costBenefit widget tooltip reports the correct cost/value', cbWidget.textContent.indexOf('SRV-1') !== -1);

  // ── Timeline widget ────────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Schedule';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'timeline';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq5';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="labelColumn"]').value = 'label';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="startColumn"]').value = 's';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="endColumn"]').value = 'e';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var timelineWidget = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Schedule';
  });
  log('timeline widget renders a header column', timelineWidget.querySelector('.kf-dashboard-timeline-col') !== null);
  log('timeline widget renders a bar for the row', timelineWidget.querySelector('.kf-dashboard-timeline-bar') !== null);
  log('timeline widget row label matches the query row', timelineWidget.textContent.indexOf('First Task') !== -1, timelineWidget.textContent);

  // ── Chart widget: bar (single hue) ────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Tasks by Priority';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'chart';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq6';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="chartType"]').value = 'bar';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="categoryColumn"]').value = 'prio';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="valueColumn"]').value = 'n';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var barChartWidget = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Tasks by Priority';
  });
  var bars = barChartWidget.querySelectorAll('rect');
  log('bar chart renders one bar per category', bars.length === 2, bars.length);
  log('bar chart shows category labels', barChartWidget.textContent.indexOf('high') !== -1 && barChartWidget.textContent.indexOf('low') !== -1, barChartWidget.textContent);

  // ── Chart widget: donut (categorical per slice) ───────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Priority Split';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'chart';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('dashboardWidgetSavedQuerySelect').value = 'sq6';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="chartType"]').value = 'donut';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="categoryColumn"]').value = 'prio';
  doc.querySelector('#dashboardWidgetConfigFields [data-config-key="valueColumn"]').value = 'n';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);
  var donutWidget = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Priority Split';
  });
  var slices = donutWidget.querySelector('.kf-dashboard-chart-widget svg').querySelectorAll('path');
  log('donut chart renders one slice per category', slices.length === 2, slices.length);
  log('donut chart slices use distinct categorical colors', slices[0].getAttribute('style') !== slices[1].getAttribute('style'), [slices[0].getAttribute('style'), slices[1].getAttribute('style')]);
  log('donut chart shows a legend with both category names', donutWidget.querySelector('.kf-dashboard-chart-legend').textContent.indexOf('high') !== -1 && donutWidget.querySelector('.kf-dashboard-chart-legend').textContent.indexOf('low') !== -1);

  // ── Read-only for a non-editing member: Done Editing hides edit controls ────────────────────
  doc.getElementById('dashboardViewerDoneEditingBtn').click();
  await wait(50);
  log('Edit-mode controls (Add Widget) hidden after Done Editing', doc.getElementById('dashboardViewerAddWidgetBtn').classList.contains('hidden'));
  log('Widget Order section hidden after Done Editing', doc.getElementById('dashboardWidgetOrderSection').classList.contains('hidden'));
  log('widget management buttons (remove/move/configure) hidden after Done Editing', doc.querySelector('[data-remove-widget]') === null);
  log('table widget CSV export stays available for a Project Admin outside edit mode', doc.querySelector('[data-widget-export-header]') !== null);
  log('table widget sort headers stay interactive outside edit mode', doc.querySelector('.kf-dashboard-table-th-sortable') !== null);

  // ── Collapse/expand: each widget independently, works outside edit mode too ────────────────
  var firstWidgetCard = doc.querySelector('.kf-dashboard-widget');
  var collapseBtn = firstWidgetCard.querySelector('[data-widget-collapse]');
  log('collapse toggle button exists on a widget card', collapseBtn !== null);
  log('collapse toggle has a real rendered icon', collapseBtn && collapseBtn.querySelector('svg') !== null);
  log('collapse button starts expanded (aria-expanded=true)', collapseBtn.getAttribute('aria-expanded') === 'true');
  log('widget body is visible before collapsing', firstWidgetCard.querySelector('.kf-dashboard-widget-body').textContent.trim() !== '');

  var secondWidgetCard = doc.querySelectorAll('.kf-dashboard-widget')[1];
  var secondWidgetId = secondWidgetCard.getAttribute('data-widget-id');

  collapseBtn.click();
  await wait(50);
  var firstWidgetIdAfterCollapse = doc.querySelector('.kf-dashboard-widget').getAttribute('data-widget-id');
  var collapsedCard = doc.querySelector('.kf-dashboard-widget[data-widget-id="' + firstWidgetIdAfterCollapse + '"]');
  log('widget card gets the collapsed class', collapsedCard.classList.contains('kf-dashboard-widget-collapsed'));
  log('collapsed widget body is empty (query not re-run, not just visually hidden)', collapsedCard.querySelector('.kf-dashboard-widget-body').innerHTML.trim() === '');
  log('collapse button flips to aria-expanded=false', collapsedCard.querySelector('[data-widget-collapse]').getAttribute('aria-expanded') === 'false');

  var otherCard = doc.querySelector('.kf-dashboard-widget[data-widget-id="' + secondWidgetId + '"]');
  log('the OTHER widget is unaffected by collapsing the first one', !otherCard.classList.contains('kf-dashboard-widget-collapsed') && otherCard.querySelector('.kf-dashboard-widget-body').innerHTML.trim() !== '');

  // Collapsing survives toggling Edit Layout on/off (not tied to editMode).
  doc.getElementById('dashboardViewerEditBtn').click();
  await wait(50);
  log('collapsed state persists into edit mode', doc.querySelector('.kf-dashboard-widget[data-widget-id="' + firstWidgetIdAfterCollapse + '"]').classList.contains('kf-dashboard-widget-collapsed'));

  // Re-expand and confirm content comes back.
  doc.querySelector('.kf-dashboard-widget[data-widget-id="' + firstWidgetIdAfterCollapse + '"] [data-widget-collapse]').click();
  await wait(50);
  var reExpandedCard = doc.querySelector('.kf-dashboard-widget[data-widget-id="' + firstWidgetIdAfterCollapse + '"]');
  log('re-expanding restores the widget body content', !reExpandedCard.classList.contains('kf-dashboard-widget-collapsed') && reExpandedCard.querySelector('.kf-dashboard-widget-body').textContent.trim() !== '');

  doc.getElementById('dashboardViewerDoneEditingBtn').click();
  await wait(50);

  // Collapse the "Completion" gauge widget right before printing — print must ignore collapse state.
  var completionCard = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Completion';
  });
  completionCard.querySelector('[data-widget-collapse]').click();
  await wait(50);
  completionCard = Array.from(doc.querySelectorAll('.kf-dashboard-widget')).find(function(w){
    return w.querySelector('.kf-dashboard-widget-title').textContent === 'Completion';
  });
  log('Completion widget is now collapsed on screen', completionCard.classList.contains('kf-dashboard-widget-collapsed'));

  // ── Print: reuses features/reports.js's #reportOverlay ────────────────────────────────────
  doc.getElementById('dashboardViewerPrintBtn').click();
  await wait(50);
  log('print opens the shared report overlay', !doc.getElementById('reportOverlay').classList.contains('hidden'));
  log('report title includes the project and dashboard name', doc.getElementById('reportTitle').textContent.indexOf('Server Project') !== -1 && doc.getElementById('reportTitle').textContent.indexOf('Sprint Overview') !== -1, doc.getElementById('reportTitle').textContent);
  var reportBody = doc.getElementById('reportBody');
  log('printed report includes every widget title', reportBody.textContent.indexOf('All Tasks Table') !== -1 && reportBody.textContent.indexOf('Completion') !== -1 && reportBody.textContent.indexOf('Schedule') !== -1, reportBody.textContent.indexOf('All Tasks Table') + ',' + reportBody.textContent.indexOf('Completion'));
  log('printed table widget has no sort headers or CSV export (static output)', reportBody.querySelector('.kf-dashboard-table-th-sortable') === null && reportBody.querySelector('[data-widget-export-header]') === null);
  log('a widget collapsed on screen still prints its full content', reportBody.textContent.indexOf('Completion') !== -1 && reportBody.textContent.indexOf('75%') !== -1, reportBody.textContent.indexOf('75%'));
  doc.getElementById('reportClose').click();

  console.log('Dashboards test complete.');
  process.exit(0);
})();
