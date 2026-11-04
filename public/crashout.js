'use strict';

const crashoutFeeds = [
  { handle:'patriottakes.bsky.social', label:'PatriotTakes' },
  { handle:'catturd2.bsky.social', label:'Catturd' },
  { handle:'meidastouch.com', label:'MeidasTouch' },
  { handle:'trumpactiontracker.bsky.social', label:'Trump Action Tracker' }
];

const crashout = {
  posts:[], failed:[], checkedAt:null, loading:false, generation:0, timer:null,
  clock:new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }),
  el(id) { return document.getElementById(id); },

  async start() {
    this.el('crashout-retry').addEventListener('click', () => this.refresh());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
    await this.refresh();
  },

  async readFeed(feed, signal) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${feed.handle}&limit=6&filter=posts_no_replies`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Feed unavailable');
    const data = await response.json();
    if (!data || !Array.isArray(data.feed)) throw new Error('Invalid feed');
    return data.feed
      .filter(item => item?.post?.record?.$type === 'app.bsky.feed.post' && !item.reason && Number.isFinite(Date.parse(item.post.record.createdAt)))
      .slice(0, 4)
      .map(item => ({
        feed:feed.label,
        handle:String(item.post.author?.handle || feed.handle),
        name:String(item.post.author?.displayName || feed.handle),
        at:Date.parse(item.post.record.createdAt),
        text:String(item.post.record.text || ''),
        rkey:String(item.post.uri || '').split('/').pop()
      }));
  },

  async refresh() {
    clearTimeout(this.timer);
    if (document.hidden) return;
    const generation = ++this.generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    this.loading = true;
    this.renderStatus();
    try {
      const results = await Promise.allSettled(crashoutFeeds.map(feed => this.readFeed(feed, controller.signal)));
      if (generation !== this.generation) return;
      const failed = crashoutFeeds.filter((feed, index) => results[index].status === 'rejected').map(feed => feed.label);
      const posts = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.at - a.at);
      if (posts.length) { this.posts = posts; this.failed = failed; }
      else if (!this.posts.length) this.failed = failed.length ? failed : ['all feeds'];
      this.checkedAt = Date.now();
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.loading = false;
        this.render();
        if (!document.hidden) this.timer = setTimeout(() => this.refresh(), 60000);
      }
    }
  },

  ago(at) {
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return new Date(at).toLocaleDateString();
  },

  post(item) {
    const card = document.createElement('article');
    card.className = 'crashout-post';
    const head = document.createElement('div');
    head.className = 'crashout-head';
    const name = document.createElement('span');
    name.className = 'crashout-author';
    name.textContent = item.name;
    const handle = document.createElement('span');
    handle.className = 'crashout-handle';
    handle.textContent = `@${item.handle}`;
    const time = document.createElement('span');
    time.className = 'crashout-time';
    time.textContent = this.ago(item.at);
    time.title = new Date(item.at).toISOString();
    head.append(name, handle, time);
    const body = document.createElement('p');
    body.textContent = item.text.length > 640 ? `${item.text.slice(0, 640)}…` : item.text;
    const link = document.createElement('a');
    link.href = `https://bsky.app/profile/${item.handle}/post/${item.rkey}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open on Bluesky ↗';
    card.append(head, body, link);
    return card;
  },

  renderStatus() {
    this.el('crashout-status').textContent = this.loading ? 'Checking social feeds…'
      : this.posts.length ? `${this.posts.length} recent posts · Checked ${this.clock.format(new Date(this.checkedAt))}`
      : 'No social posts have loaded yet.';
    this.el('crashout-retry').disabled = Boolean(this.loading);
  },

  render() {
    this.renderStatus();
    const warning = this.el('crashout-warning');
    warning.hidden = !this.failed.length;
    warning.textContent = this.failed.length ? `Unavailable right now: ${this.failed.join(', ')}. Earlier posts stay listed.` : '';
    const list = this.el('crashout-feed');
    if (!this.posts.length) {
      list.replaceChildren(document.createElement('p'));
      list.firstChild.className = 'call-empty';
      list.firstChild.textContent = 'No posts loaded yet. Use Retry.';
      return;
    }
    list.replaceChildren(...this.posts.slice(0, 12).map(item => this.post(item)));
  }
};

crashout.start();
