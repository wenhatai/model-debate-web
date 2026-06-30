import type {
  ConversationDetail,
  ExpertConfig,
  HistoryItem,
  TurnRecord,
} from '../types';

const DB_NAME = 'model-debate';
const STORE = 'conversations';
const VERSION = 1;

interface ConversationRecord {
  id?: number;
  title: string;
  experts: ExpertConfig[];
  turns: TurnRecord[];
  judgeModel: string;
  maxRounds: number;
  totalCost: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function getRecord(id: number): Promise<ConversationRecord | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<ConversationRecord | undefined>);
}

function putRecord(record: ConversationRecord): Promise<number> {
  return tx('readwrite', (s) => s.put(record) as IDBRequest<IDBValidKey>).then((k) => Number(k));
}

function recomputeTotals(turns: TurnRecord[]): { totalCost: number; totalTokens: number } {
  return {
    totalCost: turns.reduce((s, t) => s + (t.totalCost ?? 0), 0),
    totalTokens: turns.reduce((s, t) => s + (t.totalTokens ?? 0), 0),
  };
}

export async function createConversation(
  experts: ExpertConfig[],
  judgeModel: string,
  maxRounds: number,
  turn: TurnRecord,
): Promise<number> {
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    title: turn.question,
    experts,
    turns: [turn],
    judgeModel,
    maxRounds,
    totalCost: turn.totalCost,
    totalTokens: turn.totalTokens,
    createdAt: now,
    updatedAt: now,
  };
  return putRecord(record);
}

export async function appendTurn(conversationId: number, turn: TurnRecord): Promise<boolean> {
  const record = await getRecord(conversationId);
  if (!record) return false;
  record.turns.push(turn);
  Object.assign(record, recomputeTotals(record.turns));
  record.updatedAt = new Date().toISOString();
  await putRecord(record);
  return true;
}

export async function replaceTurn(
  conversationId: number,
  turnIndex: number,
  turn: TurnRecord,
): Promise<boolean> {
  const record = await getRecord(conversationId);
  if (!record) return false;
  if (turnIndex < 0 || turnIndex >= record.turns.length) return false;
  record.turns[turnIndex] = turn;
  Object.assign(record, recomputeTotals(record.turns));
  record.updatedAt = new Date().toISOString();
  await putRecord(record);
  return true;
}

export async function listConversations(): Promise<HistoryItem[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<ConversationRecord[]>);
  return all
    .map((r) => ({
      id: r.id as number,
      title: r.title,
      turnCount: r.turns.length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      totalCost: r.totalCost,
      totalTokens: r.totalTokens,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getConversation(id: number): Promise<ConversationDetail | null> {
  const r = await getRecord(id);
  if (!r) return null;
  return {
    id: r.id as number,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    totalCost: r.totalCost,
    totalTokens: r.totalTokens,
    judgeModel: r.judgeModel ?? '',
    maxRounds: r.maxRounds ?? 3,
    experts: r.experts ?? [],
    turns: r.turns ?? [],
  };
}

export async function getConversationRaw(
  id: number,
): Promise<{ experts: ExpertConfig[]; judgeModel: string; maxRounds: number; turns: TurnRecord[] } | null> {
  const r = await getRecord(id);
  if (!r) return null;
  return {
    experts: r.experts ?? [],
    judgeModel: r.judgeModel ?? '',
    maxRounds: r.maxRounds ?? 3,
    turns: r.turns ?? [],
  };
}

export async function deleteConversation(id: number): Promise<boolean> {
  await tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
  return true;
}
