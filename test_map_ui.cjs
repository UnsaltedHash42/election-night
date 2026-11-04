const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function context() {
  const env = { window:{}, Date, Number, Map, Set, URL, console, AbortSignal, setTimeout() {}, clearTimeout() {},
    document:{ hidden:true, addEventListener() {} }, fetch:async () => ({ ok:false }) };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync('public/ap.js', 'utf8'), env);
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

test('NPR rows normalize to race ids with leaders, winners and shares intact', () => {
  const env = context();
  const rows = env.readNprRaces({ results:[
    { test:false, state:'TX', office:'S', type:'General', winnerId:1,
      candidates:[
        { id:1, first:'James', last:'Talarico', party:'Dem', votes:2519629, percent:0.5815 },
        { id:2, first:'Ken', last:'Paxton', party:'GOP', votes:1746623, percent:0.4031 },
        { id:3, last:'Other', party:'Other', votes:66376 }] },
    { test:false, state:'AK', office:'H', type:'General', seatNumber:0,
      candidates:[{ id:9, first:'A', last:'B', party:'GOP', votes:5 }] },
    { test:false, state:'GA', office:'S', type:'Special General',
      candidates:[{ id:9, first:'A', last:'B', party:'Dem', votes:5 }] },
    { test:true, state:'FL', office:'S', type:'General',
      candidates:[{ id:9, first:'A', last:'B', party:'Dem', votes:5 }] },
    { test:false, state:'ZZZ', office:'S', type:'General',
      candidates:[{ id:9, first:'A', last:'B', party:'Dem', votes:5 }] },
    { test:false, state:'GA', office:'S', type:'General',
      candidates:[{ id:1, first:'W', last:'Inner', party:'Dem', votes:9, winner:'X' }, { id:2, first:'X', last:'Outer', party:'GOP', votes:4, winner:'' }] },
    { test:false, state:'CA', office:'H', type:'General', seatNumber:'12',
      candidates:[{ id:7, first:'Una', last:'Opposed', party:'Dem', votes:0, winner:'X' }] },
    { test:false, state:'NY', office:'H', type:'General', seatNumber:'',
      candidates:[{ id:8, first:'No', last:'Seat', party:'Dem', votes:5 }] },
    { test:false, state:'OH', office:'H', type:'General', seatNumber:'3',
      candidates:[{ id:9, first:'Zero', last:'Votes', party:'Dem', votes:0 }] }
  ]});
  assert.equal(rows.size, 4);
  const uncontested = rows.get('ca-house-12');
  assert.equal(uncontested.winner.name, 'Una Opposed');
  assert.equal(uncontested.leader, null);
  const tx = rows.get('tx-senate');
  assert.equal(tx.leader.name, 'James Talarico');
  assert.equal(tx.leader.party, 'dem');
  assert.equal(tx.percent, 58.2);
  assert.equal(tx.winner, null);
  assert.ok(rows.has('ak-house-00'));
  assert.equal(rows.get('ga-senate').winner.name, 'W Inner');
  assert.throws(() => env.readNprRaces({}), /Invalid NPR/);
});

test('watch.vote disagreements with AP are flagged; agreement and missing data are not', () => {
  const env = context();
  const watchLead = { result:{ ...result, leadName:'Ken Paxton', leadParty:'Republican', leadPercent:52, secondPercent:46.1 } };
  const apLead = { winner:null, leader:{ name:'James Talarico', party:'dem', partyName:'Democratic', share:58.2 }, second:null, percent:58.2, expected:58 };
  const row = env.apRow('tx-senate', apLead, Date.now(), watchLead);
  assert.equal(env.mapRaceStatus(row).party, 'dem');
  assert.match(env.providerConflict(row), /watch.vote shows Ken Paxton \(Republican\) leading with 52\.0%/);
  const apRep = { ...apLead, leader:{ ...apLead.leader, party:'rep' } };
  assert.equal(env.providerConflict(env.apRow('tx-senate', apRep, Date.now(), watchLead)), null);
  const watchCalled = { result:{ ...result, call:'called', winner:'lead', winnerName:'Ken Paxton', winnerParty:'Republican', leadPercent:52, secondPercent:46 } };
  const apCalled = { ...apLead, winner:apLead.leader };
  assert.match(env.providerConflict(env.apRow('tx-senate', apCalled, Date.now(), watchCalled)), /watch.vote has called this race for Ken Paxton \(Republican\)/);
  const unlisted = { result:{ ...result, leadParty:null, leadPercent:52, secondPercent:40 } };
  assert.equal(env.providerConflict(env.apRow('tx-senate', apLead, Date.now(), unlisted)), null);
  assert.equal(env.providerConflict(env.apRow('tx-senate', apLead, Date.now(), null)), null);
  assert.equal(env.providerConflict({ ...watchLead, source:'watch.vote' }), null);
});

test('market prices parse only live Yes/No books', () => {
  const env = context();
  const live = env.parseOddsMarket([{ outcomes:'["Yes", "No"]', outcomePrices:'["0.9935", "0.0065"]', closed:false }]);
  assert.equal(live.yes, 0.9935);
  assert.equal(env.parseOddsMarket([{ outcomes:'not json', outcomePrices:'["0.5"]' }]), null);
  const flipped = env.parseOddsMarket([{ outcomes:['No', 'Yes'], outcomePrices:['0.4', '0.6'], closed:false }]);
  assert.equal(flipped.yes, 0.6);
  assert.equal(env.parseOddsMarket([{ outcomes:['Yes', 'No'], outcomePrices:['0.61', '0.39'], closed:true }]), null);
  assert.equal(env.parseOddsMarket([{ outcomes:['Maybe'], outcomePrices:['0.5'] }]), null);
  assert.equal(env.parseOddsMarket([{ outcomes:['Yes', 'No'], outcomePrices:['bogus', '0.2'] }]), null);
  assert.equal(env.parseOddsMarket([]), null);
  assert.equal(env.parseOddsMarket('x'), null);
});
