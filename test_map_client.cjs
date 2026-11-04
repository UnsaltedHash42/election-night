const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const started = Date.parse('2026-11-04T00:00:00Z');
const races = [
  ['ar-senate', 'AR', 'Senate'], ['ga-senate', 'GA', 'Senate'],
  ['ar-governor', 'AR', 'Governor'], ['ga-governor', 'GA', 'Governor'],
  ['ar-house-01', 'AR', 'House'], ['ar-house-02', 'AR', 'House'], ['ga-house-01', 'GA', 'House']
].map(([id, state, office]) => ({ id, slug:id, state, office, name:`${state} ${office} ${id}` }));
const shape = (id, name, state, x) => ({ id, name, state, path:`M${x},10h20v20h-20Z`, centroid:[x+10,20], bounds:[[x,10],[x+20,30]] });
const shapes = { width:960, height:620,
  states:[shape('AR', 'Arkansas', undefined, 20), shape('GA', 'Georgia', undefined, 60)],
  districts:[shape('ar-house-01', 'AR district 1', 'AR', 20), shape('ar-house-02', 'AR district 2', 'AR', 30), shape('ga-house-01', 'GA district 1', 'GA', 60)] };
function payload(office, name, called = false) {
  const label = { senate:'Senate', governors:'Governor', house:'House' }[office];
  return { office, readAt:new Date(started).toISOString(), resultsFrom:'2026-11-03T22:00:00Z',
    rows:races.filter(race => race.office === label).map(race => ({ raceId:`2026-${race.id}`,
      result:{ call:called ? 'called' : 'not-called', winner:called ? 'lead' : null,
        winnerName:called ? name : null, winnerParty:called ? 'Democratic' : null,
        leadName:name, leadParty:'Democratic', leadPercent:55, secondName:'Second candidate',
        secondParty:'Republican', secondPercent:45, countedKind:'precincts', countedPercent:20,
        authority:'Fixture election office', fetchedAt:new Date(started).toISOString() },
      official:{ authority:'Fixture election office', url:'https://example.com/results', read:true } })) };
}
const response = (data, status = 200, retry = null) => ({ ok:status === 200, status,
  headers:{ get:() => retry }, json:async() => data });

function setup(fetchResults, fetchShapes = () => response(shapes)) {
  let now = started, serial = 0;
  const timers = new Map(), requests = [], explored = [], handlers = {};
  const document = { hidden:false, activeElement:null, addEventListener:(name, callback) => { handlers[name] = callback; } };
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.id = ''; this.text = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) {
      if (this.children.some(child => child.contains(document.activeElement))) document.activeElement = null;
      this.children = children;
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() { document.activeElement = this; }
    find(id) { return this.id === id ? this : this.children.map(child => child.find(id)).find(Boolean); }
  }
  const html = fs.readFileSync('public/index.html', 'utf8');
  const ids = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const node = new Element(); node.id = id; return [id, node];
  }));
  document.getElementById = id => ids.get(id) || [...ids.values()].map(node => node.find(id)).find(Boolean) || null;
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  const context = { window:{}, document, URL, Map, Set, Number, Math, JSON, Intl, console, AbortController,
    AbortSignal:{ timeout:() => new AbortController().signal },
    Date:class extends Date { static now() { return now; } },
    Option:function(text, value) { const node = new Element('option'); node.textContent = text; node.value = value; return node; },
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, at:now + delay }); return id; },
    clearTimeout:id => timers.delete(id),
    fetch:async(url, options) => {
      if (url === '/map-shapes.json') return fetchShapes();
      const request = { url, signal:options.signal, at:now };
      requests.push(request);
      return fetchResults(request, requests.length);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/map.js', 'utf8'), context);
  const map = new context.window.ElectionMap({ stateNames:{ AR:'Arkansas', GA:'Georgia' }, homeState:'AR', onExplore:value => explored.push(value) });
  const flush = async() => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  async function advance(ms) {
    const until = now + ms;
    for (let limit = 0; limit < 1000; limit++) {
      const next = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
      assert.notEqual(limit, 999, 'Timers must settle');
    }
    now = until; await flush();
  }
  map.setRaces(races);
  return { map, document, requests, explored, flush, advance,
    el:id => { const node = document.getElementById(id); assert(node, `Missing #${id}`); return node; },
    visible:value => { document.hidden = !value; handlers.visibilitychange(); } };
}

test('switching offices ignores a late response from the previous office', async() => {
  let finishSenate;
  const env = setup(request => request.url.endsWith('senate')
    ? new Promise(resolve => { finishSenate = resolve; }) : response(payload('governors', 'Governor leader')));
  await env.flush();
  env.el('map-governors').listeners.click(); await env.flush();
  assert.equal(env.requests[0].signal.aborted, true);
  assert.match(env.el('map-detail').textContent, /Governor leader/);
  finishSenate(response(payload('senate', 'Old Senate winner', true))); await env.flush();
  assert.equal(env.el('map-governors').getAttribute('aria-pressed'), 'true');
  assert.match(env.el('map-detail').textContent, /Governor leader/);
  assert.doesNotMatch(env.el('map-detail').textContent, /Old Senate winner/);
  assert.match(env.el('map-status').textContent, /0 called/);
});

