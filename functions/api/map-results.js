const offices = { senate:'senate', house:'house-\\d{2}', governors:'governor' };
const callStates = ['not-called', 'called', 'certified', 'runoff', 'recount'];
const resultFields = ['raceId', 'call', 'calledBy', 'runoffOn', 'sourceKind', 'winner', 'winnerName', 'winnerParty',
  'leadName', 'leadParty', 'leadPercent', 'secondName', 'secondParty', 'secondPercent', 'countedKind', 'countedPercent', 'authority', 'fetchedAt'];
const nullableText = value => value === null || typeof value === 'string';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const percentage = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const nonemptyText = value => typeof value === 'string' && Boolean(value.trim());

function normalize(data, office) {
  if (!data || data.office !== office || !(data.readAt === null || timestamp(data.readAt))
    || !timestamp(data.resultsFrom) || Date.parse(data.resultsFrom) !== Date.parse('2026-11-03T22:00:00Z')
    || !Array.isArray(data.rows)) throw new Error('Invalid office results');
  const pattern = new RegExp(`^2026-[a-z]{2}-${offices[office]}$`);
  const seen = new Set();
  const rows = data.rows.map(row => {
    if (!row || typeof row.raceId !== 'string' || !pattern.test(row.raceId) || seen.has(row.raceId)) throw new Error('Invalid race');
    seen.add(row.raceId);
    let official = null;
    if (row.official !== null) {
      if (!row.official || !nonemptyText(row.official.authority) || typeof row.official.url !== 'string'
        || !['https:', 'http:'].includes(new URL(row.official.url).protocol) || typeof row.official.read !== 'boolean') {
        throw new Error('Invalid source');
      }
      official = { authority:row.official.authority, url:row.official.url, read:row.official.read };
    }
    let result = null;
    if (row.result !== null) {
      const value = row.result;
      if (!value || value.raceId !== row.raceId || !callStates.includes(value.call)
        || !['licensed', 'official-feed', 'official-page'].includes(value.sourceKind)
        || !['calledBy', 'runoffOn', 'winnerName', 'winnerParty', 'leadName', 'leadParty', 'secondName', 'secondParty'].every(key => nullableText(value[key]))
        || !['leadPercent', 'secondPercent', 'countedPercent'].every(key => percentage(value[key]))
        || ![null, 'expected', 'precincts'].includes(value.countedKind) || !nonemptyText(value.authority) || !timestamp(value.fetchedAt)) {
        throw new Error('Invalid result');
      }
      const called = ['called', 'certified'].includes(value.call);
      if (called ? !['lead', 'second', 'other'].includes(value.winner) || !nonemptyText(value.winnerName)
        : value.winner !== null || value.winnerName !== null || value.winnerParty !== null) throw new Error('Inconsistent call');
      result = Object.fromEntries(resultFields.map(key => [key, value[key]]));
    }
    return { raceId:row.raceId, result, official };
  });
  return { office, readAt:data.readAt, resultsFrom:data.resultsFrom, rows };
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers:{
    'Cache-Control':status === 200 ? 'public, max-age=0, s-maxage=60' : 'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin', ...headers
  } });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error:'method_not_allowed' }, 405, { Allow:'GET' });
  const url = new URL(context.request.url);
  const office = url.searchParams.get('office');
  if (!Object.hasOwn(offices, office) || url.searchParams.getAll('office').length !== 1
    || [...url.searchParams.keys()].some(key => key !== 'office')) return json({ error:'invalid_office' }, 400);
  const cacheKey = new Request(new URL(`/api/map-results?office=${office}`, url.origin));
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
    const upstream = await fetch(`https://watch.vote/api/elections/2026/results?office=${office}`, {
      headers:{ Accept:'application/json' }, signal:AbortSignal.timeout(15000), redirect:'manual'
    });
    if (upstream.status === 429) {
      const retry = upstream.headers.get('Retry-After');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
      return json({ error:'rate_limited' }, 429, { 'Retry-After':String(Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60) });
    }
    if (!upstream.ok) throw new Error('Upstream unavailable');
    const response = json(normalize(await upstream.json(), office));
    context.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch {
    return json({ error:'results_unavailable' }, 502);
  }
}
