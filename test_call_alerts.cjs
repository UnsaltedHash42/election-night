const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const race = { id:'ar-senate', slug:'ar-senate', name:'Arkansas · U.S. Senate', office:'Senate' };
const other = { id:'ga-senate', slug:'ga-senate', name:'Georgia · U.S. Senate', office:'Senate' };
const started = Date.parse('2026-11-04T00:00:00Z');

function senate(state, winner = null, votes = [60, 40]) {
  return { test:false, state, office:'S', type:'General', candidates:[
    { id:1, first:'Ada', last:'Dem', party:'Dem', votes:votes[0], winner:winner === 'Dem' ? 'X' : '' },
    { id:2, first:'Bo', last:'Gop', party:'GOP', votes:votes[1], winner:winner === 'GOP' ? 'X' : '' }] };
}

function setup(options = {}) {
  let now = started, serial = 0;
  const timers = new Map(), requests = [], alerts = [], changes = [], handlers = {};
  const storage = options.storage || new Map();
  let feed = options.feed || (() => ({ results:[senate('AR')] }));
  const document = { hidden:Boolean(options.hidden), addEventListener:(name, callback) => {
    const previous = handlers[name]; handlers[name] = previous ? () => { previous(); callback(); } : callback; } };
  const context = {
    window:{}, document, URL, Map, Set, JSON, Number, Math, console, AbortController,
    Date:class extends Date { static now() { return now; } },
    sessionStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) },
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, at:now + delay }); return id; },
    clearTimeout:id => timers.delete(id), AbortSignal:{ timeout:() => ({}) },
    fetch:async url => {
      requests.push(url);
      if (!url.endsWith('senate.json')) return { ok:true, status:200, json:async () => ({ results:[] }) };
      const data = feed();
      return data ? { ok:true, status:200, json:async () => data } : { ok:false, status:503, json:async () => ({}) };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/ap.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/call-alerts.js', 'utf8'), context);
  const monitor = new context.window.CallMonitor({ onChange:value => changes.push(value), onAlert:event => alerts.push(event) });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  async function minute() {
    const until = now + 60000;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > until) continue;
      timers.delete(id); now = timer.at; timer.callback(); await flush();
    }
    now = until; await flush();
  }
  return { monitor, requests, alerts, changes, storage, flush, minute,
    setFeed:value => { feed = value; },
    visible:value => { document.hidden = !value; handlers.visibilitychange(); },
    snapshot:() => monitor.getSnapshot() };
}

test('a race is baselined silently, then an AP call alerts once and never repeats', async () => {
  const env = setup();
  env.monitor.setRaces([race]);
  await env.flush();
  assert.equal(env.alerts.length, 0);
  assert.equal(env.snapshot().checkedCount, 1);
  env.setFeed(() => ({ results:[senate('AR', null, [40, 60])] }));
  await env.minute();
  assert.equal(env.alerts.length, 0, 'a changed lead is not a call');
  env.setFeed(() => ({ results:[senate('AR', 'GOP', [40, 60])] }));
  await env.minute();
  assert.equal(env.alerts.length, 1);
  assert.equal(env.alerts[0].type, 'call');
  assert.deepEqual({ ...env.alerts[0].winner }, { name:'Bo Gop', party:'Republican' });
  assert.equal(env.alerts[0].source.authority, 'AP via NPR');
  await env.minute();
  assert.equal(env.alerts.length, 1);
  assert.equal(env.snapshot().calls.length, 1);
});

test('races called before the first check are listed without an alert', async () => {
  const env = setup({ feed:() => ({ results:[senate('AR', 'Dem')] }) });
  env.monitor.setRaces([race]);
  await env.flush();
  assert.equal(env.alerts.length, 0);
  assert.equal(env.snapshot().calls[0].type, 'existing');
  assert.equal(env.snapshot().events[0].type, 'existing');
});

test('a race with no votes yet alerts when AP later calls it', async () => {
  const env = setup({ feed:() => ({ results:[] }) });
  env.monitor.setRaces([race]);
  await env.flush();
  env.setFeed(() => ({ results:[senate('AR', 'Dem')] }));
  await env.minute();
  assert.equal(env.alerts.length, 1);
  assert.equal(env.alerts[0].type, 'call');
});

