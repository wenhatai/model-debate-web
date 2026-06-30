import type { ConversationDetail, HistoryItem } from '../types';
import { getApiKey } from '../utils/storage';
import { listModels } from '../core/dmxClient';
import {
  listConversations,
  getConversation,
  deleteConversation,
} from '../db/conversations';

export async function fetchModels(): Promise<string[]> {
  return listModels(getApiKey());
}

export async function fetchHistory(): Promise<HistoryItem[]> {
  return listConversations();
}

export async function fetchHistoryDetail(id: number): Promise<ConversationDetail> {
  const detail = await getConversation(id);
  if (!detail) throw new Error('获取历史详情失败');
  return detail;
}

export async function deleteHistory(id: number): Promise<void> {
  await deleteConversation(id);
}