test('failed refresh preserves results, and recovery clears the warning without dropping focus', async() => {
  let next = response(payload('senate', 'First leader'));
  const env = setup(() => next); await env.flush();
  const path = env.el('map-regions').children[0];
  path.focus();
  next = response(null, 502); await env.map.refresh();
  assert.match(env.el('map-detail').textContent, /First leader/);
  assert.equal(env.el('map-error').hidden, false);
  assert.match(env.el('map-error').textContent, /last successful results/);
  assert.equal(env.el('map-regions').children[0], path);
  assert.equal(env.document.activeElement, path);
  await env.advance(660000);
  assert.match(path.getAttribute('class'), /\bstale\b/);
  assert.match(path.getAttribute('aria-label'), /over 10 minutes old/);
  assert.match(env.el('map-detail').textContent, /Over 10 minutes old/);
  assert.match(env.el('map-detail').textContent, /First leader/);
  assert.equal(env.document.activeElement, path);
  env.el('map-source-link').focus();
  next = response(payload('senate', 'Corrected leader')); await env.map.refresh();
  assert.equal(env.el('map-error').hidden, true);
  assert.match(env.el('map-detail').textContent, /Corrected leader/);
  assert.equal(env.document.activeElement, env.el('map-source-link'));
  assert.equal(env.el('map-regions').children[0], path);
});

test('state zoom, keyboard selection and the race picker open the selected race', async() => {
  const env = setup(request => response(payload(new URL(request.url, 'https://example.com').searchParams.get('office'), 'Leader')));
  await env.flush();
  env.el('map-house').listeners.click(); await env.flush();
  env.el('map-state').value = 'AR'; env.el('map-state').listeners.change();
  assert.equal(env.el('map-regions').children.length, 2);
  assert.notEqual(env.el('election-map').getAttribute('viewBox'), '0 0 960 620');
  let prevented = false;
  env.el('map-regions').children[1].listeners.keydown({ key:'Enter', preventDefault:() => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(env.el('map-race').value, 'ar-house-02');
  env.el('map-explore').listeners.click();
  assert.equal(env.explored[0].raceId, 'ar-house-02');
  env.el('map-reset').listeners.click();
  assert.equal(env.el('map-regions').children.length, 3);
  assert.equal(env.el('election-map').getAttribute('viewBox'), '0 0 960 620');
  env.el('map-race').value = 'ga-house-01'; env.el('map-race').listeners.change();
  assert.match(env.el('map-detail').textContent, /GA House ga-house-01/);
  env.el('map-explore').listeners.click();
  assert.equal(env.explored[1].raceId, 'ga-house-01');
});

test('hiding stops polling and discards a late response until an active refresh', async() => {
  let finishHidden;
  const env = setup((_, index) => index === 2 ? new Promise(resolve => { finishHidden = resolve; })
    : response(payload('senate', index === 1 ? 'Visible leader' : 'Resumed leader')));
  await env.flush();
  const pending = env.map.refresh(); await env.flush();
  env.visible(false);
  assert.equal(env.requests[1].signal.aborted, true);
  finishHidden(response(payload('senate', 'Hidden winner', true))); await pending;
  await env.advance(180000);
  assert.equal(env.requests.length, 2);
  assert.match(env.el('map-status').textContent, /paused in background/);
  assert.doesNotMatch(env.el('map-detail').textContent, /Hidden winner/);
  env.visible(true); await env.flush();
  assert.equal(env.requests.length, 3);
  assert.match(env.el('map-detail').textContent, /Resumed leader/);
  await env.advance(59999); assert.equal(env.requests.length, 3);
  await env.advance(1); assert.equal(env.requests.length, 4);
});

test('rate limiting delays the next automatic check and keeps the previous map', async() => {
  const env = setup((_, index) => index === 2 ? response(null, 429, '120') : response(payload('senate', 'Known leader')));
  await env.flush();
  await env.map.refresh();
  assert.match(env.el('map-detail').textContent, /Known leader/);
  assert.equal(env.el('map-error').hidden, false);
  await env.advance(119999); assert.equal(env.requests.length, 2);
  await env.advance(1); assert.equal(env.requests.length, 3);
  assert.equal(env.el('map-error').hidden, true);
});

test('a failed geometry load can be retried without starting duplicate result checks', async() => {
  let geometry = response(null, 502);
  const env = setup(() => response(payload('senate', 'Leader')), () => geometry);
  await env.flush();
  assert.equal(env.el('map-error').hidden, false);
  assert.equal(env.el('map-retry').disabled, false);
  assert.equal(env.requests.length, 0);
  geometry = response(shapes);
  env.el('map-retry').listeners.click(); await env.flush();
  assert.equal(env.el('map-error').hidden, true);
  assert.match(env.el('map-detail').textContent, /Leader/);
  assert.equal(env.requests.length, 1);
  await env.advance(60000);
  assert.equal(env.requests.length, 2);
});
