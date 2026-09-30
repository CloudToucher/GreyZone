import { DshDirector, dshVersion, loadEnv } from '../server/ai/dsh.js';
import { z } from 'zod';
await loadEnv();
try {
  console.log(`Node ${process.version}`);
  console.log(`dsh ${await dshVersion()}`);
  if (process.argv.includes('--live')) {
    const result = await new DshDirector().request(
      '连通性检查。只返回 {"ok":true}。',
      z.object({ ok: z.literal(true) }).strict(),
      new AbortController().signal,
    );
    console.log(`模型与游戏专用配置：${result.ok ? '正常' : '失败'}`);
  } else console.log('本地启动检查通过。运行 npm run doctor -- --live 可验证真实模型响应。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '检查失败');
  process.exitCode = 1;
}
