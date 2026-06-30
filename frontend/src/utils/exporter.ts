import type { CostBreakdownItem, ExpertConfig, TranscriptRound } from '../types';

export interface ExportTurn {
  question: string;
  transcript: TranscriptRound[];
  finalAnswer: string;
  costBreakdown?: CostBreakdownItem[];
  totalCost?: number;
}

export interface ExportData {
  title: string;
  experts: ExpertConfig[];
  turns: ExportTurn[];
  totalCost: number;
  createdAt?: string;
}

export function toMarkdown(data: ExportData): string {
  const lines: string[] = [];
  lines.push(`# 多模型辩论记录`);
  lines.push('');
  lines.push(`**主题：** ${data.title}`);
  if (data.createdAt) lines.push(`**时间：** ${data.createdAt}`);
  lines.push(`**参与专家：** ${data.experts.map((e) => `${e.name}(${e.model})`).join('、')}`);
  lines.push('');

  data.turns.forEach((turn, ti) => {
    lines.push(`# ${ti === 0 ? '提问' : `追问 ${ti}`}：${turn.question}`);
    lines.push('');
    for (const round of turn.transcript) {
      lines.push(`## 第 ${round.round} 轮`);
      lines.push('');
      for (const a of round.answers) {
        lines.push(`### ${a.expertName}（${a.model}）`);
        lines.push('');
        lines.push(a.content);
        lines.push('');
      }
      if (round.verdict) {
        lines.push(`> 裁判判定：${round.verdict.converged ? '已收敛' : '未收敛'} — ${round.verdict.reason}`);
        lines.push('');
      }
    }
    lines.push(`## 最佳答案`);
    lines.push('');
    lines.push(turn.finalAnswer);
    lines.push('');
  });

  lines.push(`---`);
  lines.push(`**预估总费用：** $${data.totalCost.toFixed(6)}`);
  lines.push('');
  return lines.join('\n');
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportMarkdown(data: ExportData): void {
  download(`debate-${Date.now()}.md`, toMarkdown(data), 'text/markdown');
}

export function exportJson(data: ExportData): void {
  download(`debate-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
}
