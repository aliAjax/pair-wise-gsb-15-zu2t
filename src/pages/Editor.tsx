import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, ChevronDown, Eye, FileClock, GitMerge, Play, Plus,
  Save, Send, ShieldAlert, Trash2, WifiOff, XCircle,
} from 'lucide-react';
import {FlowCanvas} from '../components/FlowCanvas';
import {useAppStore} from '../store/useAppStore';
import type {FlowNode, NodeKind} from '../types';

const palette:[NodeKind,string,string][]=[
  ['start','开始','流程入口'],
  ['form','表单填写','收集业务数据'],
  ['approval','审批','人工审批任务'],
  ['condition','条件分支','按规则分流'],
  ['automation','自动化','执行本地动作'],
  ['notify','通知','发送站内通知'],
  ['end','结束','流程终点'],
];

const FIELD_NAMES: Record<string, string> = {
  'data.label': '节点名称',
  'position': '节点位置',
  'data.config': '节点配置',
  'label': '连线标签',
};

const noop = () => {};

export function Editor(){
  const {id}=useParams(), nav=useNavigate();
  const store=useAppStore();
  const w=store.workflows.find(x=>x.id===store.currentId)||store.workflows[0];
  const collab=store.collab[w.id];
  const pending=collab?.phase==='pending';
  const offline=collab?.phase==='offline';
  const selected=w.nodes.find(n=>n.id===store.selectedNodeId);

  useEffect(()=>{if(id&&id!==store.currentId)store.setCurrent(id)},[id]);

  const add=(type:NodeKind)=>{
    if(pending)return;
    const node:FlowNode={
      id:type+'-'+Date.now(),type,
      position:{x:350+Math.random()*200,y:200+Math.random()*150},
      data:{label:palette.find(x=>x[0]===type)![1],state:'unconfigured',config:{}},
    };
    store.updateNodes([...w.nodes,node]);
  };

  const publish=()=>{
    const issues=store.runValidation();
    if(!issues.length)store.publish();
  };

  const goPreview=()=>{
    if(collab){store.clearToast(); return;}
    nav(`/workflows/${w.id}/preview`);
  };

  const nodes=pending?collab!.merged.nodes:w.nodes;
  const edges=pending?collab!.merged.edges:w.edges;

  return <div className="editor-page">
    <div className="editor-top">
      <button className="icon-btn" onClick={()=>nav('/workflows')}><ArrowLeft/></button>
      <div className="editor-title"><small>流程管理 / {w.domain}</small><b>{w.name}</b></div>
      <span className="draft-indicator">{w.status==='draft'?'● 草稿':'✓ 已发布'} · v{w.version}</span>
      <div className="editor-actions">
        {!collab&&<button className="secondary" data-testid="offline-button" onClick={store.startOffline}><WifiOff/>模拟离线协作</button>}
        <button className="secondary" onClick={store.save} disabled={pending}><Save/>保存草稿</button>
        <button className="secondary" data-testid="validate-button" onClick={store.runValidation} disabled={pending}><Play/>运行校验</button>
        <button className="secondary" data-testid="preview-button" onClick={goPreview} disabled={!!collab}><Eye/>预览</button>
        <button className="secondary" onClick={()=>nav(`/workflows/${w.id}/versions`)} disabled={pending}><FileClock/>版本历史</button>
        <button data-testid="publish-button" onClick={publish} disabled={!!collab}><Send/>发布</button>
      </div>
    </div>

    {offline&&<OfflineBar/>}
    {pending&&<div className="merge-banner" data-testid="merge-banner">
      <GitMerge/><b>回连合并待处理</b>
      <span>画布展示的是按对象合并的结果；处理完冲突、移除项与结构问题后才能接受。</span>
    </div>}

    <div className="editor-body">
      <aside className="node-library">
        <div className="pane-title"><b>节点组件</b><small>{pending?'合并处理中，暂不可添加':'点击添加到画布'}</small></div>
        <div className="node-search">搜索节点组件</div>
        <h4>基础节点</h4>
        {palette.map(([type,label,desc])=>
          <button key={type} className={'palette '+type} disabled={pending} onClick={()=>add(type)}>
            <span>+</span><div><b>{label}</b><small>{desc}</small></div>
          </button>)}
        <div className="library-tip"><b>使用提示</b><p>拖动节点调整布局，从端点连接下一步骤。</p></div>
      </aside>

      <section className="editor-center">
        <div className="canvas-bar"><span>{pending?'合并结果预览':'主流程'}</span><span className="spacer"/><button className="icon-btn">−</button><small>100%</small><button className="icon-btn">＋</button></div>
        {nodes.length
          ?<FlowCanvas nodes={nodes} edges={edges} readonly={pending}
             onNodes={pending?noop:store.updateNodes}
             onEdges={pending?noop:store.updateEdges}
             onSelect={store.selectNode}/>
          :<div className="blank-flow"><div>⌘</div><b>从一个开始节点构建流程</b><p>在左侧点击节点组件，将它添加到画布。</p><button onClick={()=>add('start')}><Plus/>添加开始节点</button></div>}
      </section>

      {pending
        ?<MergePanel/>
        :<ConfigPanel node={selected} update={store.updateConfig}/>}
    </div>

    {pending?null:<section className="issues" data-testid="issues-panel">
      <div className="issues-head"><b>问题面板</b><span className="error-count" data-testid="error-count">{store.issues.filter(i=>i.level==='error').length} 错误</span><span>{store.issues.filter(i=>i.level==='warning').length} 警告</span><span className="spacer"/><small>上次校验：刚刚</small><ChevronDown/></div>
      {store.issues.length>0&&<div className="issue-list">{store.issues.map((i,k)=>
        <button key={i.nodeId+'-'+k} onClick={()=>store.selectNode(i.nodeId)}>
          <XCircle/><b>{i.message}</b><small>节点：{w.nodes.find(n=>n.id===i.nodeId)?.data.label||'流程'}</small><span>定位 →</span>
        </button>)}</div>}
    </section>}
  </div>;
}

