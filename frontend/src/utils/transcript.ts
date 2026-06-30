import type { ExpertConfig, ExpertRoundState, TranscriptRound, Verdict } from '../types';

/**
 * 将流式状态（answers map + verdicts）转换为结构化 transcript，用于导出。
 */
export function buildTranscript(
  answers: Record<string, ExpertRoundState>,
  verdicts: Verdict[],
  experts: ExpertConfig[],
): TranscriptRound[] {
  const maxRound = Math.max(0, ...Object.values(answers).map((a) => a.round));
  const rounds: TranscriptRound[] = [];
  for (let r = 1; r <= maxRound; r++) {
    const v = verdicts.find((x) => x.round === r);
    rounds.push({
      round: r,
      answers: experts.map((e) => {
        const st = answers[`${e.id}-${r}`];
        return {
          expertId: e.id,
          expertName: e.name,
          model: e.model,
          content: st?.content ?? '',
          promptTokens: st?.promptTokens ?? 0,
          completionTokens: st?.completionTokens ?? 0,
        };
      }),
      verdict: v ? { converged: v.converged, reason: v.reason } : undefined,
    });
  }
  return rounds;
}
