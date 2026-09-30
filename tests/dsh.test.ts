import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { disabledPlugins, parseJson, runProcess } from '../server/ai/dsh.js';

test('strict JSON contract accepts a single fenced object and rejects arbitrary state edits', () => {
  const schema = z.object({ text: z.string() }).strict();
  assert.deepEqual(parseJson('```json\n{"text":"中文完整"}\n```', schema), { text: '中文完整' });
  assert.throws(() => parseJson('{"text":"hello","credits":999}', schema), /协议校验/);
  assert.throws(() => parseJson('Here is your JSON {"text":"hi"}', schema), /协议校验/);
});
test('transport captures UTF-8 split across byte chunks without invoking a shell', async () => {
  const script =
    'const b=Buffer.from("围栏镇已经封锁");process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),30)';
  assert.equal(
    await runProcess({ executable: process.execPath, args: ['-e', script] }, []),
    '围栏镇已经封锁',
  );
});
test('failed subprocesses, timeout and cancellation report errors without leaking stderr', async () => {
  await assert.rejects(
    runProcess(
      {
        executable: process.execPath,
        args: ['-e', 'process.stderr.write("secret-key 401");process.exit(1)'],
      },
      [],
    ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /凭据/);
      assert.ok(!error.message.includes('secret-key'));
      return true;
    },
  );
  await assert.rejects(
    runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, [], {
      timeoutMs: 100,
    }),
    /超时/,
  );
  const controller = new AbortController();
  const promise = runProcess(
    { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
    [],
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(promise, /取消/);
});
test('game profile disables shell, filesystem, subagent and code execution plugins', () => {
  for (const id of [
    'tool-bash',
    'tool-pwsh',
    'tool-fs',
    'tool-subagent',
    'code-runtime',
    'tool-web',
    'agent-instructions',
  ])
    assert.ok(disabledPlugins.includes(id));
});
