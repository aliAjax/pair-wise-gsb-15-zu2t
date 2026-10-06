import {useMemo, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, Lock, Paperclip, RotateCcw} from 'lucide-react';
import {useAppStore} from '../store/useAppStore';
import {inspectGraph} from '../store/validate';

const STRUCTURAL = new Set(['missing-start', 'missing-end', 'orphan', 'duplicate-edge', 'dangling-edge']);

export function Preview(){
  const nav=useNavigate(),{id}=useParams();
  const store=useAppStore();
  const w=store.workflows.find(x=>x.id===id);
  const collab=id?store.collab[id]:undefined;

  /** 发布与预览只读取“通过检查”的结果：未确认合并或结构问题一律挡住 */
  const blockers=useMemo(()=>{
    if(!w)return ['流程不存在'];
    const list:string[]=[];
    if(collab?.phase==='pending')list.push('存在未完成的回连合并（冲突 / 移除 / 结构问题待确认）');
    if(collab?.phase==='offline')list.push('当前处于离线编辑状态，请先回连合并');
    inspectGraph({nodes:w.nodes,edges:w.edges})
      .filter(i=>STRUCTURAL.has(i.code!))
      .forEach(i=>list.push(i.message));
    return list;
  },[w,collab]);

  if(!w)return <div className="preview-page"><div className="preview-gate"><Lock/><h2>无法预览</h2><p>找不到该流程。</p><button onClick={()=>nav('/workflows')}>返回流程列表</button></div></div>;

  if(blockers.length)return <div className="preview-page">
    <header className="preview-header">
      <button className="icon-btn" onClick={()=>nav(`/workflows/${id}`)}><ArrowLeft/></button>
      <div><b>表单预览</b><small>{w.name}</small></div>
    </header>
    <div className="preview-gate" data-testid="preview-gate">
      <Lock/><h2>预览已暂停</h2>
      <p>当前草稿未通过合并与结构检查，预览只读取通过检查的结果：</p>
      <ul>{blockers.map((b,i)=><li key={i}>· {b}</li>)}</ul>
      <button onClick={()=>nav(`/workflows/${id}`)} data-testid="preview-back-edit">返回编辑器处理</button>
    </div>
  </div>;

  return <PreviewBody id={id!} />;
}

function PreviewBody({id}:{id:string}){
  const nav=useNavigate();
  const w=useAppStore(s=>s.workflows.find(x=>x.id===id))!;
  const form=w.nodes.find(n=>n.type==='form'),condition=w.nodes.find(n=>n.type==='condition');
  const [values,setValues]=useState<Record<string,string>>({});
  const amount=Number(values.amount||0),threshold=Number(condition?.data.config.value||5000);
  const branch=amount>threshold?'高额分支：通知财务审批人':'标准分支：写入系统记录';
  const [submitted,setSubmitted]=useState(false);
  return <div className="preview-page">
    <header className="preview-header">
      <button className="icon-btn" onClick={()=>nav(`/workflows/${id}`)}><ArrowLeft/></button>
      <div><b>表单预览</b><small>{w.name} · 实时分支模拟</small></div>
      <span className="spacer"/>
      <button className="secondary" onClick={()=>setValues({})}><RotateCcw/>重置</button>
      <button onClick={()=>setSubmitted(true)}>模拟提交</button>
    </header>
    <div className="preview-stage">
      <section className="form-preview">
        <div className="form-cover"><small>{w.domain} / 申请表单</small><h1>{form?.data.label||'业务申请'}</h1><p>请完整填写以下信息，带 * 的字段为必填项。</p></div>
        <div className="form-body">{(form?.data.config.fields||[]).map((f:any)=>
          <label key={f.id}>{f.label}{f.required&&<em>*</em>}
            {f.type==='attachment'
              ?<div className="upload"><Paperclip/><b>拖入文件或点击上传</b><small>支持 PDF、DOCX、PNG，单个文件不超过 20MB</small></div>
              :f.type==='text'
                ?<textarea aria-label={f.label} value={values[f.id]||''} onChange={e=>setValues({...values,[f.id]:e.target.value})} rows={5} placeholder="请输入详细说明（最多 2,000 字）"/>
                :<div className={f.type==='amount'?'money-input':''}>{f.type==='amount'&&<span>¥</span>}<input aria-label={f.label} type={f.type==='amount'||f.type==='number'?'number':f.type==='date'?'date':'text'} value={values[f.id]||''} onChange={e=>setValues({...values,[f.id]:e.target.value})} placeholder={f.type==='amount'?'0.00':'请输入'}/></div>}
            {submitted&&f.required&&!values[f.id]&&<small className="field-error">此字段为必填项</small>}
          </label>)}
        </div>
      </section>
      <aside className="simulation">
        <h3>条件分支模拟</h3><p>表单字段变化会实时计算流程走向。</p>
        <div className="sim-rule"><small>当前规则</small><b>申请金额 &gt; ¥{threshold.toLocaleString()}</b></div>
        <div className={'sim-result '+(amount>threshold?'high':'normal')} data-testid="branch-result"><small>模拟结果</small><b>{branch}</b><p>当前输入：¥{amount.toLocaleString(undefined,{minimumFractionDigits:2})}</p></div>
        <div className="sim-path"><span className="done">提交申请</span><i>↓</i><span className="done">直属主管审批</span><i>↓</i><span className="active">{amount>threshold?'高额通知':'记录系统'}</span></div>
      </aside>
    </div>
  </div>;
}
