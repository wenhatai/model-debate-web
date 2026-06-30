import { streamChat } from './dmxClient.js';
import { assessConsensus, synthesize } from './judge.js';
import { CostAccumulator } from './cost.js';
import {
  createConversation,
  appendTurn,
  replaceTurn,
  getConversationRaw,
  type TurnRecord,
} from './db.js';
import { buildPriorThread } from './context.js';
import { config } from './config.js';
import type { SsePublisher } from './sse.js';
import type {
  ChatMessage,
  DebateRequest,
  ExpertAnswer,
  ExpertConfig,
  PriorTurn,
  TranscriptRound,
} from './types.js';

const DEFAULT_NAMES = ['专家A', '专家B', '专家C', '专家D', '专家E', '专家F'];

function normalizeExperts(experts: ExpertConfig[]): ExpertConfig[] {
  return experts.map((e, i) => ({
    id: e.id && e.id.trim() ? e.id : `expert-${i + 1}`,
    name: e.name && e.name.trim() ? e.name : DEFAULT_NAMES[i] ?? `专家${i + 1}`,
    model: e.model,
  }));
}

function buildMessages(
  round: number,
  expert: ExpertConfig,
  question: string,
  history: ExpertAnswer[][],
  priorTurns: PriorTurn[],
): ChatMessage[] {
  const isFollowUp = priorTurns.length > 0;
  const priorThread = buildPriorThread(expert, priorTurns, config.historyBudgetChars);

  if (round === 1) {
    const persona = isFollowUp
      ? `你是一位名为「${expert.name}」的领域专家，正在与用户进行多轮对话。请结合此前的对话上下文，独立、严谨地回答用户本次的追问，给出明确的答案和清晰的推理过程。`
      : `你是一位名为「${expert.name}」的领域专家。请独立、严谨地回答用户的问题，给出明确的答案和清晰的推理过程。`;
    const current = isFollowUp ? `用户追问：\n${question}` : question;
    return [
      { role: 'system', content: persona },
      ...priorThread,
      { role: 'user', content: current },
    ];
  }

  const previous = history[round - 2];
  let user = `${isFollowUp ? '用户追问：' : '用户问题：'}\n${question}\n\n本轮（第 ${round} 轮）此前各位专家的观点如下：\n\n`;
  for (const a of previous) {
    const tag = a.expertId === expert.id ? `${a.expertName}（你自己）` : a.expertName;
    user += `【${tag}】\n${a.content}\n\n`;
  }
  user += '请综合以上观点，给出你本轮更新后的答案与推理。';
  return [
    {
      role: 'system',
      content: `你是一位名为「${expert.name}」的领域专家，正在参与多专家辩论的第 ${round} 轮。请参考其他专家本轮的观点，独立思考后更新或完善你的回答，给出你认为最准确的答案和理由。`,
    },
    ...priorThread,
    { role: 'user', content: user },
  ];
}

async function runRound(
  round: number,
  question: string,
  experts: ExpertConfig[],
  history: ExpertAnswer[][],
  priorTurns: PriorTurn[],
  apiKey: string,
  sse: SsePublisher,
  cost: CostAccumulator,
): Promise<ExpertAnswer[]> {
  const answers = await Promise.all(
    experts.map(async (expert): Promise<ExpertAnswer> => {
      const messages = buildMessages(round, expert, question, history, priorTurns);
      let content = '';
      try {
        const usage = await streamChat(apiKey, expert.model, messages, (delta) => {
          content += delta;
          sse.expertDelta(expert.id, round, delta);
        });
        sse.expertDone(expert.id, round, usage);
        return { expertId: expert.id, expertName: expert.name, model: expert.model, round, content, usage };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sse.expertError(expert.id, round, msg);
        return {
          expertId: expert.id,
          expertName: expert.name,
          model: expert.model,
          round,
          content: `（该专家本轮调用失败：${msg}）`,
          usage: { promptTokens: 0, completionTokens: 0 },
        };
      }
    }),
  );
  for (const a of answers) cost.record(a.model, a.usage);
  return answers;
}