test('a changed or withdrawn AP call is reported as a correction', async () => {
  const env = setup({ feed:() => ({ results:[senate('AR', 'Dem')] }) });
  env.monitor.setRaces([race]);
  await env.flush();
  env.setFeed(() => ({ results:[senate('AR', 'GOP')] }));
  await env.minute();
  assert.equal(env.alerts.at(-1).type, 'correction');
  assert.equal(env.alerts.at(-1).winner.party, 'Republican');
  env.setFeed(() => ({ results:[senate('AR', null)] }));
  await env.minute();
  assert.equal(env.alerts.at(-1).type, 'correction');
  assert.equal(env.alerts.at(-1).winner, null);
});

test('feed failures and missing rows keep known calls and flag unavailable races', async () => {
  const env = setup({ feed:() => ({ results:[senate('AR', 'Dem')] }) });
  env.monitor.setRaces([race]);
  await env.flush();
  env.setFeed(() => null);
  await env.minute();
  assert.equal(env.snapshot().calls.length, 1);
  assert.deepEqual([...env.snapshot().unavailable], [race.name]);
  env.setFeed(() => ({ results:[] }));
  await env.minute();
  assert.equal(env.snapshot().calls.length, 1, 'a race missing from the feed keeps its call');
  assert.equal(env.snapshot().errorCount, 0);
  assert.equal(env.alerts.length, 0);
});

test('calls made while paused or hidden alert on resume, not before', async () => {
  const env = setup();
  env.monitor.setRaces([race]);
  await env.flush();
  env.monitor.setPaused(true);
  env.setFeed(() => ({ results:[senate('AR', 'Dem')] }));
  await env.minute();
  assert.equal(env.alerts.length, 0);
  env.monitor.setPaused(false);
  assert.equal(env.alerts.length, 1);

  env.visible(false);
  const requests = env.requests.length;
  env.setFeed(() => ({ results:[senate('AR', 'GOP')] }));
  await env.minute(); await env.minute();
  assert.equal(env.requests.length, requests, 'no feed requests while hidden');
  assert.equal(env.alerts.length, 1);
  env.visible(true);
  await env.flush();
  assert.equal(env.alerts.length, 2);
  assert.equal(env.alerts[1].type, 'correction');
});

test('only watched races are checked; removed races cannot alert', async () => {
  const env = setup({ feed:() => ({ results:[senate('AR'), senate('GA')] }) });
  env.monitor.setRaces([race, other]);
  await env.flush();
  assert.equal(env.snapshot().total, 2);
  env.monitor.setRaces([race]);
  env.setFeed(() => ({ results:[senate('AR'), senate('GA', 'Dem')] }));
  await env.minute();
  assert.equal(env.alerts.length, 0);
  assert.equal(env.snapshot().total, 1);
});

test('a reload keeps the baseline, and corrupt or unsafe saved entries are ignored', async () => {
  const storage = new Map();
  const first = setup({ storage, feed:() => ({ results:[senate('AR')] }) });
  first.monitor.setRaces([race]);
  await first.flush();
  const reloaded = setup({ storage, feed:() => ({ results:[senate('AR', 'Dem')] }) });
  reloaded.monitor.setRaces([race]);
  await reloaded.flush();
  assert.equal(reloaded.alerts.length, 1, 'the saved not-called baseline turns a later call into an alert');

  const unsafe = new Map([['election-night-ap-calls-2026', JSON.stringify({ states:[{ raceId:'ar-senate', label:'x', callState:'called',
    winner:{ name:'X', party:'Y' }, source:{ authority:'Bad', url:'javascript:alert(1)' }, updatedAt:'2026-11-04T00:00:00Z', detectedAt:1, type:'call' }], events:'nope' })]]);
  const guarded = setup({ storage:unsafe, feed:() => ({ results:[senate('AR')] }) });
  guarded.monitor.setRaces([race]);
  await guarded.flush();
  assert.equal(guarded.snapshot().calls.length, 0);
  assert.equal(guarded.snapshot().events.length, 0);
});
