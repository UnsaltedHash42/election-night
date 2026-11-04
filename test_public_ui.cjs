const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.style={}; this.attributes={}; this.listeners={}; this.className=''; this.value=''; this.hidden=false; this.contentWindow=tag==='iframe'?{}:undefined; this.classList={toggle:(name,on)=>{const values=new Set(this.className.split(' ').filter(Boolean));on?values.add(name):values.delete(name);this.className=[...values].join(' ');}}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(name,value) { this.attributes[name]=value; }
  addEventListener(name,callback) { this.listeners[name]=callback; }
  querySelectorAll(selector) { return this.children.flatMap(node=>{if(!(node instanceof Element))return[];const matches=selector[0]==='.'?node.className.split(' ').includes(selector.slice(1)):node.tagName===selector.toUpperCase();return[...(matches?[node]:[]),...node.querySelectorAll(selector)];}); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  focus() { document.activeElement=this; }
  scrollIntoView() {}
}
let monitor;
let map;
class ElectionMap {
  constructor(options) { map=this; this.options=options; }
  setRaces(rows) { this.rows=rows; }
}
class CallMonitor {
  constructor(callbacks) { monitor=this; this.callbacks=callbacks; this.rows=[]; this.paused=false; }
  getSnapshot() { return {paused:this.paused,backoffUntil:0,total:this.rows.length,checkedCount:0,errorCount:0,lastCheckedAt:null,calls:[],events:[]}; }
  setRaces(rows) { this.rows=rows; this.callbacks.onChange(this.getSnapshot()); }
  setPaused(value) { this.paused=value; this.callbacks.onChange(this.getSnapshot()); }
}
const html=fs.readFileSync('public/index.html','utf8');
assert(html.includes('id="alerts-key"'), 'Missing national-key call alert control');

const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Element()]));
const document={getElementById:id=>{assert(ids.has(id),`Missing #${id}`);return ids.get(id);},createElement:tag=>new Element(tag)};
const local=new Map();
const location={href:'http://localhost/',search:''};
const messages={};
const rows=Array.from({length:9},(_,i)=>({id:`race-${i}`,slug:`${i<5?'ar':'ca'}-house-0${i+1}`,state:i<5?'AR':'CA',office:'House',name:`District ${i+1}`,featured:true}));
ids.get('alerts-key').checked=true;
const context={CallMonitor,document,location,URL,URLSearchParams,AbortSignal,Set,Map,Number,JSON,Object,console,setTimeout,clearTimeout,
  localStorage:{getItem:key=>local.get(key),setItem:(key,value)=>local.set(key,value)},
  history:{replaceState:(_,__,url)=>{location.href=String(url);location.search=new URL(url).search;}},
  window:{CallMonitor,ElectionMap,addEventListener:(name,callback)=>messages[name]=callback},
  Option:function(text,value){const node=new Element('option');node.textContent=text;node.value=value;return node;},
  fetch:async()=>({ok:true,json:async()=>rows})};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/app.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
