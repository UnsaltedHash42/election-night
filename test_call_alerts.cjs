const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const race = { id:'ar-senate', slug:'ar-senate', name:'Arkansas · U.S. Senate' };
const started = Date.parse('2026-11-04T00:00:00Z');
const source = { kind:'licensed-provider', authority:'Test provider', url:'https://example.com/results' };
function payload(state = 'not-called', winner = 'A', overrides = {}) {
  return { version:1, raceId:'2026-ar-senate', raceSlug:'ar-senate', electionDate:'2026-11-03',
    results:{ callState:state, candidates:[{ name:'A', party:'Democratic', winner:['called','certified'].includes(state) && winner === 'A' },
      { name:'B', party:'Republican', winner:['called','certified'].includes(state) && winner === 'B' }],
      source, updatedAt:'2026-11-03T23:59:00Z', fetchedAt:'2026-11-04T00:00:00Z', freshness:'fresh', ...overrides } };
}
function response(data, status = 200, retry = null) {
  return { ok:status === 200, status, headers:{ get:() => retry }, json:async() => data };
}
function setup(options = {}) {
  let now = started, serial = 0;
  const timers = new Map(), requests = [], alerts = [], changes = [], handlers = {};
  const storage = options.storage || new Map();
  const sharedStorage = options.sharedStorage || storage;
  const document = { hidden:Boolean(options.hidden), addEventListener:(name, callback) => { handlers[name] = callback; } };
  const context = {
    window:{}, document, URL, Map, Set, JSON, Number, Math, console,
    Date:class extends Date { static now() { return now; } },
    localStorage:{ getItem:key => sharedStorage.get(key) ?? null, setItem:(key, value) => sharedStorage.set(key, value) },
    sessionStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) },
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, at:now + delay }); return id; },
    clearTimeout:id => timers.delete(id), AbortSignal:{ timeout:() => ({}) },
    fetch:async url => { requests.push({ url, at:now }); return options.fetch ? options.fetch(url, requests.length) : response(payload()); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/call-alerts.js','utf8'), context);
  const monitor = new context.window.CallMonitor({ onChange:value => changes.push(value), onAlert:event => alerts.push(event) });
  const flush = async() => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function advance(ms) {
    const until = now + ms;
    for (let limit = 0; limit < 10000; limit++) {
      const next = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
      assert.notEqual(limit, 9999, 'Timer loop did not settle');
    }
    now = until; await flush();
  }
  return { monitor, requests, alerts, changes, storage, document, advance, flush,
    visible:value => { document.hidden = !value; handlers.visibilitychange(); }, now:() => now };
}

test('explicit calls alert once; leads and runoff do not become winners', async() => {
  let data = payload();
  const env = setup({ fetch:() => response(data) });
  env.monitor.setRaces([race]); await env.advance(0);
  assert.equal(env.monitor.getSnapshot().calls.length, 0);
  data = payload('runoff'); await env.advance(120000);
  assert.equal(env.alerts.length, 0);
  data = payload('called'); await env.advance(120000);
  assert.equal(env.alerts.length, 1);
  assert.equal(env.alerts[0].type, 'call');
  assert.equal(env.alerts[0].winner.name, 'A');
  assert.equal(env.alerts[0].detectedAt, env.now());
  await env.advance(120000);
  data = payload('certified'); await env.advance(120000);
  assert.equal(env.alerts.length, 1);
  assert.equal(env.monitor.getSnapshot().calls[0].callState, 'certified');
});

test('first observed and restored calls are listed without new-call alerts', async() => {
  const env = setup({ fetch:() => response(payload('called')) });
  env.monitor.setRaces([race]); await env.advance(0);
  assert.equal(env.alerts.length, 0);
  assert.equal(env.monitor.getSnapshot().events[0].type, 'existing');
  const restored = setup({ storage:env.storage, fetch:() => response(payload('called')) });
  restored.monitor.setRaces([race]); await restored.advance(0);
  assert.equal(restored.alerts.length, 0);
  assert.equal(restored.monitor.getSnapshot().events.length, 1);
});

test('winner changes and explicit withdrawal produce corrections', async() => {
  let data = payload('called');
  const env = setup({ fetch:() => response(data) });
  env.monitor.setRaces([race]); await env.advance(0);
  data = payload('called', 'B'); await env.advance(120000);
  assert.equal(env.alerts[0].type, 'correction');
  assert.equal(env.monitor.getSnapshot().calls[0].winner.name, 'B');
  data = payload('recount'); await env.advance(120000);
  assert.equal(env.alerts[1].type, 'correction');
  assert.equal(env.monitor.getSnapshot().calls.length, 0);
  assert.equal(env.monitor.getSnapshot().events[0].winner, null);
});

