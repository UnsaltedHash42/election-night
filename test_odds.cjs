const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const event = (slug, markets, closed = false) => ({ slug, closed, markets:markets.map(([label, token, price, active = true]) => ({
  active, groupItemTitle:label, clobTokenIds:JSON.stringify([token, `${token}-no`]), outcomePrices:JSON.stringify([String(price), String(1 - price)])
})) });

function setup({ map = {}, events = [], midpoints = {}, hidden = false } = {}) {
  let serial = 0;
  const timers = new Map(), requests = [], handlers = {};
  const document = { hidden, addEventListener:(name, callback) => { handlers[name] = callback; } };
  const context = { window:{}, document, JSON, Number, Map, Set, Object, Array, String, Math, AbortSignal:{ timeout:() => ({}) },
    setTimeout:(callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    clearTimeout:id => timers.delete(id), encodeURIComponent,
    fetch:async (url, options = {}) => {
      requests.push({ url, body:options.body });
      if (url === '/market-map.json') return { ok:true, json:async () => map };
      if (url.startsWith('https://gamma-api.polymarket.com/events?')) {
        const slugs = new URL(url).searchParams.getAll('slug');
        return { ok:true, json:async () => events.filter(item => slugs.includes(item.slug)) };
      }
      if (url === 'https://clob.polymarket.com/midpoints') {
        const asked = JSON.parse(options.body).map(item => item.token_id);
        return { ok:true, json:async () => Object.fromEntries(asked.filter(token => token in midpoints).map(token => [token, midpoints[token]])) };
      }
      return { ok:false, json:async () => ({}) };
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/odds.js', 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  return { odds:context.window.raceOdds, oddsText:context.oddsText, requests, timers, handlers, document, flush, midpoints,
    tick:async () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } await flush(); } };
}

test('watched races get live prices, ordered by price, in one batched request', async () => {
  const env = setup({
    map:{ 'oh-senate':'ohio-senate-election-winner', 'tx-house-35':'tx-35-house-election-winner' },
    events:[
      event('ohio-senate-election-winner', [['Sherrod Brown (D)', 'b', 0.6], ['Jon Husted (R)', 'h', 0.4], ['Person A', 'x', 0.5, false]]),
      event('tx-35-house-election-winner', [['Carlos De La Cruz (R)', 'c', 0.02], ['Johnny Garcia (D)', 'g', 0.98]])
    ],
    midpoints:{ b:'0.996', h:'0.004', c:'0.017', g:'0.983' }
  });
  assert.equal(env.odds.get('oh-senate'), undefined);
  env.odds.watch('desk', ['oh-senate', 'tx-house-35']);
  await env.flush();
  const ohio = env.odds.get('oh-senate');
  assert.deepEqual(Array.from(ohio.markets, market => market.label), ['Sherrod Brown (D)', 'Jon Husted (R)']);
  assert.equal(ohio.markets[0].price, 0.996, 'live midpoint replaces the cached event price');
  assert.equal(env.oddsText(ohio), 'Polymarket: Sherrod Brown (D) >99% · Jon Husted (R) <1%');
  assert.equal(env.oddsText(env.odds.get('tx-house-35')), 'Polymarket: Johnny Garcia (D) 98% · Carlos De La Cruz (R) 2%');
  const gamma = env.requests.filter(request => request.url.includes('gamma-api'));
  const clob = env.requests.filter(request => request.url.includes('clob'));
  assert.equal(gamma.length, 1);
  assert.equal(clob.length, 1);
  assert.deepEqual(JSON.parse(clob[0].body).map(item => item.token_id).sort(), ['b', 'c', 'g', 'h']);
});

test('each minute refreshes prices only; event details are fetched once', async () => {
  const env = setup({ map:{ 'oh-senate':'ohio' }, events:[event('ohio', [['Brown (D)', 'b', 0.5], ['Husted (R)', 'h', 0.5]])], midpoints:{ b:'0.55', h:'0.45' } });
  env.odds.watch('desk', ['oh-senate']);
  await env.flush();
  env.midpoints.b = '0.70'; env.midpoints.h = '0.30';
  await env.tick();
  assert.equal(env.odds.get('oh-senate').markets[0].price, 0.7);
  assert.equal(env.requests.filter(request => request.url.includes('gamma-api')).length, 1);
  assert.equal(env.requests.filter(request => request.url.includes('clob')).length, 2);
});

test('resolved markets show the result, unmapped races say so, and failures keep prices', async () => {
  const env = setup({ map:{ 'va-senate':'va', 'oh-senate':'ohio' },
    events:[event('va', [['Mark Warner (D)', 'w', 1], ['Bert Mizusawa (R)', 'm', 0]], true), event('ohio', [['Brown (D)', 'b', 0.5]])],
    midpoints:{ b:'0.8' } });
  env.odds.watch('desk', ['va-senate', 'oh-senate', 'dc-house-00']);
  await env.flush();
  assert.equal(env.oddsText(env.odds.get('va-senate')), 'Polymarket (resolved): Mark Warner (D)');
  assert.equal(env.odds.get('dc-house-00'), null);
  assert.equal(env.oddsText(null), 'Polymarket: no market for this race');
  assert.equal(env.oddsText(undefined), 'Polymarket: loading…');
  assert.ok(!env.requests.some(request => request.body?.includes('"w"')), 'resolved markets are not polled');
  delete env.midpoints.b;
  await env.tick();
  assert.equal(env.odds.get('oh-senate').markets[0].price, 0.8);
});

test('hidden pages stop polling; a newly visible race triggers an immediate fetch', async () => {
  const env = setup({ map:{ a:'ea', b:'eb' }, events:[event('ea', [['A (D)', 'ta', 0.5]]), event('eb', [['B (R)', 'tb', 0.5]])], midpoints:{ ta:'0.5', tb:'0.5' } });
  env.odds.watch('desk', ['a']);
  await env.flush();
  const before = env.requests.length;
  env.odds.watch('desk', ['a']);
  await env.flush();
  assert.equal(env.requests.length, before, 'an unchanged watch list does not refetch');
  env.odds.watch('map', ['b']);
  await env.flush();
  assert.ok(env.requests.length > before);
  env.document.hidden = true;
  env.handlers.visibilitychange();
  const hidden = env.requests.length;
  await env.tick();
  assert.equal(env.requests.length, hidden);
});
