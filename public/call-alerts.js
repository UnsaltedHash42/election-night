'use strict';

(() => {
  const storageKey = 'election-night-ap-calls-2026';
  const apSource = { authority:'AP via NPR', url:'https://apps.npr.org/2026-election-results/' };
  const callStates = ['not-called', 'called'];
  const isCalled = (state) => state === 'called';
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
      this.checked = new Set();
      this.events = [];
      this.paused = false;
      this.lastCheckedAt = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (Array.isArray(saved?.states)) {
          this.states = new Map(saved.states.filter(validEntry).map((entry) => [entry.raceId, entry]));
        }
        if (Array.isArray(saved?.events)) this.events = saved.events.filter(validEntry).slice(0, 30);
      } catch {}
      document.addEventListener('visibilitychange', () => this.publish());
      window.apResults.subscribe(() => this.check());
    }

    setRaces(rows) {
      this.races = new Map(rows.filter((race) => race && typeof race.id === 'string'
        && typeof race.name === 'string' && typeof race.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(race.slug))
        .map((race) => [race.id, race]));
      this.check();
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
      this.check();
    }

    getSnapshot() {
      const ids = [...this.races.keys()];
      const unavailable = ids.filter((id) => window.apResults.failed(window.apResults.officeFor(this.races.get(id))));
      return {
        paused:this.paused, hidden:document.hidden, backoffUntil:0, total:ids.length,
        checkedCount:ids.filter((id) => this.checked.has(id)).length,
        errorCount:unavailable.length, lastCheckedAt:this.lastCheckedAt,
        unavailable:unavailable.map((id) => this.races.get(id).name),
        calls:ids.map((id) => this.states.get(id)).filter((entry) => entry && isCalled(entry.callState))
          .sort((a, b) => b.detectedAt - a.detectedAt),
        events:this.events.filter((entry) => this.races.has(entry.raceId))
      };
    }

    publish() {
      this.onChange(this.getSnapshot());
    }

    check() {
      const checkedAt = window.apResults.checkedAt;
      if (this.paused || document.hidden || !checkedAt) { this.publish(); return; }
      const alerts = [];
      for (const race of this.races.values()) {
        if (!window.apResults.office(window.apResults.officeFor(race))) continue;
        const event = this.accept(race, window.apResults.get(race.id), checkedAt);
        this.checked.add(race.id);
        if (event) alerts.push(event);
      }
      this.lastCheckedAt = checkedAt;
      try { sessionStorage.setItem(storageKey, JSON.stringify({ states:[...this.states.values()], events:this.events })); } catch {}
      this.publish();
      for (const event of alerts) this.onAlert(event);
    }

    accept(race, ap, checkedAt) {
      const previous = this.states.get(race.id);
      if (!ap && previous) return undefined;
      const winner = ap?.winner ? { name:ap.winner.name, party:ap.winner.partyName || 'Party not listed' } : null;
      let type;
      if (!previous && winner) type = 'existing';
      else if (previous?.winner && !sameWinner(previous.winner, winner)) type = 'correction';
      else if (previous && !previous.winner && winner) type = 'call';
      if (previous && !type) return undefined;
      const entry = {
        raceId:race.id, label:race.name, callState:winner ? 'called' : 'not-called', winner, source:apSource,
        updatedAt:new Date(checkedAt).toISOString(), detectedAt:Date.now(), type:type || 'existing'
      };
      this.states.set(race.id, entry);
      if (type) this.events = [entry, ...this.events].slice(0, 30);
      return type && type !== 'existing' ? entry : undefined;
    }
  };
})();
