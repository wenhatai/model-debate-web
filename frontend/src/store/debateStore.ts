import { create } from 'zustand';
import type {
  CostBreakdownItem,
  ConversationDetail,
  DebateConfig,
  ExpertConfig,
  ExpertRoundState,
  PriorTurn,
  Verdict,
} from '../types';
import { runDebateStream, type DebateStreamHandlers } from '../services/sseClient';

export type DebateStatus = 'idle' | 'running' | 'done' | 'error';

export interface TurnState {
  question: string;
  answers: Record<string, ExpertRoundState>; // key: `${expertId}-${round}`
  verdicts: Verdict[];
  finalAnswer: string;
  totalCost: number;
  costBreakdown: CostBreakdownItem[];
  currentRound: number;
  status: 'running' | 'done' | 'error';
  errorMessage: string;
}

interface DebateState {
  status: DebateStatus;
  experts: ExpertConfig[];
  maxRounds: number;
  judgeModel: string;
  conversationId: number | null;
  turns: TurnState[];
  abort: (() => void) | null;

  startDebate: (config: DebateConfig, apiKey: string) => void;
  askFollowUp: (question: string, apiKey: string) => void;
  continueDebate: (extraRounds: number, apiKey: string) => void;
  loadConversation: (detail: ConversationDetail) => void;
  stopDebate: () => void;
  reset: () => void;
}

const key = (expertId: string, round: number) => `${expertId}-${round}`;

function newTurn(question: string): TurnState {
  return {
    question,
    answers: {},
    verdicts: [],
    finalAnswer: '',
    totalCost: 0,
    costBreakdown: [],
    currentRound: 0,
    status: 'running',
    errorMessage: '',
  };
}

function expertFinal(turn: TurnState, expertId: string): string {
  let best: ExpertRoundState | undefined;
  for (const a of Object.values(turn.answers)) {
    if (a.expertId === expertId && (!best || a.round > best.round)) best = a;
  }
  return best?.content ?? '';
}

