import { streamChat } from './dmxClient';
import { assessConsensus, synthesize } from './judge';
import { CostAccumulator } from './cost';
import {
  createConversation,
  appendTurn,
  replaceTurn,
  getConversationRaw,
} from '../db/conversations';
import { buildPriorThread } from './context';
import { coreConfig } from './config';
import type {
  ChatMessage,
  CostBreakdownItem,
  ExpertAnswer,
  ExpertConfig,
  PriorTurn,
  ResumeRequest,
  TokenUsage,
  TranscriptRound,
  TurnRecord,
} from '../types';

export interface DebateHandlers {
  onRoundStart: (round: number) => void;
  onExpertDelta: (expertId: string, round: number, text: string) => void;
  onExpertDone: (expertId: string, round: number, usage: TokenUsage) => void;
  onExpertError: (expertId: string, round: number, message: string) => void;
  onJudgeVerdict: (round: number, converged: boolean, reason: string) => void;
  onCostUpdate: (total: number, breakdown: CostBreakdownItem[]) => void;
  onFinalAnswer: (markdown: string) => void;
  onDebateDone: (conversationId: number, turnIndex: number) => void;
  onError: (message: string) => void;
}

export interface DebatePayload {
  question: string;
  experts: ExpertConfig[];
  maxRounds: number;
  judgeModel?: string;
  apiKey: string;
  history?: PriorTurn[];
  conversationId?: number | null;
  resume?: ResumeRequest;
}

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
  const priorThread = buildPriorThread(expert, priorTurns, coreConfig.historyBudgetChars);

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
  handlers: DebateHandlers,
  cost: CostAccumulator,
  signal: AbortSignal,
): Promise<ExpertAnswer[]> {
  const answers = await Promise.all(
    experts.map(async (expert): Promise<ExpertAnswer> => {
      const messages = buildMessages(round, expert, question, history, priorTurns);
      let content = '';
      try {
        const usage = await streamChat(
          apiKey,
          expert.model,
          messages,
          (delta) => {
            content += delta;
            handlers.onExpertDelta(expert.id, round, delta);
          },
          signal,
        );
        handlers.onExpertDone(expert.id, round, usage);
        return { expertId: expert.id, expertName: expert.name, model: expert.model, round, content, usage };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!signal.aborted) handlers.onExpertError(expert.id, round, msg);
        return {
          expertId: expert.id,
          expertName: expert.name,
          model: expert.model,
          round,
          content: signal.aborted ? content : `（该专家本轮调用失败：${msg}）`,
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

function expertFinalInTurn(turn: TurnRecord, expertId: string): string {
  for (let i = turn.transcript.length - 1; i >= 0; i--) {
    const a = turn.transcript[i].answers.find((x) => x.expertId === expertId);
    if (a) return a.content;
  }
  return '';
}

function mergeBreakdown(
  base: CostBreakdownItem[],
  extra: CostBreakdownItem[],
): CostBreakdownItem[] {
  const map = new Map<string, CostBreakdownItem>();
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

/** 继续讨论：对已存在会话中某个未收敛的 turn 追加若干轮辩论。 */
async function runContinue(
  payload: DebatePayload,
  handlers: DebateHandlers,
  signal: AbortSignal,
): Promise<void> {
  const resume = payload.resume!;
  const conv = await getConversationRaw(resume.conversationId);
  if (!conv) return handlers.onError('继续讨论失败：未找到该会话');
  const turn = conv.turns[resume.turnIndex];
  if (!turn) return handlers.onError('继续讨论失败：未找到该轮对话');

  const experts = normalizeExperts(conv.experts);
  const judgeModel = conv.judgeModel?.trim() || experts[0].model;
  const apiKey = payload.apiKey?.trim();
  if (!apiKey) return handlers.onError('请先在「设置」中填写 DMXAPI Key');
  const question = turn.question;
  const extraRounds = Math.max(1, resume.extraRounds || conv.maxRounds || 3);

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
    handlers.onRoundStart(round);
    const answers = await runRound(round, question, experts, history, priorTurns, apiKey, handlers, cost, signal);
    if (signal.aborted) return;
    history.push(answers);

    const roundEntry: TranscriptRound = { round, answers: answers.map(toTranscriptAnswer) };
    handlers.onCostUpdate(cost.totalCost, cost.breakdown());

    const verdict = await assessConsensus(apiKey, judgeModel, question, answers, signal);
    if (signal.aborted) return;
    cost.record(verdict.model, verdict.usage);
    handlers.onJudgeVerdict(round, verdict.converged, verdict.reason);
    handlers.onCostUpdate(cost.totalCost, cost.breakdown());
    roundEntry.verdict = { converged: verdict.converged, reason: verdict.reason };
    transcript.push(roundEntry);

    if (verdict.converged) {
      converged = true;
      break;
    }
  }

  const lastAnswers = history[history.length - 1];
  const synthesis = await synthesize(apiKey, judgeModel, question, lastAnswers, converged, signal);
  if (signal.aborted) return;
  cost.record(synthesis.model, synthesis.usage);
  handlers.onFinalAnswer(synthesis.markdown);

  const mergedBreakdown = mergeBreakdown(turn.costBreakdown, cost.breakdown());
  const updated: TurnRecord = {
    ...turn,
    transcript,
    finalAnswer: synthesis.markdown,
    rounds: history.length,
    converged,
    costBreakdown: mergedBreakdown,
    totalCost: (turn.totalCost ?? 0) + cost.totalCost,
    totalTokens: (turn.totalTokens ?? 0) + cost.totalTokens,
  };
  await replaceTurn(resume.conversationId, resume.turnIndex, updated);
  handlers.onCostUpdate(updated.totalCost, mergedBreakdown);
  handlers.onDebateDone(resume.conversationId, resume.turnIndex);
}

export async function runDebate(
  payload: DebatePayload,
  handlers: DebateHandlers,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (payload.resume) {
      await runContinue(payload, handlers, signal);
      return;
    }

    const experts = normalizeExperts(payload.experts);
    const maxRounds = Math.max(1, payload.maxRounds || 3);
    const judgeModel = payload.judgeModel?.trim() || experts[0].model;
    const apiKey = payload.apiKey?.trim();
    if (!apiKey) {
      handlers.onError('请先在「设置」中填写 DMXAPI Key');
      return;
    }
    const question = payload.question;
    const priorTurns = payload.history ?? [];

    const cost = new CostAccumulator();
    const history: ExpertAnswer[][] = [];
    const transcript: TranscriptRound[] = [];
    let converged = false;

    for (let round = 1; round <= maxRounds; round++) {
      handlers.onRoundStart(round);
      const answers = await runRound(round, question, experts, history, priorTurns, apiKey, handlers, cost, signal);
      if (signal.aborted) return;
      history.push(answers);

      const roundEntry: TranscriptRound = { round, answers: answers.map(toTranscriptAnswer) };
      handlers.onCostUpdate(cost.totalCost, cost.breakdown());

      // 每一轮都裁决，保证最后一轮也有结论，且「为何结束」始终明确
      const verdict = await assessConsensus(apiKey, judgeModel, question, answers, signal);
      if (signal.aborted) return;
      cost.record(verdict.model, verdict.usage);
      handlers.onJudgeVerdict(round, verdict.converged, verdict.reason);
      handlers.onCostUpdate(cost.totalCost, cost.breakdown());
      roundEntry.verdict = { converged: verdict.converged, reason: verdict.reason };
      transcript.push(roundEntry);

      if (verdict.converged) {
        converged = true;
        break;
      }
    }

    const lastAnswers = history[history.length - 1];
    const synthesis = await synthesize(apiKey, judgeModel, question, lastAnswers, converged, signal);
    if (signal.aborted) return;
    cost.record(synthesis.model, synthesis.usage);
    handlers.onFinalAnswer(synthesis.markdown);
    handlers.onCostUpdate(cost.totalCost, cost.breakdown());

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

    let conversationId = payload.conversationId ?? undefined;
    let turnIndex: number;
    if (conversationId != null && (await appendTurn(conversationId, turn))) {
      turnIndex = priorTurns.length;
    } else {
      conversationId = await createConversation(experts, judgeModel, maxRounds, turn);
      turnIndex = 0;
    }
    handlers.onDebateDone(conversationId, turnIndex);
  } catch (e) {
    if (signal.aborted) return;
    const msg = e instanceof Error ? e.message : String(e);
    handlers.onError(`辩论执行失败：${msg}`);
  }
}
