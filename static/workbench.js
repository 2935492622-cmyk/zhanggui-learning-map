'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {project:'项目',module:'模块',file:'文件',function:'函数',class:'类',workflow:'流程节点'};
const kinds = {contains:'包含',imports:'源码导入',calls:'调用候选',flow:'流程配置',conditional:'条件分支',data:'State 候选',implements:'绑定实现',dependency:'依赖汇总'};
const icons = {project:'◈',module:'▧',file:'≡',function:'ƒ',class:'◇',workflow:'⬡'};
const workflowTitles = {node_item_name_confirm:'商品确认',node_multi_search:'多路检索 · 分叉',node_search_embedding:'向量检索',node_search_embedding_hyde:'HyDE 检索',node_query_kg:'知识图谱检索',node_web_search_mcp:'联网检索',node_join:'检索结果汇合',node_rrf:'RRF 融合排序',node_rerank:'相关性重排',node_answer_output:'答案输出',node_entry:'文件入口',node_pdf_to_md:'PDF 解析',node_md_img:'图片处理',node_document_split:'文档切块',node_item_name_recognition:'商品名称识别',node_bge_embedding:'文本向量化',node_import_milvus:'Milvus 入库'};
let G, L, N, E, scope = 'overview', selected = null, edgeSelected = null, direction = 'both';
let currentNodes = [], currentEdges = [], positions = new Map(), view = {x:0,y:0,w:900,h:550};
let completed = {}, storageKey = '', sourceToken = 0;
let engine, engineReady = false, painting = false, pendingPaint = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motion = !reducedMotion.matches;
const motionTiming = () => motion && !reducedMotion.matches ? {duration: 380, easing: 'ease-in-out'} : false;
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) { const el = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); if(text != null) el.textContent=text; return el; }
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').hidden=true,2600); }
async function get(url) { const r = await fetch(url); if(!r.ok) throw new Error(`读取失败 (${r.status})，请检查扫描数据和仓库路径。`); return r.json(); }
function badge(status) { return `<span class="badge ${status==='pending'?'pending':''}">${status==='pending'?'◌ 待验证':'✓ 源码已确认'}</span>`; }
function evidenceHTML(list = []) { return list.map((e,i)=>`<button class="evidence" data-ev="${i}">${esc(e.path)}<br><span>L${e.line}${e.symbol?' · '+esc(e.symbol):''} ↗</span></button>`).join(''); }
function bindEvidence(list) { $$('[data-ev]', $('#details')).forEach(b=>b.onclick=()=>openSource(list[+b.dataset.ev])); }
function stats() {
  const data = [[G.nodes.filter(n=>n.type==='module').length,'项目模块','个','▧'],[Object.keys(G.files).length,'源码文件','份','≡'],[G.edges.filter(e=>e.status==='confirmed').length,'源码已确认关系','条','⌁'],[G.edges.filter(e=>e.status==='pending').length,'待验证关系','条','◌']];
  $('#stats').innerHTML=data.map(([v,t,u,i])=>`<div class="stat"><div><small>${t}</small><strong>${v}</strong><em>${u}</em></div><span class="staticon">${i}</span></div>`).join('');
}
function setPage(page) {
  ['graph','paths','glossary'].forEach(p=>$(`#${p}Page`).hidden=p!==page);
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('#pageTitle').textContent={graph:'项目知识图谱',paths:'学习路径',glossary:'技术术语'}[page];
  if(page==='paths') renderPaths(); if(page==='glossary') renderGlossary();
  if(page==='graph') requestAnimationFrame(()=>{ resizeEngine(); });
  document.body.classList.toggle('graph-page',page==='graph');
}
function resetFilters() { $('#typeFilter').value='all'; $('#relationFilter').value='default'; $('#statusFilter').value='all'; }
function setScope(value, pick = null) {
  scope=value; positions.clear(); resetFilters(); selected=pick; edgeSelected=null; direction='both';
  setPage('graph'); renderGraph(true); renderDetail();
}
function reveal(id) {
  const n=N.get(id); if(!n) return toast('此学习锚点在当前仓库中不存在，请维护学习数据。');
  if(n.type==='project' || n.type==='module') setScope('overview',id);
  else if(n.type==='workflow') setScope(n.module==='query_process'?'query':'import',id);
  else setScope('children:'+n.parent,id);
  $('#searchResults').hidden=true; $('#search').value='';
}
function expand(id) { const kids=G.nodes.filter(n=>n.parent===id); if(kids.length) setScope('children:'+id,id); else toast('已到达当前扫描范围的最深层。'); }
function visibleData() {
  let list;
  if(scope==='overview') list=G.nodes.filter(n=>n.type==='project'||n.type==='module');
  else if(scope==='query'||scope==='import') list=G.nodes.filter(n=>n.type==='workflow'&&n.module===(scope==='query'?'query_process':'import_process'));
  else if(scope.startsWith('related:')) { const root=scope.substring(8), ids=new Set([root]); G.edges.filter(e=>e.source===root||e.target===root).forEach(e=>{ids.add(e.source);ids.add(e.target);}); list=G.nodes.filter(n=>ids.has(n.id)); }
  else { const root=scope.substring(9); list=G.nodes.filter(n=>n.id===root||n.parent===root); }
  const type=$('#typeFilter').value;
  if(type!=='all') list=list.filter(n=>n.type===type);
  const ids=new Set(list.map(n=>n.id)), relation=$('#relationFilter').value, status=$('#statusFilter').value;
  let edges=G.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  if(relation==='default') edges=edges.filter(e=>e.kind!=='data');
  else if(relation!=='all') edges=edges.filter(e=>relation==='flow'?['flow','conditional'].includes(e.kind):e.kind===relation);
  if(status!=='all') { edges=edges.filter(e=>e.status===status); const connected=new Set(edges.flatMap(e=>[e.source,e.target])); list=list.filter(n=>connected.has(n.id)); }
  return {nodes:list,edges};
}
function layout(list) {
  if ($('#layoutSelect').value === 'radial') {
    const root = list.find(n=>n.type==='project') || list.find(n=>n.id===selected) || list[0];
    const rest=list.filter(n=>n!==root), r=Math.max(265,rest.length*40);
    if(root) positions.set(root.id,{x:0,y:0});
    rest.forEach((n,i)=>{const a=-Math.PI/2+i*2*Math.PI/rest.length;positions.set(n.id,{x:Math.cos(a)*r*1.3,y:Math.sin(a)*r});});
    return;
  }
  if(scope==='overview') {
    const arrangement={'project':[1,1], 'query_process':[0,0], 'import_process':[0,2], 'clients':[2,1], 'lm':[1,0], 'utils':[1,2], 'conf':[2,2], 'core':[2,0], 'tool':[0,1]};
    list.forEach((n,i)=>{ const [x,y]=arrangement[n.module||n.id]||[i%3,Math.floor(i/3)]; positions.set(n.id,{x:60+x*265,y:45+y*135}); });
  } else if(scope==='query') {
    const a={'开始':[0,0],node_item_name_confirm:[1,0],node_multi_search:[2,0],node_search_embedding:[0,1],node_search_embedding_hyde:[1,1],node_web_search_mcp:[2,1],node_query_kg:[3,1],node_join:[0,2],node_rrf:[1,2],node_rerank:[2,2],node_answer_output:[2,3],'结束':[3,3]};
    list.forEach((n,i)=>{ const [x,y]=a[n.label]||[i%4,Math.floor(i/4)];positions.set(n.id,{x:40+x*225,y:50+y*120}); });
  } else if(scope==='import') {
    const order=['开始','node_entry','node_pdf_to_md','node_md_img','node_document_split','node_item_name_recognition','node_bge_embedding','node_import_milvus','结束'];
    list.forEach(n=>{const i=order.indexOf(n.label),r=Math.floor(i/3),c=r%2?2-i%3:i%3;positions.set(n.id,{x:45+c*255,y:45+r*135});});
  } else {
    const root=scope.substring(scope.startsWith('related:')?8:9), kids=list.filter(n=>n.id!==root), cols=Math.max(2,Math.min(4,Math.ceil(Math.sqrt(kids.length))));
    list.forEach(n=>{if(n.id===root) positions.set(n.id,{x:45,y:45});else {const i=kids.indexOf(n);positions.set(n.id,{x:45+i%cols*235,y:180+Math.floor(i/cols)*115});}});
  }
}
function fit() {
  if(engineReady && currentNodes.length) engine.fitView({when:'always',direction:'both'},motionTiming()).catch(reportGraphError);
}
function applyView() { resizeEngine(); }
function zoom(factor) {
  if(engineReady) engine.zoomBy(1/factor,motionTiming()).catch(reportGraphError);
}
function resizeEngine() {
  const stage=$('#stage');
  if(engine && !$('#graphPage').hidden && stage.clientWidth && stage.clientHeight) {
    engine.setSize(stage.clientWidth,stage.clientHeight);
  }
}
function reportGraphError(error) {
  $('#graphLoading').hidden=true;
  $('#fatal').hidden=false;
  $('#fatal').textContent='图谱绘制失败：'+error.message+'。请刷新页面重试。';
}
function reachable(id, reverse) {
  const result=new Set(), q=[id];
  while(q.length){const cur=q.shift(); for(const e of currentEdges){const next=reverse?(e.target===cur?e.source:null):(e.source===cur?e.target:null);if(next&&next!==id&&!result.has(next)){result.add(next);q.push(next);}}}
  return result;
}
// G6 owns canvas interactions; evidence and learning data remain independent.
const palette={query_process:'#648dbb',import_process:'#bd9a59',clients:'#839776',lm:'#9b87b6',utils:'#679d91',conf:'#899ba3',core:'#b18f7c',tool:'#929d71'};
function createEngine() {
  if(!globalThis.G6) throw new Error('G6 未加载，请检查本地 app.js 是否完整。');
  class LearningCard extends G6.Rect {
    render(attributes=this.parsedAttributes,container) {
      super.render(attributes,container);
      const accent=attributes.accent || '#5e8f69';
      const common={fontFamily:'Segoe UI, Microsoft YaHei, sans-serif',textBaseline:'middle'};
      this.upsert('accent','rect',{x:-98,y:-19,width:30,height:34,radius:8,fill:accent,fillOpacity:.10},container);
      this.upsert('glyph','text',{...common,x:-83,y:-1,text:attributes.glyph||'◈',fontSize:19,textAlign:'center',fill:accent},container);
      this.upsert('primary','text',{...common,x:-56,y:-10,text:attributes.primary||'',fontSize:12,fontWeight:500,fill:attributes.titleFill||'#344c3b'},container);
      this.upsert('subtitle','text',{...common,x:-56,y:11,text:attributes.subtitle||'',fontSize:8,fill:'#99a58f'},container);
      this.upsert('indicator','circle',{cx:98,cy:-23,r:2.5,fill:accent,fillOpacity:.6},container);
    }
  }
  G6.register(G6.ExtensionCategory.NODE,'learning-card',LearningCard);
  engine=new G6.Graph({
    container:$('#graph'),width:Math.max(300,$('#stage').clientWidth),height:Math.max(300,$('#stage').clientHeight),
    padding:[65,38,60,38],zoomRange:[.15,2.5],animation:motionTiming(),
    node:{type:'learning-card',style:{size:[220,76],radius:10,label:false,fill:'#ffffff',stroke:'#dce5d5',lineWidth:1,cursor:'pointer',shadowColor:'#264f3210',shadowBlur:8,shadowOffsetY:3},state:{active:{stroke:'#82a96c',lineWidth:1.5,shadowBlur:14,shadowColor:'#5f8b4625'},inactive:{opacity:.22}}},
    edge:{type:'cubic',style:{stroke:'#b6c8af',lineWidth:1.2,endArrow:true,endArrowSize:5,cursor:'pointer'},state:{active:{stroke:'#6d9860',lineWidth:2},inactive:{opacity:.12}}},
    behaviors:['drag-canvas',{type:'zoom-canvas',key:'zoom',sensitivity:.8,animation:motionTiming()},{type:'drag-element',trigger:[],hideEdge:'none'},{type:'hover-activate',key:'hover',degree:1,inactiveState:'inactive',animation:true,enable:()=>!selected&&!edgeSelected}],
    plugins:[{type:'minimap',key:'minimap',size:[115,76],padding:8,position:'right-bottom',className:'g6-minimap',containerStyle:{right:'12px',bottom:'12px'},maskStyle:{border:'1px solid #8ca778',background:'rgba(148,174,126,.12)'}}]
  });
  engine.on('node:click',ev=>chooseNode(ev.target.id));
  engine.on('node:dblclick',ev=>expand(ev.target.id));
  engine.on('edge:click',ev=>chooseEdge(ev.target.id));
  engine.on('canvas:click',()=>{selected=null;edgeSelected=null;renderGraph();renderDetail();});
  engine.on('node:dragend',()=>{for(const n of engine.getNodeData()) if(n.style) positions.set(n.id,{x:n.style.x-110,y:n.style.y-38});});
  engine.on('aftertransform',()=>{$('#zoomLevel').textContent=Math.round(engine.getZoom()*100)+'%';});
}
function renderGraph(relayout=false) {
  const data=visibleData();currentNodes=data.nodes;currentEdges=data.edges;
  if(relayout||currentNodes.some(n=>!positions.has(n.id))) layout(currentNodes);
  const up=selected?reachable(selected,true):new Set(), down=selected?reachable(selected,false):new Set();
  const near=new Set([selected,...(direction!=='down'?up:[]),...(direction!=='up'?down:[])]);
  const chosenEdge=E.get(edgeSelected), hasSelection=currentNodes.some(n=>n.id===selected)||!!chosenEdge;
  const graphData={nodes:currentNodes.map(n=>{
    const p=positions.get(n.id),sel=selected===n.id;
    const dim=hasSelection&&(chosenEdge?![chosenEdge.source,chosenEdge.target].includes(n.id):!near.has(n.id));
    const label=n.type==='workflow'?(workflowTitles[n.label]||n.label):n.label;
    const short=label.length>15?label.slice(0,13)+'…':label;
    let stroke=sel?'#4d7f39':up.has(n.id)&&direction!=='down'?'#759bc9':down.has(n.id)&&direction!=='up'?'#c7a367':'#dce5d5';
    return {id:n.id,states:[],data:{label:n.label},style:{x:p.x+110,y:p.y+38,primary:short,subtitle:n.type==='workflow'?n.label.slice(0,25):names[n.type]+(n.module?' / '+n.module:''),glyph:icons[n.type],accent:palette[n.module]||'#5d8450',opacity:dim?.22:1,stroke,lineWidth:sel?2:1,fill:sel?'#f2f7ed':'#ffffff'}};
  }),edges:currentEdges.map(e=>{
    const dim=hasSelection&&(chosenEdge?e.id!==chosenEdge.id:!(near.has(e.source)&&near.has(e.target)));
    const active=e.id===edgeSelected, flow=['flow','conditional'].includes(e.kind);
    return {id:e.id,states:[],source:e.source,target:e.target,style:{stroke:active?'#648d4c':e.status==='pending'?'#c3b38d':'#acbfa4',lineWidth:active?2.4:1.15,lineDash:e.status==='pending'?[5,5]:[],opacity:dim?.12:.85,labelText:flow?kinds[e.kind]:'',labelFontSize:8,labelFill:'#a6b29e',labelBackground:true,labelBackgroundFill:'#fcfdfb',labelPadding:3}};
  })};
  const title=scope==='overview'?'项目架构总览':scope==='query'?'问答查询流程':scope==='import'?'知识导入流程':scope.startsWith('related:')?'关联图 · '+N.get(scope.substring(8))?.label:N.get(scope.substring(9))?.label||'代码关系';
  $('#scopeHint').textContent=title+' · '+currentNodes.length+' 个节点 / '+currentEdges.length+' 条关系';
  $('#canvasScope').textContent=title;
  $('#stagebadge').textContent=scope==='overview'?'PROJECT / MODULE':scope==='query'||scope==='import'?'LANGGRAPH / '+scope.toUpperCase():'SOURCE / STRUCTURE';
  $$('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===scope));
  $('#upBtn').hidden=!scope.startsWith('children:');$('#emptyGraph').hidden=!!currentNodes.length;
  $('#nodeJump').innerHTML='<option value="">选择节点</option>'+currentNodes.map(n=>`<option value="${esc(n.id)}" ${n.id===selected?'selected':''}>${esc(n.type==='workflow'?(workflowTitles[n.label]||n.label):n.label)}</option>`).join('');
  pendingPaint={data:graphData,fit:relayout};
  paintGraph();
}
async function paintGraph() {
  if(painting||!engine) return;
  painting=true;
  try {
    while(pendingPaint) {
      const next=pendingPaint;pendingPaint=null;
      engine.setData(next.data);
      if(!engineReady){await engine.render();engineReady=true;}else await engine.draw();
      $('#graphLoading').hidden=true;$('#fatal').hidden=true;
      if(next.fit&&next.data.nodes.length) await engine.fitView({when:'always',direction:'both'},motionTiming());
      $('#zoomLevel').textContent=Math.round(engine.getZoom()*100)+'%';
    }
  }catch(error){reportGraphError(error);}finally{painting=false;}
}
function chooseNode(id) {selected=id;edgeSelected=null;renderGraph();renderDetail();}
function chooseEdge(id) {edgeSelected=id;selected=null;renderGraph();renderDetail();}
function renderDetail() {
  const box=$('#details');
  if(edgeSelected) {
    const e=E.get(edgeSelected),a=N.get(e.source),b=N.get(e.target);
    box.innerHTML=`<div class="detailhead">RELATION DETAILS ${badge(e.status)}</div><div class="detailicon">⌁</div><h3>${esc(kinds[e.kind])}</h3><p class="desc">${esc(a.label)} → ${esc(b.label)}</p><p class="desc">${esc(e.explanation)}</p><h4>代码证据</h4>${evidenceHTML(e.evidence)}<div class="actionrow"><button class="quiet" id="fromNode">查看上游节点</button><button class="quiet" id="toNode">查看下游节点</button></div><div class="softnote">${e.status==='pending'?'此关系尚未验证。请沿代码锚点检查符号绑定、分支和 State 字段，再以实际执行证据核实。':'已确认源码中存在此结构或配置。是否在某次业务请求中执行，需要运行时验证。'}</div>`;
    bindEvidence(e.evidence);$('#fromNode').onclick=()=>reveal(a.id);$('#toNode').onclick=()=>reveal(b.id);return;
  }
  const n=N.get(selected);
  if(!n) {box.innerHTML=`<div class="detailhead">INSPECTOR <span>节点详情</span></div><div class="empty-detail"><svg class="detail-empty-map" viewBox="0 0 150 120" aria-hidden="true"><path d="M30 30L75 60L122 26M75 60L117 100M75 60L25 96" fill="none" stroke="#d1dfc6" stroke-width="1.5" stroke-dasharray="4 4"/><rect x="53" y="39" width="44" height="42" rx="12" fill="#edf4e8" stroke="#d6e3cd"/><text x="75" y="66" text-anchor="middle" fill="#85a36f" font-size="25">◈</text><circle cx="30" cy="30" r="8" fill="#eef2f7" stroke="#d0dcea"/><circle cx="122" cy="26" r="8" fill="#f5f0e5" stroke="#e9ddc5"/><circle cx="117" cy="100" r="7" fill="#edf3e6" stroke="#d9e5cc"/><circle cx="25" cy="96" r="7" fill="#f1edf5" stroke="#e0d6e9"/></svg><h3>每一次连接，都是线索。</h3><p class="desc">选择一个节点，查看职责、关联关系<br>与真实的代码证据。</p><div class="detail-tips"><div><b>1</b><span><strong>悬停，聚焦关系</strong>高亮节点的一跳关联</span></div><div><b>2</b><span><strong>双击，深入结构</strong>从模块一路走到函数</span></div><div><b>3</b><span><strong>核对，回到源码</strong>点击证据查看原始代码</span></div></div><div class="detail-footer">蓝色边框：上游 · 金色边框：下游<br>虚线表示待验证的关系。</div></div>`;return;}
  const incoming=G.edges.filter(e=>e.target===n.id),outgoing=G.edges.filter(e=>e.source===n.id),kids=G.nodes.filter(x=>x.parent===n.id);
  const relationHTML=(list,reverse)=>list.slice(0,18).map(e=>`<button class="relationrow" data-detail-edge="${e.id}"><span>${reverse?'↖':'↘'}</span><span class="relationname">${esc(N.get(reverse?e.source:e.target)?.label)}</span><span>${esc(kinds[e.kind])}${e.status==='pending'?' ◌':''}</span></button>`).join('')+(list.length>18?`<p class="muted">另有 ${list.length-18} 条，切换关系筛选后在图中查看。</p>`:'');
  box.innerHTML=`<div class="detailhead">NODE DETAILS <span>${esc(names[n.type])}</span></div><div class="detailicon">${icons[n.type]}</div><h3>${esc(n.label)}</h3><span class="badge">${esc(n.module||'项目根节点')}</span><p class="desc">${esc(n.description)}</p>${(n.routes||[]).map(r=>`<span class="route">${esc(r)}</span>`).join('')}<div class="actionrow">${kids.length?'<button class="primary" id="expandBtn">展开子节点 ↗</button>':''}${n.implementation?'<button class="quiet" id="implBtn">查看实现</button>':''}<button class="quiet" id="relatedBtn">查看关联图</button><button class="quiet" id="markBtn">${completed[n.id]?'✓ 已学会':'标记已学会'}</button></div><div class="directions"><button data-dir="both" class="${direction==='both'?'active':''}">上下游</button><button data-dir="up" class="${direction==='up'?'active':''}">仅上游</button><button data-dir="down" class="${direction==='down'?'active':''}">仅下游</button></div>${(n.evidence||[]).length?'<h4>代码证据</h4>'+evidenceHTML(n.evidence):''}${(n.fields||[]).length?'<h4>声明字段</h4>'+n.fields.map(f=>`<span class="field">${esc(f)}</span>`).join(''):''}${(n.reads||[]).length?'<h4>读取 State 字段 · 静态候选</h4>'+n.reads.map(f=>`<span class="field">${esc(f)}</span>`).join(''):''}${(n.writes||[]).length?'<h4>写入 / 返回字典键 · 静态候选</h4>'+n.writes.map(f=>`<span class="field">${esc(f)}</span>`).join(''):''}${incoming.length?`<h4>上游关系 · ${incoming.length}</h4>${relationHTML(incoming,true)}`:''}${outgoing.length?`<h4>下游关系 · ${outgoing.length}</h4>${relationHTML(outgoing,false)}`:''}${kids.length?`<h4>子节点 · ${kids.length}</h4><div class="childlist">${kids.map(c=>`<button data-child="${esc(c.id)}">${icons[c.type]} ${esc(c.label)} ↗</button>`).join('')}</div>`:''}`;
  if($('#expandBtn'))$('#expandBtn').onclick=()=>expand(n.id);if($('#implBtn'))$('#implBtn').onclick=()=>reveal(n.implementation);
  $('#relatedBtn').onclick=()=>setScope('related:'+n.id,n.id);
  $('#markBtn').onclick=()=>{completed[n.id]=!completed[n.id];saveProgress();renderDetail();};
  $$('[data-dir]',box).forEach(b=>b.onclick=()=>{direction=b.dataset.dir;renderGraph();renderDetail();});
  $$('[data-detail-edge]',box).forEach(b=>b.onclick=()=>{const e=E.get(b.dataset.detailEdge);if(!currentEdges.some(x=>x.id===e.id))toast('此关系位于当前画布之外，可通过上下游按钮继续定位。');chooseEdge(e.id);});
  $$('[data-child]',box).forEach(b=>b.onclick=()=>reveal(b.dataset.child));bindEvidence(n.evidence||[]);
}
async function openSource(ev) {
  const token=++sourceToken,d=$('#sourceDialog');$('#sourceTitle').textContent=`${ev.path}:${ev.line}`;$('#sourceBody').textContent='正在读取本地源码…';if(!d.open)d.showModal();
  try {const s=await get(`/api/source?path=${encodeURIComponent(ev.path)}&line=${ev.line}`);if(token!==sourceToken)return;
    $('#sourceBody').innerHTML=`${s.stale?'<div class="warning">源码已变化，旧图谱证据已过期。请重新扫描后再核实关系，当前显示的是文件现有内容。</div>':'<span class="badge">✓ 文件 SHA-256 与扫描快照一致</span>'}<p class="sourcepath">${esc(s.absolutePath)} · ${esc(ev.symbol||'文件锚点')}</p><div class="codepane">${s.lines.map((line,i)=>`<span class="codeline ${s.start+i===ev.line?'target':''}"><span class="linenum">${s.start+i}</span>${esc(line)||' '}</span>`).join('')}</div><div class="actionrow"><button class="quiet" id="copyPath">复制路径与行号</button> <a class="quiet" href="${esc(s.editorUrl)}">在 VS Code 打开 ↗</a></div><p class="sourcepath">代码只读显示；编辑器跳转需要本机已注册 VS Code。复制路径可用于其他编辑器。</p>`;
    $('#copyPath').onclick=async()=>{try{await navigator.clipboard.writeText(s.absolutePath+':'+ev.line);toast('已复制代码位置');}catch{toast('浏览器禁止复制，可在上方选中路径手动复制。');}};
  } catch(e){$('#sourceBody').textContent=e.message;}
}
function saveProgress() {try{localStorage.setItem(storageKey,JSON.stringify(completed));}catch{toast('浏览器未允许保存，进度仅在本次打开期间保留。');}}
function resolveAnchor(anchor) {return G.nodes.find(n=>n.path===anchor.path&&(!anchor.symbol?n.type==='file':n.symbol===anchor.symbol));}
function renderPaths() {
  $('#pathsPage').innerHTML=`<div class="eyebrow">LEARNING BY EXPLORING</div><h2 class="contentheading">把复杂项目，拆成可以走完的路。</h2><p class="contentintro">每一步都回到源码。先理解一条主线，再深入函数细节。勾选进度会保存在本机浏览器。</p><div class="pathgrid">${L.paths.map((p,pi)=>{const done=p.steps.filter(s=>completed[resolveAnchor(s)?.id]).length;return `<article class="pathcard"><span class="eyebrow">PATH 0${pi+1} / ${esc(p.duration)}</span><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><div class="progressbar"><i style="width:${done/p.steps.length*100}%"></i></div>${p.steps.map((s,si)=>{const n=resolveAnchor(s);return `<div class="step ${completed[n?.id]?'done':''}"><span class="stepnum">${completed[n?.id]?'✓':si+1}</span><div class="steptext"><button data-anchor="${pi}:${si}" ${n?'':'disabled'}>${esc(s.title)} ↗</button><p>${esc(s.question)}</p>${!n?'<p class="warning">锚点已失效，请维护 content/learning.json。</p>':''}</div>${n?`<label class="stepcheck"><input type="checkbox" data-check="${esc(n.id)}" ${completed[n.id]?'checked':''} aria-label="标记${esc(s.title)}已学会"></label>`:''}</div>`;}).join('')}<p>${done} / ${p.steps.length} 已完成</p></article>`;}).join('')}</div>`;
  $$('[data-anchor]').forEach(b=>b.onclick=()=>{const [p,s]=b.dataset.anchor.split(':').map(Number);reveal(resolveAnchor(L.paths[p].steps[s])?.id);});
  $$('[data-check]').forEach(c=>c.onchange=()=>{completed[c.dataset.check]=c.checked;saveProgress();renderPaths();});
}
function renderGlossary(query='') {
  if(!$('#termSearch')) {
    $('#glossaryPage').innerHTML='<div class="eyebrow">CONCEPTS IN CONTEXT</div><h2 class="contentheading">术语，放回项目里理解。</h2><p class="contentintro">简明解释只是入口，关联源码帮助你确认它在掌柜智库中的具体用法。</p><input id="termSearch" class="termfilter" placeholder="筛选术语，如 SSE、State、Milvus" aria-label="筛选技术术语"><div class="termgrid" id="termGrid"></div>';
    $('#termSearch').oninput=e=>renderGlossary(e.target.value);
  }
  const terms=L.terms.filter(t=>(t.title+t.english+t.definition).toLowerCase().includes(query.toLowerCase()));
  $('#termGrid').innerHTML=terms.map(t=>`<article class="termcard"><span class="english">${esc(t.english)}</span><h3>${esc(t.title)}</h3><p>${esc(t.definition)}</p><p><strong>在掌柜智库中</strong><br>${esc(t.context)}</p><button data-term="${esc(t.title)}">查看关联源码 ↗</button></article>`).join('')||'<p class="empty">没有匹配的术语。</p>';
  $$('[data-term]').forEach(b=>b.onclick=()=>{const t=L.terms.find(t=>t.title===b.dataset.term);reveal(resolveAnchor(t.anchor)?.id);});
}
function search(query) {
  const box=$('#searchResults'),q=query.trim().toLowerCase();if(!q){box.hidden=true;return;}
  const ns=G.nodes.filter(n=>(n.label+' '+(n.path||'')+' '+n.description).toLowerCase().includes(q));
  const ts=L.terms.filter(t=>(t.title+' '+t.english).toLowerCase().includes(q));
  box.hidden=false;box.innerHTML=ns.slice(0,24).map(n=>`<button data-result="${esc(n.id)}">${icons[n.type]} ${esc(n.label)}<small>${names[n.type]} · ${esc(n.path||n.module||'掌柜智库')}</small></button>`).join('')+ts.map(t=>`<button data-result-term="${esc(t.title)}">≡ ${esc(t.title)}<small>技术术语 · ${esc(t.english)}</small></button>`).join('')+(!ns.length&&!ts.length?'<p class="empty">没有找到匹配项，试试文件名或函数名。</p>':'')+(ns.length>24?`<p class="empty">共 ${ns.length} 项，显示前 24 项；请增加关键词缩小范围。</p>`:'');
  $$('[data-result]',box).forEach(b=>b.onclick=()=>reveal(b.dataset.result));
  $$('[data-result-term]',box).forEach(b=>b.onclick=()=>{setPage('glossary');$('#termSearch').value=b.dataset.resultTerm;renderGlossary(b.dataset.resultTerm);box.hidden=true;});
}
function bind() {
  $$('.nav').forEach(b=>b.onclick=()=>setPage(b.dataset.page));$$('[data-scope]').forEach(b=>b.onclick=()=>setScope(b.dataset.scope));
  $('#learnBtn').onclick=()=>setPage('paths');
  ['typeFilter','relationFilter','statusFilter'].forEach(id=>$('#'+id).onchange=()=>renderGraph(true));
  $('#clearBtn').onclick=$('#emptyReset').onclick=()=>{resetFilters();renderGraph(true);};
  $('#upBtn').onclick=()=>{const n=N.get(scope.substring(9));if(n?.parent&&n.parent!=='project')setScope('children:'+n.parent,n.id);else setScope('overview',n?.id);};
  $('#zoomIn').onclick=()=>zoom(.8);$('#zoomOut').onclick=()=>zoom(1.25);$('#fitBtn').onclick=fit;$('#resetBtn').onclick=()=>renderGraph(true);
  $('#search').oninput=e=>search(e.target.value);$('#search').onkeydown=e=>{if(e.key==='Escape')$('#searchResults').hidden=true;if(e.key==='Enter')$('button',$('#searchResults'))?.click();if(e.key==='ArrowDown'){e.preventDefault();$('button',$('#searchResults'))?.focus();}};
  $('#searchResults').onkeydown=e=>{const buttons=$$('button',$('#searchResults')),i=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Escape'){$('#searchResults').hidden=true;$('#search').focus();}};
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}});
  document.addEventListener('click',e=>{if(!e.target.closest('.searchwrap'))$('#searchResults').hidden=true;});
  $('#closeSource').onclick=()=>{sourceToken++;$('#sourceDialog').close();};$('#closeAbout').onclick=()=>$('#aboutDialog').close();
  $('#aboutBtn').onclick=()=>{$('#aboutBody').innerHTML=`<p><strong>来源仓库</strong><br><a href="https://github.com/2935492622-cmyk/zhanggui-zhiku" target="_blank" rel="noreferrer">2935492622-cmyk / zhanggui-zhiku ↗</a></p><p>本地扫描目录：${esc(G.meta.sourceRoot)}<br>提交：${esc(G.meta.revision)} · ${G.meta.dirty?'含本地修改':'工作区干净'}<br>扫描时间：${esc(new Date(G.meta.generatedAt).toLocaleString('zh-CN'))}<br>范围：${esc(G.meta.scope)}</p><p>${esc(G.meta.policy)}</p><p>每条代码证据保存扫描时的文件 SHA-256。点击证据会重新核对当前文件；若发生修改，将提示证据过期。学习说明为人工编写，State 候选为文件级静态汇总，需要结合代码确认。</p><p>${esc(G.meta.sourceNote)}</p>${G.meta.warnings.length?'<div class="warning">'+G.meta.warnings.map(esc).join('<br>')+'</div>':''}`;$('#aboutDialog').showModal();};
  $('#sideLearn').onclick=()=>setPage('paths');
  $('#homeBtn').onclick=()=>setScope('overview');
  $('#layoutSelect').onchange=()=>renderGraph(true);
  $('#nodeJump').onchange=e=>{if(e.target.value){chooseNode(e.target.value);if(engineReady)engine.focusElement(e.target.value,motionTiming()).catch(reportGraphError);}};
  const focus=on=>{document.body.classList.toggle('focus-mode',on);$('#focusBtn').setAttribute('aria-pressed',String(on));$('#focusBtn').textContent=on?'⛶ 退出专注':'⛶ 专注模式';requestAnimationFrame(()=>{resizeEngine();fit();});};
  $('#focusBtn').onclick=()=>focus(!document.body.classList.contains('focus-mode'));
  const updateMotion=()=>{const enabled=motion&&!reducedMotion.matches;document.body.classList.toggle('motion-off',!enabled);$('#motionBtn').setAttribute('aria-pressed',String(enabled));$('#motionBtn').textContent='动效 '+(enabled?'开':'关');engine.setOptions({animation:motionTiming()});engine.updateBehavior({key:'zoom',animation:motionTiming()});engine.updateBehavior({key:'hover',animation:enabled});};
  $('#motionBtn').onclick=()=>{motion=!motion;updateMotion();};
  reducedMotion.addEventListener('change',updateMotion);updateMotion();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sourceDialog').open&&!$('#aboutDialog').open){if(document.body.classList.contains('focus-mode'))focus(false);else{selected=null;edgeSelected=null;renderGraph();renderDetail();}}});
  for(const dialog of [$('#sourceDialog'),$('#aboutDialog')]) dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  new ResizeObserver(resizeEngine).observe($('#stage'));
}
async function init(){try{
  [G,L]=await Promise.all([get('/api/graph'),get('/api/learning')]);N=new Map(G.nodes.map(n=>[n.id,n]));E=new Map(G.edges.map(e=>[e.id,e]));
  storageKey='zhanggui-learning:'+G.meta.sourceRoot;try{completed=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!completed||typeof completed!=='object')completed={};}catch{completed={};}
  $('#revision').textContent=`zhanggui-zhiku · ${G.meta.revision.slice(0,7)}`;stats();createEngine();bind();renderGraph(true);renderDetail();
}catch(e){$('#fatal').hidden=false;$('#fatal').textContent=e.message;$('#graphPage').hidden=true;}}
init();
