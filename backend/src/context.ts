import type { ChatMessage, ExpertConfig, PriorTurn } from './types.js';

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '…（已截断）';
}

/**
 * 为某个专家构建「此前各轮对话」的消息线程，带预算压缩（参考 chatbot/AI coding 上下文管理）：
 * - 近端 turn 逐字保留：user(该轮问题) + assistant(该专家自己当时的发言)，保持个体记忆与人设连续；
 * - 最近一轮额外注入「全体共识(最佳答案)」作为共享锚点；
 * - 超出预算的更早 turn 折叠成一个「历史摘要」(问题→最佳答案，截断)；
 * - 再超预算则丢弃最旧并标注「更早历史已省略」。
 */
export function buildPriorThread(
  expert: ExpertConfig,
  history: PriorTurn[],
  budgetChars: number,
): ChatMessage[] {
  if (!history || history.length === 0) return [];

  const verbatim: ChatMessage[] = [];
  let used = 0;
  let cutoffIndex = -1; // 0..cutoffIndex 需要压缩

  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const own = turn.expertFinals.find((f) => f.expertId === expert.id)?.content ?? '';
    const isLatest = i === history.length - 1;
    const userContent = isLatest
      ? `第 ${i + 1} 轮问题：\n${turn.question}\n\n（上一轮全体共识结论：${truncate(turn.finalAnswer, 1200)}）`
      : `第 ${i + 1} 轮问题：\n${turn.question}`;
    const assistantContent = own || '（本轮未产生有效发言）';
    const cost = userContent.length + assistantContent.length;

    // 至少保留最近一轮逐字，其余按预算
    if (used + cost > budgetChars && verbatim.length > 0) {
      cutoffIndex = i;
      break;
    }
    used += cost;
    verbatim.push({ role: 'assistant', content: assistantContent });
    verbatim.push({ role: 'user', content: userContent });
  }

  verbatim.reverse();

  const messages: ChatMessage[] = [];
  if (cutoffIndex >= 0) {
    const olderBudget = Math.max(2000, Math.floor(budgetChars * 0.4));
    const lines: string[] = [];
    let sused = 0;
    for (let i = 0; i <= cutoffIndex; i++) {
      const t = history[i];
      const line = `${i + 1}. 问题：${truncate(t.question, 200)}\n   最佳答案：${truncate(t.finalAnswer, 400)}`;
      if (sused + line.length > olderBudget) {
        lines.push('（更早历史已省略）');
        break;
      }
      sused += line.length;
      lines.push(line);
    }
    messages.push({
      role: 'system',
      content: `更早的对话历史（精简，仅保留问题与最佳答案）：\n${lines.join('\n')}`,
    });
  }
  messages.push(...verbatim);
  return messages;
}
