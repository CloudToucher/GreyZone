import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.js';
import { Store, uid } from '../server/store.js';
import { ManualDirector } from './fixtures.js';

function harness() {
  const game = createApp({
    store: new Store(':memory:'),
    serveStatic: false,
    director: (s) => new ManualDirector(s),
  });
  const post = async (route: string, payload: Record<string, unknown> = {}, token = '') =>
    game.app.inject({
      method: 'POST',
      url: route,
      headers: { authorization: 'Bearer ' + token },
      payload: { requestId: uid(), ...payload },
    });
  const create = async () => {
    const response = await post('/api/rooms', { name: '房主' });
    assert.equal(response.statusCode, 201);
    return response.json() as { id: string; token: string };
  };
  const character = async (room: string, token: string, name: string) => {
    const result = await post(`/api/rooms/${room}/characters`, { name }, token);
    assert.equal(result.statusCode, 200);
    const id = result.json().characterId as string;
    const data = game.store.room(room);
    data.world.records[id].data.ready = true;
    data.world.records[id].data.specialties = ['工程'];
    game.store.saveRoom(data);
    return id;
  };
  return { ...game, post, create, character };
}

test('1—6 席位、一人多角、角色所有权与房主裁决权限', async (t) => {
  const h = harness();
  t.after(() => h.app.close());
  const room = await h.create(),
    guests: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await h.post(`/api/rooms/${room.id}/join`, { name: '玩家' + i });
    assert.equal(r.statusCode, 200);
    guests.push(r.json().token);
  }
  assert.equal((await h.post(`/api/rooms/${room.id}/join`, { name: '第七人' })).statusCode, 400);
  const p1 = await h.character(room.id, room.token, '甲'),
    p2 = await h.character(room.id, room.token, '乙'),
    p3 = await h.character(room.id, guests[0], '丙');
  assert.equal(h.store.seats(room.id)[0].characters.length, 2);
  assert.equal(
    (await h.post(`/api/rooms/${room.id}/board`, { characterId: p3, text: '偷控角色' }, room.token))
      .statusCode,
    403,
  );
  assert.equal((await h.post(`/api/rooms/${room.id}/run`, {}, guests[0])).statusCode, 403);
  for (const pc of [p1, p2])
    assert.equal(
      (
        await h.post(
          `/api/rooms/${room.id}/board`,
          { characterId: pc, text: '各自配合' },
          room.token,
        )
      ).statusCode,
      200,
    );
  const run = await h.post(`/api/rooms/${room.id}/run`, {}, room.token);
  assert.equal(run.statusCode, 200);
  assert.equal(h.store.run(run.json().runId).actions.length, 2);
});

