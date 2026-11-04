'use strict';

const $ = (id) => document.getElementById(id);
const stateNames = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
  MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
  TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia',
  WI:'Wisconsin', WY:'Wyoming'
};
const storageKeys = { home: 'election-night-home-state', pins: 'election-night-public-pins' };
const pageSize = 6;
let homeState = '';
let pins = new Set();
let races = [];
let view = 'key';
let page = 0;
let renderedIds = '';
let searchTimer;
let loading = false;
let soundEnabled = false;
let audioContext;
const callTime = new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZoneName:'short' });
try { $('alerts-key').checked = localStorage.getItem('election-night-key-alerts') !== 'off'; } catch {}
const callMonitor = new window.CallMonitor({ onChange:renderCalls, onAlert:announceCall });

try {
  const saved = localStorage.getItem(storageKeys.home);
  if (Object.hasOwn(stateNames, saved)) homeState = saved;
  const savedPins = JSON.parse(localStorage.getItem(storageKeys.pins) || '[]');
  if (Array.isArray(savedPins)) pins = new Set(savedPins.filter((id) => typeof id === 'string'));
} catch {}
const queryState = new URLSearchParams(location.search).get('state');
if (queryState !== null && (queryState === '' || Object.hasOwn(stateNames, queryState.toUpperCase()))) {
  homeState = queryState.toUpperCase();
  save(storageKeys.home, homeState);
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateMonitoredRaces() {
  callMonitor.setRaces(races.filter((race) => pins.has(race.id) || ($('alerts-key').checked && race.featured)));
}

function callText(event) {
  if (!event.winner) return 'Call no longer reported';
  const label = event.type === 'correction' ? 'Updated call' : event.callState === 'certified' ? 'Certified' : event.type === 'existing' ? 'Already called' : 'Called';
  return `${label}: ${event.winner.name} (${event.winner.party})`;
}

function renderCalls(snapshot) {
  const status = snapshot.paused ? 'Ⅱ Alerts paused' : document.hidden ? 'Ⅱ Checks paused in background'
    : snapshot.backoffUntil > Date.now() ? '◌ Provider rate limit — checks will resume'
    : `● Watching ${snapshot.total} races · ${snapshot.checkedCount} checked · ${snapshot.calls.length} called`;
  $('calls-status').textContent = status + (snapshot.errorCount ? ` · ${snapshot.errorCount} unavailable or delayed` : '')
    + (snapshot.lastCheckedAt ? ` · Last check ${callTime.format(new Date(snapshot.lastCheckedAt))}` : '');
  $('alerts-pause').textContent = snapshot.paused ? 'Resume alerts' : 'Pause alerts';
  $('alerts-pause').setAttribute('aria-pressed', String(snapshot.paused));
  $('calls-coverage').hidden = !snapshot.unavailable?.length;
  $('calls-unavailable').textContent = (snapshot.unavailable || []).join(' · ');
  const seen = new Set();
  const recent = snapshot.events.filter((event) => {
    if (seen.has(event.raceId) || !races.some((race) => race.id === event.raceId)) return false;
    seen.add(event.raceId);
    return true;
  }).slice(0, 12);
  if (!recent.length) {
    $('call-events').replaceChildren(element('p', 'call-empty', snapshot.total
      ? 'No calls observed yet. A lead never triggers an alert.' : 'Save a race with ☆ or include national key races to watch for calls.'));
    return;
  }
  $('call-events').replaceChildren(...recent.map((event) => {
    const race = races.find((item) => item.id === event.raceId);
    const card = element('article', `call-event${event.type === 'correction' ? ' call-correction' : ''}`);
    const title = element('a', 'call-race', event.label);
    title.href = `https://watch.vote/midterms/2026/races/${race.slug}`;
    title.target = '_blank'; title.rel = 'noopener noreferrer';
    const source = element('a', '', event.source.authority);
    try {
      const url = new URL(event.source.url);
      source.href = ['https:', 'http:'].includes(url.protocol) ? url.href : title.href;
    } catch { source.href = title.href; }
    source.target = '_blank'; source.rel = 'noopener noreferrer';
    const attribution = element('p', 'call-source', 'watch.vote · ');
    attribution.append(source);
    const timestamp = new Date(event.updatedAt);
    const timing = `Detected ${callTime.format(new Date(event.detectedAt))}${Number.isFinite(timestamp.getTime()) ? ` · Source updated ${timestamp.toLocaleString()}` : ''}`;
    card.append(title, element('strong', 'call-outcome', callText(event)), element('p', 'call-time', timing), attribution);
    return card;
  }));
}

function soundCall() {
  if (!soundEnabled || audioContext?.state !== 'running') return;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.frequency.value = 660;
  volume.gain.setValueAtTime(0.06, audioContext.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
  oscillator.connect(volume); volume.connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + 0.25);
}

function announceCall(event) {
  $('call-announcement').hidden = false;
  $('call-announcement').textContent = `${event.type === 'correction' ? '↻' : '✓'} ${event.label} — ${callText(event)} · Detected ${callTime.format(new Date(event.detectedAt))}`;
  soundCall();
}

function updateLocation() {
  $('home-state').value = homeState;
  $('home-focus').hidden = !homeState;
  $('home-focus').textContent = homeState ? `Show ${stateNames[homeState]} races` : 'Show home state';
  $('location-note').textContent = homeState
    ? `${stateNames[homeState]} races join Key races. Your choice stays in this browser; national coverage stays above.`
    : 'Choose a state to include its races in Key races. Your choice stays in this browser.';
  $('local-links').hidden = homeState !== 'AR' && $('state-filter').value !== 'AR';
}

function raceCard(race) {
  const card = element('article', 'race-card');
  card.dataset.raceId = race.id;
  const header = element('div', 'card-header');
  const title = element('div');
  title.append(element('p', 'race-label', `${stateNames[race.state]} / ${race.office}`), element('h3', '', race.name));
  const pin = element('button', 'pin-button');
  pin.type = 'button';
  pin.dataset.raceId = race.id;
  pin.addEventListener('click', () => {
    pins.has(race.id) ? pins.delete(race.id) : pins.add(race.id);
    save(storageKeys.pins, JSON.stringify([...pins]));
    updateMonitoredRaces();
    render();
    const replacement = [...$('race-grid').querySelectorAll('.pin-button')].find((node) => node.dataset.raceId === race.id);
    (replacement || $('view-pinned')).focus({ preventScroll: true });
  });
  header.append(title, pin);
  const frame = element('iframe', 'race-frame');
  frame.src = `https://watch.vote/widget/race/${race.slug}?theme=dark`;
  frame.title = `${race.name} — 2026 results from watch.vote`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const fallback = element('div', 'race-fallback');
  const source = element('a', '', 'Open race at watch.vote ↗');
  source.href = `https://watch.vote/midterms/2026/races/${race.slug}`;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  fallback.append(source, element('span', '', 'Use this link if the card is blank.'));
  card.append(header, frame, fallback);
  return card;
}

function matchingRaces() {
  const state = $('state-filter').value;
  const office = $('office-filter').value;
  const query = $('search').value.trim().toLowerCase();
  const ranks = { Senate:0, Governor:1, House:2, Delegate:3 };
  return races.filter((race) => (!state || race.state === state) && (!office || race.office === office)
    && (view !== 'pinned' || pins.has(race.id)) && (view !== 'key' || race.featured || (homeState && race.state === homeState))
    && (!query || `${race.name} ${race.state} ${stateNames[race.state]} ${race.office}`.toLowerCase().includes(query)))
    .sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || ranks[a.office] - ranks[b.office]
      || a.state.localeCompare(b.state) || a.name.localeCompare(b.name, undefined, { numeric:true }));
}

