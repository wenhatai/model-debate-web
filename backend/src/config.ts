import os from 'node:os';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  dmxApiBaseUrl: process.env.DMXAPI_BASE_URL ?? 'https://www.dmxapi.cn/v1',
  // 内置默认 Key（可用 env DMXAPI_KEY 覆盖）。请求未携带 Key 时回退到此值。
  defaultApiKey: process.env.DMXAPI_KEY ?? 'sk-Q9pRgm1yxytx1nSMokXmD1gN3ctSj6Si5JUqhXcrDeTC4KBc',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  // 追问时注入的历史上下文预算（按字符估算，约 4 字符/token）。超出后压缩更早历史。
  historyBudgetChars: Number(process.env.HISTORY_BUDGET_CHARS ?? 24000),
  dataDir: path.join(os.homedir(), '.model-debate'),
  dbFile: path.join(os.homedir(), '.model-debate', 'debate.db'),
};