test('冻结批次不接纳后续编辑，下一批行动独立；API 重试只启动一轮', async (t) => {
  const h = harness();
  t.after(() => h.app.close());
  const room = await h.create(),
    pc = await h.character(room.id, room.token, '甲');
  const action = await h.post(
    `/api/rooms/${room.id}/board`,
    { characterId: pc, text: '先观察' },
    room.token,
  );
  const payload = { requestId: 'same-run' };
  const first = await h.post(`/api/rooms/${room.id}/run`, payload, room.token),
    retry = await h.post(`/api/rooms/${room.id}/run`, payload, room.token);
  assert.deepEqual(first.json(), retry.json());
  assert.equal(
    (
      await h.post(
        `/api/rooms/${room.id}/board`,
        { characterId: pc, actionId: action.json().actionId, text: '改已冻结行动' },
        room.token,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await h.post(
        `/api/rooms/${room.id}/withdraw`,
        { actionId: action.json().actionId },
        room.token,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await h.post(
        `/api/rooms/${room.id}/board`,
        { characterId: pc, text: '下一轮撤退' },
        room.token,
      )
    ).statusCode,
    200,
  );
  assert.equal(h.store.active(room.id)?.actions[0].text, '先观察');
  assert.equal(h.store.room(room.id).board[0].text, '下一轮撤退');
  assert.equal((await h.post(`/api/rooms/${room.id}/run`, {}, room.token)).statusCode, 409);
});

test('私密讨论、私密问题、回答与暂停后的恢复均验证角色权限', async (t) => {
  const h = harness();
  t.after(() => h.app.close());
  const room = await h.create();
  const guest = (await h.post(`/api/rooms/${room.id}/join`, { name: '同伴' })).json();
  const a = await h.character(room.id, room.token, '甲'),
    b = await h.character(room.id, guest.token, '乙');
  await h.post(
    `/api/rooms/${room.id}/messages`,
    { text: 'PRIVATE', characterId: b, private: true, askGM: true },
    guest.token,
  );
  const run = h.store.active(room.id)!;
  assert.deepEqual(run.responseAudience, [b]);
  h.tools.call('turn_ask', { key: 'ask', prompt: 'PRIVATE QUESTION', characters: [b] }, run.id);
  const view = await h.app.inject({
    url: `/api/rooms/${room.id}`,
    headers: { authorization: 'Bearer ' + room.token },
  });
  assert.ok(!view.body.includes('PRIVATE'));
  assert.equal(
    (
      await h.post(
        `/api/rooms/${room.id}/answer`,
        { runId: run.id, characterId: a, text: '代答' },
        room.token,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await h.post(
        `/api/rooms/${room.id}/answer`,
        { runId: run.id, characterId: b, text: '由我决定' },
        guest.token,
      )
    ).statusCode,
    200,
  );
  const resumed = h.store.run(run.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.metrics.resumptions, 1);
  const after = await h.app.inject({
    url: `/api/rooms/${room.id}`,
    headers: { authorization: 'Bearer ' + guest.token },
  });
  assert.equal(after.json().run.question, undefined);
  await h.post(`/api/rooms/${room.id}/stop`, { runId: run.id }, room.token);
  assert.equal(h.store.run(run.id).status, 'failed');
  assert.equal(
    (await h.post(`/api/rooms/${room.id}/resume`, { runId: run.id }, guest.token)).statusCode,
    200,
  );
});

test('真实 MCP HTTP 握手、工具发现和调用；未经授权无法连接', async (t) => {
  const h = harness();
  t.after(() => h.app.close());
  const room = await h.create(),
    pc = await h.character(room.id, room.token, '甲');
  await h.post(`/api/rooms/${room.id}/board`, { characterId: pc, text: '检查门锁' }, room.token);
  await h.post(`/api/rooms/${room.id}/run`, {}, room.token);
  const url = await h.app.listen({ host: '127.0.0.1', port: 0 });
  h.setUrl(url);
  assert.equal(
    (await h.app.inject({ method: 'POST', url: `/internal/mcp/${room.id}`, payload: {} }))
      .statusCode,
    403,
  );
  const client = new Client({ name: 'protocol-test', version: '1.0' }),
    transport = new StreamableHTTPClientTransport(new URL(`${url}/internal/mcp/${room.id}`), {
      requestInit: { headers: { Authorization: 'Bearer test-mcp-token' } },
    });
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((t) => t.name).sort(),
    [
      'context_get',
      'context_search',
      'checks_resolve',
      'state_apply',
      'time_advance',
      'turn_commit',
      'turn_ask',
    ].sort(),
  );
  const context = await client.callTool({ name: 'context_get', arguments: { ids: [pc] } });
  assert.equal(context.isError, undefined);
  assert.ok(JSON.stringify(context).includes(pc));
  const fail = await client.callTool({
    name: 'time_advance',
    arguments: { key: 'bad', minutes: -1, reason: '不允许倒退' },
  });
  assert.equal(fail.isError, true);
});

test('全批都是其他人的私密行动时，房主获知待裁决数量但看不到内容', async (t) => {
  const h = harness();
  t.after(() => h.app.close());
  const room = await h.create();
  const guest = (await h.post(`/api/rooms/${room.id}/join`, { name: '同伴' })).json();
  const pc = await h.character(room.id, guest.token, '乙');
  await h.post(
    `/api/rooms/${room.id}/board`,
    { characterId: pc, text: 'PRIVATE-ONLY', private: true },
    guest.token,
  );
  const view = (
    await h.app.inject({
      url: `/api/rooms/${room.id}`,
      headers: { authorization: 'Bearer ' + room.token },
    })
  ).json();
  assert.equal(view.boardCount, 1);
  assert.equal(view.board.length, 0);
  assert.ok(!JSON.stringify(view).includes('PRIVATE-ONLY'));
  assert.equal((await h.post(`/api/rooms/${room.id}/run`, {}, room.token)).statusCode, 200);
});
