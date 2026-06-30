import type { CostBreakdownItem, TokenUsage } from '../types';

const DEFAULT_PRICE: [number, number] = [1.0, 2.0]; // [input, output] USD / 1M tokens

const PRICE_TABLE: Record<string, [number, number]> = {
  'deepseek-chat': [0.27, 1.1],
  'deepseek-reasoner': [0.55, 2.19],
  'qwen-max': [1.6, 6.4],
  'qwen-plus': [0.4, 1.2],
  'qwen-turbo': [0.05, 0.2],
  'doubao-pro': [0.4, 1.2],
  'ernie-4.0': [4.0, 12.0],
  'moonshot-v1-8k': [1.7, 1.7],
  'glm-4': [1.4, 1.4],
  'gpt-4o': [2.5, 10.0],
  'gpt-4o-mini': [0.15, 0.6],
};

function lookup(model: string): [number, number] {
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(PRICE_TABLE)) {
    if (lower.includes(key)) return price;
  }
  return DEFAULT_PRICE;
}

export function costOf(model: string, usage: TokenUsage): number {
  const [input, output] = lookup(model);
  return (usage.promptTokens / 1_000_000) * input + (usage.completionTokens / 1_000_000) * output;
}

/**
 * 按模型聚合 token 与费用。
 */
export class CostAccumulator {
  private byModel = new Map<string, { prompt: number; completion: number; calls: number; cost: number }>();
  private _totalCost = 0;
  private _totalTokens = 0;

  record(model: string, usage: TokenUsage): void {
    const cost = costOf(model, usage);
    const entry = this.byModel.get(model) ?? { prompt: 0, completion: 0, calls: 0, cost: 0 };
    entry.prompt += usage.promptTokens;
    entry.completion += usage.completionTokens;
    entry.calls += 1;
    entry.cost += cost;
    this.byModel.set(model, entry);
    this._totalCost += cost;
    this._totalTokens += usage.promptTokens + usage.completionTokens;
  }

  get totalCost(): number {
    return this._totalCost;
  }

  get totalTokens(): number {
    return this._totalTokens;
  }

  breakdown(): CostBreakdownItem[] {
    return [...this.byModel.entries()].map(([model, e]) => ({
      model,
      promptTokens: e.prompt,
      completionTokens: e.completion,
      calls: e.calls,
      cost: e.cost,
    }));
  }
}
