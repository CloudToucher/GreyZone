import { createApp } from './app.js';
import { loadEnv } from './ai/dsh.js';
await loadEnv();
const app = await createApp({ directory: process.env.DATA_DIR ?? '.data' });
const port = Number(process.env.PORT ?? 4317),
  host = process.env.HOST ?? '127.0.0.1';
try {
  await app.listen({ port, host });
  console.log(`灰区：撤离 · http://${host}:${port}`);
  console.log('开发界面：http://127.0.0.1:5173 · 存档在 DATA_DIR 中自动保存');
} catch (error) {
  await app.close();
  throw error;
}
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));
  });
