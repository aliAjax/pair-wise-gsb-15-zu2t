import type {
  FlowEdge, FlowNode, Graph, HeldDeletion, MergeConflict,
} from '../types';

export const clone = <T,>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

export const nodeLabel = (n?: FlowNode) => n?.data.label || n?.id || '未知节点';
export const edgeKey = (e: FlowEdge) => `${e.source}->${e.target}`;
export const edgeLabel = (e: FlowEdge) => `${e.source} → ${e.target}${e.label ? `（${e.label}）` : ''}`;

const valText = (v: unknown): string => {
  if (v === undefined) return '（空）';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
};

/**
 * 参与三方合并的字段：节点（名称 / 位置 / 配置）与连线（标签）。
 * state 是编辑器内部状态，不参与合并。
 */
const NODE_FIELDS = ['data.label', 'position', 'data.config'] as const;
const EDGE_FIELDS = ['label'] as const;

const get = (obj: any, path: string) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export interface MergeSide {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface MergeResult {
  graph: Graph;
  conflicts: MergeConflict[];
  held: HeldDeletion[];
}

/**
 * 按对象做三方合并（base / 本地 / 协作者）：
 * - 任一方新增的节点和连线一律保留（各自新增的内容不会互相冲掉）
 * - 同一对象同一字段只有一方修改：直接采用
 * - 两边都改且取值不同：记入冲突，等待人工选择，不自动取值
 * - 一方删除的对象先停在待处理区；删除的节点仍被连线引用时给出引用提示
 */
export function mergeGraphs(base: Graph, local: Graph, remote: MergeSide): MergeResult {
  const conflicts: MergeConflict[] = [];
  const held: HeldDeletion[] = [];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const bn = new Map(base.nodes.map(n => [n.id, n]));
  const ln = new Map(local.nodes.map(n => [n.id, n]));
  const rn = new Map(remote.nodes.map(n => [n.id, n]));
  const allNodeIds = new Set([...bn.keys(), ...ln.keys(), ...rn.keys()]);

  const referencedByEdge = (id: string, by: 'local' | 'remote') => {
    const es = by === 'local' ? local.edges : remote.edges;
    return es.some(e => e.source === id || e.target === id);
  };

  for (const id of allNodeIds) {
    const b = bn.get(id), l = ln.get(id), r = rn.get(id);

    if (!b) {
      // 新增：谁新增就收谁；两边恰好新增同 id 时按字段合并
      if (l && r) nodes.push(mergeNodeFields(undefined, l, r, conflicts));
      else nodes.push(clone((l || r)!));
      continue;
    }
    if (l && r) {
      nodes.push(mergeNodeFields(b, l, r, conflicts));
    } else if (!l && !r) {
      // 两边都移除：保持删除
      continue;
    } else {
      // 仅一方移除：先停在待处理区，画布暂保留，等待“确认移除 / 保留”
      const by: 'local' | 'remote' = !l ? 'local' : 'remote';
      const keptSide = l || r;
      const referenced = !keptSide ? false : referencedByEdge(id, by === 'local' ? 'remote' : 'local');
      held.push({
        id, kind: 'node', label: nodeLabel(b!), by: [by],
        note: referenced
          ? `${by === 'local' ? '本地' : '协作者'}移除了该节点，但仍有连线引用它，需要先确认`
          : `${by === 'local' ? '本地' : '协作者'}移除了该节点，等待确认`,
      });
      nodes.push(clone(b!));
    }
  }

  const be = new Map(base.edges.map(e => [e.id, e]));
  const le = new Map(local.edges.map(e => [e.id, e]));
  const re = new Map(remote.edges.map(e => [e.id, e]));
  const allEdgeIds = new Set([...be.keys(), ...le.keys(), ...re.keys()]);

  for (const id of allEdgeIds) {
    const b = be.get(id), l = le.get(id), r = re.get(id);
    if (!b) { edges.push(clone((l || r)!)); continue; }
    if (l && r) {
      const out: FlowEdge = { id, source: l.source, target: l.target, label: b.label };
      for (const f of EDGE_FIELDS) {
        const bv = get(b, f), lv = get(l, f), rv = get(r, f);
        if (same(lv, rv)) (out as any)[f] = clone(lv);
        else if (same(bv, lv)) (out as any)[f] = clone(rv);
        else if (same(bv, rv)) (out as any)[f] = clone(lv);
        else conflicts.push({
          id, kind: 'edge', label: edgeLabel(b), field: f,
          baseValue: valText(bv), localValue: valText(lv), remoteValue: valText(rv),
          baseRaw: clone(bv), localRaw: clone(lv), remoteRaw: clone(rv),
        });
      }
      edges.push(out);
    } else if (!l && !r) {
      // 两边都移除：保持删除
      continue;
    } else {
      const by: 'local' | 'remote' = !l ? 'local' : 'remote';
      held.push({
        id, kind: 'edge', label: edgeLabel(b), by: [by],
        note: `${by === 'local' ? '本地' : '协作者'}移除了这条连线，等待确认`,
      });
      edges.push(clone(b));
    }
  }

  return { graph: { nodes, edges }, conflicts, held };
}

/** 单个节点的字段级三方（或双方新增）合并 */
function mergeNodeFields(
  base: FlowNode | undefined,
  local: FlowNode,
  remote: FlowNode,
  conflicts: MergeConflict[],
): FlowNode {
  const out: FlowNode = {
    id: local.id,
    type: local.type || remote.type || base?.type || 'form',
    position: { x: 0, y: 0 },
    data: { label: '', state: 'configuring', config: {} },
  };
  for (const f of NODE_FIELDS) {
    const bv = base ? get(base, f) : undefined;
    const lv = get(local, f);
    const rv = get(remote, f);
    let picked: unknown;
    if (same(lv, rv)) picked = clone(lv);
    // 有共同祖先：只有一方改则直接采用
    else if (base && same(bv, lv)) picked = clone(rv);
    else if (base && same(bv, rv)) picked = clone(lv);
    else {
      // 无祖先的同 id 新增且取值不同，同样不能臆断，列为冲突
      conflicts.push({
        id: local.id, kind: 'node',
        label: nodeLabel(local) !== local.id ? nodeLabel(local) : nodeLabel(remote),
        field: f,
        baseValue: valText(bv), localValue: valText(lv), localRaw: clone(lv),
        remoteValue: valText(rv), remoteRaw: clone(rv), baseRaw: clone(bv),
      });
      picked = clone(lv);
    }
    if (f === 'data.label') out.data.label = (picked as string) ?? '';
    else if (f === 'position') out.position = (picked as FlowNode['position']) ?? { x: 0, y: 0 };
    else out.data.config = (picked as Record<string, any>) ?? {};
  }
  return out;
}