function toTranscriptAnswer(a: ExpertAnswer) {
  return {
    expertId: a.expertId,
    expertName: a.expertName,
    model: a.model,
    content: a.content,
    promptTokens: a.usage.promptTokens,
    completionTokens: a.usage.completionTokens,
  };
}

/** 将已存储的 transcript 还原为按轮组织的 ExpertAnswer 二维数组。 */
function transcriptToHistory(transcript: TranscriptRound[]): ExpertAnswer[][] {
  return transcript.map((round) =>
    round.answers.map((a) => ({
      expertId: a.expertId,
      expertName: a.expertName,
      model: a.model,
      round: round.round,
      content: a.content,
      usage: { promptTokens: a.promptTokens, completionTokens: a.completionTokens },
    })),
  );
}

/** 取某个 turn 中指定专家最后一轮的发言内容（用于追问上下文）。 */
function expertFinalInTurn(turn: TurnRecord, expertId: string): string {
  for (let i = turn.transcript.length - 1; i >= 0; i--) {
    const a = turn.transcript[i].answers.find((x) => x.expertId === expertId);
    if (a) return a.content;
  }
  return '';
}

/**
 * 继续讨论：对已存在会话中某个未收敛的 turn，在已有轮次基础上再追加若干轮辩论，
 * 然后重新汇总并整体回写该 turn。
 */
async function runContinue(request: DebateRequest, sse: SsePublisher): Promise<void> {
  const resume = request.resume!;
  const conv = getConversationRaw(resume.conversationId);
  if (!conv) {
    sse.error('继续讨论失败：未找到该会话');
    return;
  }
  const turn = conv.turns[resume.turnIndex];
  if (!turn) {
    sse.error('继续讨论失败：未找到该轮对话');
    return;
  }

  const experts = normalizeExperts(conv.experts);
  const judgeModel = conv.judgeModel?.trim() || experts[0].model;
  const apiKey = request.apiKey?.trim() || config.defaultApiKey;
  const question = turn.question;
  const extraRounds = Math.max(1, resume.extraRounds || conv.maxRounds || 3);

  // 之前的 turn 作为追问上下文
  const priorTurns: PriorTurn[] = conv.turns.slice(0, resume.turnIndex).map((t) => ({
    question: t.question,
    finalAnswer: t.finalAnswer,
    expertFinals: experts.map((e) => ({ expertId: e.id, content: expertFinalInTurn(t, e.id) })),
  }));

  const history = transcriptToHistory(turn.transcript);
  const transcript: TranscriptRound[] = turn.transcript.map((r) => ({ ...r }));
  const startRound = history.length + 1;
  const endRound = history.length + extraRounds;

  const cost = new CostAccumulator();
  let converged = false;

  for (let round = startRound; round <= endRound; round++) {
    sse.roundStart(round);
    const answers = await runRound(round, question, experts, history, priorTurns, apiKey, sse, cost);
    history.push(answers);

    const roundEntry: TranscriptRound = { round, answers: answers.map(toTranscriptAnswer) };
    sse.costUpdate(cost.totalCost, cost.breakdown());

    const verdict = await assessConsensus(apiKey, judgeModel, question, answers);
    cost.record(verdict.model, verdict.usage);
    sse.judgeVerdict(round, verdict.converged, verdict.reason);
    sse.costUpdate(cost.totalCost, cost.breakdown());
    roundEntry.verdict = { converged: verdict.converged, reason: verdict.reason };
    transcript.push(roundEntry);

    if (verdict.converged) {
      converged = true;
      break;
    }
    if (sse.isClosed) return;
  }

  const lastAnswers = history[history.length - 1];
  const synthesis = await synthesize(apiKey, judgeModel, question, lastAnswers, converged);
  cost.record(synthesis.model, synthesis.usage);
  sse.finalAnswer(synthesis.markdown);

  // 成本：保留既有 turn 成本，叠加本次新增轮次的成本
  const addedCost = cost.totalCost;
  const addedTokens = cost.totalTokens;
  const mergedBreakdown = mergeBreakdown(turn.costBreakdown, cost.breakdown());

  const updated: TurnRecord = {
    ...turn,
    transcript,
    finalAnswer: synthesis.markdown,
    rounds: history.length,
    converged,
    costBreakdown: mergedBreakdown,
    totalCost: (turn.totalCost ?? 0) + addedCost,
    totalTokens: (turn.totalTokens ?? 0) + addedTokens,
  };
  replaceTurn(resume.conversationId, resume.turnIndex, updated);
  sse.costUpdate(updated.totalCost, mergedBreakdown);
  sse.debateDone(resume.conversationId, resume.turnIndex);
}

