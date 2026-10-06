import type {Workflow} from '../types';
import {clone} from './merge';

/**
 * 浏览器关闭后从最后一份完整草稿继续。
 * 只持久化“已接受快照”级别的流程数据；未确认的合并冲突、待处理对象
 * 属于会话内协作状态，不落盘，绝不会被带进下一步。
 */
const KEY = 'flowdesk.workflows.v2';
const CURRENT_KEY = 'flowdesk.currentId.v2';

export function loadWorkflows(fallback: Workflow[]): Workflow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(fallback);
    const parsed = JSON.parse(raw) as Workflow[];
    if (!Array.isArray(parsed) || !parsed.length) return clone(fallback);
    return parsed;
  } catch {
    return clone(fallback);
  }
}

export function saveWorkflows(workflows: Workflow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(workflows));
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}

export function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* ignore */
  }
}

export function resetWorkflows(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

/** 测试/演示用：挂在 window 上的重置入口 */
if (typeof window !== 'undefined') {
  (window as any).__flowdeskReset = resetWorkflows;
}
