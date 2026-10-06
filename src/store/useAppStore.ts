import {create} from 'zustand';
import {workflows as seed} from '../../mock-data/workflows';
import {instances} from '../../mock-data/instances';
import type {
  CollabState, FlowEdge, FlowNode, Graph, NodeKind, ValidationIssue, Workflow,
} from '../types';
import {clone, edgeLabel, mergeGraphs, nodeLabel} from './merge';
import {dedupeEdges, hasErrors, inspectGraph, removeDangling, removeNode} from './validate';
import {loadCurrentId, loadWorkflows, saveCurrentId, saveWorkflows} from './persistence';

/** 合并待处理区里阻断“接受合并”的检查项（结构类） */
const STRUCTURAL = new Set(['missing-start', 'missing-end', 'orphan', 'duplicate-edge', 'dangling-edge']);
const structuralIssues = (g: Graph): ValidationIssue[] =>
  inspectGraph(g).filter(i => i.code && STRUCTURAL.has(i.code));

export interface State {
  workflows: Workflow[];
  instances: typeof instances;
  currentId: string;
  selectedNodeId: string | null;
  issues: ValidationIssue[];
  toast: string;
  /** 会话内协作状态，不落 localStorage；键为 workflowId */
  collab: Record<string, CollabState>;

  setCurrent: (id: string) => void;
  selectNode: (id: string | null) => void;
  updateNodes: (nodes: FlowNode[]) => void;
  updateEdges: (edges: FlowEdge[]) => void;
  updateConfig: (id: string, config: Record<string, any>) => void;
  runValidation: () => ValidationIssue[];
  save: () => void;
  publish: () => void;
  create: () => string;
  copy: (id: string) => void;
  archive: (id: string) => void;
  restore: (v: number) => void;
  clearToast: () => void;

  startOffline: () => void;
  remoteAddNode: (kind: NodeKind, fromId?: string) => void;
  remoteUpdateSelected: (patch: Record<string, any>) => void;
  remoteDeleteSelected: () => void;
  remoteAddEdge: (source: string, target: string, label?: string) => void;
  reconnect: () => void;
  resolveConflict: (index: number, side: 'local' | 'remote') => void;
  decideHeld: (index: number, decision: 'delete' | 'keep') => void;
  fixMergeIssue: (index: number) => void;
  acceptMerge: () => void;
  cancelMerge: () => void;
}

const initialWorkflows = loadWorkflows(seed);
const initialId = loadCurrentId();

