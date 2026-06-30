export interface ExpertConfig {
  id: string;
  name: string;
  model: string;
}

export interface ExpertRoundState {
  expertId: string;
  round: number;
  content: string;
  status: 'streaming' | 'done' | 'error';
  promptTokens?: number;
  completionTokens?: number;
  errorMessage?: string;
}

export interface Verdict {
  round: number;
  converged: boolean;
  reason: string;
}

export interface CostBreakdownItem {
  model: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  cost: number;
}

export interface DebateConfig {
  question: string;
  experts: ExpertConfig[];
  maxRounds: number;
  judgeModel: string;
}

export interface HistoryItem {
  id: number;
  title: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  totalTokens: number;
}

export interface TranscriptAnswer {
  expertId: string;
  expertName: string;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface TranscriptRound {
  round: number;
  answers: TranscriptAnswer[];
  verdict?: { converged: boolean; reason: string };
}

export interface TurnRecord {
  question: string;
  transcript: TranscriptRound[];
  finalAnswer: string;
  rounds: number;
  converged: boolean;
  costBreakdown: CostBreakdownItem[];
  totalCost: number;
  totalTokens: number;
  createdAt: string;
}

export interface ConversationDetail {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  totalTokens: number;
  judgeModel: string;
  maxRounds: number;
  experts: ExpertConfig[];
  turns: TurnRecord[];
}

/** 追问时携带的此前一轮上下文 */
export interface PriorTurn {
  question: string;
  finalAnswer: string;
  expertFinals: { expertId: string; content: string }[];
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ExpertAnswer {
  expertId: string;
  expertName: string;
  model: string;
  round: number;
  content: string;
  usage: TokenUsage;
}

export interface ResumeRequest {
  conversationId: number;
  turnIndex: number;
  extraRounds: number;
}
