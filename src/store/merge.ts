import type {FieldConflict,FlowEdge,FlowNode,HeldRemoval,ValidationIssue} from '../types';

export interface Graph{nodes:FlowNode[];edges:FlowEdge[]}
export interface MergeResult extends Graph{conflicts:FieldConflict[];held:HeldRemoval[]}
type ObjectType='node'|'edge';

const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** 校验状态等瞬时标记不参与合并比较 */
const strip=(n:FlowNode)=>({...n,data:{...n.data,state:undefined}});

const CONFIG_LABELS:Record<string,string>={instruction:'审批说明',approverSource:'审批人来源',role:'审批角色',ruleType:'判断字段',operator:'运算符',value:'比较值',targets:'通知对象',template:'消息模板',timing:'提醒时机',action:'执行动作'};

/** 参与合并的字段：节点比较名称/位置/逐项配置，连线比较起终点和标签 */
const fieldsOf=(type:ObjectType,objs:any[]):string[]=>{
 if(type==='edge')return['source','target','label'];
 const config=new Set<string>();
 objs.forEach(o=>Object.keys(o?.data?.config??{}).forEach(k=>config.add(k)));
 return['label','position',...[...config].map(k=>'config.'+k)];
};

export const getField=(obj:any,type:ObjectType,key:string):any=>{
 if(type==='edge')return obj[key];
 if(key==='label')return obj.data.label;
 if(key==='position')return obj.position;
 return obj.data.config[key.slice(7)];
};

export const setField=<T,>(obj:T,type:ObjectType,key:string,value:any):T=>{
 const o=obj as any;
 if(type==='edge')o[key]=value;
 else if(key==='label')o.data.label=value;
 else if(key==='position')o.position=value;
 else o.data.config[key.slice(7)]=value;
 return obj;
};

export const fieldLabel=(type:ObjectType,key:string):string=>{
 if(type==='edge')return({source:'起点',target:'终点',label:'连线标签'}as Record<string,string>)[key]??key;
 if(key==='label')return'节点名称';
 if(key==='position')return'节点位置';
 return`配置项「${CONFIG_LABELS[key.slice(7)]??key.slice(7)}」`;
};

/** 单对象三方合并：仅一方修改的字段自动合并，双方改出不同值的字段列为冲突（画布上先保留本地值） */
const mergeObject=<T extends{id:string}>(type:ObjectType,base:T|undefined,local:T,remote:T,objectLabel:string):{merged:T;conflicts:FieldConflict[]}=>{
 const merged=clone(local);
 const conflicts:FieldConflict[]=[];
 for(const field of fieldsOf(type,[base,local,remote])){
  const b=base?getField(base,type,field):undefined;
  const l=getField(local,type,field);
  const r=getField(remote,type,field);
  if(eq(l,r)){setField(merged,type,field,l);continue}
  if(base&&eq(l,b)){setField(merged,type,field,r);continue}
  if(base&&eq(r,b)){setField(merged,type,field,l);continue}
  conflicts.push({key:`${type}:${local.id}:${field}`,objectId:local.id,objectType:type,objectLabel,field,fieldLabel:fieldLabel(type,field),localValue:l,remoteValue:r});
  setField(merged,type,field,l);
 }
 return{merged,conflicts};
};

/**
 * 按对象三方合并流程图。
 * - 各自新增的节点/连线都保留进合并结果；
 * - 单方移除的对象不直接删除，先停进待确认列表（对象保留在合并结果中）；
 * - 被其他连线引用的待移除节点会在 reason 中标注，确认前需先处理引用。
 */
