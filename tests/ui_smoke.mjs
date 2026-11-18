/** State/interaction smoke checks. Uses a G6 test double, not a browser renderer. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [source,html,graph,learning]=await Promise.all([
  fs.readFile(path.join(root,'static/workbench.js'),'utf8'),
  fs.readFile(path.join(root,'static/index.html'),'utf8'),
  fs.readFile(path.join(root,'data/graph.json'),'utf8').then(JSON.parse),
  fs.readFile(path.join(root,'content/learning.json'),'utf8').then(JSON.parse)
]);
const bundle=await fs.readFile(path.join(root,'static/app.js'),'utf8');
assert(bundle.endsWith(source),'Run python build_ui.py after editing workbench.js');
assert(!/<script[^>]+src=["']https?:/i.test(html),'Runtime scripts must remain local');
const elements=new Map();
function element(id){
  if(!elements.has(id)){
    const classes=new Set();
    elements.set(id,{id,hidden:false,value:({'typeFilter':'all','relationFilter':'default','statusFilter':'all','layoutSelect':'structured'})[id]||'',innerHTML:'',textContent:'',clientWidth:900,clientHeight:500,open:false,attributes:{},
      classList:{toggle(c,on){if(on===undefined)on=!classes.has(c);on?classes.add(c):classes.delete(c);},contains:c=>classes.has(c)},
      querySelector:s=>element(s.slice(1)),querySelectorAll:()=>[],setAttribute(k,v){this.attributes[k]=v;},addEventListener(){},focus(){},getBoundingClientRect:()=>({left:0,right:880,top:0,bottom:600}),showModal(){this.open=true;},close(){this.open=false;}});
  }
  return elements.get(id);
}
for(const m of html.matchAll(/id="([^"]+)"/g))element(m[1]);
element('fatal').hidden=true;
let graphInstance;
class GraphDouble{
 constructor(options){this.options=options;this.events={};this.zoom=1;graphInstance=this;}
 on(name,fn){this.events[name]=fn;}
 setData(data){this.data=data;const ids=new Set(data.nodes.map(n=>n.id));assert.equal(ids.size,data.nodes.length);for(const e of data.edges){assert(ids.has(e.source));assert(ids.has(e.target));}for(const n of data.nodes){assert(Number.isFinite(n.style.x));assert(Number.isFinite(n.style.y));}}
 async render(){} async draw(){} async fitView(){} async focusElement(id){assert(this.data.nodes.some(n=>n.id===id));}
 setSize(){} setOptions(options){Object.assign(this.options,options);} updateBehavior(options){assert(this.options.behaviors.some(b=>b.key===options.key));}
 getZoom(){return this.zoom;} async zoomBy(ratio){this.zoom*=ratio;} getNodeData(){return this.data.nodes;}
}
const storage=new Map();
const context=vm.createContext({console,setTimeout,clearTimeout,matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame:fn=>fn(),ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}},
 document:{querySelector:s=>element(s.slice(1)),querySelectorAll:()=>[],body:element('body'),activeElement:{tagName:'BODY'},addEventListener(){}},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 G6:{Rect:class{},register(){},ExtensionCategory:{NODE:'node'},Graph:GraphDouble},
 fetch:async url=>({ok:true,json:async()=>url==='/api/graph'?graph:learning})});
vm.runInContext(source,context);
const run=s=>vm.runInContext(s,context);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);assert.equal(element('fatal').hidden,true,element('fatal').textContent);};
await settle();assert.equal(graphInstance.data.nodes.length,9);
run("setScope('query')");await settle();assert.equal(graphInstance.data.nodes.length,12);assert.equal(graphInstance.data.edges.length,15);
run("chooseNode(currentNodes.find(n=>n.label==='node_search_embedding').id)");await settle();assert.match(element('details').innerHTML,/node_search_embedding/);assert(graphInstance.data.nodes.some(n=>n.style.opacity===.22));
run("setScope('import')");await settle();assert.equal(graphInstance.data.nodes.length,9);
element('relationFilter').value='data';run('renderGraph(true)');await settle();assert.equal(graphInstance.data.edges.length,17);assert(graphInstance.data.edges.every(e=>e.style.lineDash.length));
element('layoutSelect').value='radial';element('layoutSelect').onchange();await settle();assert(graphInstance.data.nodes.some(n=>n.style.x<0));
run("setScope('query');setScope('import');setScope('overview')");await settle();assert.equal(graphInstance.data.nodes.length,9);
run("expand('module:query_process')");await settle();assert(graphInstance.data.nodes.some(n=>n.data.label==='query_service.py'));
run("search('sse_generator')");assert.match(element('searchResults').innerHTML,/sse_generator/);
run("setPage('paths')");assert.match(element('pathsPage').innerHTML,/pathcard/);
run("setPage('glossary');renderGlossary('SSE')");assert.match(element('termGrid').innerHTML,/SSE/);
run("selected='project';completed[selected]=true;saveProgress()");assert([...storage.values()].some(v=>v.includes('project')));
element('focusBtn').onclick();assert(element('body').classList.contains('focus-mode'));element('focusBtn').onclick();assert(!element('body').classList.contains('focus-mode'));
element('motionBtn').onclick();assert.equal(graphInstance.options.animation,false);element('motionBtn').onclick();assert.equal(graphInstance.options.animation.duration,380);
assert.equal(element('graphLoading').hidden,true);
console.log('UI state smoke checks passed: scopes, evidence inspector, State filtering, layout, rapid navigation, search, learning pages, progress, focus, animation. Browser rendering is not covered.');
