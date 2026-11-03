'use strict';

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('en-US');
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
let data = null;
let apiFailed = false;
let fetching = false;
let timer;
let watchlistOnly = false;
let keyOnly = true;
let visibleLimit = 60;
let pins = new Set();
const opened = new Set();
try { pins = new Set(JSON.parse(localStorage.getItem('election-night-pins') || '[]')); } catch { /* Storage may be disabled. */ }

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(label, url, className = '') {
  const node = element('a', className, label);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      node.href = parsed.href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
  } catch { /* A malformed source URL must not become a navigation target. */ }
  return node;
}

function time(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return 'Not yet available';
  const day = date.toDateString() === new Date().toDateString() ? '' : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, `;
  return day + timeFormat.format(date);
}

function age(value) {
  if (!value) return 'Not checked yet';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return 'Unknown';
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function stale(source) {
  const maxAge = Math.max(300000, (source?.pollIntervalSeconds || 60) * 2000 + 60000);
  return apiFailed || !source || source.status !== 'ok' || !source.lastSuccess || Date.now() - new Date(source.lastSuccess).getTime() > maxAge;
}

function status(label, kind) { return element('span', `status status-${kind}`, label); }

function candidateRow(candidate, total) {
  const row = element('div', 'candidate');
  const top = element('div', 'candidate-top');
  const info = element('div', 'candidate-info');
  const party = String(candidate.party || 'OTHER');
  const partyClass = party === 'DEM' ? 'dem' : party === 'REP' ? 'rep' : 'other';
  info.append(element('span', 'candidate-name', candidate.name), element('span', `party party-${partyClass}`, party));
  const count = element('div', 'candidate-numbers');
  count.append(element('strong', '', number.format(candidate.votes)), element('span', 'candidate-percent', total > 0 ? `${(candidate.votes / total * 100).toFixed(1)}%` : '—'));
  top.append(info, count);
  const track = element('div', 'vote-track');
  track.setAttribute('aria-hidden', 'true');
  const fill = element('div', `vote-fill ${partyClass}`);
  fill.style.width = `${total > 0 ? Math.min(100, candidate.votes / total * 100) : 0}%`;
  track.append(fill);
  row.append(top, track);
  return row;
}

function detailRow(label, value) {
  const row = element('div', 'detail-row');
  row.append(element('span', '', label), element('span', '', value));
  return row;
}

function raceCard(race, sources) {
  const source = sources.get(race.sourceId);
  const isStale = stale(source);
  const candidates = [...race.candidates].sort((a, b) => b.votes - a.votes);
  const leader = candidates[0];
  const runner = candidates[1];
  const margin = leader && runner ? leader.votes - runner.votes : null;
  const card = element('article', `race-card${pins.has(race.id) ? ' is-pinned' : ''}${isStale ? ' is-stale' : ''}`);
  const header = element('div', 'card-header');
  const title = element('div');
  title.append(element('div', 'race-label', `${race.state} / ${race.office}`), element('h3', '', race.name));
  const pin = element('button', 'pin-button', pins.has(race.id) ? '★' : '☆');
  pin.type = 'button';
  pin.dataset.raceId = race.id;
  pin.dataset.focusKey = `${race.id}-pin`;
  pin.setAttribute('aria-label', `${pins.has(race.id) ? 'Unpin' : 'Pin'} ${race.state} ${race.name}`);
  pin.setAttribute('aria-pressed', String(pins.has(race.id)));
  pin.addEventListener('click', () => {
    pins.has(race.id) ? pins.delete(race.id) : pins.add(race.id);
    try { localStorage.setItem('election-night-pins', JSON.stringify([...pins])); } catch { /* Pins still work for this page session. */ }
    renderRaces();
    const replacement = [...document.querySelectorAll('.pin-button')].find((button) => button.dataset.raceId === race.id);
    (replacement || $('view-pinned')).focus({ preventScroll: true });
  });
  header.append(title, pin);
  const state = element('div', 'card-status');
  let stateText = '◌ Awaiting returns';
  if (race.totalVotes > 0) stateText = margin === 0 ? '= Tied in reported votes' : '● Votes reporting';
  if (race.called) stateText = `✓ Called by AP${race.winnerName ? ` · ${race.winnerName}` : ''}`;
  if (isStale) stateText = race.totalVotes > 0 ? '△ Cached results · source stale' : '△ Source unavailable · no current totals';
  if (isStale && race.called) stateText = `△ AP call retained${race.winnerName ? ` · ${race.winnerName}` : ''} · source stale`;
  state.append(status(stateText, isStale ? 'warning' : race.totalVotes > 0 || race.called ? 'good' : 'loading'));
  if (race.flip) state.append(element('span', 'flip-badge', `⇄ FLIP · ${race.previousParty || 'Previous party'} → ${race.winnerParty || 'Called winner'}`));
  const list = element('div', 'candidate-list');
  candidates.slice(0, 2).forEach((candidate) => list.append(candidateRow(candidate, race.totalVotes)));
  card.append(header, state, list);
  if (candidates.length > 2) {
    const others = candidates.slice(2);
    card.append(element('p', 'other-candidates', `+ ${others.length} other ${others.length === 1 ? 'candidate' : 'candidates'} · ${number.format(others.reduce((sum, item) => sum + item.votes, 0))} votes`));
  }
  const summary = element('div', 'race-summary');
  const total = element('span', 'race-total');
  total.append(element('strong', '', number.format(race.totalVotes)), document.createTextNode(' reported votes'));
  let marginText = 'No votes reported';
  if (race.totalVotes > 0) marginText = margin === null ? 'One candidate listed' : margin === 0 ? 'No leader' : `Lead: ${number.format(margin)} · ${(margin / race.totalVotes * 100).toFixed(1)} pts`;
  summary.append(total, element('span', 'race-margin', marginText));
  card.append(summary);
  const details = element('details', 'card-details');
  details.open = opened.has(race.id);
  const summaryLabel = element('summary', '', 'Details & source');
  summaryLabel.dataset.focusKey = `${race.id}-details`;
  const body = element('div', 'details-body');
  body.append(detailRow('Last count change', race.totalVotes ? time(race.updatedAt) : 'No votes reported'), detailRow('Last successful check', source ? time(source.lastSuccess) : 'Not checked yet'));
  if (race.reporting) {
    body.append(detailRow(`${race.reporting.label || 'Precincts'} reporting`, `${number.format(race.reporting.count)} / ${number.format(race.reporting.total)}`), element('p', 'detail-note', 'Reporting units are not a measure of votes remaining.'));
  }
  if (candidates.length > 2) {
    body.append(element('p', 'all-candidates-heading', 'Additional candidates'));
    candidates.slice(2).forEach((candidate) => body.append(candidateRow(candidate, race.totalVotes)));
  }
  const history = race.history || [];
  if (history.length > 1) {
    body.append(element('p', 'all-candidates-heading', 'Recent count updates'));
    const table = element('table', 'history');
    const head = element('thead');
    const tr = element('tr');
    tr.append(element('th', '', 'Time'), element('th', '', 'Reported votes'));
    head.append(tr);
    const tbody = element('tbody');
    history.slice(-5).reverse().forEach((point) => {
      const row = element('tr');
      row.append(element('td', '', time(point.at)), element('td', '', number.format(point.totalVotes)));
      tbody.append(row);
    });
    table.append(head, tbody);
    body.append(table, element('p', 'detail-note', 'Changes reflect reported batches, including corrections.'));
  }
  if (source) body.append(element('p', 'detail-note', source.label));
  const sourceLink = link('View source ↗', race.sourceUrl || source?.url, 'race-source-link');
  sourceLink.dataset.focusKey = `${race.id}-source`;
  body.append(sourceLink);
  details.append(summaryLabel, body);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    details.open ? opened.add(race.id) : opened.delete(race.id);
  });
  card.append(details);
  return card;
}

function emptyState(title, description, clear = false) {
  const box = element('div', 'empty-state');
  box.append(element('span', 'empty-symbol', watchlistOnly ? '☆' : '◌'), element('h3', '', title), element('p', '', description));
  if (clear) {
    const button = element('button', 'button', 'Clear filters');
    button.addEventListener('click', () => { $('search').value = ''; $('state-filter').value = ''; $('office-filter').value = ''; renderRaces(); });
    box.append(button);
  }
  return box;
}

function renderRaces() {
  if (!data) return;
  const focusKey = document.activeElement?.dataset.focusKey;
  const query = $('search').value.trim().toLowerCase();
  const state = $('state-filter').value;
  const office = $('office-filter').value;
  const all = data.races || [];
  const validPins = all.filter((race) => pins.has(race.id)).length;
  $('pin-count').textContent = number.format(validPins);
  $('view-all').classList.toggle('active', !watchlistOnly && !keyOnly);
  $('view-key').classList.toggle('active', keyOnly);
  $('view-pinned').classList.toggle('active', watchlistOnly);
  $('view-all').setAttribute('aria-pressed', String(!watchlistOnly && !keyOnly));
  $('view-key').setAttribute('aria-pressed', String(keyOnly));
  $('view-pinned').setAttribute('aria-pressed', String(watchlistOnly));
  const ranks = { Senate: 0, Governor: 1, House: 2, Other: 3 };
  const races = all.filter((race) => (!watchlistOnly || pins.has(race.id)) && (!keyOnly || race.keyRace || race.state === 'AR') && (!state || race.state === state) && (!office || race.office === office) && (!query || [race.name, race.state, race.office, ...race.candidates.map((candidate) => candidate.name)].join(' ').toLowerCase().includes(query))).sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || (ranks[a.office] ?? 4) - (ranks[b.office] ?? 4) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  $('results-count').textContent = `${number.format(races.length)} of ${number.format(all.length)} monitored races${watchlistOnly ? ' · Watchlist' : keyOnly ? ' · Key races + Arkansas' : ''}${races.length > visibleLimit ? ` · first ${visibleLimit} shown` : ''}`;
  const grid = $('race-grid');
  if (!races.length) {
    if (state === 'AR' && !all.some((race) => race.state === 'AR')) {
      const box = emptyState('Arkansas results are not connected yet', 'Use the Arkansas results link for local returns. National chamber coverage remains available above.', true);
      const arkansas = (data.links || []).find((item) => /arkansas/i.test(item.label));
      if (arkansas) box.append(link('Arkansas official results ↗', arkansas.url, 'race-source-link'));
      grid.replaceChildren(box);
      return;
    }
    const title = watchlistOnly && !validPins ? 'Your watchlist starts here' : all.length ? 'No matching races' : 'Waiting for the first feed';
    const description = watchlistOnly && !validPins ? 'Choose All races, then tap ☆ on the races you want to follow.' : all.length ? 'Try another state, office or candidate name.' : 'Source status is shown alongside this desk. Connected races will appear automatically.';
    grid.replaceChildren(emptyState(title, description, Boolean(all.length && !(watchlistOnly && !validPins))));
    return;
  }
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  grid.replaceChildren(...races.slice(0, visibleLimit).map((race) => raceCard(race, sources)));
  if (races.length > visibleLimit) {
    const more = element('button', 'button show-more', `Show ${Math.min(60, races.length - visibleLimit)} more races`);
    more.dataset.focusKey = 'more-races';
    more.style.gridColumn = '1 / -1';
    more.addEventListener('click', () => { visibleLimit += 60; renderRaces(); });
    grid.append(more);
  }
  if (focusKey) {
    const replacement = [...grid.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey);
    (replacement || $('view-all')).focus({ preventScroll: true });
  }
}

function renderSources() {
  const list = $('source-list');
  list.replaceChildren(...data.sources.map((source) => {
    const item = element('div', 'source-item');
    const failed = stale(source);
    const label = source.status === 'loading' && !source.lastSuccess ? '◌ Connecting' : failed ? '△ Delayed / unavailable' : '● Connected';
    item.append(link(source.label, source.url, 'source-name'), status(label, failed ? 'warning' : 'good'));
    for (const [caption, value] of [['Checked', source.lastSuccess ? `${age(source.lastSuccess)} · ${time(source.lastSuccess)}` : 'No successful check'], ['Source timestamp', time(source.sourceUpdatedAt)]]) {
      const row = element('div', 'source-time');
      row.append(element('span', '', caption), element('span', '', value));
      item.append(row);
    }
    if (source.coverage) item.append(element('p', 'source-coverage', source.coverage));
    if (source.error) item.append(element('p', 'source-error', source.error));
    return item;
  }));
}

function renderClosings() {
  const closings = data.pollClosings || [];
  const box = $('poll-closings');
  if (!closings.length) { box.replaceChildren(element('p', 'muted', 'See official source pages for local reporting schedules.')); return; }
  box.replaceChildren(...[...closings].sort((a, b) => new Date(a.at) - new Date(b.at)).map((close) => {
    const passed = new Date(close.at).getTime() <= Date.now();
    const item = element('div', `poll-item${passed ? ' closed' : ''}`);
    const row = element('div', 'poll-line');
    const date = element('time', '', time(close.at));
    date.dateTime = close.at;
    row.append(link(close.label || close.state, close.url), date);
    item.append(row, element('small', '', close.event === 'results' ? (passed ? 'Results window has begun' : 'Scheduled results start') : (passed ? 'Scheduled close has passed' : 'Scheduled poll close')));
    if (close.note) item.append(element('small', '', close.note));
    return item;
  }));
}

function render() {
  const states = [...new Set(data.races.map((race) => race.state))].sort();
  $('metric-races').textContent = number.format(data.races.length);
  $('metric-reporting').textContent = number.format(data.races.filter((race) => race.totalVotes > 0).length);
  $('metric-states').textContent = number.format(states.length);
  $('metric-state-list').textContent = states.join(' · ') || 'No connected results yet';
  $('metric-sources').textContent = `${data.sources.filter((source) => !stale(source)).length} / ${data.sources.length}`;
  const selected = $('state-filter').value;
  const filterStates = [...new Set([...states, 'AR'])].sort();
  const options = [new Option('All states', ''), ...filterStates.map((state) => new Option(state, state))];
  $('state-filter').replaceChildren(...options);
  if (filterStates.includes(selected)) $('state-filter').value = selected;
  $('national-links').replaceChildren(...(data.links || []).map((item) => {
    const anchor = link(item.label, item.url);
    anchor.title = item.description || item.label;
    anchor.append(element('span', 'external-arrow', '↗'));
    return anchor;
  }));
  renderChambers();
  renderFlips();
  renderSources();
  renderClosings();
  renderRaces();
  updateConnection();
}

function renderFlips() {
  const flips = data.flips || [];
  const source = data.sources.find((item) => item.id === 'npr');
  const delayed = stale(source);
  $('flip-count').textContent = `${flips.length} AP-CALLED ${flips.length === 1 ? 'FLIP' : 'FLIPS'}${delayed ? ' · SOURCE DELAYED' : ''}`;
  if (!flips.length) {
    $('flips').replaceChildren(element('p', 'muted', delayed ? 'The national calls feed is unavailable. No verified flips are stored yet.' : 'No AP-called flips yet. Changes appear here only after a race call.'));
    return;
  }
  $('flips').replaceChildren(...flips.map((race) => {
    const row = element('div', 'flip-row');
    row.append(element('span', 'flip-icon', '⇄'));
    const title = element('div', 'flip-race');
    title.append(element('span', 'race-label', `${race.state} / ${race.office}`), link(race.name, race.sourceUrl));
    const outcome = element('div', 'flip-outcome');
    outcome.append(element('strong', '', `${race.previousParty || 'Previous party'} → ${race.winnerParty || 'Called winner'}`), element('span', '', race.winnerName || 'Called by AP'));
    row.append(title, outcome);
    return row;
  }));
}

function renderChambers() {
  const supplied = data.chambers || [];
  $('chambers').replaceChildren(...['House', 'Senate'].map((office) => {
    const chamber = supplied.find((item) => item.office === office);
    const total = office === 'House' ? 435 : 100;
    const majority = office === 'House' ? 218 : 51;
    const known = chamber && chamber.dem !== null && chamber.rep !== null && Number.isFinite(chamber.dem) && Number.isFinite(chamber.rep);
    const card = element('article', 'chamber-card');
    const head = element('div', 'chamber-heading');
    const name = element('div');
    name.append(element('p', 'eyebrow', 'NATIONAL CONTROL'), element('h2', '', office === 'House' ? 'House of Representatives' : 'U.S. Senate'));
    head.append(name, element('span', 'majority-threshold', `${chamber?.majority || majority} for a majority`));
    card.append(head);
    const numbers = element('div', 'chamber-numbers');
    const dem = element('div', 'chamber-party chamber-dem');
    dem.append(element('span', '', office === 'Senate' ? 'Democratic caucus' : 'Democrats'), element('strong', '', known ? number.format(chamber.dem) : '—'));
    const rep = element('div', 'chamber-party chamber-rep');
    rep.append(element('span', '', 'Republicans'), element('strong', '', known ? number.format(chamber.rep) : '—'));
    numbers.append(dem, rep);
    const bar = element('div', 'chamber-bar');
    bar.setAttribute('aria-hidden', 'true');
    if (known) {
      const demBar = element('span', 'chamber-dem-bar');
      demBar.style.width = `${chamber.dem / (chamber.total || total) * 100}%`;
      const repBar = element('span', 'chamber-rep-bar');
      repBar.style.width = `${chamber.rep / (chamber.total || total) * 100}%`;
      bar.append(demBar, repBar);
    }
    card.append(numbers, bar);
    const state = element('div', 'chamber-state');
    const warning = stale(data.sources.find((source) => source.id === chamber?.sourceId));
    state.append(status(warning ? '△ National tally delayed' : known ? '● National seat tally' : '◌ Awaiting verified national tally', warning ? 'warning' : known ? 'good' : 'loading'));
    if (known && chamber.uncalled !== null && Number.isFinite(chamber.uncalled)) state.append(element('span', 'small-label', `${number.format(chamber.uncalled)} uncalled${chamber.other ? ` · ${number.format(chamber.other)} other` : ''}`));
    card.append(state);
    card.append(element('p', 'chamber-note', chamber?.note || 'National calls are separate from the partial state vote counts below. Follow AP or NPR for the full tally.'));
    if (chamber?.url) {
      const source = element('div', 'chamber-source');
      source.append(link(chamber.source || 'National source', chamber.url));
      if (chamber.asOf) source.append(element('span', '', `Updated ${time(chamber.asOf)}`));
      card.append(source);
    }
    return card;
  }));
}

function updateConnection() {
  if (!data) return;
  const good = data.sources.filter((source) => !stale(source)).length;
  const warning = apiFailed || good < data.sources.length;
  const node = $('connection-status');
  node.className = `status status-${warning ? 'warning' : 'good'}`;
  node.textContent = apiFailed ? '△ Connection lost · showing saved data' : good === 0 ? '△ Waiting on official sources' : warning ? '△ Some sources delayed' : '● Auto-refresh on';
  $('refresh-note').textContent = `Dashboard checked ${time(data.generatedAt)} · every ${data.refreshSeconds || 60}s`;
}

async function load() {
  if (fetching) return;
  fetching = true;
  clearTimeout(timer);
  $('refresh').disabled = true;
  try {
    const response = await fetch('/api/results', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (!Array.isArray(next.races) || !Array.isArray(next.sources)) throw new Error('Invalid results response');
    data = next;
    apiFailed = false;
    $('alert').hidden = true;
    render();
  } catch {
    apiFailed = true;
    $('alert').hidden = false;
    $('alert').textContent = data ? 'The local results service is not responding. Last available data remains below; it may be out of date. Retrying automatically.' : 'The local results service is not responding. Keep this page open; it will retry automatically.';
    if (data) render();
    else {
      $('connection-status').textContent = '△ Service unavailable';
      $('connection-status').className = 'status status-warning';
      $('refresh-note').textContent = 'Retrying every 60 seconds';
      $('race-grid').replaceChildren(emptyState('Results temporarily unavailable', 'Try Refresh. The dashboard needs its local server to fetch official results.'));
    }
  } finally {
    fetching = false;
    $('refresh').disabled = false;
    timer = setTimeout(load, Math.max(30, data?.refreshSeconds || 60) * 1000);
  }
}

$('refresh').addEventListener('click', load);
['search', 'state-filter', 'office-filter'].forEach((id) => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { visibleLimit = 60; renderRaces(); }));
$('view-all').addEventListener('click', () => { watchlistOnly = false; keyOnly = false; visibleLimit = 60; renderRaces(); });
$('view-key').addEventListener('click', () => { watchlistOnly = false; keyOnly = true; visibleLimit = 60; renderRaces(); });
$('view-pinned').addEventListener('click', () => { watchlistOnly = true; keyOnly = false; visibleLimit = 60; renderRaces(); });
$('arkansas-focus').addEventListener('click', () => { $('state-filter').value = 'AR'; watchlistOnly = false; keyOnly = false; visibleLimit = 60; renderRaces(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
function tick() {
  $('local-clock').textContent = timeFormat.format(new Date());
  if (data) updateConnection();
}
$('timezone-label').textContent = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || 'Local time';
tick();
setInterval(tick, 15000);
load();