/** 合并两份按模型聚合的成本明细。 */
function mergeBreakdown(
  base: TurnRecord['costBreakdown'],
  extra: TurnRecord['costBreakdown'],
): TurnRecord['costBreakdown'] {
  const map = new Map<string, { model: string; promptTokens: number; completionTokens: number; calls: number; cost: number }>();
  for (const item of [...(base ?? []), ...(extra ?? [])]) {
    const e = map.get(item.model) ?? { model: item.model, promptTokens: 0, completionTokens: 0, calls: 0, cost: 0 };
    e.promptTokens += item.promptTokens;
    e.completionTokens += item.completionTokens;
    e.calls += item.calls;
    e.cost += item.cost;
    map.set(item.model, e);
  }
  return [...map.values()];
}

export async function runDebate(request: DebateRequest, sse: SsePublisher): Promise<void> {
  try {
    if (request.resume) {
      await runContinue(request, sse);
      return;
    }
    const experts = normalizeExperts(request.experts);
    const maxRounds = Math.max(1, request.maxRounds || 3);
    const judgeModel = request.judgeModel?.trim() || experts[0].model;
    const apiKey = request.apiKey?.trim() || config.defaultApiKey;
    const question = request.question;
    const priorTurns = request.history ?? [];

    const cost = new CostAccumulator();
    const history: ExpertAnswer[][] = [];
    const transcript: TranscriptRound[] = [];
    let converged = false;

    for (let round = 1; round <= maxRounds; round++) {
      sse.roundStart(round);
      const answers = await runRound(round, question, experts, history, priorTurns, apiKey, sse, cost);
      history.push(answers);

      const roundEntry: TranscriptRound = { round, answers: answers.map(toTranscriptAnswer) };
      sse.costUpdate(cost.totalCost, cost.breakdown());

      // 每一轮都裁决，保证最后一轮也有结论，且「为何结束」始终明确
      const verdict = await assessConsensus(apiKey, judgeModel, question, answers);
      cost.record(verdict.model, verdict.usage);
      sse.judgeVerdict(round, verdict.converged, verdict.reason);
      sse.costUpdate(cost.totalCost, cost.breakdown());
      roundEntry.verdict = { converged: verdict.converged, reason: verdict.reason };
      transcript.push(roundEntry);

      if (verdict.converged) {
        converged = true;
        break;
      }
      if (sse.isClosed) return;
    }

    const lastAnswers = history[history.length - 1];
    const synthesis = await synthesize(apiKey, judgeModel, question, lastAnswers, converged);
    cost.record(synthesis.model, synthesis.usage);
    sse.finalAnswer(synthesis.markdown);
    sse.costUpdate(cost.totalCost, cost.breakdown());

    const turn: TurnRecord = {
      question,
      transcript,
      finalAnswer: synthesis.markdown,
      rounds: history.length,
      converged,
      costBreakdown: cost.breakdown(),
      totalCost: cost.totalCost,
      totalTokens: cost.totalTokens,
      createdAt: new Date().toISOString(),
    };

    let conversationId = request.conversationId;
    let turnIndex: number;
    if (conversationId && appendTurn(conversationId, turn)) {
      turnIndex = priorTurns.length; // 追加在已有 turns 之后
    } else {
      conversationId = createConversation(experts, judgeModel, maxRounds, turn);
      turnIndex = 0;
    }
    sse.debateDone(conversationId, turnIndex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sse.error(`辩论执行失败：${msg}`);
  } finally {
    sse.complete();
  }
}
