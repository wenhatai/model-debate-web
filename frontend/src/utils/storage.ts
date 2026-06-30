import type { DebateConfig } from '../types';

const KEY_API = 'dmxapi_key';
const KEY_CONFIG = 'debate_last_config';

/** 用户在本地保存的 DMXAPI Key（首次填写后缓存，后续无需再填）。未设置时为空串。 */
export function getApiKey(): string {
  return localStorage.getItem(KEY_API)?.trim() ?? '';
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

export function setApiKey(value: string): void {
  localStorage.setItem(KEY_API, value);
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function getLastConfig(): Partial<DebateConfig> | null {
  const raw = localStorage.getItem(KEY_CONFIG);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<DebateConfig>;
  } catch {
    return null;
  }
}

export function saveLastConfig(config: Partial<DebateConfig>): void {
  localStorage.setItem(KEY_CONFIG, JSON.stringify(config));
}
