'use strict';

const balanceChambers = [
  { key:'senate', label:'Senate', total:100, majority:51,
    base:{ dem:34, rep:31, other:0 }, note:'Includes 65 seats not up tonight: Democratic caucus 34 (with 2 independents), Republicans 31. A 50–50 tie goes to the vice president.' },
  { key:'house', label:'House', total:435, majority:218, base:null, note:'' },
  { key:'governors', label:'Governor', total:36, majority:19, base:null, note:'Of tonight’s 36 governor races.' }
];

const balance = {
  data:null, checkedAt:null,
  clock:new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZoneName:'short' }),
  el(id) { return document.getElementById(id); },

  update() {
    const data = { ...this.data };
    for (const chamber of balanceChambers) {
      const races = window.apResults.office(chamber.key);
      if (!races) continue;
      let dem = chamber.base?.dem || 0, rep = chamber.base?.rep || 0, other = chamber.base?.other || 0;
      for (const [id, race] of races) {
        if (!race.winner || id === 'dc-house-00') continue;
        if (race.winner.party === 'dem') dem++;
        else if (race.winner.party === 'rep') rep++;
        else other++;
      }
      data[chamber.key] = { dem, rep, other, called:dem + rep + other, uncalled:chamber.total - dem - rep - other };
    }
    if (balanceChambers.every(chamber => data[chamber.key])) {
      this.data = data;
      this.checkedAt = window.apResults.checkedAt;
    }
    this.render();
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
      status.textContent = 'Loading AP race calls…';
      return;
    }
    status.textContent = `AP race calls via NPR’s public feed · calls only, not forecasts · checked ${this.clock.format(new Date(this.checkedAt))}`;
    box.replaceChildren(status, ...balanceChambers.map(chamber => this.row(chamber)));
  }
};

window.apResults.subscribe(() => balance.update());
