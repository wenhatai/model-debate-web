import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { listModels } from './dmxClient.js';
import { runDebate } from './orchestrator.js';
import { SsePublisher } from './sse.js';
import { listConversations, getConversation, deleteConversation } from './db.js';
import type { DebateRequest } from './types.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

app.post('/api/debate/stream', (request, reply) => {
  const body = request.body as DebateRequest;
  // 接管底层响应进行 SSE 写入，告知 Fastify 不再处理该响应。
  reply.hijack();
  const sse = new SsePublisher(reply.raw);
  void runDebate(body, sse);
});

app.get('/api/models', async (request, reply) => {
  const header = request.headers['x-api-key'];
  const apiKey = typeof header === 'string' && header ? header : config.defaultApiKey;
  try {
    return await listModels(apiKey);
  } catch (e) {
    return reply.code(502).send({ message: e instanceof Error ? e.message : '获取模型失败' });
  }
});

app.get('/api/history', async () => listConversations());

app.get('/api/history/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const conversation = getConversation(id);
  if (!conversation) return reply.code(404).send({ message: '未找到' });
  return conversation;
});

app.delete('/api/history/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const ok = deleteConversation(id);
  if (!ok) return reply.code(404).send({ message: '未找到' });
  return reply.code(204).send();
});

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`backend listening on :${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
