import {create} from 'zustand';
import {workflows as seed} from '../../mock-data/workflows';
import {instances} from '../../mock-data/instances';
import type {FlowEdge,FlowNode,PendingMerge,ValidationIssue,Workflow,WorkflowStatus} from '../types';
import {checkGraph,mergeGraph,setField,type Graph} from './merge';

const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const now=()=>{const d=new Date(),p=(n:number)=>String(n).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};

const validate=(w:Workflow):ValidationIssue[]=>{const issues:ValidationIssue[]=[]; if(!w.nodes.some(n=>n.type==='end')) issues.push({nodeId:w.nodes[0]?.id||'flow',level:'error',message:'流程缺少结束节点'}); const linked=new Set(w.edges.flatMap(e=>[e.source,e.target])); w.nodes.filter(n=>n.type!=='start'&&n.type!=='end'&&!linked.has(n.id)).forEach(n=>issues.push({nodeId:n.id,level:'error',message:'必经节点不能孤立'})); w.nodes.forEach(n=>{if(n.type==='condition'&&!n.data.config.ruleType)issues.push({nodeId:n.id,level:'error',message:'条件分支规则未配置'}); if(n.type==='approval'&&!n.data.config.approverSource)issues.push({nodeId:n.id,level:'error',message:'审批人不能为空'});}); return issues};

// ---------- 草稿持久化 ----------
// server 键模拟多人共享的远端草稿（跨标签页可见）；draft 键是本端最近一次通过检查的完整草稿。
// 待处理区（未确认冲突/待确认移除/检查问题）只存在于内存，刷新或关闭后不会带进下一步。
interface ServerCopy extends Graph{rev:number;editor:string;savedAt:string}
interface DraftCopy extends Graph{rev:number;savedAt:string;status?:WorkflowStatus;version?:number;publishedAt?:string}
const SERVER_KEY=(id:string)=>`flowdesk:server:${id}`;
const DRAFT_KEY=(id:string)=>`flowdesk:draft:${id}`;
const read=<T,>(key:string):T|null=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null}catch{return null}};
const readServer=(id:string)=>read<ServerCopy>(SERVER_KEY(id));
const readDraft=(id:string)=>read<DraftCopy>(DRAFT_KEY(id));
const write=(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{/* 存储不可用时静默降级为内存态 */}};

const initWorkflows=():Workflow[]=>clone(seed).map(w=>{
 const draft=readDraft(w.id);
 if(!draft)return{...w,base:{rev:0,nodes:clone(w.nodes),edges:clone(w.edges)},confirmed:{nodes:clone(w.nodes),edges:clone(w.edges),savedAt:w.updatedAt}};
 return{...w,nodes:clone(draft.nodes),edges:clone(draft.edges),status:draft.status??w.status,version:draft.version??w.version,publishedAt:draft.publishedAt??w.publishedAt,updatedAt:draft.savedAt,base:{rev:draft.rev,nodes:clone(draft.nodes),edges:clone(draft.edges)},confirmed:{nodes:clone(draft.nodes),edges:clone(draft.edges),savedAt:draft.savedAt}};
});

interface State{workflows:Workflow[];instances:typeof instances;currentId:string;selectedNodeId:string|null;issues:ValidationIssue[];pending:PendingMerge|null;toast:string;setCurrent:(id:string)=>void;selectNode:(id:string|null)=>void;updateNodes:(nodes:FlowNode[])=>void;updateEdges:(edges:FlowEdge[])=>void;updateConfig:(id:string,config:Record<string,any>)=>void;runValidation:()=>ValidationIssue[];save:()=>void;resolveConflict:(key:string,choice:'local'|'remote')=>void;resolveHold:(id:string,approve:boolean)=>void;simulatePeerEdit:()=>void;publish:()=>void;create:()=>string;copy:(id:string)=>void;archive:(id:string)=>void;restore:(v:number)=>void;clearToast:()=>void}