export const useDebateStore = create<DebateState>((set, get) => {
  const patchLast = (patch: (t: TurnState) => TurnState) => {
    const turns = get().turns;
    if (turns.length === 0) return;
    const updated = patch(turns[turns.length - 1]);
    set({ turns: [...turns.slice(0, -1), updated] });
  };

  // 按动画帧批量合并 delta：无论各模型 token 颗粒度如何，所有专家列每帧一起推进，
  // 避免逐 token 全量重渲染导致的卡顿与“看起来串行”的错觉。
  let pending: { expertId: string; round: number; text: string }[] = [];
  let scheduled = false;

  const applyDeltas = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    patchLast((t) => {
      const answers = { ...t.answers };
      for (const d of batch) {
        const k = key(d.expertId, d.round);
        const prev = answers[k];
        answers[k] = {
          expertId: d.expertId,
          round: d.round,
          content: (prev?.content ?? '') + d.text,
          status: prev?.status === 'done' ? 'done' : 'streaming',
          promptTokens: prev?.promptTokens,
          completionTokens: prev?.completionTokens,
          errorMessage: prev?.errorMessage,
        };
      }
      return { ...t, answers };
    });
  };

  const flush = () => {
    scheduled = false;
    applyDeltas();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(flush);
    else setTimeout(flush, 30);
  };

  const handlers = (): DebateStreamHandlers => ({
    onRoundStart: (round) => {
      applyDeltas();
      patchLast((t) => ({ ...t, currentRound: round }));
    },
    onExpertDelta: (expertId, round, text) => {
      pending.push({ expertId, round, text });
      schedule();
    },
    onExpertDone: (expertId, round, usage) => {
      applyDeltas();
      patchLast((t) => {
        const k = key(expertId, round);
        const prev = t.answers[k] ?? { expertId, round, content: '', status: 'done' as const };
        return {
          ...t,
          answers: {
            ...t.answers,
            [k]: {
              ...prev,
              status: 'done',
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            },
          },
        };
      });
    },
    onExpertError: (expertId, round, message) => {
      applyDeltas();
      patchLast((t) => {
        const k = key(expertId, round);
        const prev = t.answers[k] ?? { expertId, round, content: '', status: 'error' as const };
        return { ...t, answers: { ...t.answers, [k]: { ...prev, status: 'error', errorMessage: message } } };
      });
    },
    onJudgeVerdict: (round, converged, reason) => {
      applyDeltas();
      patchLast((t) => ({ ...t, verdicts: [...t.verdicts, { round, converged, reason }] }));
    },
    onCostUpdate: (total, breakdown) =>
      patchLast((t) => ({ ...t, totalCost: total, costBreakdown: breakdown })),
    onFinalAnswer: (markdown) => {
      applyDeltas();
      patchLast((t) => ({ ...t, finalAnswer: markdown }));
    },
    onDebateDone: (conversationId) => {
      applyDeltas();
      patchLast((t) => ({ ...t, status: 'done' }));
      set({ status: 'done', conversationId, abort: null });
    },
    onError: (message) => {
      applyDeltas();
      patchLast((t) => ({ ...t, status: 'error', errorMessage: message }));
      set({ status: 'error', errorMessage: message, abort: null } as Partial<DebateState>);
    },
  });

  return {
    status: 'idle',
    experts: [],
    maxRounds: 3,
    judgeModel: '',
    conversationId: null,
    turns: [],
    abort: null,

    startDebate: (config, apiKey) => {
      set({
        status: 'running',
        experts: config.experts,
        maxRounds: config.maxRounds,
        judgeModel: config.judgeModel,
        conversationId: null,
        turns: [newTurn(config.question)],
      });
      const abort = runDebateStream(
        { ...config, apiKey, history: [], conversationId: null },
        handlers(),
      );
      set({ abort });
    },

    askFollowUp: (question, apiKey) => {
      const { status, turns, experts, maxRounds, judgeModel, conversationId } = get();
      if (status === 'running' || turns.length === 0) return;

      const history: PriorTurn[] = turns.map((t) => ({
        question: t.question,
        finalAnswer: t.finalAnswer,
        expertFinals: experts.map((e) => ({ expertId: e.id, content: expertFinal(t, e.id) })),
      }));

      set({ status: 'running', turns: [...turns, newTurn(question)] });
      const abort = runDebateStream(
        { question, experts, maxRounds, judgeModel, apiKey, history, conversationId },
        handlers(),
      );
      set({ abort });
    },

    continueDebate: (extraRounds, apiKey) => {
      const { status, turns, experts, maxRounds, judgeModel, conversationId } = get();
      if (status === 'running' || turns.length === 0 || conversationId == null) return;
      const turnIndex = turns.length - 1;

      set({ status: 'running' });
      patchLast((t) => ({ ...t, status: 'running' }));
      const abort = runDebateStream(
        {
          question: turns[turnIndex].question,
          experts,
          maxRounds,
          judgeModel,
          apiKey,
          resume: { conversationId, turnIndex, extraRounds },
        },
        handlers(),
      );
      set({ abort });
    },

    loadConversation: (detail) => {
      const experts = detail.experts ?? [];
      const turns: TurnState[] = (detail.turns ?? []).map((t) => {
        const answers: Record<string, ExpertRoundState> = {};
        for (const round of t.transcript ?? []) {
          for (const a of round.answers) {
            answers[key(a.expertId, round.round)] = {
              expertId: a.expertId,
              round: round.round,
              content: a.content,
              status: 'done',
              promptTokens: a.promptTokens,
              completionTokens: a.completionTokens,
            };
          }
        }
        const verdicts: Verdict[] = (t.transcript ?? [])
          .filter((r) => r.verdict)
          .map((r) => ({ round: r.round, converged: r.verdict!.converged, reason: r.verdict!.reason }));
        return {
          question: t.question,
          answers,
          verdicts,
          finalAnswer: t.finalAnswer,
          totalCost: t.totalCost,
          costBreakdown: t.costBreakdown ?? [],
          currentRound: t.rounds,
          status: 'done' as const,
          errorMessage: '',
        };
      });
      set({
        status: 'done',
        experts,
        maxRounds: detail.maxRounds && detail.maxRounds > 0 ? detail.maxRounds : 3,
        judgeModel: detail.judgeModel || experts[0]?.model || '',
        conversationId: detail.id,
        turns,
        abort: null,
      });
    },

    stopDebate: () => {
      get().abort?.();
      patchLast((t) => (t.status === 'running' ? { ...t, status: 'error', errorMessage: '已停止' } : t));
      set({ status: 'idle', abort: null });
    },

    reset: () =>
      set({
        status: 'idle',
        experts: [],
        conversationId: null,
        turns: [],
        abort: null,
      }),
  };
});