function render() {
  updateLocation();
  for (const name of ['key', 'all', 'pinned']) {
    $(`view-${name}`).classList.toggle('active', view === name);
    $(`view-${name}`).setAttribute('aria-pressed', String(view === name));
  }
  $('pin-count').textContent = races.filter((race) => pins.has(race.id)).length;
  const matching = matchingRaces();
  const pages = Math.ceil(matching.length / pageSize);
  page = Math.min(page, Math.max(0, pages - 1));
  const visible = matching.slice(page * pageSize, (page + 1) * pageSize);
  $('results-count').textContent = `${matching.length} ${matching.length === 1 ? 'race' : 'races'}${view === 'key' ? ` · Key races${homeState ? ` + ${stateNames[homeState]}` : ''}` : view === 'pinned' ? ' · Your watchlist' : ''}${visible.length ? ` · Showing ${page * pageSize + 1}–${page * pageSize + visible.length}` : ''}`;
  $('pagination').hidden = pages <= 1;
  $('page-prev').disabled = page === 0;
  $('page-next').disabled = page + 1 >= pages;
  $('page-label').textContent = pages ? `Page ${page + 1} of ${pages}` : '';
  const ids = visible.map((race) => race.id).join('|');
  if (!visible.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('h3', '', view === 'pinned' ? 'No matching saved races' : 'No matching races'),
      element('p', '', view === 'pinned' ? 'Choose Key races or All races, then tap ☆ to save a race.' : 'Try All races, another state, or clear the filters.'));
    const clear = element('button', 'button', 'Clear filters');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      $('search').value = ''; $('state-filter').value = ''; $('office-filter').value = ''; view = 'all'; page = 0; render();
      $('view-all').focus({ preventScroll:true });
    });
    empty.append(clear);
    $('race-grid').replaceChildren(empty);
  } else if (ids !== renderedIds) {
    $('race-grid').replaceChildren(...visible.map(raceCard));
  }
  renderedIds = ids;
  for (const card of $('race-grid').querySelectorAll('.race-card')) {
    const race = visible.find((item) => item.id === card.dataset.raceId);
    const pinned = pins.has(race.id);
    card.classList.toggle('is-pinned', pinned);
    const button = card.querySelector('.pin-button');
    button.textContent = pinned ? '★' : '☆';
    button.setAttribute('aria-pressed', String(pinned));
    button.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${race.name}`);
  }
}

async function loadDirectory() {
  if (loading) return;
  loading = true;
  $('retry').disabled = true;
  try {
    const response = await fetch('/races.json', { signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Directory unavailable');
    const rows = await response.json();
    const offices = ['House', 'Senate', 'Governor', 'Delegate'];
    if (!Array.isArray(rows) || !rows.length || rows.some((row) => !row || typeof row.id !== 'string'
      || typeof row.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)
      || !Object.hasOwn(stateNames, row.state) || !offices.includes(row.office) || typeof row.name !== 'string')
      || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Invalid race directory');
    races = rows;
    updateMonitoredRaces();
    $('directory-error').hidden = true;
    render();
  } catch {
    $('directory-error').hidden = false;
    $('results-count').textContent = 'Race directory unavailable';
    if (!races.length) $('race-grid').replaceChildren();
  } finally {
    loading = false;
    $('retry').disabled = false;
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://watch.vote' || event.data?.type !== 'watchvote-embed-resize') return;
  const height = Number(event.data.height);
  if (!Number.isFinite(height) || height <= 0) return;
  for (const frame of $('race-grid').querySelectorAll('iframe')) {
    if (frame.contentWindow === event.source) {
      frame.style.height = `${Math.min(1600, Math.max(300, Math.ceil(height) + 20))}px`;
      break;
    }
  }
});

for (const [code, name] of Object.entries(stateNames).sort((a, b) => a[1].localeCompare(b[1]))) {
  $('home-state').append(new Option(name, code));
  $('state-filter').append(new Option(name, code));
}
$('home-state').addEventListener('change', () => {
  homeState = $('home-state').value;
  save(storageKeys.home, homeState);
  const url = new URL(location.href);
  homeState ? url.searchParams.set('state', homeState) : url.searchParams.delete('state');
  history.replaceState(null, '', url);
  page = 0; render();
});
$('home-focus').addEventListener('click', () => {
  $('state-filter').value = homeState; $('office-filter').value = ''; $('search').value = ''; view = 'all'; page = 0; render();
});
for (const name of ['key', 'all', 'pinned']) $(`view-${name}`).addEventListener('click', () => { view = name; page = 0; render(); });
for (const id of ['state-filter', 'office-filter']) $(id).addEventListener('change', () => { page = 0; render(); });
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; render(); }, 200); });
$('page-prev').addEventListener('click', () => { page -= 1; render(); $('race-desk').scrollIntoView({ block:'start' }); });
$('page-next').addEventListener('click', () => { page += 1; render(); $('race-desk').scrollIntoView({ block:'start' }); });
$('retry').addEventListener('click', loadDirectory);
$('alerts-key').addEventListener('change', () => {
  save('election-night-key-alerts', $('alerts-key').checked ? 'on' : 'off');
  updateMonitoredRaces();
});
$('alerts-pause').addEventListener('click', () => callMonitor.setPaused(!callMonitor.getSnapshot().paused));
$('alerts-sound').addEventListener('click', async () => {
  if (!soundEnabled) {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
    } catch {
      $('alerts-sound').textContent = 'Sound unavailable';
      return;
    }
  }
  soundEnabled = !soundEnabled;
  $('alerts-sound').textContent = soundEnabled ? 'Sound on' : 'Enable sound';
  $('alerts-sound').setAttribute('aria-pressed', String(soundEnabled));
});
updateLocation();
loadDirectory();