export const useAppStore=create<State>((set,get)=>{
 const current=()=>get().workflows.find(x=>x.id===get().currentId)!;
 const patchCurrent=(fn:(w:Workflow)=>Workflow)=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?fn(w):w)}));

 /** 合并事项全部解决且结构检查通过后，把当前画布固化为完整草稿（本端+远端各一份） */
 const confirm=(remoteRev:number)=>{
  const w=current();
  const rev=remoteRev+1;
  const snapshot={nodes:clone(w.nodes),edges:clone(w.edges)};
  const savedAt=now();
  write(SERVER_KEY(w.id),{...clone(snapshot),rev,editor:w.editor,savedAt});
  write(DRAFT_KEY(w.id),{...clone(snapshot),rev,savedAt,status:'draft',version:w.version,publishedAt:w.publishedAt});
  set({pending:null,toast:'草稿已保存并通过检查'});
  patchCurrent(x=>({...x,status:'draft',updatedAt:savedAt,base:{rev,...clone(snapshot)},confirmed:{...clone(snapshot),savedAt}}));
 };

 /** 每次解决待处理项后重检：全部清空才允许固化；远端期间又前进则要求重新合并 */
 const tryConfirm=()=>{
  const p=get().pending;
  if(!p)return;
  const w=current();
  const issues=checkGraph(w.nodes,w.edges);
  const remaining=p.conflicts.length+p.held.length+issues.length;
  if(remaining){set({pending:{...p,issues},toast:`待处理区还有 ${remaining} 项未解决`});return}
  const server=readServer(w.id);
  if((server?.rev??0)!==p.remoteRev){set({pending:null,toast:'远端又有新的更改，请重新保存以合并'});return}
  confirm(p.remoteRev);
 };

 return{workflows:initWorkflows(),instances,currentId:'wf-1',selectedNodeId:null,issues:[],pending:null,toast:'',
 setCurrent:id=>set({currentId:id,selectedNodeId:null,issues:[],pending:null}),
 selectNode:id=>set({selectedNodeId:id}),
 updateNodes:nodes=>patchCurrent(w=>({...w,nodes})),
 updateEdges:edges=>patchCurrent(w=>({...w,edges})),
 updateConfig:(id,config)=>patchCurrent(w=>({...w,nodes:w.nodes.map(n=>n.id===id?{...n,data:{...n.data,config:{...n.data.config,...config},state:'configuring'}}:n)})),
 runValidation:()=>{const w=current(); const issues=validate(w); set(s=>({issues,workflows:s.workflows.map(x=>x.id===w.id?{...x,nodes:x.nodes.map(n=>({...n,data:{...n.data,state:issues.some(i=>i.nodeId===n.id)?'invalid':'valid'}}))}:x),toast:issues.length?`发现 ${issues.length} 个问题`:'校验通过'}));return issues},

 save:()=>{
  const s=get();
  const w=current();
  if(s.pending){tryConfirm();return}
  const baseRev=w.base?.rev??0;
  const server=readServer(w.id);
  if(!server||server.rev===baseRev){
   // 无远端更改：本地草稿直接做结构检查，通过即固化
   const issues=checkGraph(w.nodes,w.edges);
   if(issues.length){set({pending:{conflicts:[],held:[],issues,remoteRev:baseRev,remoteEditor:'',mergedAt:now()},toast:`检查发现 ${issues.length} 个问题，已转入待处理区`});return}
   confirm(baseRev);
   return;
  }
  // 远端已前进：按对象三方合并（base=本端上次同步点）
  const base:Graph={nodes:w.base?.nodes??w.nodes,edges:w.base?.edges??w.edges};
  const merged=mergeGraph(base,{nodes:w.nodes,edges:w.edges},{nodes:server.nodes,edges:server.edges});
  const issues=checkGraph(merged.nodes,merged.edges);
  patchCurrent(x=>({...x,nodes:merged.nodes,edges:merged.edges}));
  const total=merged.conflicts.length+merged.held.length+issues.length;
  if(!total){confirm(server.rev);return}
  set({pending:{conflicts:merged.conflicts,held:merged.held,issues,remoteRev:server.rev,remoteEditor:server.editor,mergedAt:now()},toast:`已合并 ${server.editor||'远端'} 的更改：${total} 项进入待处理区`});
 },

 resolveConflict:(key,choice)=>{
  const s=get();
  const p=s.pending;
  const c=p?.conflicts.find(x=>x.key===key);
  if(!p||!c)return;
  const value=choice==='local'?c.localValue:c.remoteValue;
  patchCurrent(w=>({...w,
   nodes:c.objectType==='node'?w.nodes.map(n=>n.id===c.objectId?setField(clone(n),'node',c.field,clone(value)):n):w.nodes,
   edges:c.objectType==='edge'?w.edges.map(e=>e.id===c.objectId?setField(clone(e),'edge',c.field,clone(value)):e):w.edges}));
  set({pending:{...p,conflicts:p.conflicts.filter(x=>x.key!==key)}});
  tryConfirm();
 },

 resolveHold:(id,approve)=>{
  const s=get();
  const p=s.pending;
  const h=p?.held.find(x=>x.id===id);
  if(!p||!h)return;
  const w=current();
  if(approve&&h.objectType==='node'){
   const heldEdgeIds=new Set(p.held.filter(x=>x.objectType==='edge').map(x=>x.id));
   const refs=w.edges.filter(e=>(e.source===id||e.target===id)&&!heldEdgeIds.has(e.id));
   if(refs.length){set({toast:`「${h.label}」仍被 ${refs.length} 条连线引用，请先处理相关连线`});return}
  }
  if(approve){
   // 确认移除节点时，一并移除同样待确认的关联连线，避免悬空
   const cascade=h.objectType==='node'?p.held.filter(x=>x.objectType==='edge'&&w.edges.some(e=>e.id===x.id&&(e.source===id||e.target===id))).map(x=>x.id):[];
   const dropEdges=new Set(cascade);
   if(h.objectType==='edge')dropEdges.add(id);
   patchCurrent(x=>({...x,
    nodes:h.objectType==='node'?x.nodes.filter(n=>n.id!==id):x.nodes,
    edges:x.edges.filter(e=>!dropEdges.has(e.id))}));
   set({pending:{...p,held:p.held.filter(x=>x.id!==id&&!cascade.includes(x.id))}});
  }else set({pending:{...p,held:p.held.filter(x=>x.id!==id)}});
  tryConfirm();
 },

 /** 无后端环境下复现协作场景：以同事“陈默”的身份直接改远端草稿，下次保存触发合并 */
 simulatePeerEdit:()=>{
  const w=current();
  const server=readServer(w.id)??{nodes:clone(w.base?.nodes??w.nodes),edges:clone(w.base?.edges??w.edges),rev:w.base?.rev??0,editor:w.editor,savedAt:now()};
  const nodes=clone(server.nodes);
  let edges=clone(server.edges);
  const stamp=Date.now()%100000;
  const anchor=nodes.find(n=>n.type==='condition')??nodes.find(n=>n.type==='approval')??nodes[0];
  if(anchor){
   nodes.push({id:'peer-'+stamp,type:'notify',position:{x:anchor.position.x+220,y:anchor.position.y+170},data:{label:'超时提醒',state:'valid',config:{targets:'财务审批人',template:'超过 24 小时未处理自动提醒'}}});
   edges=[...edges,{id:'peer-e'+stamp,source:anchor.id,target:'peer-'+stamp,label:'超时'}];
  }
  const approval=nodes.find(n=>n.type==='approval');
  if(approval)approval.data.config={...approval.data.config,instruction:'请先核对预算归属，再提交审批。'};
  const automation=nodes.find(n=>n.type==='automation');
  if(automation){nodes.splice(nodes.indexOf(automation),1);edges=edges.filter(e=>e.source!==automation.id&&e.target!==automation.id)}
  const notify=nodes.find(n=>n.type==='notify'&&n.id!=='peer-'+stamp);
  if(notify){nodes.splice(nodes.indexOf(notify),1);edges=edges.filter(e=>e.target!==notify.id)}
  write(SERVER_KEY(w.id),{nodes,edges,rev:server.rev+1,editor:'陈默',savedAt:now()});
  set({toast:'同事陈默的离线更改已同步到远端，保存草稿时将触发合并'});
 },

 publish:()=>{
  const s=get();
  const w=current();
  if(s.pending){const n=s.pending.conflicts.length+s.pending.held.length+s.pending.issues.length;set({toast:`还有 ${n} 项合并事项待处理，不能发布`});return}
  const structural=checkGraph(w.nodes,w.edges);
  if(structural.length){set({toast:`草稿未通过检查：${structural[0].message} 等 ${structural.length} 项`});return}
  const configIssues=validate(w);
  if(configIssues.length){set({issues:configIssues,toast:`校验未通过：${configIssues.length} 个问题`});return}
  const version=w.version+1;
  const snapshot={nodes:clone(w.nodes),edges:clone(w.edges)};
  const savedAt=now();
  const rev=(w.base?.rev??0)+1;
  write(SERVER_KEY(w.id),{...clone(snapshot),rev,editor:w.editor,savedAt});
  write(DRAFT_KEY(w.id),{...clone(snapshot),rev,savedAt,status:'published',version,publishedAt:savedAt});
  set({toast:'流程发布成功'});
  patchCurrent(x=>({...x,status:'published',version,publishedAt:savedAt,updatedAt:savedAt,base:{rev,...clone(snapshot)},confirmed:{...clone(snapshot),savedAt},versions:[...x.versions,{version,createdAt:savedAt,note:'发布最新审批配置',...clone(snapshot)}]}));
 },

 create:()=>{const id='wf-'+Date.now();const empty={nodes:[],edges:[]};set(s=>({workflows:[{id,name:'未命名流程',domain:'财务',status:'draft',version:0,editor:'林秋',updatedAt:now(),abnormalCount:0,nodes:[],edges:[],versions:[],base:{rev:0,...empty},confirmed:{...empty,savedAt:now()}},...s.workflows],currentId:id,pending:null}));return id},
 copy:id=>set(s=>{const w=s.workflows.find(x=>x.id===id)!;return{workflows:[{...clone(w),id:'wf-'+Date.now(),name:w.name+'（副本）',status:'draft'},...s.workflows]}}),
 archive:id=>set(s=>({workflows:s.workflows.map(w=>w.id===id?{...w,status:'archived'}:w)})),
 restore:v=>{set(s=>({pending:null,workflows:s.workflows.map(w=>{if(w.id!==s.currentId)return w;const old=w.versions.find(x=>x.version===v)!;return{...w,status:'draft',nodes:clone(old.nodes),edges:clone(old.edges)}}),toast:`已恢复 v${v} 为草稿`}))},
 clearToast:()=>set({toast:''})};
});
