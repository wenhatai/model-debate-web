import { runDebate, type DebateHandlers, type DebatePayload } from '../core/orchestrator';

export type DebateStreamHandlers = DebateHandlers;

/**
 * 在浏览器内直接驱动辩论编排（不再走后端 SSE），返回一个可中止的函数。
 * 保留原 runDebateStream 名称与签名，store 无需改动。
 */
export function runDebateStream(
  payload: DebatePayload,
  handlers: DebateStreamHandlers,
): () => void {
  const controller = new AbortController();
  void runDebate(payload, handlers, controller.signal);
  return () => controller.abort();
}
