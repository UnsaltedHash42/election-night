'use strict';

const balanceChambers = [
  { key:'senate', label:'Senate', total:100, majority:51, file:'senate.json',
    base:{ dem:34, rep:31, other:0 }, note:'Includes 65 seats not up tonight: Democratic caucus 34 (with 2 independents), Republicans 31. A 50–50 tie goes to the vice president.' },
  { key:'house', label:'House', total:435, majority:218, file:'house.json', base:null, note:'' },
  { key:'governors', label:'Governor', total:36, majority:19, file:'gov.json', base:null, note:'Of tonight’s 36 governor races.' }
];

const balance = {
  data:null, checkedAt:null, loading:false, generation:0, timer:null,
  clock:new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZoneName:'short' }),
  el(id) { return document.getElementById(id); },

  async start() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
    await this.refresh();
  },

  async read(file) {
    const response = await fetch(`https://apps.npr.org/2026-election-results/data/${file}`, { signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Feed unavailable');
    return readNprRaces(await response.json());
  },

  async refresh() {
    clearTimeout(this.timer);
    if (document.hidden) return;
    const generation = ++this.generation;
    this.loading = true;
    this.render();
    try {
      const feeds = await Promise.all(balanceChambers.map(chamber => this.read(chamber.file)));
      if (generation !== this.generation) return;
      const data = {};
      for (const [index, chamber] of balanceChambers.entries()) {
        const suffix = chamber.key === 'senate' ? '-senate' : chamber.key === 'governors' ? '-governor' : '-house-';
        let dem = chamber.base?.dem || 0, rep = chamber.base?.rep || 0, other = chamber.base?.other || 0;
        for (const [id, race] of feeds[index]) {
          if (!id.includes(suffix) || !race.winner) continue;
          if (id === 'dc-house-00') continue;
          if (race.winner.party === 'dem') dem++;
          else if (race.winner.party === 'rep') rep++;
          else other++;
        }
        data[chamber.key] = { dem, rep, other, called:dem + rep + other, uncalled:chamber.total - dem - rep - other };
      }
      this.data = data;
      this.checkedAt = Date.now();
    } catch { /* the last successful count stays in place */ } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.render();
        if (!document.hidden) this.timer = setTimeout(() => this.refresh(), 60000);
      }
    }
  },

  row(chamber) {
    const counts = this.data[chamber.key];
    const wrap = document.createElement('div');
    wrap.className = 'balance-row';
    const head = document.createElement('div');
    head.className = 'balance-head';
    const name = document.createElement('span');
    name.textContent = `${chamber.label} · ${chamber.total} seats`;
    const countsLine = document.createElement('span');
    countsLine.textContent = `D ${counts.dem} · R ${counts.rep}${counts.other ? ` · O ${counts.other}` : ''} · ${counts.uncalled} uncalled`;
    head.append(name, countsLine);
    const bar = document.createElement('div');
    bar.className = 'balance-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${chamber.label}: ${counts.dem} Democratic, ${counts.rep} Republican${counts.other ? `, ${counts.other} other` : ''}, ${counts.uncalled} uncalled of ${chamber.total}`);
    for (const [party, count, className] of [['dem', counts.dem, 'dem'], ['rep', counts.rep, 'rep'], ['other', counts.other, 'other'], ['uncalled', counts.uncalled, 'none']]) {
      if (!count) continue;
      const segment = document.createElement('span');
      segment.className = `balance-seg ${className}`;
      segment.style.width = `${(count / chamber.total) * 100}%`;
      bar.append(segment);
    }
    const marker = document.createElement('span');
    marker.className = 'balance-marker';
    marker.style.left = `${(chamber.majority / chamber.total) * 100}%`;
    marker.title = `Majority: ${chamber.majority}`;
    bar.append(marker);
    wrap.append(head, bar);
    if (chamber.note) {
      const note = document.createElement('p');
      note.className = 'balance-note';
      note.textContent = chamber.note;
      wrap.append(note);
    }
    return wrap;
  },

  render() {
    const box = this.el('balance');
    const status = this.el('balance-status');
    if (!this.data) {
      status.textContent = this.loading ? 'Loading AP race calls…' : 'AP race calls have not loaded yet.';
      return;
    }
    status.textContent = `AP race calls via NPR’s public feed · calls only, not forecasts · checked ${this.clock.format(new Date(this.checkedAt))}${this.loading ? ' · updating…' : ''}`;
    box.replaceChildren(status, ...balanceChambers.map(chamber => this.row(chamber)));
  }
};

if (typeof readNprRaces === 'function') balance.start();
else document.getElementById('balance-status').textContent = 'Balance counts are unavailable because the map did not load.';
