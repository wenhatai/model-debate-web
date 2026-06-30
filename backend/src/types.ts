export interface ExpertConfig {
  id: string;
  name: string;
  model: string;
}

export interface PriorTurn {
  question: string;
  finalAnswer: string;
  /** 每个专家在该 turn 收敛时自己的最终发言，用于个体上下文连续性 */
  expertFinals: { expertId: string; content: string }[];
}

export interface DebateRequest {
  question: string;
  experts: ExpertConfig[];
  maxRounds: number;
  judgeModel?: string;
  apiKey: string;
  /** 同一会话内此前各轮（追问时携带） */
  history?: PriorTurn[];
  /** 已存在的会话 id，追问时携带以便追加 turn */
  conversationId?: number;
  /** 继续讨论：对已存在会话中某个未收敛的 turn 追加若干轮辩论 */
  resume?: ResumeRequest;
}

export interface ResumeRequest {
  conversationId: number;
  turnIndex: number;
  /** 在已有轮次基础上，最多再讨论的轮数 */
  extraRounds: number;
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

export interface CostBreakdownItem {
  model: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  cost: number;
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
