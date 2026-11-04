const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function context() {
  const env = { window:{}, Date, Number, Map, Set, URL, console };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync('public/map.js', 'utf8'), env);
  return env;
}
const result = { call:'not-called', winner:null, winnerName:null, winnerParty:null,
  leadName:'First name', leadParty:'Democratic', leadPercent:null,
  secondName:'Second name', secondParty:'Republican', secondPercent:null,
  fetchedAt:new Date().toISOString() };

test('candidate order without positive vote shares never becomes a lead', () => {
  const env = context();
  assert.equal(env.mapRaceStatus(null).kind, 'missing');
  for (const share of [null, 0, -1, 101, '51']) {
    assert.equal(env.mapRaceStatus({ result:{ ...result, leadPercent:share } }).kind, 'waiting');
  }
});

test('a lead, a tie, a runoff and an explicit named winner stay distinct', () => {
  const env = context();
  assert.equal(env.mapRaceStatus({ result:{ ...result, leadPercent:52, secondPercent:48 } }).kind, 'leading');
  assert.equal(env.mapRaceStatus({ result:{ ...result, leadPercent:50, secondPercent:50 } }).kind, 'tied');
  assert.equal(env.mapRaceStatus({ result:{ ...result, call:'runoff', leadPercent:52 } }).kind, 'runoff');
  const call = env.mapRaceStatus({ result:{ ...result, call:'called', winner:'other', winnerName:'Named winner', winnerParty:null } });
  assert.equal(call.kind, 'called');
  assert.match(call.text, /Named winner/);
  assert.equal(call.party, 'other');
  assert.equal(env.mapRaceStatus({ result:{ ...result, call:'called' } }).kind, 'waiting');
});

test('old source checks stay marked and percentages never imply certification', () => {
  const env = context();
  const old = { ...result, leadPercent:100, secondPercent:0, fetchedAt:'2026-01-01T00:00:00Z' };
  const status = env.mapRaceStatus({ result:old });
  assert.equal(status.kind, 'leading');
  assert.equal(status.stale, true);
});
