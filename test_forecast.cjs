const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('decision desk frame reloads on demand and on a visible five-minute tick', () => {
  const handlers = {};
  const intervals = [];
  const frame = { src:'https://votes.decisiondeskhq.com/forecast/2026' };
  const status = {};
  const state = { visibilityState:'visible' };
  const elements = { 'forecast-frame':frame, 'forecast-refresh':{ addEventListener:(type, fn) => { handlers[type] = fn; } },
    'forecast-status':status };
  const context = { setInterval:(fn, ms) => intervals.push({ fn, ms }), document:{
    visibilityState:state.visibilityState,
    getElementById:id => elements[id] } };
  Object.defineProperty(context.document, 'visibilityState', { get:() => state.visibilityState });
  vm.runInNewContext(fs.readFileSync('public/forecast.js', 'utf8'), context);
  let reloads = 0;
  const current = frame.src;
  Object.defineProperty(frame, 'src', { get:() => current, set:value => { assert.equal(value, current); reloads++; } });

  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 300000);
  state.visibilityState = 'hidden';
  intervals[0].fn();
  assert.equal(reloads, 0);
  state.visibilityState = 'visible';
  intervals[0].fn();
  assert.equal(reloads, 1);

  handlers.click();
  assert.equal(reloads, 2);
  assert.match(status.textContent, /Forecast reloaded/);
  assert.match(status.textContent, /model forecast, not vote counts or race calls/);
});
