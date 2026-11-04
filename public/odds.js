'use strict';

function parseOddsEvent(event) {
  const markets = [];
  for (const market of event?.markets || []) {
    if (!market?.active || typeof market.groupItemTitle !== 'string' || !market.groupItemTitle.trim()) continue;
    let tokens, prices;
    try {
      tokens = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
      prices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices;
    } catch { continue; }
    const price = Number(Array.isArray(prices) ? prices[0] : NaN);
    if (!Number.isFinite(price) || price < 0 || price > 1) continue;
    markets.push({ label:market.groupItemTitle.trim(), token:Array.isArray(tokens) ? String(tokens[0] || '') : '', price });
  }
  return { closed:event?.closed === true, markets };
}

window.raceOdds = (() => {
  const events = new Map(), live = new Map(), watched = new Map(), listeners = new Set();
  let slugs = null, checkedAt = null, timer = null, generation = 0;

  async function loadSlugs() {
    if (slugs) return slugs;
    const response = await fetch('/market-map.json', { signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Market map unavailable');
    slugs = await response.json();
    return slugs;
  }

  async function refresh() {
    clearTimeout(timer);
    if (document.hidden) return;
    const current = ++generation;
    try {
      const map = await loadSlugs();
      const wanted = [...new Set([...watched.values()].flatMap(ids => [...ids]).map(id => map[id]).filter(Boolean))];
      const unknown = wanted.filter(slug => !events.has(slug) || Date.now() - events.get(slug).fetchedAt >= 300000);
      if (unknown.length) {
        const query = unknown.map(slug => `slug=${encodeURIComponent(slug)}`).join('&');
        const response = await fetch(`https://gamma-api.polymarket.com/events?${query}`, { signal:AbortSignal.timeout(15000) });
        if (response.ok) for (const event of await response.json()) if (unknown.includes(event?.slug)) events.set(event.slug, { ...parseOddsEvent(event), fetchedAt:Date.now() });
      }
      const tokens = wanted.flatMap(slug => events.get(slug)?.closed === false ? events.get(slug).markets.map(market => market.token) : []).filter(Boolean);
      if (tokens.length) {
        const response = await fetch('https://clob.polymarket.com/midpoints', { method:'POST', headers:{ 'Content-Type':'application/json' },
          body:JSON.stringify(tokens.map(token_id => ({ token_id }))), signal:AbortSignal.timeout(15000) });
        if (response.ok) {
          for (const [token, value] of Object.entries(await response.json())) {
            const price = Number(value);
            if (Number.isFinite(price) && price >= 0 && price <= 1) live.set(token, price);
          }
          checkedAt = Date.now();
        }
      } else if (wanted.length) checkedAt = Date.now();
    } catch { /* last known prices stay in place */ }
    if (current !== generation) return;
    for (const listener of listeners) listener();
    if (!document.hidden) timer = setTimeout(refresh, 60000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); generation++; }
    else refresh();
  });

  return {
    watch(owner, raceIds) {
      const previous = watched.get(owner);
      const next = new Set(raceIds.filter(Boolean));
      watched.set(owner, next);
      if (!previous || [...next].some(id => !previous.has(id))) refresh();
    },
    get(raceId) {
      if (!slugs) return undefined;
      const slug = slugs[raceId];
      if (!slug) return null;
      const event = events.get(slug);
      if (!event) return undefined;
      const markets = event.markets.map(market => ({ label:market.label, price:event.closed ? market.price : live.get(market.token) ?? market.price }))
        .sort((a, b) => b.price - a.price);
      return { slug, closed:event.closed, markets, checkedAt };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
})();

function oddsText(odds) {
  if (odds === undefined) return 'Polymarket: loading…';
  if (odds === null || !odds.markets.length) return 'Polymarket: no market for this race';
  const percent = price => price < 0.01 ? '<1%' : price > 0.99 ? '>99%' : `${Math.round(price * 100)}%`;
  if (odds.closed) return `Polymarket (resolved): ${odds.markets[0].label}`;
  return `Polymarket: ${odds.markets.slice(0, 2).map(market => `${market.label} ${percent(market.price)}`).join(' · ')}`;
}