export const mergeGraph=(base:Graph,local:Graph,remote:Graph):MergeResult=>{
 const conflicts:FieldConflict[]=[];
 const held:HeldRemoval[]=[];
 const nodes:FlowNode[]=[];
 const edges:FlowEdge[]=[];
 const byId=<T extends{id:string}>(list:T[])=>new Map(list.map(x=>[x.id,x]));
 const idsOf=<T extends{id:string}>(...lists:T[][])=>[...new Set(lists.flat().map(x=>x.id))];

 const bN=byId(base.nodes),lN=byId(local.nodes),rN=byId(remote.nodes);
 for(const id of idsOf(base.nodes,local.nodes,remote.nodes)){
  const b=bN.get(id),l=lN.get(id),r=rN.get(id);
  if(b&&!l&&!r)continue;
  if(!b&&l&&!r){nodes.push(clone(l));continue}
  if(!b&&!l&&r){nodes.push(clone(r));continue}
  if(!b&&l&&r){const m=mergeObject('node',undefined,l,r,l.data.label);nodes.push(m.merged);conflicts.push(...m.conflicts);continue}
  if(b&&l&&!r){
   held.push({id,objectType:'node',label:l.data.label,reason:eq(strip(l),strip(b))?'对方在离线期间移除了该节点':'对方移除了该节点，但你在本地修改过它'});
   nodes.push(clone(l));continue;
  }
  if(b&&!l&&r){
   held.push({id,objectType:'node',label:r.data.label,reason:eq(strip(r),strip(b))?'你在本地移除了该节点':'你在本地移除了该节点，但对方修改过它'});
   nodes.push(clone(r));continue;
  }
  const m=mergeObject('node',b!,l!,r!,l!.data.label);
  nodes.push(m.merged);conflicts.push(...m.conflicts);
 }

 const bE=byId(base.edges),lE=byId(local.edges),rE=byId(remote.edges);
 const edgeLabel=(e:FlowEdge)=>e.label||`${e.source} → ${e.target}`;
 for(const id of idsOf(base.edges,local.edges,remote.edges)){
  const b=bE.get(id),l=lE.get(id),r=rE.get(id);
  if(b&&!l&&!r)continue;
  if(!b&&l&&!r){edges.push(clone(l));continue}
  if(!b&&!l&&r){edges.push(clone(r));continue}
  if(!b&&l&&r){const m=mergeObject('edge',undefined,l,r,edgeLabel(l));edges.push(m.merged);conflicts.push(...m.conflicts);continue}
  if(b&&l&&!r){held.push({id,objectType:'edge',label:edgeLabel(l),reason:'对方在离线期间移除了该连线'});edges.push(clone(l));continue}
  if(b&&!l&&r){held.push({id,objectType:'edge',label:edgeLabel(r),reason:'你在本地移除了该连线'});edges.push(clone(r));continue}
  const m=mergeObject('edge',b!,l!,r!,edgeLabel(l!));
  edges.push(m.merged);conflicts.push(...m.conflicts);
 }

 const heldEdgeIds=new Set(held.filter(h=>h.objectType==='edge').map(h=>h.id));
 held.filter(h=>h.objectType==='node').forEach(h=>{
  const refs=edges.filter(e=>(e.source===h.id||e.target===h.id)&&!heldEdgeIds.has(e.id));
  if(refs.length)h.reason+=`；仍被 ${refs.length} 条连线引用`;
 });
 return{nodes,edges,conflicts,held};
};

/** 合并后的结构检查：缺少开始/结束节点、孤立节点、重复连线、悬空连线 */
export const checkGraph=(nodes:FlowNode[],edges:FlowEdge[]):ValidationIssue[]=>{
 const issues:ValidationIssue[]=[];
 if(!nodes.some(n=>n.type==='start'))issues.push({nodeId:'flow',level:'error',message:'缺少开始节点'});
 if(!nodes.some(n=>n.type==='end'))issues.push({nodeId:'flow',level:'error',message:'缺少结束节点'});
 const ids=new Set(nodes.map(n=>n.id));
 const linked=new Set<string>();
 const pairs=new Map<string,FlowEdge[]>();
 for(const e of edges){
  linked.add(e.source);linked.add(e.target);
  const k=`${e.source} → ${e.target}`;
  pairs.set(k,[...pairs.get(k)??[],e]);
  if(!ids.has(e.source)||!ids.has(e.target))issues.push({nodeId:e.id,level:'error',message:`连线「${e.label||k}」指向不存在的节点`});
 }
 nodes.filter(n=>!linked.has(n.id)).forEach(n=>issues.push({nodeId:n.id,level:'error',message:`孤立节点「${n.data.label}」没有任何连线`}));
 pairs.forEach((list,k)=>{if(list.length>1)issues.push({nodeId:list[1].id,level:'error',message:`重复连线：${k} 共 ${list.length} 条`})});
 return issues;
};

/** 忽略校验状态等瞬时标记，比较两张图是否有实质差异 */
export const graphChanged=(a:Graph,b:Graph):boolean=>{
 const stripGraph=(g:Graph)=>({nodes:g.nodes.map(strip),edges:g.edges});
 return JSON.stringify(stripGraph(a))!==JSON.stringify(stripGraph(b));
};
