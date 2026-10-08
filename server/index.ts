import { loadLocalEnv } from './config.js';
loadLocalEnv();
const { createApp } = await import('./app.js');
const game = createApp();
const port = Number(process.env.PORT ?? 4317),
  host = process.env.HOST ?? '127.0.0.1';
await game.app.listen({ host, port });
game.setUrl(`http://127.0.0.1:${port}`);
console.log(`灰区团桌：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void game.app.close().then(() => process.exit(0));
  });