test('unknown, delayed, malformed, wrong-race and failed responses retain verified calls', async() => {
  let next = response(payload('called'));
  const env = setup({ fetch:() => { if (next instanceof Error) throw next; return next; } });
  env.monitor.setRaces([race]); await env.advance(0);
  const nullResults = { ...payload(), results:null };
  const wrongRace = { ...payload(), raceSlug:'ga-senate' };
  const wrongElection = { ...payload(), electionDate:'2024-11-05' };
  const twoWinners = payload('called'); twoWinners.results.candidates[1].winner = true;
  const failures = [nullResults, payload('not-called', 'A', { freshness:'stale' }),
    payload('not-called', 'A', { freshness:'delayed' }), wrongRace, wrongElection, twoWinners,
    payload('not-called', 'A', { fetchedAt:'invalid timestamp' }),
    payload('not-called', 'A', { updatedAt:'2026-11-03T23:00:00Z' })];
  for (const data of failures) {
    next = response(data); await env.advance(120000);
    assert.equal(env.monitor.getSnapshot().calls[0].winner.name, 'A');
    assert.equal(env.monitor.getSnapshot().errorCount, 1);
    assert.equal(env.monitor.getSnapshot().unavailable[0], race.name);
  }
  for (const failure of [new Error('offline'), response(null, 503), { ok:true, json:async() => { throw new SyntaxError('bad JSON'); } }]) {
    next = failure; await env.advance(120000);
    assert.equal(env.monitor.getSnapshot().calls[0].winner.name, 'A');
    assert.equal(env.monitor.getSnapshot().errorCount, 1);
  }
  assert.equal(env.alerts.length, 0);
  next = response(payload('called')); await env.advance(120000);
  assert.equal(env.monitor.getSnapshot().errorCount, 0);
});

test('null results before any baseline do not invent a new-call transition', async() => {
  let data = { ...payload(), results:null };
  const env = setup({ fetch:() => response(data) });
  env.monitor.setRaces([race]); await env.advance(0);
  assert.equal(env.monitor.getSnapshot().errorCount, 0);
  data = payload('called'); await env.advance(120000);
  assert.equal(env.alerts.length, 0);
  assert.equal(env.monitor.getSnapshot().events[0].type, 'existing');
});

test('nullable party fields preserve races and display a winner without inventing affiliation', async() => {
  let data = payload();
  data.results.candidates[1].party = null;
  const env = setup({ fetch:() => response(data) });
  env.monitor.setRaces([race]); await env.advance(0);
  assert.equal(env.monitor.getSnapshot().errorCount, 0);
  data = payload('called');
  data.results.candidates[0].party = null;
  data.results.candidates[1].party = null;
  await env.advance(120000);
  assert.equal(env.alerts.length, 1);
  assert.equal(env.alerts[0].winner.party, 'Party not listed');
  assert.equal(env.monitor.getSnapshot().errorCount, 0);
  data.results.candidates[1].party = 1;
  await env.advance(120000);
  assert.equal(env.monitor.getSnapshot().errorCount, 1);
  assert.equal(env.monitor.getSnapshot().calls[0].winner.party, 'Party not listed');
});

test('429 respects Retry-After and missing headers cause five-minute backoff', async() => {
  for (const retry of ['180', null]) {
    const env = setup({ fetch:(_, index) => index === 1 ? response(null, 429, retry) : response(payload()) });
    env.monitor.setRaces([race]); await env.advance(0);
    const delay = retry ? 180000 : 300000;
    assert.equal(env.monitor.getSnapshot().backoffUntil, started + delay);
    await env.advance(delay - 1); assert.equal(env.requests.length, 1);
    await env.advance(1); assert.equal(env.requests.length, 2);
    assert.equal(env.monitor.getSnapshot().errorCount, 0);
  }
});

test('hidden and paused pages stop requests, then resume without bypassing intervals', async() => {
  const env = setup({ hidden:true });
  env.monitor.setRaces([race]); await env.advance(10000);
  assert.equal(env.requests.length, 0);
  env.visible(true); await env.advance(0); assert.equal(env.requests.length, 1);
  env.monitor.setPaused(true); await env.advance(240000);
  assert.equal(env.requests.length, 1);
  env.monitor.setPaused(false); await env.advance(0); assert.equal(env.requests.length, 2);
  env.visible(false); await env.advance(240000); assert.equal(env.requests.length, 2);
  env.visible(true); await env.advance(0); assert.equal(env.requests.length, 3);
  env.monitor.setPaused(true); env.monitor.setPaused(false); await env.advance(0);
  assert.equal(env.requests.length, 3);
});

