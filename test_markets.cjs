const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('key-market selection keeps the question, source link and read-only embed aligned', () => {
  const handlers = {};
  const choice = { selectedOptions:[], addEventListener:(type, fn) => { handlers[type] = fn; } };
  const frame = {}, link = {}, status = {};
  const frames = [frame, { src:'house' }, { src:'senate' }];
  const elements = { 'market-race':choice, 'market-race-frame':frame, 'market-race-link':link,
    'markets-status':status, 'markets-refresh':{ addEventListener:(_, fn) => { handlers.refresh = fn; } } };
  const context = { URLSearchParams, document:{ getElementById:id => elements[id], querySelectorAll:() => frames } };
  vm.runInNewContext(fs.readFileSync('public/markets.js', 'utf8'), context);
  choice.selectedOptions = [{ value:'will-the-democrats-win-the-maine-senate-race-in-2026', textContent:'Maine Senate', dataset:{ event:'maine-senate-election-winner' } }];
  handlers.change();
  const url = new URL(frame.src);
  assert.equal(url.origin, 'https://embed.polymarket.com');
  assert.equal(url.searchParams.get('market'), 'will-the-democrats-win-the-maine-senate-race-in-2026');
  assert.equal(url.searchParams.get('buttons'), 'false');
  assert.equal(frame.title, 'Polymarket: Democratic victory in Maine Senate');
  assert.equal(link.href, 'https://polymarket.com/event/maine-senate-election-winner');
  assert.equal(link.textContent, 'Open Maine Senate market ↗');
  let reloads = 0;
  for (const item of frames) {
    const src = item.src;
    Object.defineProperty(item, 'src', { get:() => src, set:value => { assert.equal(value, src); reloads++; } });
  }
  handlers.refresh();
  assert.equal(reloads, 3);
  assert.match(status.textContent, /Refresh requested/);
  assert.match(status.textContent, /not vote counts or race calls/);
});
