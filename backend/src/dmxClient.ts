import { config } from './config.js';
import type { ChatMessage, TokenUsage } from './types.js';

function estimateFromMessages(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.max(1, Math.floor(chars / 4));
}

function estimateFromText(text: string): number {
  return Math.max(1, Math.floor((text?.length ?? 0) / 4));
}

/**
 * 流式调用 DMXAPI（OpenAI 兼容），逐 token 回调 onDelta，返回 token 用量。
 */
export async function streamChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
): Promise<TokenUsage> {
  const res = await fetch(`${config.dmxApiBaseUrl}/chat/completions`, {
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
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`DMXAPI ${res.status}: ${text.slice(0, 200)}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
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
): Promise<{ content: string; usage: TokenUsage }> {
  const res = await fetch(`${config.dmxApiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: false }),
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
 * 透传 DMXAPI 模型列表。
 */
export async function listModels(apiKey: string): Promise<unknown> {
  const res = await fetch(`${config.dmxApiBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DMXAPI ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