const frames=()=>ids.get('race-grid').querySelectorAll('iframe');
(async()=>{
  await new Promise(setImmediate);
  assert.equal(monitor.rows.length,9,'Featured races must be monitored without pinning');
  assert.equal(map.rows.length,9,'Map must receive the race directory');
  assert.equal(frames().length,6);
  const first=frames()[0];run('render()');assert.equal(frames()[0],first,'Unchanged rendering reloads frames');
  assert.equal(ids.get('home-state').children.length,51);
  ids.get('state-filter').value='AR';ids.get('state-filter').listeners.change();assert.equal(frames().length,5);
  ids.get('home-state').value='CA';ids.get('home-state').listeners.change();assert.equal(local.get('election-night-home-state'),'CA');assert.equal(location.search,'?state=CA');
  ids.get('search').value='old query';ids.get('office-filter').value='Senate';ids.get('home-focus').listeners.click();
  assert.equal(ids.get('state-filter').value,'CA');assert.equal(ids.get('search').value,'');assert.equal(ids.get('office-filter').value,'');assert.equal(frames().length,4);
  ids.get('race-grid').querySelector('.pin-button').listeners.click();assert.equal(JSON.parse(local.get('election-night-public-pins')).length,1);
  ids.get('view-pinned').listeners.click();assert.equal(frames().length,1);
  ids.get('race-grid').querySelector('.pin-button').listeners.click();assert.equal(frames().length,0);assert.equal(document.activeElement,ids.get('view-pinned'));
  ids.get('state-filter').value='';ids.get('view-all').listeners.click();assert.equal(frames().length,6);
  ids.get('page-next').listeners.click();assert.equal(frames().length,3);assert.equal(ids.get('page-next').disabled,true);
  const frame=frames()[0];
  messages.message({origin:'https://example.com',source:frame.contentWindow,data:{type:'watchvote-embed-resize',height:900}});assert.equal(frame.style.height,undefined);
  messages.message({origin:'https://watch.vote',source:{},data:{type:'watchvote-embed-resize',height:900}});assert.equal(frame.style.height,undefined);
  messages.message({origin:'https://watch.vote',source:frame.contentWindow,data:{type:'watchvote-embed-resize',height:10}});assert.equal(frame.style.height,'300px');
  messages.message({origin:'https://watch.vote',source:frame.contentWindow,data:{type:'watchvote-embed-resize',height:5000}});assert.equal(frame.style.height,'1600px');
  assert.equal(ids.get('local-links').hidden,true);
  ids.get('state-filter').value='AR';ids.get('state-filter').listeners.change();assert.equal(ids.get('local-links').hidden,false);
  const stableFrames = frames();
  context.fetch=async()=>{throw new Error('Network unavailable');};
  await run('loadDirectory()');
  assert.equal(ids.get('directory-error').hidden,false);
  assert.equal(ids.get('retry').disabled,false);
  assert.equal(frames()[0],stableFrames[0],'A failed reload discarded loaded cards');
  context.fetch=async()=>({ok:true,json:async()=>[{id:'invalid',slug:'../bad'}]});
  await run('loadDirectory()');
  assert.equal(ids.get('directory-error').hidden,false);
  assert.equal(frames()[0],stableFrames[0]);
  run("races=[]; renderedIds='';");
  context.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('Bad JSON');}});
  await run('loadDirectory()');
  assert.equal(frames().length,0);
  assert.equal(ids.get('directory-error').hidden,false);
  context.fetch=async()=>({ok:true,json:async()=>rows});
  await ids.get('retry').listeners.click();
  assert.equal(ids.get('directory-error').hidden,true);
  assert.equal(frames().length,5);
  assert.equal(ids.get('retry').disabled,false);
  ids.get('alerts-key').checked=false;ids.get('alerts-key').listeners.change();
  assert.equal(monitor.rows.length,0,'Key-race toggle must stop monitoring unsaved races');
  ids.get('race-grid').querySelector('.pin-button').listeners.click();
  assert.equal(monitor.rows.length,1,'Saved race must enter the monitor');
  ids.get('alerts-pause').listeners.click();assert.equal(monitor.paused,true);
  ids.get('alerts-pause').listeners.click();assert.equal(monitor.paused,false);
  const event={raceId:rows[0].id,label:rows[0].name,type:'call',callState:'called',winner:{name:'Fixture Winner',party:'Independent'},source:{authority:'Fixture source',url:'https://example.com/results'},updatedAt:'2026-11-04T01:00:00Z',detectedAt:Date.parse('2026-11-04T01:01:00Z')};
  monitor.callbacks.onChange({...monitor.getSnapshot(),checkedCount:1,calls:[event],events:[event]});
  assert.equal(ids.get('call-events').querySelectorAll('article').length,1);
  monitor.callbacks.onAlert(event);assert.match(ids.get('call-announcement').textContent,/Fixture Winner/);
  const correction={...event,type:'correction',callState:'not-called',winner:null};
  monitor.callbacks.onChange({...monitor.getSnapshot(),events:[correction,event]});
  assert.equal(ids.get('call-events').querySelectorAll('article').length,1,'Superseded winner must not remain as a current alert');
  rows.push({...rows[0],id:'race-10',slug:'ar-house-10',name:rows[0].name+'0'});
  map.options.onExplore({raceId:rows[0].id});
  assert.equal(ids.get('state-filter').value,'AR');
  assert.equal(ids.get('office-filter').value,'House');
  assert.equal(ids.get('search').value,rows[0].name);
  assert.equal(frames().length,1,'Map selection must open the chosen race');
  console.log('PASS: key/saved-race monitor selection, pause/resume, call announcement, correction replacement.');
  console.log('PASS: directory network/schema/JSON failures and Retry recovery.');
  console.log('PASS: six-frame cap, stable frames, all state options, home persistence, filter clearing, pins, pages, iframe resize origin/source/height checks, and local link visibility.');
})().catch(error=>{console.error(error);process.exitCode=1;});
