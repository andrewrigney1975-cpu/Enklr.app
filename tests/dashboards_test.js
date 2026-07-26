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
      t1: {id: 't1', key: 'SRV-1', title: 'First Task', priority: 'high', columnId: 'col1', dependencies: [], archived: false},
      t2: {id: 't2', key: 'SRV-2', title: 'Second Task', priority: 'low', columnId: 'col1', dependencies: [], archived: false}
    },
    members: [], releases: [], taskTypes: [],
    savedQueries: [
      {id: 'sq1', name: 'All Tasks', sql: 'SELECT key, title, priority FROM tasks', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq2', name: 'Completion Pct', sql: 'SELECT 75 AS pct FROM tasks LIMIT 1', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false},
      {id: 'sq3', name: 'Task Count', sql: 'SELECT 8 AS taskCount FROM tasks LIMIT 1', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false}
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
  log('CSV export button shown for a Project Admin in edit mode', doc.querySelector('[data-widget-export]') !== null);

  // ── Add a text widget ─────────────────────────────────────────────────────────────────────
  doc.getElementById('dashboardViewerAddWidgetBtn').click();
  await wait(20);
  doc.getElementById('dashboardWidgetTitleInput').value = 'Notes';
  doc.getElementById('dashboardWidgetTypeSelect').value = 'text';
  doc.getElementById('dashboardWidgetTypeSelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await wait(20);
  log('Saved Query field hidden for a text widget', doc.getElementById('dashboardWidgetSavedQueryField').classList.contains('hidden'));
  log('Text editor field shown for a text widget', !doc.getElementById('dashboardWidgetTextField').classList.contains('hidden'));
  doc.getElementById('dashboardWidgetTextEditor').innerHTML = '<p>Hello dashboard</p>';
  doc.getElementById('dashboardWidgetFormSaveBtn').click();
  await wait(150);

  var widgetTitles = Array.from(doc.querySelectorAll('.kf-dashboard-widget-title')).map(function(e){ return e.textContent; });
  log('both widgets now present', widgetTitles.indexOf('All Tasks Table') !== -1 && widgetTitles.indexOf('Notes') !== -1, widgetTitles.join(','));
  log('text widget renders its markdown content', doc.body.textContent.indexOf('Hello dashboard') !== -1);

  // ── Reorder: move the second widget up ────────────────────────────────────────────────────
  var moveUpBtn = doc.querySelector('[data-move-widget-up]');
  log('a move-up button exists for the non-first widget', moveUpBtn !== null);
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

  // ── Read-only for a non-editing member: Done Editing hides edit controls ────────────────────
  doc.getElementById('dashboardViewerDoneEditingBtn').click();
  await wait(50);
  log('Edit-mode controls (Add Widget) hidden after Done Editing', doc.getElementById('dashboardViewerAddWidgetBtn').classList.contains('hidden'));
  log('no CSV export button shown outside edit mode', doc.querySelector('[data-widget-export]') === null);

  console.log('Dashboards test complete.');
  process.exit(0);
})();
