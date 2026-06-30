import { chat } from './dmxClient';
import type { ExpertAnswer, TokenUsage } from '../types';

export interface Verdict {
  converged: boolean;
  reason: string;
  usage: TokenUsage;
  model: string;
}

export interface Synthesis {
  markdown: string;
  usage: TokenUsage;
  model: string;
}

function stripFences(text: string): string {
  let t = (text ?? '').trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    if (nl >= 0) t = t.slice(nl + 1);
    if (t.endsWith('```')) t = t.slice(0, -3);
  }
  return t.trim();
}

/**
 * 用「模型名称」作为各专家的展示标签（裁决/汇总对用户展示时使用模型名而非「专家A」）。
 * 同一模型出现多次时追加序号以消歧。
 */
function modelLabels(answers: ExpertAnswer[]): Map<string, string> {
  const total = new Map<string, number>();
  for (const a of answers) total.set(a.model, (total.get(a.model) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const a of answers) {
    if ((total.get(a.model) ?? 0) > 1) {
      const n = (seen.get(a.model) ?? 0) + 1;
      seen.set(a.model, n);
      labels.set(a.expertId, `${a.model} #${n}`);
    } else {
      labels.set(a.expertId, a.model);
    }
  }
  return labels;
}

/**
 * 判断本轮各专家答案是否已收敛（就核心结论达成多数共识）。
 */
export async function assessConsensus(
  apiKey: string,
  judgeModel: string,
  question: string,
  answers: ExpertAnswer[],
  signal?: AbortSignal,
): Promise<Verdict> {
  let prompt = `用户问题：\n${question}\n\n以下是本轮各位专家（以模型名称标识）的回答：\n\n`;
  const labels = modelLabels(answers);
  for (const a of answers) {
    prompt += `【${labels.get(a.expertId)}】\n${a.content}\n\n`;
  }
  prompt +=
    '请严格判断这些专家是否就【问题的核心结论/最终答案】达成了多数共识。\n\n' +
    '重要原则：\n' +
    '1. 「使用相似的分析方法、讨论同一话题、格式结构相似」都【不等于】结论一致。\n' +
    '2. 只有当【多数专家给出实质相同的最终结论/推荐】时，才算达成共识。\n' +
    '3. 如果各专家给出的最终答案/推荐各不相同（例如各自推荐了不同的方案、名称、数值、选项），即视为【未收敛】。\n' +
    '4. 拿不准时，判为未收敛。\n\n' +
    '请先逐位提取每个模型「一句话的最终核心结论」，再据此判断。\n' +
    '只输出如下 JSON（不要其它文字），name 字段请使用模型名称：\n' +
    '{"conclusions":[{"name":"模型名称","conclusion":"该模型的最终核心结论"}],"converged":true 或 false,"reason":"结合各自结论说明为何收敛/未收敛"}';

  const { content, usage } = await chat(
    apiKey,
    judgeModel,
    [
      {
        role: 'system',
        content:
          '你是一名极其严谨的辩论裁判，倾向于保守判定。只有在多数专家的最终结论实质相同时才判为已收敛，否则一律判为未收敛。只输出 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    signal,
  );

  let converged = false;
  let reason = '';
  try {
    const json = JSON.parse(stripFences(content));
    converged = json.converged === true;
    const conclusions = Array.isArray(json.conclusions)
      ? json.conclusions.map((c: { name?: string; conclusion?: string }) => `${c.name ?? ''}：${c.conclusion ?? ''}`).join('；')
      : '';
    reason = json.reason ?? '';
    if (conclusions) reason = `各专家结论 → ${conclusions}。${reason}`;
  } catch {
    reason = '裁判输出解析失败，默认继续辩论。';
  }
  return { converged, reason, usage, model: judgeModel };
}

/**
 * 辩论结束后，由裁判模型【如实汇总】各专家最终立场：
 * - 已收敛：汇总提炼出共识结论；
 * - 未收敛：只罗列各模型各自结论与分歧，不做综合判断、不给折中方案、不替用户决策。
 */
export async function synthesize(
  apiKey: string,
  judgeModel: string,
  question: string,
  answers: ExpertAnswer[],
  converged: boolean,
  signal?: AbortSignal,
): Promise<Synthesis> {
  const labels = modelLabels(answers);
  let prompt = `用户问题：\n${question}\n\n以下是各位专家（以模型名称标识）的最终立场：\n\n`;
  for (const a of answers) {
    prompt += `【${labels.get(a.expertId)}】\n${a.content}\n\n`;
  }
  prompt += converged
    ? '各专家已就核心结论达成多数共识。请汇总提炼出一个清晰、准确、对用户友好的最终共识结论，指代专家时一律使用模型名称。'
    : '各专家的最终结论【并不一致】。你的任务仅是【如实汇总】，不得给出你自己的综合判断、折中方案或推荐选择：\n' +
      '1. 用一个对比表清晰列出【每个模型各自的最终结论/推荐】及其关键理由（表格首列为模型名称）；\n' +
      '2. 简要列出各方的主要分歧点；\n' +
      '3. 不要提出新的折中方案，不要替用户做选择，把最终判断权留给用户。';
  prompt += '\n请使用 Markdown 格式输出，结构清晰。';

  const { content, usage } = await chat(
    apiKey,
    judgeModel,
    [
      {
        role: 'system',
        content:
          '你是一名专业、诚实的汇总助手（非决策者）。意见一致时汇总共识结论；意见不一致时，只如实呈现各模型各自的结论与分歧，绝不提出自己的综合判断、折中方案或代替用户做选择。指代专家时使用模型名称。使用 Markdown 格式。',
      },
      { role: 'user', content: prompt },
    ],
    signal,
  );
  return { markdown: content, usage, model: judgeModel };
}
