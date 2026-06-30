import { coreConfig } from './config';
import type { ChatMessage, TokenUsage } from '../types';

function estimateFromMessages(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.max(1, Math.floor(chars / 4));
}

function estimateFromText(text: string): number {
  return Math.max(1, Math.floor((text?.length ?? 0) / 4));
}

/**
 * 浏览器流式调用 DMXAPI（OpenAI 兼容），逐 token 回调 onDelta，返回 token 用量。
 * 通过 ReadableStream reader 读取 SSE 分片，支持 AbortSignal 中止。
 */
export async function streamChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<TokenUsage> {
  const res = await fetch(`${coreConfig.dmxApiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`DMXAPI ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nlIndex: number;
    while ((nlIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nlIndex).trim();
      buffer = buffer.slice(nlIndex + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '' || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta: string = json?.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
        if (json?.usage) {
          promptTokens = json.usage.prompt_tokens ?? promptTokens;
          completionTokens = json.usage.completion_tokens ?? completionTokens;
        }
      } catch {
        // 跳过无法解析的分片
      }
    }
  }

  if (promptTokens === 0 && completionTokens === 0) {
    promptTokens = estimateFromMessages(messages);
    completionTokens = estimateFromText(full);
  }
  return { promptTokens, completionTokens };
}

/**
 * 非流式调用，返回完整回复与 token 用量（用于裁判判定/综合）。
 */
export async function chat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ content: string; usage: TokenUsage }> {
  const res = await fetch(`${coreConfig.dmxApiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DMXAPI ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  const usage: TokenUsage = json?.usage
    ? {
        promptTokens: json.usage.prompt_tokens ?? estimateFromMessages(messages),
        completionTokens: json.usage.completion_tokens ?? estimateFromText(content),
      }
    : { promptTokens: estimateFromMessages(messages), completionTokens: estimateFromText(content) };
  return { content, usage };
}

/**
 * 拉取 DMXAPI 模型列表，返回已排序的模型 id 数组。
 */
export async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${coreConfig.dmxApiBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DMXAPI ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: { id?: string }[] };
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
}
