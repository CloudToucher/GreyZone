import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { emptyPlan } from '../server/engine.js';
import type { PublicState } from '../shared/types.js';
const spec = {
  name: '主角',
  profile: 'mechanic',
  school: 'none',
  background: '测试',
  mode: 'local',
};
async function cleanup(directory: string) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^greyzone-(api|rollback|free)-/);
  await rm(target, { recursive: true, force: true });
}
test('authenticated proposals, private projection, multiplayer ownership, retry receipts and restart persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'greyzone-api-'));
  let app = await createApp({ directory, serveStatic: false, die: () => 1 });
  try {
    const create = await app.inject({ method: 'POST', url: '/api/rooms', payload: spec });
    assert.equal(create.statusCode, 201);
    const r = create.json();
    let s: PublicState = r.state;
    const headers = { authorization: `Bearer ${r.token}` };
    assert.equal((await app.inject({ url: `/api/rooms/${r.room}` })).statusCode, 401);
    const joined = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/join`,
      payload: { name: '同伴', profile: 'medic', school: 'none', background: '' },
    });
    assert.equal(joined.statusCode, 200);
    const guest = joined.json();
    s = (await app.inject({ url: `/api/rooms/${r.room}`, headers })).json();
    const input = {
      requestId: randomUUID(),
      revision: s.revision,
      intent: '前往码头',
      command: { kind: 'travel', target: 'dock' },
    };
    let result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/actions`,
      headers,
      payload: input,
    });
    assert.equal(result.statusCode, 200, result.body);
    s = result.json();
    assert.equal(s.minute, 0);
    assert.ok(s.proposal);
    assert.ok(!('success' in s.proposal));
    result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/actions`,
      headers,
      payload: input,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().revision, s.revision);
    const decision = {
      requestId: randomUUID(),
      revision: s.revision,
      proposalId: s.proposal!.id,
      decision: 'confirm',
    };
    result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/decisions`,
      headers: { authorization: `Bearer ${guest.token}` },
      payload: decision,
    });
    assert.equal(result.statusCode, 403);
    result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/decisions`,
      headers,
      payload: decision,
    });
    assert.equal(result.statusCode, 200, result.body);
    s = result.json();
    assert.equal(s.minute, 20);
    assert.equal(s.characters[1].location, 'town');
    result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/decisions`,
      headers,
      payload: decision,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().minute, 20);
    assert.equal(result.json().revision, s.revision);
    const raw = await readFile(join(directory, `${r.room}.json`), 'utf8');
    assert.ok(!raw.includes(r.token));
    await app.close();
    app = await createApp({ directory, serveStatic: false });
    assert.equal((await app.inject({ url: `/api/rooms/${r.room}`, headers })).json().minute, 20);
  } finally {
    await app.close();
    await cleanup(directory);
  }
});
test('model failure and invalid resource effects do not commit world changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'greyzone-rollback-'));
  const app = await createApp({
    directory,
    serveStatic: false,
    director: {
      async plan() {
        const p = emptyPlan('捏造资源');
        p.costs = [{ itemId: 'does-not-exist', quantity: 1 }];
        return p;
      },
    },
  });
  try {
    const r = (await app.inject({ method: 'POST', url: '/api/rooms', payload: spec })).json(),
      headers = { authorization: `Bearer ${r.token}` };
    const result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/actions`,
      headers,
      payload: { requestId: randomUUID(), revision: 0, intent: '随便做点什么' },
    });
    assert.equal(result.statusCode, 400);
    const s = (await app.inject({ url: `/api/rooms/${r.room}`, headers })).json();
    assert.equal(s.minute, 0);
    assert.equal(s.revision, 0);
    assert.equal(s.proposal, null);
    assert.equal(s.characters[0].cash, 300);
  } finally {
    await app.close();
    await cleanup(directory);
  }
});
test('free AI adjudication persists custom objects without an action whitelist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'greyzone-free-'));
  const app = await createApp({
    directory,
    serveStatic: false,
    die: () => 1,
    director: {
      async plan(_s, _id, intent) {
        assert.ok(intent.includes('警报'));
        const p = emptyPlan('制作机械警报', 20);
        p.skill = 'technical';
        p.costs = [
          { itemId: 'wire', quantity: 1 },
          { itemId: 'scrap', quantity: 1 },
        ];
        p.success.effects = [
          {
            type: 'create',
            item: {
              id: 'custom-alarm',
              name: '罐片警报',
              quantity: 1,
              weight: 0.3,
              value: 25,
              kind: 'gear',
              description: '拉动即响。',
            },
            basis: '钢丝和罐片',
          },
        ];
        return p;
      },
    },
  });
  try {
    const r = (await app.inject({ method: 'POST', url: '/api/rooms', payload: spec })).json(),
      headers = { authorization: `Bearer ${r.token}` };
    const plan = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/actions`,
      headers,
      payload: { requestId: randomUUID(), revision: 0, intent: '用细钢丝做一个警报' },
    });
    assert.equal(plan.statusCode, 200, plan.body);
    const s = plan.json();
    const result = await app.inject({
      method: 'POST',
      url: `/api/rooms/${r.room}/decisions`,
      headers,
      payload: {
        requestId: randomUUID(),
        revision: s.revision,
        proposalId: s.proposal.id,
        decision: 'confirm',
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(
      result.json().characters[0].inventory.some((i: { id: string }) => i.id === 'custom-alarm'),
    );
  } finally {
    await app.close();
    await cleanup(directory);
  }
});
