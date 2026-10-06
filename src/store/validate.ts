import type {FlowEdge, FlowNode, Graph, ValidationIssue} from '../types';
import {edgeKey} from './merge';

/**
 * 合并后的结构检查。任一项不过，结果都停在待处理区，
 * 发布与预览只读取通过检查的“已接受快照”。
 */
export function inspectGraph(g: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const {nodes, edges} = g;
  const ids = new Set(nodes.map(n => n.id));

  // 1. 缺少开始 / 结束节点
  if (!nodes.some(n => n.type === 'start'))
    issues.push({nodeId: nodes[0]?.id || 'flow', level: 'error', code: 'missing-start', fix: 'add-start', message: '流程缺少开始节点'});
  if (!nodes.some(n => n.type === 'end'))
    issues.push({nodeId: nodes[0]?.id || 'flow', level: 'error', code: 'missing-end', fix: 'add-end', message: '流程缺少结束节点'});

  // 2. 连线引用了不存在的节点
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target))
      issues.push({nodeId: e.target || e.source, level: 'error', code: 'dangling-edge', fix: 'remove', message: `连线 ${edgeKey(e)} 引用了已移除的节点`});
  }

  // 3. 重复连线（相同来源与目标）
  const seen = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const k = edgeKey(e);
    seen.set(k, [...(seen.get(k) || []), e]);
  }
  for (const [, group] of seen) {
    if (group.length > 1)
      for (const e of group.slice(1))
        issues.push({nodeId: e.source, level: 'error', code: 'duplicate-edge', fix: 'remove', message: `存在重复连线 ${edgeKey(e)}`});
  }

  // 4. 孤立节点：开始/结束以外，既无入边也无出边（与主流程完全断开）
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      outbound.add(e.source);
      inbound.add(e.target);
    }
  }
  for (const n of nodes) {
    if (n.type === 'start' || n.type === 'end') continue;
    if (!inbound.has(n.id) || !outbound.has(n.id))
      issues.push({nodeId: n.id, level: 'error', code: 'orphan', fix: 'remove', message: `节点「${n.data.label}」是孤立节点，未接入流程`});
  }

  // 5. 原有配置检查
  for (const n of nodes) {
    if (n.type === 'condition' && !n.data.config.ruleType)
      issues.push({nodeId: n.id, level: 'error', code: 'condition-unconfigured', message: '条件分支规则未配置'});
    if (n.type === 'approval' && !n.data.config.approverSource)
      issues.push({nodeId: n.id, level: 'error', code: 'approver-empty', message: '审批人不能为空'});
  }
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some(i => i.level === 'error');

/** 删除节点后清理只引用它的连线 */
export function removeNode(g: Graph, id: string): Graph {
  return {
    nodes: g.nodes.filter(n => n.id !== id),
    edges: g.edges.filter(e => e.source !== id && e.target !== id),
  };
}

/** 删除重复连线时保留每组第一条 */
export function dedupeEdges(g: Graph): Graph {
  const keep = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const e of g.edges) {
    const k = edgeKey(e);
    if (keep.has(k)) continue;
    keep.add(k);
    edges.push(e);
  }
  return {nodes: g.nodes, edges};
}

export function removeDangling(g: Graph): Graph {
  const ids = new Set(g.nodes.map(n => n.id));
  return {nodes: g.nodes, edges: g.edges.filter(e => ids.has(e.source) && ids.has(e.target))};
}
