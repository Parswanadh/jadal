import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  OUTBOUND: Queue;
  ASSETS?: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

const APP_VERSION = '0.1.0';
const GIT_COMMIT = 'c0014a2';

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    version: APP_VERSION,
    commit: GIT_COMMIT,
  });
});

// Fallback to ASSETS if worker is invoked for asset routes
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`Cron triggered at ${new Date(event.scheduledTime).toISOString()}: ${event.cron}`);
  },
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`Queue ${batch.queue} received ${batch.messages.length} messages`);
  },
};
