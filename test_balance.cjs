const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const started = Date.parse('2026-11-04T02:30:00Z');

const nprRow = (state, office, winnerParty, seatNumber) => {
  const candidates = [
    { id:1, first:'Ava', last:'Dem', party:'Dem', votes:winnerParty === 'dem' ? 9 : 4, winner:winnerParty === 'dem' ? 'X' : '' },
    { id:2, first:'Bob', last:'Gop', party:'GOP', votes:winnerParty === 'rep' ? 9 : 4, winner:winnerParty === 'rep' ? 'X' : '' }
  ];
  if (winnerParty === 'other') candidates.push({ id:3, first:'Cal', last:'Ind', party:'Ind', votes:9, winner:'X' });
  return { test:false, state, office, type:'General', seatNumber, candidates };
};

function setup(feedQueues) {
  let now = started, serial = 0;
  const timers = new Map(), requests = [], handlers = {};
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.hidden = false; this.id = ''; this.text = ''; this.className = ''; this.style = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    find(id) { return this.id === id ? this : this.children.map(child => child.find(id)).find(Boolean); }
  }
  const html = fs.readFileSync('public/index.html', 'utf8');
  const ids = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const node = new Element(); node.id = id; return [id, node];
  }));
  const document = { hidden:false,
    getElementById:id => ids.get(id) || [...ids.values()].map(node => node.find(id)).find(Boolean) || null,
    createElement:tag => new Element(tag),
    addEventListener:(name, callback) => { handlers[name] = callback; } };
  const context = { window:{}, document, console, AbortController, AbortSignal:{ timeout:() => new AbortController().signal }, Intl, URL, Date, Map, Set, Number, Math, JSON,
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, at:now + delay }); return id; },
    clearTimeout:id => timers.delete(id),
    fetch:async url => {
      requests.push(String(url));
      const file = Object.keys(feedQueues).find(name => String(url).endsWith(name));
      const queue = feedQueues[file];
      const next = Array.isArray(queue) ? queue.shift() : queue;
      if (!next) return { ok:false, status:503, json:async () => ({}) };
      return { ok:true, status:200, json:async () => next };
    } };
  context.window.document = document;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/ap.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/balance.js', 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return { context, document, handlers, requests, timers, flush, set hidden(value) { document.hidden = value; } };
}

const senateFeed = [nprRow('TX', 'S', 'dem'), nprRow('IA', 'S', 'rep'), nprRow('GA', 'S', 'dem')];
const houseFeed = [nprRow('CA', 'H', 'dem', '12'), nprRow('WY', 'H', 'rep', '0'), nprRow('DC', 'H', 'dem', '0'), nprRow('NY', 'H', 'dem', '10')];
const govFeed = [nprRow('GA', 'G', 'dem'), nprRow('TX', 'G', 'rep'), nprRow('FL', 'G', 'other')];
const queues = () => ({
  'senate.json':[{ results:senateFeed }],
  'house.json':[{ results:houseFeed }],
  'gov.json':[{ results:govFeed }]
});

test('balance counts AP calls with the Senate holdover baseline', async () => {
  const harness = setup(queues());
  await harness.flush();

  const box = harness.document.getElementById('balance');
  assert.equal(box.children.length, 4);
  const senateRow = box.children[1], houseRow = box.children[2], govRow = box.children[3];
  assert.match(senateRow.textContent, /D 36 · R 32 · 32 uncalled/);
  assert.match(houseRow.textContent, /D 2 · R 1 · 432 uncalled/);
  assert.match(govRow.textContent, /D 1 · R 1 · O 1 · 33 uncalled/);
  const senateBar = senateRow.children[1];
  assert.match(senateBar.getAttribute('aria-label'), /36 Democratic, 32 Republican, 32 uncalled of 100/);
  const marker = senateBar.children[senateBar.children.length - 1];
  assert.equal(marker.title, 'Majority: 51');
  assert.match(senateRow.textContent, /50–50 tie goes to the vice president/);
  assert.match(harness.document.getElementById('balance-status').textContent, /AP race calls via NPR/);
  assert.match(harness.document.getElementById('balance-status').textContent, /not forecasts/);
});

test('a failed refresh keeps the last counts; visibility resumes polling', async () => {
  const feedQueues = queues();
  const harness = setup(feedQueues);
  await harness.flush();
  assert.match(harness.document.getElementById('balance').children[1].textContent, /D 36 · R 32/);

  const firstRound = harness.requests.length;
  assert.equal(firstRound, 3);
  feedQueues['senate.json'] = [];
  feedQueues['house.json'] = [];
  feedQueues['gov.json'] = [];
  harness.handlers.visibilitychange();
  await harness.flush();
  assert.equal(harness.requests.length, 6);
  assert.match(harness.document.getElementById('balance').children[1].textContent, /D 36 · R 32/);

  harness.hidden = true;
  harness.handlers.visibilitychange();
  for (const timer of harness.timers.values()) timer.callback();
  await harness.flush();
  assert.equal(harness.requests.length, 6);
});