function OfflineBar(){
  const store=useAppStore();
  const w=store.workflows.find(x=>x.id===store.currentId)!;
  const c=store.collab[w.id]!;
  const selected=w.nodes.find(n=>n.id===store.selectedNodeId);
  return <div className="offline-bar" data-testid="offline-bar">
    <WifiOff/><b>离线编辑中</b>
    <span>本地改动会自动保存；右侧可模拟协作者陈默的改动，回连后按对象合并。</span>
    <span className="spacer"/>
    <button className="secondary mini" data-testid="remote-add-node" onClick={()=>store.remoteAddNode('approval')}>协作者：新增审批节点</button>
    <button className="secondary mini" data-testid="remote-edit-selected" disabled={!selected}
      onClick={()=>store.remoteUpdateSelected(selected?.type==='approval'?{approverSource:'指定成员',instruction:'陈默：请改走会签'}:{instruction:'陈默的修改'})}>
      协作者：修改选中节点
    </button>
    <button className="secondary mini" data-testid="remote-delete-selected" disabled={!selected} onClick={store.remoteDeleteSelected}>协作者：删除选中节点</button>
    <button data-testid="reconnect-button" onClick={store.reconnect}><GitMerge/>回连合并</button>
    {c.remoteOps.length>0&&<div className="remote-ops" data-testid="remote-ops">
      <b>协作者改动（{c.remoteOps.length}）</b>
      {c.remoteOps.map((op,i)=><span key={i}>· {op}</span>)}
    </div>}
  </div>;
}

function MergePanel(){
  const store=useAppStore();
  const w=store.workflows.find(x=>x.id===store.currentId)!;
  const c=store.collab[w.id]!;
  const unresolved=c.conflicts.filter(x=>!x.resolution).length;
  const undecided=c.held.filter(x=>!x.decision).length;
  const blocking=c.issues.filter(i=>i.level==='error').length;
  const ready=unresolved===0&&undecided===0&&blocking===0;
  return <aside className="config-panel merge-panel" data-testid="merge-panel">
    <div className="config-head">
      <div><small>MERGE REVIEW</small><h3>合并待处理区</h3></div>
      <ShieldAlert className={ready?'ok':'warn'}/>
    </div>

    <section className="merge-section">
      <h4>字段冲突 <em data-testid="conflict-count">{c.conflicts.length}</em></h4>
      {c.conflicts.length===0&&<p className="merge-empty">双方没有修改同一字段。</p>}
      {c.conflicts.map((cf,i)=>
        <div key={i} className={'merge-item conflict '+(cf.resolution?'resolved':'')} data-testid={'conflict-'+i}>
          <div className="merge-item-head"><b>{cf.label}</b><small>{FIELD_NAMES[cf.field]||cf.field}</small></div>
          <div className="conflict-values">
            <label className={cf.resolution==='local'?'picked':''}>
              <input type="radio" data-testid={'conflict-local-'+i} checked={cf.resolution==='local'}
                onChange={()=>store.resolveConflict(i,'local')}/>
              <span><small>本地</small>{cf.localValue}</span>
            </label>
            <label className={cf.resolution==='remote'?'picked':''}>
              <input type="radio" data-testid={'conflict-remote-'+i} checked={cf.resolution==='remote'}
                onChange={()=>store.resolveConflict(i,'remote')}/>
              <span><small>协作者</small>{cf.remoteValue}</span>
            </label>
          </div>
          {cf.resolution&&<small className="resolved-hint">已选择{cf.resolution==='local'?'本地':'协作者'}版本</small>}
        </div>)}
    </section>

    <section className="merge-section">
      <h4>被移除的对象 <em data-testid="held-count">{c.held.length}</em></h4>
      {c.held.length===0&&<p className="merge-empty">没有待确认的移除。</p>}
      {c.held.map((h,i)=>
        <div key={h.kind+'-'+h.id+'-'+i} className={'merge-item held '+(h.decision?'resolved':'')} data-testid={'held-'+i}>
          <div className="merge-item-head"><b>{h.label}</b><small>{h.kind==='node'?'节点':'连线'}</small></div>
          <p>{h.note}</p>
          <div className="merge-actions">
            <button className="secondary mini" data-testid={'held-delete-'+i} disabled={!!h.decision} onClick={()=>store.decideHeld(i,'delete')}>确认移除</button>
            <button className="secondary mini" data-testid={'held-keep-'+i} disabled={!!h.decision} onClick={()=>store.decideHeld(i,'keep')}>保留</button>
            {h.decision&&<small className="resolved-hint">{h.decision==='delete'?'将移除':'将保留'}</small>}
          </div>
        </div>)}
    </section>

    <section className="merge-section">
      <h4>结构检查 <em className={blocking?'bad':''} data-testid="structure-count">{c.issues.length}</em></h4>
      {c.issues.length===0&&<p className="merge-empty ok-line"><CheckCircle2/>无孤立节点、重复连线，开始/结束节点齐全。</p>}
      {c.issues.map((iss,i)=>
        <div key={iss.code+'-'+iss.nodeId+'-'+i} className="merge-item issue" data-testid={'structure-issue-'+i}>
          <XCircle className="bad"/><b>{iss.message}</b>
          <button className="secondary mini" data-testid={'fix-issue-'+i} onClick={()=>store.fixMergeIssue(i)}>
            {iss.code==='orphan'?'自动接入 / 移除':iss.code==='missing-start'?'补开始节点':iss.code==='missing-end'?'补结束节点':'自动清理'}
          </button>
        </div>)}
    </section>

    <div className="config-footer merge-footer">
      <button className="secondary" data-testid="cancel-merge" onClick={store.cancelMerge}>放弃合并</button>
      <button data-testid="accept-merge" disabled={!ready} onClick={store.acceptMerge}>
        <CheckCircle2/>接受合并{ready?'':`（${unresolved+undecided+blocking} 项待处理）`}
      </button>
    </div>
  </aside>;
}

