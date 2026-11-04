'use strict';

function nprParty(value) {
  if (value === 'Dem') return 'dem';
  if (/^(GOP|Rep)/.test(value || '')) return 'rep';
  return 'other';
}

function nprPartyName(value) {
  return { Dem:'Democratic', GOP:'Republican' }[value] || value || null;
}

function readNprRaces(data) {
  if (!data || !Array.isArray(data.results)) throw new Error('Invalid NPR results');
  const map = new Map(), regular = new Set();
  for (const item of data.results) {
    if (item?.test !== false || !/^[A-Z]{2}$/.test(item?.state || '')) continue;
    let id;
    const statewide = ['General', 'Special General'].includes(item.type);
    if (item.office === 'S' && statewide) id = `${item.state.toLowerCase()}-senate`;
    else if (item.office === 'G' && statewide) id = `${item.state.toLowerCase()}-governor`;
    else if (item.office === 'H' && ['General', 'Nonpartisan Election'].includes(item.type)) {
      const district = ['AK', 'DE', 'ND', 'SD', 'VT', 'WY'].includes(item.state) ? 0 : Number(item.seatNumber);
      if (!Number.isInteger(district) || district < 0 || String(item.seatNumber).trim() === '') continue;
      id = `${item.state.toLowerCase()}-house-${String(district).padStart(2, '0')}`;
    } else continue;
    if (item.type === 'Special General' && regular.has(id)) continue;
    if (item.type !== 'Special General') regular.add(id);
    const named = (item.candidates || []).filter(candidate => candidate.party !== 'Other' && (candidate.last || candidate.first));
    const counted = named.filter(candidate => Number.isFinite(candidate.votes) && candidate.votes > 0).sort((a, b) => b.votes - a.votes);
    const winner = named.find(candidate => candidate.winner === 'X') || null;
    if (!winner && !counted.length) continue;
    const total = (item.candidates || []).reduce((sum, candidate) => sum + (Number.isFinite(candidate.votes) && candidate.votes > 0 ? candidate.votes : 0), 0);
    const name = candidate => `${candidate.first || ''} ${candidate.last || ''}`.trim();
    const person = candidate => candidate ? { name:name(candidate), party:nprParty(candidate.party), partyName:nprPartyName(candidate.party),
      share:total ? Math.round((candidate.votes / total) * 1000) / 10 : null } : null;
    const leader = person(counted[0]);
    map.set(id, {
      winner: person(winner),
      leader,
      second: person(counted[1]),
      percent: leader?.share ?? null,
      expected: Number.isFinite(item.eevp) && item.eevp >= 0 && item.eevp <= 1 ? Math.round(item.eevp * 1000) / 10 : null
    });
  }
  return map;
}

window.apResults = (() => {
  const files = { senate:'senate.json', house:'house.json', governors:'gov.json' };
  const offices = new Map(), failed = new Set(), listeners = new Set();
  let checkedAt = null, timer = null, generation = 0;

  async function read(office) {
    const response = await fetch(`https://apps.npr.org/2026-election-results/data/${files[office]}`,
      { cache:'no-cache', signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('AP results unavailable');
    return readNprRaces(await response.json());
  }

  async function refresh() {
    clearTimeout(timer);
    if (document.hidden) return;
    const current = ++generation;
    const names = Object.keys(files);
    const results = await Promise.allSettled(names.map(read));
    if (current !== generation) return;
    names.forEach((office, index) => {
      if (results[index].status === 'fulfilled') { offices.set(office, results[index].value); failed.delete(office); }
      else failed.add(office);
    });
    if (results.some(result => result.status === 'fulfilled')) checkedAt = Date.now();
    for (const listener of listeners) listener();
    if (!document.hidden) timer = setTimeout(refresh, 60000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); generation++; }
    else refresh();
  });

  return {
    get(raceId) {
      for (const races of offices.values()) if (races.has(raceId)) return races.get(raceId);
      return null;
    },
    office(office) { return offices.get(office) || null; },
    failed(office) { return failed.has(office); },
    officeFor(race) { return race.office === 'Senate' ? 'senate' : race.office === 'Governor' ? 'governors' : 'house'; },
    get checkedAt() { return checkedAt; },
    subscribe(listener) { listeners.add(listener); if (checkedAt) listener(); return () => listeners.delete(listener); },
    refresh
  };
})();

window.apResults.refresh();
