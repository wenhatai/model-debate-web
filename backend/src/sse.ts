import type { ServerResponse } from 'node:http';
import type { CostBreakdownItem, TokenUsage } from './types.js';

/**
 * 统一的辩论 SSE 事件发布器（Node 单线程，无需加锁）。
 */
export class SsePublisher {
  private closed = false;

  constructor(private res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.on('close', () => {
      this.closed = true;
    });
  }

  private send(event: string, data: unknown): void {
    if (this.closed) return;
    try {
      this.res.write(`event: ${event}\n`);
      this.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.closed = true;
    }
  }

  roundStart(round: number): void {
    this.send('round_start', { round });
  }

  expertDelta(expertId: string, round: number, text: string): void {
    this.send('expert_delta', { expertId, round, text });
  }

  expertDone(expertId: string, round: number, usage: TokenUsage): void {
    this.send('expert_done', { expertId, round, usage });
  }

  expertError(expertId: string, round: number, message: string): void {
    this.send('expert_error', { expertId, round, message });
  }

  judgeVerdict(round: number, converged: boolean, reason: string): void {
    this.send('judge_verdict', { round, converged, reason });
  }

  costUpdate(total: number, breakdown: CostBreakdownItem[]): void {
    this.send('cost_update', { total, breakdown });
  }

  finalAnswer(markdown: string): void {
    this.send('final_answer', { markdown });
  }

  debateDone(conversationId: number, turnIndex: number): void {
    this.send('debate_done', { conversationId, turnIndex });
  }

  error(message: string): void {
    this.send('error', { message });
  }

  complete(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.res.end();
    } catch {
      // ignore
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
