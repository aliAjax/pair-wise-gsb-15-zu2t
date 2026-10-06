export type WorkflowStatus='draft'|'published'|'archived';
export type NodeKind='start'|'form'|'approval'|'condition'|'automation'|'notify'|'end';
export type NodeState='unconfigured'|'configuring'|'valid'|'invalid';
export interface FormField {id:string;label:string;type:'text'|'number'|'amount'|'date'|'select'|'attachment';required:boolean;options?:string[]}
export interface FlowNode {id:string;type:NodeKind;position:{x:number;y:number};data:{label:string;state:NodeState;config:Record<string,any>}}
export interface FlowEdge {id:string;source:string;target:string;label?:string}
export interface Version {version:number;createdAt:string;note:string;nodes:FlowNode[];edges:FlowEdge[]}
export interface DraftBase {rev:number;nodes:FlowNode[];edges:FlowEdge[]}
export interface ConfirmedDraft {nodes:FlowNode[];edges:FlowEdge[];savedAt:string}
export interface Workflow {id:string;name:string;domain:string;status:WorkflowStatus;version:number;editor:string;updatedAt:string;publishedAt?:string;abnormalCount:number;nodes:FlowNode[];edges:FlowEdge[];versions:Version[];base?:DraftBase;confirmed?:ConfirmedDraft}
export interface FieldConflict {key:string;objectId:string;objectType:'node'|'edge';objectLabel:string;field:string;fieldLabel:string;localValue:any;remoteValue:any}
export interface HeldRemoval {id:string;objectType:'node'|'edge';label:string;reason:string}
export interface PendingMerge {conflicts:FieldConflict[];held:HeldRemoval[];issues:ValidationIssue[];remoteRev:number;remoteEditor:string;mergedAt:string}
export interface Instance {id:string;workflowId:string;applicant:string;domain:string;currentNode:string;status:'abnormal'|'timeout'|'running'|'completed';submittedAt:string;duration:string;risk:'high'|'medium'|'low';timeline:{title:string;time:string;status:string}[]}
export interface ValidationIssue {nodeId:string;level:'error'|'warning';message:string}