export const useAppStore = create<State>((set, get) => {
  /** 把当前流程列表落盘（只保存完整草稿/已发布数据） */
  const persist = () => saveWorkflows(get().workflows);
  const current = (): Workflow =>
    get().workflows.find(w => w.id === get().currentId) || get().workflows[0];
  const graphOf = (w: Workflow): Graph => ({nodes: w.nodes, edges: w.edges});
  const blockedToast = () => set({toast: '请先在待处理区完成合并，才能继续编辑'});

  /** 重新执行结构检查并回写协作会话 */
  const recheck = (id: string, patch: Partial<CollabState>) => {
    set((s: State) => {
      const c = s.collab[id];
      if (!c || c.phase !== 'pending') return {};
      const merged = patch.merged || c.merged;
      const next = {...c, ...patch, merged, issues: structuralIssues(merged)};
      return {collab: {...s.collab, [id]: next}};
    });
  };

  const stamp = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return {
    workflows: initialWorkflows,
    instances,
    currentId: initialId && initialWorkflows.some(w => w.id === initialId) ? initialId : 'wf-1',
    selectedNodeId: null,
    issues: [],
    toast: '',
    collab: {},

    setCurrent: id => {
      saveCurrentId(id);
      set({currentId: id, selectedNodeId: null, issues: []});
    },
    selectNode: id => set({selectedNodeId: id}),

    updateNodes: nodes => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') return blockedToast();
      set((s: State) => ({
        workflows: s.workflows.map(w => w.id === s.currentId ? {...w, nodes} : w),
      }));
      persist();
    },
    updateEdges: edges => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') return blockedToast();
      set((s: State) => ({
        workflows: s.workflows.map(w => w.id === s.currentId ? {...w, edges} : w),
      }));
      persist();
    },
    updateConfig: (id, config) => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') return blockedToast();
      set((s: State) => ({
        workflows: s.workflows.map(w => w.id === s.currentId
          ? {...w, nodes: w.nodes.map(n => n.id === id
            ? {...n, data: {...n.data, config: {...n.data.config, ...config}, state: 'configuring'}}
            : n)}
          : w),
      }));
      persist();
    },

    runValidation: () => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') { blockedToast(); return []; }
      const w = current();
      const issues = inspectGraph(graphOf(w));
      set((s: State) => ({
        issues,
        workflows: s.workflows.map(x => x.id === w.id
          ? {...x, nodes: x.nodes.map(n => ({...n, data: {...n.data, state: issues.some(i => i.nodeId === n.id) ? 'invalid' : 'valid'}}))}
          : x),
        toast: issues.length ? `发现 ${issues.length} 个问题` : '校验通过',
      }));
      return issues;
    },

    save: () => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') return blockedToast();
      set((s: State) => ({
        workflows: s.workflows.map(w => w.id === s.currentId
          ? {...w, status: 'draft', updatedAt: stamp()}
          : w),
        toast: '草稿已保存',
      }));
      persist();
    },

    publish: () => {
      const c = get().collab[get().currentId];
      if (c) return set({toast: c.phase === 'pending' ? '请先处理合并待办' : '请先回连并完成离线合并'});
      const w = current();
      const issues = inspectGraph(graphOf(w));
      if (hasErrors(issues)) {
        set((s: State) => ({
          issues,
          workflows: s.workflows.map(x => x.id === w.id
            ? {...x, nodes: x.nodes.map(n => ({...n, data: {...n.data, state: issues.some(i => i.nodeId === n.id) ? 'invalid' : 'valid'}}))}
            : x),
          toast: `存在 ${issues.length} 个未通过检查的问题，无法发布`,
        }));
        return;
      }
      set((s: State) => ({
        workflows: s.workflows.map(w0 => {
          if (w0.id !== s.currentId) return w0;
          const version = w0.version + 1;
          return {
            ...w0, status: 'published', version,
            publishedAt: stamp(), updatedAt: stamp(),
            versions: [...w0.versions, {version, createdAt: stamp(), note: '发布最新审批配置', nodes: clone(w0.nodes), edges: clone(w0.edges)}],
          };
        }),
        issues: [],
        toast: '流程发布成功',
      }));
      persist();
    },

    create: () => {
      const id = 'wf-' + Date.now();
      set((s: State) => ({
        workflows: [{
          id, name: '未命名流程', domain: '财务', status: 'draft', version: 0, editor: '林秋',
          updatedAt: stamp(), abnormalCount: 0, nodes: [], edges: [], versions: [],
        }, ...s.workflows],
        currentId: id, selectedNodeId: null, issues: [],
      }));
      saveCurrentId(id);
      persist();
      return id;
    },

    copy: id => {
      set((s: State) => {
        const w = s.workflows.find(x => x.id === id)!;
        return {workflows: [{...clone(w), id: 'wf-' + Date.now(), name: w.name + '（副本）', status: 'draft'}, ...s.workflows]};
      });
      persist();
    },

    archive: id => {
      set((s: State) => ({
        workflows: s.workflows.map(w => w.id === id ? {...w, status: 'archived'} : w),
      }));
      persist();
    },
    restore: v => {
      const c = get().collab[get().currentId];
      if (c?.phase === 'pending') return blockedToast();
      set((s: State) => ({
        workflows: s.workflows.map(w => {
          if (w.id !== s.currentId) return w;
          const old = w.versions.find(x => x.version === v)!;
          return {...w, status: 'draft', nodes: clone(old.nodes), edges: clone(old.edges)};
        }),
        toast: `已恢复 v${v} 为草稿`,
      }));
      persist();
    },

    clearToast: () => set({toast: ''}),

    // ---------- 离线协作模拟 ----------

    startOffline: () => {
      const w = current();
      if (get().collab[w.id]) return set({toast: '该流程已处于离线协作会话中'});
      const base = clone(graphOf(w));
      const collab = {...get().collab, [w.id]: {
        workflowId: w.id, phase: 'offline' as const, base, remote: clone(base),
        remoteOps: [], merged: {nodes: [], edges: []}, conflicts: [], held: [], issues: [],
      }};
      set({collab, toast: '已进入离线模式：本地改动将与协作者改动在回连时按对象合并'});
    },

    remoteAddNode: (kind, fromId) => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'offline') return;
      const ts = Date.now();
      const labels: Partial<Record<NodeKind, string>> = {
        approval: '会签审批', condition: '补充判断', notify: '抄送通知', automation: '自动归档', form: '补充表单',
      };
      const source = fromId ? c.remote.nodes.find(n => n.id === fromId) : undefined;
      const node: FlowNode = {
        id: 'r-node-' + ts, type: kind,
        position: source ? {x: source.position.x, y: source.position.y + 160} : {x: 500 + Math.random() * 120, y: 320 + Math.random() * 100},
        data: {label: labels[kind] || '新增节点', state: 'unconfigured', config: {}},
      };
      const edges = [...c.remote.edges];
      if (fromId) edges.push({id: 'r-edge-' + ts, source: fromId, target: node.id});
      const ops = [...c.remoteOps, `新增了「${node.data.label}」节点`];
      const next: CollabState = {...c, remote: {nodes: [...c.remote.nodes, node], edges}, remoteOps: ops};
      set((s: State) => ({collab: {...s.collab, [w.id]: next}}));
    },

    remoteUpdateSelected: patch => {
      const w = current();
      const c = get().collab[w.id];
      const nid = get().selectedNodeId;
      if (!c || c.phase !== 'offline' || !nid) return;
      const target = c.remote.nodes.find(n => n.id === nid);
      if (!target) return;
      const next: CollabState = {
        ...c,
        remote: {
          ...c.remote,
          nodes: c.remote.nodes.map(n => n.id === nid
            ? {...n, data: {...n.data, config: {...n.data.config, ...patch}}}
            : n),
        },
        remoteOps: [...c.remoteOps, `修改了「${nodeLabel(target)}」的配置`],
      };
      set((s: State) => ({collab: {...s.collab, [w.id]: next}}));
    },

    remoteDeleteSelected: () => {
      const w = current();
      const c = get().collab[w.id];
      const nid = get().selectedNodeId;
      if (!c || c.phase !== 'offline' || !nid) return;
      const target = c.remote.nodes.find(n => n.id === nid);
      if (!target) return;
      // 协作者分叉里只删节点、保留连线，合并时作为“被移除对象”进入待处理区
      const next: CollabState = {
        ...c,
        remote: {...c.remote, nodes: c.remote.nodes.filter(n => n.id !== nid)},
        remoteOps: [...c.remoteOps, `删除了「${nodeLabel(target)}」节点`],
      };
      set((s: State) => ({collab: {...s.collab, [w.id]: next}}));
    },

    remoteAddEdge: (source, target, label) => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'offline') return;
      const edge: FlowEdge = {id: 'r-edge-' + Date.now(), source, target, label};
      const next: CollabState = {
        ...c,
        remote: {...c.remote, edges: [...c.remote.edges, edge]},
        remoteOps: [...c.remoteOps, `新增连线 ${edgeLabel(edge)}`],
      };
      set((s: State) => ({collab: {...s.collab, [w.id]: next}}));
    },

    reconnect: () => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'offline') return;
      const result = mergeGraphs(c.base, graphOf(w), {nodes: c.remote.nodes, edges: c.remote.edges});
      const issues = structuralIssues(result.graph);
      const next: CollabState = {
        ...c, phase: 'pending',
        merged: result.graph, conflicts: result.conflicts, held: result.held, issues,
      };
      set((s: State) => ({
        selectedNodeId: null,
        collab: {...s.collab, [w.id]: next},
        toast: result.conflicts.length || result.held.length || issues.length
          ? '合并完成：存在待确认冲突 / 移除 / 结构问题，请在待处理区处理'
          : '合并完成：双方改动已按对象合并',
      }));
    },

    resolveConflict: (index, side) => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'pending') return;
      const cf = c.conflicts[index];
      if (!cf || cf.resolution) return;
      const merged = clone(c.merged);
      const raw = side === 'local' ? cf.localRaw : cf.remoteRaw;
      const setPath = (obj: any, path: string, value: unknown) => {
        const keys = path.split('.');
        let o = obj;
        for (const k of keys.slice(0, -1)) o = o[k];
        o[keys[keys.length - 1]] = value;
      };
      if (cf.kind === 'edge') {
        const e = merged.edges.find((x: FlowEdge) => x.id === cf.id);
        if (e) setPath(e, cf.field, clone(raw));
      } else {
        const n = merged.nodes.find((x: FlowNode) => x.id === cf.id);
        if (n) setPath(n, cf.field, clone(raw));
      }
      const conflicts = c.conflicts.map((x, i) => i === index ? {...x, resolution: side} : x);
      recheck(w.id, {merged, conflicts});
    },

    decideHeld: (index, decision) => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'pending') return;
      const h = c.held[index];
      if (!h || h.decision) return;
      let merged = clone(c.merged);
      if (decision === 'delete') {
        if (h.kind === 'node') merged = removeNode(merged, h.id);
        else merged = {...merged, edges: merged.edges.filter(e => e.id !== h.id)};
      }
      // 节点确认删除后，只引用它的待处理连线一并结案移除
      let held = c.held.map((x, i) => i === index ? {...x, decision} : x);
      if (decision === 'delete' && h.kind === 'node') {
        held = held.filter(x => {
          if (x.kind !== 'edge') return true;
          const edge = c.merged.edges.find(e => e.id === x.id);
          return !(edge && (edge.source === h.id || edge.target === h.id));
        });
      }
      recheck(w.id, {merged, held});
    },

    fixMergeIssue: index => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'pending') return;
      const issue = c.issues[index];
      if (!issue) return;
      let merged = clone(c.merged);
      if (issue.code === 'orphan') {
        // 自动接进主流程：从条件节点补入边、向结束节点补出边；无法接线时才移除
        const end = merged.nodes.find(n => n.type === 'end');
        const anchor = merged.nodes.find(n => n.type === 'condition')
          || [...merged.nodes].reverse().find(n => n.type !== 'start' && n.type !== 'end' && n.id !== issue.nodeId);
        const add: FlowEdge[] = [];
        if (anchor && !merged.edges.some(e => e.source === anchor.id && e.target === issue.nodeId))
          add.push({id: 'fix-in-' + Date.now(), source: anchor.id, target: issue.nodeId});
        if (end && !merged.edges.some(e => e.source === issue.nodeId && e.target === end.id))
          add.push({id: 'fix-out-' + (Date.now() + 1), source: issue.nodeId, target: end.id, label: '自动接入'});
        merged = add.length
          ? {...merged, edges: [...merged.edges, ...add]}
          : removeNode(merged, issue.nodeId);
      } else if (issue.code === 'duplicate-edge') {
        merged = dedupeEdges(merged);
      } else if (issue.code === 'dangling-edge') {
        merged = removeDangling(merged);
      } else if (issue.code === 'missing-start') {
        merged = {nodes: [{id: 'start-' + Date.now(), type: 'start', position: {x: 20, y: 150}, data: {label: '开始', state: 'valid', config: {}}}, ...merged.nodes], edges: merged.edges};
      } else if (issue.code === 'missing-end') {
        merged = {nodes: [...merged.nodes, {id: 'end-' + Date.now(), type: 'end', position: {x: 1080, y: 150}, data: {label: '结束', state: 'valid', config: {}}}], edges: merged.edges};
      }
      recheck(w.id, {merged});
    },

    acceptMerge: () => {
      const w = current();
      const c = get().collab[w.id];
      if (!c || c.phase !== 'pending') return;
      const unresolved = c.conflicts.some(x => !x.resolution);
      const undecided = c.held.some(x => !x.decision);
      const blocking = c.issues.some(i => i.level === 'error');
      if (unresolved || undecided || blocking) return set({toast: '仍有未确认的冲突、移除项或结构问题'});
      set((s: State) => {
        const collab = {...s.collab};
        delete collab[w.id];
        return {
          collab,
          workflows: s.workflows.map(x => x.id === w.id
            ? {...x, nodes: clone(c.merged.nodes), edges: clone(c.merged.edges), status: 'draft', updatedAt: stamp()}
            : x),
          issues: [],
          toast: '合并已接受，双方新增内容均已保留',
        };
      });
      persist();
    },

    cancelMerge: () => {
      const w = current();
      set((s: State) => {
        const collab = {...s.collab};
        delete collab[w.id];
        return {collab, toast: '已取消合并会话，本地草稿保持不变'};
      });
    },
  };
});