function ConfigPanel({node,update}:{node?:FlowNode;update:(id:string,c:Record<string,any>)=>void}){
  const [saved,setSaved]=useState(false);
  if(!node)return <aside className="config-panel empty-config"><div>◫</div><b>选择一个节点</b><p>在画布中选择节点以查看和编辑配置。</p></aside>;
  const c=node.data.config, set=(v:Record<string,any>)=>{update(node.id,v);setSaved(false)};
  return <aside className="config-panel" data-testid="config-panel">
    <div className="config-head"><div><small>{node.type.toUpperCase()} NODE</small><h3>{node.data.label}</h3></div><button className="icon-btn"><Trash2/></button></div>
    <label>节点名称<input value={node.data.label} readOnly/></label>
    {node.type==='approval'&&<><h4>审批配置</h4>
      <label>审批人来源<select aria-label="审批人来源" value={c.approverSource||''} onChange={e=>set({approverSource:e.target.value})}><option value="">请选择审批人来源</option><option>直属主管</option><option>固定角色</option><option>指定成员</option><option>表单字段</option></select></label>
      {c.approverSource==='固定角色'&&<label>审批角色<select onChange={e=>set({role:e.target.value})}><option>财务审批人</option><option>部门负责人</option><option>法务经理</option></select></label>}
      <label>审批说明<textarea rows={5} value={c.instruction||''} onChange={e=>set({instruction:e.target.value})} placeholder="输入审批说明"/></label>
    </>}
    {node.type==='condition'&&<><h4>分支规则</h4>
      <label>判断字段<select aria-label="条件字段" value={c.ruleType||''} onChange={e=>set({ruleType:e.target.value})}><option value="">请选择字段</option><option value="amount">申请金额</option><option value="department">部门</option><option value="attachment">附件</option></select></label>
      <div className="form-row"><label>运算符<select value={c.operator||'>'} onChange={e=>set({operator:e.target.value})}><option>&gt;</option><option>=</option><option>为空</option></select></label><label>比较值<input aria-label="条件比较值" type="number" value={c.value||''} onChange={e=>set({value:Number(e.target.value)})}/></label></div>
      <div className="branch-card"><b>分支 1</b><span>满足规则</span></div>
      <div className="branch-card"><b>分支 2</b><span>其他情况</span></div>
    </>}
    {node.type==='form'&&<><h4>表单字段</h4>{(c.fields||[]).map((f:any)=><div key={f.id} className="field-chip"><b>{f.label}</b><small>{f.type} · {f.required?'必填':'选填'}</small></div>)}</>}
    {node.type==='automation'&&<><h4>本地动作</h4><label>执行动作<select value={c.action||''} onChange={e=>set({action:e.target.value})}><option>创建工单</option><option>发送 Webhook（模拟）</option><option>写入系统记录</option></select></label></>}
    {node.type==='notify'&&<><h4>通知设置</h4><label>通知对象<input value={c.targets||''} onChange={e=>set({targets:e.target.value})}/></label><label>消息模板<textarea value={c.template||''} onChange={e=>set({template:e.target.value})}/></label></>}
    <div className="config-footer"><span>{saved?<><CheckCircle2/>配置已保存</>:'尚有未保存更改'}</span><button data-testid="save-node-config" onClick={()=>setSaved(true)}>保存配置</button></div>
  </aside>;
}
