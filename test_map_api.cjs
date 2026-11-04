const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function payload(office = 'senate', call = 'not-called') {
  const raceId = `2026-ar-${office === 'house' ? 'house-01' : office === 'governors' ? 'governor' : 'senate'}`;
  const called = ['called', 'certified'].includes(call);
  return { office, readAt:'2026-11-04T01:00:00Z', resultsFrom:'2026-11-03T22:00:00Z', rows:[{
    raceId, official:{ authority:'Test election office', url:'https://example.com/results', read:true },
    result:{ raceId, call, calledBy:call === 'called' ? 'Test decision desk' : null, runoffOn:null,
      sourceKind:call === 'called' ? 'licensed' : 'official-feed', winner:called ? 'lead' : null,
      winnerName:called ? 'A' : null, winnerParty:called ? 'Democratic' : null,
      leadName:'A', leadParty:'Democratic', leadPercent:60, secondName:'B', secondParty:null, secondPercent:40,
      countedKind:'precincts', countedPercent:70, authority:'Test election office', fetchedAt:'2026-11-04T00:59:00Z' }
  }] };
}

function setup(upstream = () => Response.json(payload())) {
  const entries = new Map(), requests = [], pending = [];
  const context = vm.createContext({ URL, Request, Response, Headers, AbortSignal, Date, console,
    fetch:async(url, options) => {
      requests.push({ url, options });
      if (options.redirect === 'error') throw new TypeError('Workers accepts only follow or manual redirects');
      return upstream(url, options);
    },
    caches:{ default:{
      match:async request => entries.get(request.url)?.clone(),
      put:async(request, response) => { entries.set(request.url, response.clone()); }
    } }
  });
  const source = fs.readFileSync('functions/api/map-results.js', 'utf8').replace('export async function onRequest', 'async function onRequest');
  const handler = vm.runInContext(source + '\nonRequest;', context);
  return { entries, requests,
    request:async(query = 'office=senate', method = 'GET') => {
      const response = await handler({ request:new Request(`https://election.example/api/map-results?${query}`, {
        method, headers:{ Cookie:'private=do-not-forward', Range:'bytes=0-1' }
      }), waitUntil:promise => pending.push(promise) });
      await Promise.all(pending.splice(0));
      return response;
    }
  };
}

test('only GET and the three named offices can reach the upstream', async() => {
  const env = setup();
  for (const query of ['', 'office=president', 'office=senate&office=house', 'office=https://example.com', 'office=senate&url=https://example.com']) {
    const response = await env.request(query);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const response = await env.request('office=senate', 'POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET');
  assert.equal(env.requests.length, 0);
});

test('valid office results are normalized and cached for 60 seconds without client headers', async() => {
  const data = payload();
  data.privateExtra = 'omit'; data.rows[0].result.extra = 'omit'; data.rows[0].official.extra = 'omit';
  const env = setup(() => Response.json(data, { headers:{ 'Set-Cookie':'upstream-private=omit' } }));
  const first = await env.request();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), payload());
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=60');
  assert.equal(first.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(first.headers.get('Set-Cookie'), null);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(env.requests[0].url, 'https://watch.vote/api/elections/2026/results?office=senate');
  assert.equal(new Headers(env.requests[0].options.headers).get('Cookie'), null);
  assert.equal(env.requests[0].options.redirect, 'manual');
  assert.ok(env.requests[0].options.signal instanceof AbortSignal);
  assert.equal((await env.request()).status, 200);
  assert.equal(env.requests.length, 1);
  assert.equal(env.entries.size, 1);
});

test('all offices preserve explicit calls, nullable fields, and unknown results', async() => {
  for (const office of ['senate', 'house', 'governors']) {
    for (const call of ['not-called', 'called', 'certified', 'runoff', 'recount']) {
      const data = payload(office, call);
      if (call === 'called') data.rows[0].result.winnerParty = null;
      const env = setup(() => Response.json(data));
      assert.deepEqual(await (await env.request(`office=${office}`)).json(), data);
    }
  }
  const data = payload(); data.rows[0].result = null; data.rows[0].official = null; data.readAt = null;
  const env = setup(() => Response.json(data));
  assert.deepEqual(await (await env.request()).json(), data);
});

test('malformed or mismatched results return an error instead of an empty election map', async() => {
  const mutations = [
    data => { data.office = 'house'; },
    data => { data.resultsFrom = '2024-11-05T22:00:00Z'; },
    data => { data.readAt = 'invalid'; },
    data => { data.rows[0].raceId = '2024-ar-senate'; },
    data => { data.rows[0].result.raceId = '2026-ga-senate'; },
    data => { data.rows.push(data.rows[0]); },
    data => { data.rows[0].result.leadPercent = 101; },
    data => { data.rows[0].result.secondPercent = '40'; },
    data => { data.rows[0].result.call = 'projected'; },
    data => { data.rows[0].result.winner = 'lead'; },
    data => { data.rows[0].result.call = 'called'; },
    data => { data.rows[0].result.fetchedAt = 'invalid'; },
    data => { data.rows[0].official.url = 'javascript:alert(1)'; }
  ];
  for (const mutate of mutations) {
    const data = payload(); mutate(data);
    const env = setup(() => Response.json(data));
    const response = await env.request();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error:'results_unavailable' });
    assert.equal(env.entries.size, 0);
  }
});

test('an expired successful cache is not replaced with invented results on an outage', async() => {
  let upstream = () => Response.json(payload('senate', 'called'));
  const env = setup(() => upstream());
  assert.equal((await env.request()).status, 200);
  env.entries.clear();
  for (const failure of [() => new Response('offline', { status:503 }), () => { throw new Error('network failure'); }, () => new Response('{bad')]) {
    upstream = failure;
    const response = await env.request();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error:'results_unavailable' });
    assert.equal(env.entries.size, 0);
  }
});

test('upstream rate limits return a safe retry interval and are not cached', async() => {
  for (const [retry, expected] of [['180', '180'], ['invalid', '60'], ['-3', '60']]) {
    const env = setup(() => new Response('private upstream error', { status:429, headers:{ 'Retry-After':retry } }));
    const response = await env.request();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), expected);
    assert.deepEqual(await response.json(), { error:'rate_limited' });
    assert.equal(env.entries.size, 0);
  }
});

test('an upstream redirect is rejected without following its destination', async() => {
  const env = setup(() => new Response(null, { status:302, headers:{ Location:'https://example.com/another-feed' } }));
  const response = await env.request();
  assert.equal(response.status, 502);
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].options.redirect, 'manual');
  assert.equal(env.entries.size, 0);
});
