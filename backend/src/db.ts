import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from './config.js';
import type { CostBreakdownItem, ExpertConfig, TranscriptRound } from './types.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    experts_json TEXT,
    turns_json TEXT,
    judge_model TEXT,
    max_rounds INTEGER DEFAULT 3,
    total_cost REAL DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// 兼容旧表：补齐新增列
function ensureColumn(name: string, ddl: string): void {
  const cols = db.prepare('PRAGMA table_info(conversation)').all() as { name: string }[];
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE conversation ADD COLUMN ${ddl}`);
  }
}
ensureColumn('judge_model', 'judge_model TEXT');
ensureColumn('max_rounds', 'max_rounds INTEGER DEFAULT 3');

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

interface ConversationRow {
  id: number;
  title: string;
  experts_json: string;
  turns_json: string;
  judge_model: string | null;
  max_rounds: number | null;
  total_cost: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export function createConversation(
  experts: ExpertConfig[],
  judgeModel: string,
  maxRounds: number,
  turn: TurnRecord,
): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO conversation
        (title, experts_json, turns_json, judge_model, max_rounds, total_cost, total_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      turn.question,
      JSON.stringify(experts),
      JSON.stringify([turn]),
      judgeModel,
      maxRounds,
      turn.totalCost,
      turn.totalTokens,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function appendTurn(conversationId: number, turn: TurnRecord): boolean {
  const row = db
    .prepare('SELECT * FROM conversation WHERE id = ?')
    .get(conversationId) as ConversationRow | undefined;
  if (!row) return false;
  const turns: TurnRecord[] = safeParse(row.turns_json) ?? [];
  turns.push(turn);
  const totalCost = turns.reduce((s, t) => s + (t.totalCost ?? 0), 0);
  const totalTokens = turns.reduce((s, t) => s + (t.totalTokens ?? 0), 0);
  db.prepare(
    `UPDATE conversation SET turns_json = ?, total_cost = ?, total_tokens = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(turns), totalCost, totalTokens, new Date().toISOString(), conversationId);
  return true;
}

/** 替换会话中指定下标的 turn（用于「继续讨论」追加轮次后回写整条 turn）。 */
export function replaceTurn(conversationId: number, turnIndex: number, turn: TurnRecord): boolean {
  const row = db
    .prepare('SELECT * FROM conversation WHERE id = ?')
    .get(conversationId) as ConversationRow | undefined;
  if (!row) return false;
  const turns: TurnRecord[] = safeParse(row.turns_json) ?? [];
  if (turnIndex < 0 || turnIndex >= turns.length) return false;
  turns[turnIndex] = turn;
  const totalCost = turns.reduce((s, t) => s + (t.totalCost ?? 0), 0);
  const totalTokens = turns.reduce((s, t) => s + (t.totalTokens ?? 0), 0);
  db.prepare(
    `UPDATE conversation SET turns_json = ?, total_cost = ?, total_tokens = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(turns), totalCost, totalTokens, new Date().toISOString(), conversationId);
  return true;
}

/** 读取会话中指定下标的 turn 及上下文（用于「继续讨论」重建辩论状态）。 */
export function getConversationRaw(conversationId: number) {
  const r = db.prepare('SELECT * FROM conversation WHERE id = ?').get(conversationId) as
    | ConversationRow
    | undefined;
  if (!r) return null;
  return {
    experts: (safeParse(r.experts_json) ?? []) as ExpertConfig[],
    judgeModel: r.judge_model ?? '',
    maxRounds: r.max_rounds ?? 3,
    turns: (safeParse(r.turns_json) ?? []) as TurnRecord[],
  };
}

export function listConversations() {
  const rows = db
    .prepare('SELECT * FROM conversation ORDER BY updated_at DESC')
    .all() as ConversationRow[];
  return rows.map((r) => {
    const turns: TurnRecord[] = safeParse(r.turns_json) ?? [];
    return {
      id: r.id,
      title: r.title,
      turnCount: turns.length,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      totalCost: r.total_cost,
      totalTokens: r.total_tokens,
    };
  });
}

export function getConversation(id: number) {
  const r = db.prepare('SELECT * FROM conversation WHERE id = ?').get(id) as
    | ConversationRow
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalCost: r.total_cost,
    totalTokens: r.total_tokens,
    judgeModel: r.judge_model ?? '',
    maxRounds: r.max_rounds ?? 3,
    experts: safeParse(r.experts_json),
    turns: safeParse(r.turns_json) ?? [],
  };
}

export function deleteConversation(id: number): boolean {
  const info = db.prepare('DELETE FROM conversation WHERE id = ?').run(id);
  return info.changes > 0;
}

function safeParse(json: string | null) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
