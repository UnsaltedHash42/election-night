'use strict';

function mapParty(party) {
  if (/^(d|democrat|democratic)$/i.test(party || '')) return 'dem';
  if (/^(r|republican|gop)$/i.test(party || '')) return 'rep';
  return 'other';
}

function mapRaceStatus(row) {
  const result = row?.result;
  if (!result) return { kind:'missing', party:'none', text:'No result available', stale:false };
  const stale = !Number.isFinite(Date.parse(result.fetchedAt)) || Date.now() - Date.parse(result.fetchedAt) > 600000;
  if (['called', 'certified'].includes(result.call) && ['lead', 'second', 'other'].includes(result.winner) && result.winnerName) {
    return { kind:'called', party:mapParty(result.winnerParty), stale,
      text:`✓ ${result.call === 'certified' ? 'Certified' : 'Called'}: ${result.winnerName} (${result.winnerParty || 'Party not listed'})` };
  }
  if (['runoff', 'recount'].includes(result.call)) return { kind:result.call, party:'none', stale, text:result.call === 'runoff' ? 'Runoff' : 'Recount' };
  const share = result.leadPercent;
  if (result.call === 'not-called' && result.leadName && typeof share === 'number' && share > 0 && share <= 100) {
    if (share === result.secondPercent) return { kind:'tied', party:'none', stale, text:'Tied in reported votes · Not called' };
    if (typeof result.secondPercent !== 'number' || share > result.secondPercent) {
      return { kind:'leading', party:mapParty(result.leadParty), stale,
        text:`Leading: ${result.leadName} (${result.leadParty || 'Party not listed'}) · Not called` };
    }
  }
  return { kind:'waiting', party:'none', stale, text:'Awaiting a reported lead · Not called' };
}

function apRow(raceId, ap, checkedAt, watch) {
  const { winner, leader, second } = ap;
  const place = !winner ? null : winner.name === leader?.name ? 'lead' : winner.name === second?.name ? 'second' : 'other';
  return { raceId:`2026-${raceId}`, source:'ap', ap, watch:watch || null,
    official:{ authority:'AP via NPR', url:'https://apps.npr.org/2026-election-results/', read:true },
    result:{ raceId:`2026-${raceId}`, call:winner ? 'called' : 'not-called', calledBy:winner ? 'AP' : null, runoffOn:null,
      sourceKind:'licensed', winner:place, winnerName:winner?.name || null, winnerParty:winner?.partyName || null,
      leadName:leader?.name || null, leadParty:leader?.partyName || null, leadPercent:leader?.share ?? null,
      secondName:second?.name || null, secondParty:second?.partyName || null, secondPercent:second?.share ?? null,
      countedKind:ap.expected === null ? null : 'expected', countedPercent:ap.expected,
      authority:'AP via NPR', fetchedAt:new Date(checkedAt).toISOString() } };
}

function providerConflict(row) {
  if (row?.source !== 'ap' || !row.watch?.result) return null;
  const ap = row.ap, watch = row.watch.result, status = mapRaceStatus(row.watch);
  const apParty = ap.winner?.party || ap.leader?.party;
  if (!apParty) return null;
  if (['called', 'certified'].includes(status.kind)) {
    return status.party !== apParty ? `watch.vote has called this race for ${watch.winnerName} (${watch.winnerParty || 'party not listed'}).` : null;
  }
  if (status.kind !== 'leading' || !watch.leadParty || mapParty(watch.leadParty) === apParty) return null;
  return `watch.vote shows ${watch.leadName} (${watch.leadParty}) leading with ${watch.leadPercent.toFixed(1)}%.`;
}