test('requests are serial, spaced, fair and removed races cannot raise alerts', async() => {
  let resolve;
  const second = { id:'ga-senate', slug:'ga-senate', name:'Georgia Senate' };
  const env = setup({ fetch:() => new Promise(done => { resolve = done; }) });
  env.monitor.setRaces([race, second]); await env.advance(0);
  await env.advance(10000); assert.equal(env.requests.length, 1);
  env.monitor.setRaces([second]); resolve(response(payload('called'))); await env.flush();
  assert.equal(env.monitor.getSnapshot().events.length, 0);
  await env.advance(1999); assert.equal(env.requests.length, 1);
  await env.advance(1); assert.equal(env.requests.length, 2);
  assert.match(env.requests[1].url, /ga-senate$/);

  const many = Array.from({ length:65 }, (_, i) => ({ id:`ar-house-${String(i+1).padStart(2,'0')}`, slug:`ar-house-${String(i+1).padStart(2,'0')}`, name:`House ${i+1}` }));
  const fair = setup({ fetch:url => {
    const slug = url.split('/').at(-1);
    return response({ ...payload(), raceSlug:slug, raceId:`2026-${slug}` });
  } });
  fair.monitor.setRaces(many); await fair.advance(128000);
  assert.equal(fair.requests.length, 65);
  assert.equal(new Set(fair.requests.map(request => request.url)).size, 65);
  for (let i = 1; i < fair.requests.length; i++) assert.ok(fair.requests[i].at - fair.requests[i-1].at >= 2000);
});

test('corrupt saved data is ignored, and saved source links cannot use script URLs', async() => {
  const storage = new Map([['election-night-calls-2026', '{bad json']]);
  const env = setup({ storage }); env.monitor.setRaces([race]); await env.advance(0);
  assert.equal(env.monitor.getSnapshot().errorCount, 0);
  const invalid = setup({ fetch:() => response(payload('called','A',{ source:{ ...source,url:'javascript:alert(1)' } })) });
  invalid.monitor.setRaces([race]); await invalid.advance(0);
  assert.equal(invalid.monitor.getSnapshot().calls.length, 0);
  assert.equal(invalid.monitor.getSnapshot().errorCount, 1);
});

test('a response completed while hidden or paused leaves the call for the next active check', async() => {
  for (const inactive of ['hidden', 'paused']) {
    let complete;
    const env = setup({ fetch:(_, index) => index === 1 ? response(payload())
      : index === 2 ? new Promise(resolve => { complete = resolve; }) : response(payload('called')) });
    env.monitor.setRaces([race]); await env.advance(0);
    await env.advance(120000);
    if (inactive === 'hidden') env.visible(false); else env.monitor.setPaused(true);
    complete(response(payload('called'))); await env.flush();
    assert.equal(env.alerts.length, 0);
    assert.equal(env.monitor.getSnapshot().calls.length, 0, 'Inactive response must retain the prior baseline');
    if (inactive === 'hidden') env.visible(true); else env.monitor.setPaused(false);
    await env.advance(120000);
    assert.equal(env.alerts.length, 1);
    assert.equal(env.alerts[0].winner.name, 'A');
  }
});

test('another tab cannot overwrite the call baseline used after a reload', async() => {
  const sharedStorage = new Map();
  const first = setup({ storage:new Map(), sharedStorage,
    fetch:(_, index) => response(payload(index === 1 ? 'not-called' : 'called')) });
  first.monitor.setRaces([race]); await first.advance(0);
  const second = setup({ storage:new Map(), sharedStorage });
  second.monitor.setRaces([race]); await second.advance(0);
  await first.advance(120000);
  assert.equal(first.alerts.length, 1);
  await second.advance(120000);
  const reloaded = setup({ storage:first.storage, sharedStorage, fetch:() => response(payload('called')) });
  reloaded.monitor.setRaces([race]); await reloaded.advance(0);
  assert.equal(reloaded.alerts.length, 0, 'The first tab must not alert twice for its observed call');
  assert.equal(reloaded.monitor.getSnapshot().calls[0].winner.name, 'A');
});
