export type WorkflowStatus='draft'|'published'|'archived';
export type NodeKind='start'|'form'|'approval'|'condition'|'automation'|'notify'|'end';
export type NodeState='unconfigured'|'configuring'|'valid'|'invalid';
export interface FormField {id:string;label:string;type:'text'|'number'|'amount'|'date'|'select'|'attachment';required:boolean;options?:string[]}
export interface FlowNode {id:string;type:NodeKind;position:{x:number;y:number};data:{label:string;state:NodeState;config:Record<string,any>}}
export interface FlowEdge {id:string;source:string;target:string;label?:string}
export interface Version {version:number;createdAt:string;note:string;nodes:FlowNode[];edges:FlowEdge[]}
export interface Workflow {id:string;name:string;domain:string;status:WorkflowStatus;version:number;editor:string;updatedAt:string;publishedAt?:string;abnormalCount:number;nodes:FlowNode[];edges:FlowEdge[];versions:Version[]}
export interface Instance {id:string;workflowId:string;applicant:string;domain:string;currentNode:string;status:'abnormal'|'timeout'|'running'|'completed';submittedAt:string;duration:string;risk:'high'|'medium'|'low';timeline:{title:string;time:string;status:string}[]}

export type IssueFix='remove'|'add-start'|'add-end';
export type IssueCode=
  |'missing-start'|'missing-end'|'orphan'|'duplicate-edge'|'dangling-edge'
  |'condition-unconfigured'|'approver-empty';
export interface ValidationIssue {nodeId:string;level:'error'|'warning';message:string;code?:IssueCode;fix?:IssueFix}

/** 画布上的一组节点与连线，合并、校验、持久化都以它为单位 */
export interface Graph {nodes:FlowNode[];edges:FlowEdge[]}

/** 同一对象同一字段两边都改且不一致 */
export interface MergeConflict {
  id:string;
  kind:'node'|'edge';
  label:string;
  field:string;
  baseValue:string;
  localValue:string;
  remoteValue:string;
  baseRaw?:unknown;
  localRaw:unknown;
  remoteRaw:unknown;
  resolution?:'local'|'remote';
}

/** 一方移除的对象先停在待处理区，等待“确认移除 / 保留” */
export interface HeldDeletion {
  id:string;
  kind:'node'|'edge';
  label:string;
  by:('local'|'remote')[];
  note:string;
  decision?:'delete'|'keep';
}

export interface CollabState {
  workflowId:string;
  phase:'offline'|'pending';
  base:Graph;
  remote:Graph;
  remoteOps:string[];
  merged:Graph;
  conflicts:MergeConflict[];
  held:HeldDeletion[];
  issues:ValidationIssue[];
}
