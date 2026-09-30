import { createApp } from '../../server/app.js';
import { fixtureDirector } from '../fixtures.js';
const app = await createApp({
  directory: process.env.DATA_DIR ?? '.data/ui-tests',
  director: fixtureDirector,
  die: () => 1,
  serveStatic: true,
});
await app.listen({ port: Number(process.env.PORT ?? 4321), host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
