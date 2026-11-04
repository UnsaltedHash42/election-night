const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const started = Date.parse('2026-11-04T01:00:00Z');

function post(handle, name, rkey, minutesAgo, text) {
  return { post:{ uri:`at://did:plc:x/${rkey}`, author:{ handle, displayName:name },
    record:{ $type:'app.bsky.feed.post', createdAt:new Date(started - minutesAgo * 60000).toISOString(), text } } };
}
const response = data => ({ ok:true, status:200, json:async () => data });
const failure = () => ({ ok:false, status:503, json:async () => ({}) });

function setup(feedResponses) {
  let now = started, serial = 0;
  const timers = new Map(), requests = [], handlers = {};
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.hidden = false; this.id = ''; this.text = ''; this.disabled = false; this.href = ''; this.target = ''; this.rel = ''; this.title = ''; this.className = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
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
  const context = { document, console, AbortController, Intl, URL,
    Date:class extends Date { static now() { return now; } },
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, at:now + delay }); return id; },
    clearTimeout:id => timers.delete(id),
    fetch:async url => {
      requests.push(String(url));
      const handle = Object.keys(feedResponses).find(key => url.includes(`actor=${key}`));
      const queue = feedResponses[handle];
      return (Array.isArray(queue) ? queue.shift() : queue) ?? failure();
    } };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const advance = minutes => {
    const target = now + minutes * 60000;
    while (true) {
      const next = [...timers.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      for (const [id, timer] of timers) if (timer === next) timers.delete(id);
      next.callback();
    }
    now = target;
  };
  return { context, document, handlers, requests, timers, flush, advance,
    set hidden(value) { document.hidden = value; } };
}

test('crash-out watch merges feeds newest first and renders text safely', async () => {
  const feeds = {
    'patriottakes.bsky.social':[response({ feed:[
      post('patriottakes.bsky.social', 'PatriotTakes', 'pt2', 3, 'Trump posted this 4 hours ago: "Republicans are currently showing signs of PRESIDENTIAL-LEVEL turnout"'),
      post('patriottakes.bsky.social', 'PatriotTakes', 'pt1', 90, 'Earlier reaction <script>alert(1)</script>')
    ] })],
    'catturd2.bsky.social':[response({ feed:[
      post('catturd2.bsky.social', 'Catturd', 'ct1', 10, 'THE DOOCH!'),
      { reason:{ $type:'app.bsky.feed.repost' }, ...post('someone-else.com', 'Reposted', 'rp1', 1, 'repost body') },
      { post:{ uri:'at://did:plc:x/bad', author:{}, record:{ $type:'app.bsky.feed.repost', createdAt:new Date(started).toISOString(), text:'not a post' } } }
    ] })],
    'meidastouch.com':[response({ feed:[post('meidastouch.com', 'MeidasTouch', 'mt1', 30, 'BREAKING: race called')] })],
    'trumpactiontracker.bsky.social':[response({ feed:[post('trumpactiontracker.bsky.social', 'Trump Action Tracker', 'ta1', 55, 'DOJ announcement')] })]
  };
  const harness = setup(feeds);
  vm.runInNewContext(fs.readFileSync('public/crashout.js', 'utf8'), harness.context);
  await harness.flush(); await harness.flush(); await harness.flush();

  const list = harness.document.getElementById('crashout-feed');
  assert.equal(list.children.length, 5);
  const order = list.children.map(card => card.children[0].children[0].textContent);
  assert.deepEqual(order, ['PatriotTakes', 'Catturd', 'MeidasTouch', 'Trump Action Tracker', 'PatriotTakes']);
  const newest = list.children[0];
  const link = newest.children.find(child => child.tagName === 'a');
  assert.equal(link.href, 'https://bsky.app/profile/patriottakes.bsky.social/post/pt2');
  const older = list.children[4].children[1].textContent;
  assert.equal(older, 'Earlier reaction <script>alert(1)</script>');
  assert.ok(!JSON.stringify(list).includes('repost body'));
  const status = harness.document.getElementById('crashout-status').textContent;
  assert.match(status, /5 recent posts/);
  assert.equal(harness.document.getElementById('crashout-warning').hidden, true);
  assert.equal(harness.requests.length, 4);
});

test('feed failures warn, keep posts, and polling pauses while hidden', async () => {
  const feeds = {
    'patriottakes.bsky.social':[response({ feed:[post('patriottakes.bsky.social', 'PatriotTakes', 'pt9', 5, 'live reaction')] })],
    'catturd2.bsky.social':[failure()],
    'meidastouch.com':[failure()],
    'trumpactiontracker.bsky.social':[failure()]
  };
  const harness = setup(feeds);
  vm.runInNewContext(fs.readFileSync('public/crashout.js', 'utf8'), harness.context);
  await harness.flush(); await harness.flush(); await harness.flush();

  const warning = harness.document.getElementById('crashout-warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /Catturd, MeidasTouch, Trump Action Tracker/);
  assert.equal(harness.document.getElementById('crashout-feed').children.length, 1);

  harness.hidden = true;
  harness.advance(61);
  assert.equal(harness.requests.length, 4);
  harness.hidden = false;
  harness.handlers.visibilitychange();
  await harness.flush(); await harness.flush(); await harness.flush();
  assert.ok(harness.requests.length > 4);
  assert.equal(harness.document.getElementById('crashout-feed').children.length, 1);
});
