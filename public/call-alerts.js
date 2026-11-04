'use strict';

(() => {
  const storageKey = 'election-night-calls-2026';
  const callStates = ['not-called', 'called', 'certified', 'runoff', 'recount'];
  const isCalled = (state) => ['called', 'certified'].includes(state);
  const sameWinner = (a, b) => a?.name === b?.name && a?.party === b?.party;
  const validSource = (source) => {
    if (!source || typeof source.authority !== 'string' || !source.authority.trim()) return false;
    try { return ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { return false; }
  };
  const validEntry = (entry) => entry && typeof entry.raceId === 'string' && /^[a-z0-9-]+$/.test(entry.raceId)
    && typeof entry.label === 'string' && callStates.includes(entry.callState) && validSource(entry.source)
    && Number.isFinite(Date.parse(entry.updatedAt)) && Number.isFinite(entry.detectedAt)
    && ['existing', 'call', 'correction'].includes(entry.type)
    && (isCalled(entry.callState) ? entry.winner && typeof entry.winner.name === 'string'
      && typeof entry.winner.party === 'string' : entry.winner === null);

  window.CallMonitor = class CallMonitor {
    constructor({ onChange, onAlert }) {
      this.onChange = onChange;
      this.onAlert = onAlert;
      this.races = new Map();
      this.states = new Map();
      this.attempts = new Map();
      this.errors = new Set();
      this.events = [];
      this.paused = false;
      this.backoffUntil = 0;
      this.lastCheckedAt = null;
      this.nextRequestAt = 0;
      this.cursor = 0;
      this.inflight = false;
      this.timer = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (Array.isArray(saved?.states)) {
          this.states = new Map(saved.states.filter(validEntry).map((entry) => [entry.raceId, entry]));
        }
        if (Array.isArray(saved?.events)) this.events = saved.events.filter(validEntry).slice(0, 30);
      } catch {}
      document.addEventListener('visibilitychange', () => { this.publish(); this.schedule(); });
    }

    setRaces(rows) {
      this.races = new Map(rows.filter((race) => race && typeof race.id === 'string'
        && typeof race.name === 'string' && typeof race.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(race.slug))
        .map((race) => [race.id, race]));
      this.cursor %= this.races.size || 1;
      this.publish();
      this.schedule();
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
      this.publish();
      this.schedule();
    }

    getSnapshot() {
      const ids = [...this.races.keys()];
      return {
        paused:this.paused, hidden:document.hidden, backoffUntil:this.backoffUntil, total:ids.length,
        checkedCount:ids.filter((id) => this.attempts.has(id)).length,
        errorCount:ids.filter((id) => this.errors.has(id)).length, lastCheckedAt:this.lastCheckedAt,
        unavailable:ids.filter((id) => this.errors.has(id)).map((id) => this.races.get(id).name),
        calls:ids.map((id) => this.states.get(id)).filter((entry) => entry && isCalled(entry.callState))
          .sort((a, b) => b.detectedAt - a.detectedAt),
        events:this.events.filter((entry) => this.races.has(entry.raceId))
      };
    }

    publish() {
      this.onChange(this.getSnapshot());
    }

    schedule() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.paused || document.hidden || this.inflight || !this.races.size) return;
      const due = Math.min(...[...this.races.keys()].map((id) => this.attempts.has(id) ? this.attempts.get(id) + 120000 : 0));
      const delay = Math.max(0, due - Date.now(), this.nextRequestAt - Date.now(), this.backoffUntil - Date.now());
      this.timer = setTimeout(() => this.poll(), delay);
    }

    async poll() {
      this.timer = null;
      if (this.paused || document.hidden || this.inflight || !this.races.size) return;
      if (Date.now() < Math.max(this.nextRequestAt, this.backoffUntil)) { this.schedule(); return; }
      const races = [...this.races.values()];
      let race;
      for (let offset = 0; offset < races.length; offset++) {
        const index = (this.cursor + offset) % races.length;
        const candidate = races[index];
        if (!this.attempts.has(candidate.id) || Date.now() - this.attempts.get(candidate.id) >= 120000) {
          race = candidate; this.cursor = (index + 1) % races.length; break;
        }
      }
      if (!race) { this.schedule(); return; }
      this.inflight = true;
      this.attempts.set(race.id, Date.now());
      let event;
      try {
        const response = await fetch(`https://watch.vote/api/widgets/race/${race.slug}`, { signal:AbortSignal.timeout(15000) });
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const seconds = retry !== null && retry.trim() !== '' ? Number(retry) : NaN;
          const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry);
          this.backoffUntil = Number.isFinite(until) ? Math.max(Date.now() + 2000, until) : Date.now() + 300000;
        }
        if (!response.ok) throw new Error('Provider unavailable');
        const data = await response.json();
        if (!this.paused && !document.hidden && this.races.get(race.id)?.slug === race.slug) event = this.accept(race, data);
      } catch {
        this.errors.add(race.id);
      } finally {
        this.inflight = false;
        this.lastCheckedAt = Date.now();
        this.nextRequestAt = Date.now() + 2000;
        this.publish();
        this.schedule();
      }
      if (event && !this.paused && !document.hidden) this.onAlert(event);
    }

    accept(race, data) {
      if (data?.version !== 1 || data.raceSlug !== race.slug || data.raceId !== `2026-${race.slug}`
        || data.electionDate !== '2026-11-03') throw new Error('Wrong race or election');
      const previous = this.states.get(race.id);
      const results = data.results;
      if (results === null) {
        if (previous) throw new Error('Results unavailable');
        this.errors.delete(race.id);
        return;
      }
      if (!results || !callStates.includes(results.callState) || results.freshness !== 'fresh'
        || !validSource(results.source) || !Number.isFinite(Date.parse(results.updatedAt))
        || !Number.isFinite(Date.parse(results.fetchedAt))
        || !Array.isArray(results.candidates) || results.candidates.some((candidate) => !candidate
          || typeof candidate.name !== 'string' || !candidate.name.trim()
          || (candidate.party !== null && typeof candidate.party !== 'string') || typeof candidate.winner !== 'boolean')) {
        throw new Error('Unverified results');
      }
      if (previous && Date.parse(results.updatedAt) < Date.parse(previous.updatedAt)) throw new Error('Older results');
      const winners = results.candidates.filter((candidate) => candidate.winner);
      if (isCalled(results.callState) ? winners.length !== 1 : winners.length !== 0) throw new Error('Inconsistent call');
      const winner = winners.length ? { name:winners[0].name, party:winners[0].party ?? 'Party not listed' } : null;
      let type;
      if (!previous && winner) type = 'existing';
      else if (previous?.winner && !sameWinner(previous.winner, winner)) type = 'correction';
      else if (previous && !previous.winner && winner) type = 'call';
      const entry = {
        raceId:race.id, label:race.name, callState:results.callState, winner,
        source:{ authority:results.source.authority, url:results.source.url }, updatedAt:results.updatedAt,
        detectedAt:type ? Date.now() : previous?.detectedAt ?? Date.now(), type:type || previous?.type || 'existing'
      };
      this.states.set(race.id, entry);
      this.errors.delete(race.id);
      if (type) this.events = [entry, ...this.events].slice(0, 30);
      try { sessionStorage.setItem(storageKey, JSON.stringify({ states:[...this.states.values()], events:this.events })); } catch {}
      return type && type !== 'existing' ? entry : undefined;
    }
  };
})();
