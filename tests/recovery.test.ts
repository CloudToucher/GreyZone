import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { DshDirector } from '../server/dsh.js';
import { GameTools } from '../server/tools.js';
import { fixture, commit } from './fixtures.js';

test('存档单写入锁；重启保留阶段、草稿、骰子与未完成任务', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const path = join(mkdtempSync(join(tmpdir(), 'greyzone-recovery-')), 'table.sqlite');
  const disk = new Store(path);
  disk.saveRoom(f.room);
  for (const source of [f.host, f.guest]) {
    const seat = disk.addSeat(f.room.id, source.seat.name, source.seat.host);
    seat.seat.characters = source.seat.characters;
    disk.saveSeat(seat.seat);
  }
  disk.saveRun(f.run);
  const tools = new GameTools(
    disk,
    f.library,
    () => {},
    () => 17,
  );
  const check = {
    id: 'persisted',
    actorId: 'pc-a',
    attribute: 'body',
    purpose: '检修',
    basis: '现场',
    difficulty: 12,
    audience: [],
  };
  tools.call('checks_resolve', { key: 'roll', checks: [check] }, f.run.id);
  tools.call(
    'turn_commit',
    {
      ...commit('checkpoint', false),
      changes: [{ op: 'adjust', id: 'pc-a', resource: 'cash', amount: -3, reason: '购买材料' }],
      decisions: [],
    },
    f.run.id,
  );
  tools.call(
    'state_apply',
    {
      key: 'draft',
      changes: [{ op: 'adjust', id: 'pc-a', resource: 'cash', amount: -2, reason: '下一阶段草稿' }],
    },
    f.run.id,
  );
  assert.throws(() => new Store(path), /已有服务运行/);
  disk.close();
  const restored = new Store(path);
  t.after(() => restored.close());
  assert.equal(restored.active(f.room.id)?.status, 'failed');
  assert.equal(restored.active(f.room.id)?.checkpoint, 1);
  assert.equal(
    (restored.room(f.room.id).world.records['pc-a'].data.resources as { cash: number }).cash,
    97,
  );
  assert.equal(
    (restored.active(f.room.id)!.draft.records['pc-a'].data.resources as { cash: number }).cash,
    95,
  );
  assert.equal(restored.rolls(f.run.id)[0].selected, 17);
  const resumed = restored.run(f.run.id);
  resumed.status = 'running';
  restored.saveRun(resumed);
  const recoveredTools = new GameTools(
    restored,
    f.library,
    () => {},
    () => {
      throw new Error('must not reroll');
    },
  );
  recoveredTools.call('checks_resolve', { key: 'replayed', checks: [check] }, f.run.id);
  assert.equal(restored.rolls(f.run.id).length, 1);
});

test('快速回答在上一调用结束后续跑；同一代请求不重复派发', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const director = new DshDirector(f.store, f.library, '.data/test-runtime');
  let release!: () => void;
  let calls = 0;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const fake = {
    request: async () => {
      calls++;
      if (calls === 1) {
        f.tools.call(
          'turn_ask',
          { key: 'q', prompt: '是否冒险？', characters: ['pc-a'] },
          f.run.id,
        );
        await waiting;
      } else f.tools.call('turn_commit', commit(), f.run.id);
      return { ok: true, metrics: { modelCalls: 1 } };
    },
  };
  Object.assign(director, { worker: () => fake });
  const first = director.launch(f.run.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.store.run(f.run.id).status, 'waiting');
  const run = f.store.run(f.run.id);
  run.question!.answers['pc-a'] = '按已知风险执行';
  run.status = 'running';
  run.metrics.resumptions++;
  f.store.saveRun(run);
  assert.equal(
    director.toolRun(f.room.id),
    undefined,
    'Older native turn cannot use tools after a queued new answer',
  );
  const second = director.launch(run.id),
    retry = director.launch(run.id);
  release();
  await Promise.all([first, second, retry]);
  assert.equal(calls, 2);
  assert.equal(f.store.run(run.id).status, 'completed');
  assert.equal(f.store.run(run.id).metrics.modelCalls, 2);
  assert.equal(director.toolRun(f.room.id), undefined);
});

test('发布完毕但原生调用尚未退出时，新一轮按序等待', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const director = new DshDirector(f.store, f.library, '.data/test-runtime');
  let release!: () => void,
    calls = 0;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  Object.assign(director, {
    worker: () => ({
      request: async () => {
        calls++;
        const id = director.toolRun(f.room.id)!;
        f.tools.call('turn_commit', commit(), id);
        if (calls === 1) await waiting;
        return { ok: true };
      },
    }),
  });
  const first = director.launch(f.run.id);
  await new Promise((r) => setImmediate(r));
  const room = f.store.room(f.room.id),
    next = { ...f.run, id: 'run-2', draft: room.world, baseVersion: room.worldVersion };
  f.store.saveRun(next);
  const second = director.launch(next.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(f.store.run(next.id).status, 'completed');
});