window.ElectionMap = class ElectionMap {
  constructor({ stateNames, homeState, onExplore }) {
    this.names = stateNames;
    this.onExplore = onExplore;
    this.office = 'senate';
    this.selectedState = homeState || '';
    this.selectedRace = homeState ? `${homeState.toLowerCase()}-senate` : '';
    this.races = [];
    this.cache = new Map();
    window.apResults?.subscribe(() => this.render());
    window.raceOdds?.subscribe(() => this.render());
    this.nodes = new Map();
    this.generation = 0;
    this.time = new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZoneName:'short' });
    for (const [code, name] of Object.entries(stateNames).sort((a,b) => a[1].localeCompare(b[1]))) {
      this.el('map-state').append(new Option(name, code));
    }
    for (const office of ['senate', 'house', 'governors']) this.el(`map-${office}`).addEventListener('click', () => {
      this.office = office;
      this.selectedRace = '';
      this.error = '';
      this.render();
      this.refresh();
    });
    this.el('map-state').addEventListener('change', () => {
      this.selectedState = this.el('map-state').value;
      this.selectedRace = '';
      this.render();
    });
    this.el('map-race').addEventListener('change', () => {
      this.selectedRace = this.el('map-race').value;
      this.selectedState = this.races.find(race => race.id === this.selectedRace)?.state || this.selectedState;
      this.render();
    });
    this.el('map-reset').addEventListener('click', () => {
      this.el('map-state').value = ''; this.selectedRace = ''; this.selectedState = ''; this.render();
    });
    this.el('map-retry').addEventListener('click', () => this.shapes ? this.refresh() : this.start());
    document.addEventListener('visibilitychange', () => {
      clearTimeout(this.timer);
      if (document.hidden) { this.controller?.abort(); this.generation++; this.loading = false; this.renderStatus(); }
      else if (this.shapes) this.refresh();
    });
  }

  el(id) { return document.getElementById(id); }
  node(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
  }
  svg(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  officeName() { return { senate:'Senate', house:'House', governors:'Governor' }[this.office]; }
  officeRaces() { return this.races.filter(race => race.office === this.officeName() || (this.office === 'house' && race.office === 'Delegate')); }
  setRaces(races) {
    this.races = races;
    if (!this.shapes && !this.starting) this.start(); else if (this.shapes) this.render();
  }

  async start() {
    if (this.starting) return;
    this.starting = true;
    this.el('map-retry').disabled = true;
    try {
      const response = await fetch('/map-shapes.json', { signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Map unavailable');
      const shapes = await response.json();
      if (!Array.isArray(shapes.states) || !Array.isArray(shapes.districts) || shapes.width !== 960 || shapes.height !== 620) throw new Error('Invalid map');
      this.shapes = shapes;
      this.error = '';
      this.render();
      await this.refresh();
    } catch {
      this.error = 'Map could not be loaded. Use Retry or the race desk below.';
      this.renderStatus();
    } finally { this.starting = false; this.el('map-retry').disabled = false; }
  }

  async refresh() {
    clearTimeout(this.timer);
    if (document.hidden || !this.shapes) return;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    const generation = ++this.generation, office = this.office;
    const timeout = setTimeout(() => controller.abort(), 15000);
    let delay = 60000;
    this.loading = true;
    this.renderStatus();
    try {
      const response = await fetch(`/api/map-results?office=${office}`, { signal:controller.signal });
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After'));
        if (Number.isFinite(retry) && retry > 0) delay = Math.max(60000, retry * 1000);
      }
      if (!response.ok) throw new Error('Results unavailable');
      const payload = await response.json();
      if (payload.office !== office || !Array.isArray(payload.rows)) throw new Error('Invalid results');
      if (generation !== this.generation) return;
      this.cache.set(office, { payload, checkedAt:Date.now() });
      this.error = '';
    } catch {
      if (generation === this.generation) this.error = this.cache.has(office)
        ? 'Update unavailable — showing the last successful results.' : 'Results unavailable — no results have loaded for this view.';
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.loading = false;
        this.render();
        if (!document.hidden) this.timer = setTimeout(() => this.refresh(), delay);
      }
    }
  }

  mergedRows() {
    const watch = new Map((this.cache.get(this.office)?.payload.rows || []).map(row => [row.raceId.replace(/^2026-/, ''), row]));
    const rows = new Map();
    for (const race of this.officeRaces()) {
      const ap = window.apResults?.get(race.id), row = watch.get(race.id);
      if (ap) rows.set(race.id, apRow(race.id, ap, window.apResults.checkedAt, row));
      else if (row) rows.set(race.id, { ...row, source:'watch.vote' });
    }
    return rows;
  }

  renderStatus() {
    const saved = this.cache.get(this.office);
    const rows = [...this.mergedRows().values()].filter(row => row.result);
    const fallback = rows.filter(row => row.source === 'watch.vote').length;
    const called = rows.filter(row => mapRaceStatus(row).kind === 'called').length;
    const disputed = rows.filter(row => providerConflict(row)).length;
    const checked = Math.max(saved?.checkedAt || 0, window.apResults?.checkedAt || 0);
    this.el('map-status').textContent = document.hidden ? 'Ⅱ Map checks paused in background'
      : checked ? `${rows.length} races with results · ${called} called · AP via NPR${fallback ? `; watch.vote for ${fallback} AP hasn’t reported` : ''}${disputed ? ` · ⚠ ${disputed} ${disputed === 1 ? 'race where' : 'races where'} watch.vote disagrees` : ''} · Checked ${this.time.format(new Date(checked))}${this.loading ? ' · Updating…' : ''}`
      : this.loading ? 'Loading results…' : 'Waiting for results';
    const apCovered = Boolean(window.apResults?.office(this.office)) && !window.apResults.failed(this.office);
    this.el('map-error').hidden = !this.error || apCovered;
    this.el('map-error').textContent = this.error || '';
    this.el('map-retry').disabled = Boolean(this.loading);
  }

  render() {
    if (!this.shapes) return;
    const officeRaces = this.officeRaces(), zoom = this.el('map-state').value;
    const raceByShape = new Map();
    for (const race of officeRaces) {
      const key = this.office === 'house' ? race.id : race.state;
      if (!raceByShape.has(key)) raceByShape.set(key, race);
    }
    if (!this.selectedRace && this.selectedState) this.selectedRace = officeRaces.find(race => race.state === this.selectedState)?.id || '';
    const rows = this.mergedRows();
    const shapes = (this.office === 'house' ? this.shapes.districts : this.shapes.states).filter(shape => !zoom || (shape.state || shape.id) === zoom);
    const signature = `${this.office}:${zoom}`;
    if (signature !== this.signature) {
      this.nodes.clear();
      const paths = shapes.map(shape => {
        const path = this.svg('path'), title = this.svg('title');
        path.setAttribute('d', shape.path); path.setAttribute('tabindex', '0'); path.setAttribute('role', 'button');
        path.dataset.shape = shape.id;
        path.append(title);
        const select = () => {
          this.selectedState = shape.state || shape.id;
          this.selectedRace = this.office === 'house' ? shape.id : officeRaces.find(race => race.state === shape.id)?.id || '';
          this.render();
        };
        path.addEventListener('click', select);
        path.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } });
        this.nodes.set(shape.id, { shape, path, title });
        return path;
      });
      this.el('map-regions').replaceChildren(...paths);
      const state = this.shapes.states.find(shape => shape.id === zoom);
      const bounds = state?.bounds;
      this.el('election-map').setAttribute('viewBox', bounds
        ? `${bounds[0][0]-12} ${bounds[0][1]-12} ${bounds[1][0]-bounds[0][0]+24} ${bounds[1][1]-bounds[0][1]+24}` : '0 0 960 620');
      const labels = this.shapes.states.filter(shape => (!zoom || shape.id === zoom) && (zoom || !['DC','RI','DE','NJ','CT','MA','MD'].includes(shape.id))).map(shape => {
        const text = this.svg('text'); text.textContent = shape.id;
        text.setAttribute('x', shape.centroid[0]); text.setAttribute('y', shape.centroid[1]);
        text.setAttribute('font-size', zoom ? Math.max(2, (bounds[1][0]-bounds[0][0])/18) : 11);
        return text;
      });
      this.el('map-labels').replaceChildren(...labels);
      this.signature = signature;
    }
    for (const { shape, path, title } of this.nodes.values()) {
      const race = raceByShape.get(shape.id);
      const status = race ? mapRaceStatus(rows.get(race.id)) : { kind:'no-race', party:'none', text:`No ${this.officeName()} race in 2026` };
      const conflict = race ? providerConflict(rows.get(race.id)) : null;
      const selected = race ? race.id === this.selectedRace : shape.id === this.selectedState;
      path.setAttribute('class', `map-region ${status.kind} ${status.party}${status.stale ? ' stale' : ''}${conflict ? ' disputed' : ''}${selected ? ' selected' : ''}`);
      path.setAttribute('aria-label', `${race?.name || shape.name}: ${status.text}${status.stale ? ' · Source check over 10 minutes old' : ''}${conflict ? ' · Sources disagree' : ''}`);
      path.setAttribute('aria-pressed', String(selected));
      title.textContent = `${race?.name || shape.name}: ${status.text}${conflict ? ' · Sources disagree' : ''}`;
    }
    for (const office of ['senate', 'house', 'governors']) this.el(`map-${office}`).setAttribute('aria-pressed', String(this.office === office));
    const choices = officeRaces.filter(race => !zoom || race.state === zoom);
    const pickerSignature = choices.map(race => race.id).join('|');
    if (pickerSignature !== this.pickerSignature) {
      this.el('map-race').replaceChildren(new Option('Choose a race', ''), ...choices.map(race => new Option(race.name, race.id)));
      this.pickerSignature = pickerSignature;
    }
    this.el('map-race').value = this.selectedRace;
    window.raceOdds?.watch('map', [this.selectedRace]);
    this.renderDetail(officeRaces.find(race => race.id === this.selectedRace), rows.get(this.selectedRace));
    this.renderStatus();
  }

  renderDetail(race, row) {
    const panel = this.el('map-detail');
    const focusedId = panel.contains(document.activeElement) ? document.activeElement.id : '';
    const name = race?.name || (this.selectedState ? this.names[this.selectedState] : 'Select a state or district');
    const content = [this.node('h3', '', name)];
    if (!race) {
      content.push(this.node('p', '', this.selectedState ? `No ${this.officeName()} race is listed here in 2026.` : 'Click the map or choose a race to see its leaders, call status and source. Use the state picker to zoom in.'));
    } else {
      const result = row?.result, status = mapRaceStatus(row);
      content.push(this.node('p', `map-outcome ${status.kind}`, status.text));
      if (row?.source === 'watch.vote' && result) content.push(this.node('p', 'map-ap-fill', 'AP via NPR has no results for this race yet — showing watch.vote.'));
      const conflict = providerConflict(row);
      if (conflict) {
        content.push(this.node('p', 'map-conflict', `⚠ Sources disagree — ${conflict}`));
        const compare = this.node('a', '', 'Compare at watch.vote ↗');
        compare.href = `https://watch.vote/midterms/2026/races/${race.slug}`;
        compare.target = '_blank'; compare.rel = 'noopener noreferrer';
        content.push(compare);
      }
      const odds = window.raceOdds?.get(race.id);
      if (window.raceOdds) content.push(this.node('p', 'map-odds', `${oddsText(odds)}${odds?.markets?.length ? ' · a market price, not a count, call or forecast' : ''}`));
      if (odds?.slug) {
        const market = this.node('a', '', 'Open Polymarket market ↗');
        market.href = `https://polymarket.com/event/${odds.slug}`;
        market.target = '_blank'; market.rel = 'noopener noreferrer';
        content.push(market);
      }
      for (const prefix of ['lead', 'second']) {
        if (result?.[`${prefix}Name`]) content.push(this.node('p', 'map-candidate',
          `${result[`${prefix}Name`]} · ${result[`${prefix}Party`] || 'Party not listed'} · ${typeof result[`${prefix}Percent`] === 'number' ? `${result[`${prefix}Percent`].toFixed(1)}%` : 'No vote share yet'}`));
      }
      if (result?.countedPercent !== null && typeof result?.countedPercent === 'number') {
        content.push(this.node('p', 'map-counted', `${result.countedPercent.toFixed(1)}% ${result.countedKind === 'expected' ? 'of expected vote counted' : result.countedKind === 'precincts' ? 'of precincts reporting (not vote share)' : 'counted — measure not specified'}`));
      }
      if (result) {
        content.push(this.node('p', 'map-source-time', `Source last checked ${new Date(result.fetchedAt).toLocaleString()}${status.stale ? ' · Over 10 minutes old' : ''}`));
        if (result.calledBy) content.push(this.node('p', 'map-source-time', `Call by ${result.calledBy}`));
      }
      const source = this.node('a', '', result?.authority || row?.official?.authority || 'Open race at watch.vote');
      source.id = 'map-source-link';
      source.href = row?.official?.url || `https://watch.vote/midterms/2026/races/${race.slug}`;
      source.target = '_blank'; source.rel = 'noopener noreferrer';
      content.push(source);
      const official = row?.watch?.official;
      if (official?.url) {
        const link = this.node('a', '', `Official results: ${official.authority} ↗`);
        link.href = official.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const line = this.node('p', 'map-source-time');
        line.append(link);
        content.push(line);
      }
      const explore = this.node('button', 'button', 'Open race in the desk ↓');
      explore.id = 'map-explore'; explore.type = 'button';
      explore.addEventListener('click', () => this.onExplore({ raceId:race.id }));
      content.push(explore);
    }
    panel.replaceChildren(...content);
    if (focusedId) this.el(focusedId)?.focus({ preventScroll:true });
  }
};
