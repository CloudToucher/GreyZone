import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadEnv } from '../server/ai/dsh.js';
import type { PublicState } from '../shared/types.js';
await loadEnv();
const directory = `.data/verification/session-zero-${Date.now()}`;
await mkdir(directory, { recursive: true });
const app = await createApp({ directory, serveStatic: false, die: () => 1 });
const records: unknown[] = [];
try {
  const concept =
    '我叫沈沅，女，31岁，灾前后一直干港口潜水与沉船打捞，现在回来找失踪的搭档。我想从集装箱码头开局，和搭档的姐姐叶遥碰头，只知道他失踪前去过一座抽水棚。不要预先告诉我失踪真相。我希望有水下切割这个明确的专业，带自己修过的轻便呼吸设备、潜水刀、水和干粮，另有我自己买来的低纯度小结晶作为异能导体，现金不多但无债务，不要任何枪械或弹药，防身也只用潜水刀。我有一种接触金属才能辨别附近振动来源的异能，不能读心、不知道名字、不能远程看图；请共同设计范围和代价。我接受疲劳与可治疗的风险，不接受强制失能、强制恋爱。想玩调查、救援、与当地人打交道，也接受真实死亡风险。请直接给可玩的完整草案，其他小细节合理暂定。';
  const created = await app.inject({ method: 'POST', url: '/api/rooms', payload: { concept } });
  assert.equal(created.statusCode, 201, created.body);
  const credentials = created.json();
  let state: PublicState = credentials.state;
  const headers = { authorization: `Bearer ${credentials.token}` };
  async function call(path: string, payload: Record<string, unknown>) {
    console.log(`dsh session-zero: ${path}`);
    const response = await app.inject({
      method: 'POST',
      url: `/api/rooms/${state.id}/${path}`,
      headers,
      payload: { requestId: randomUUID(), revision: state.revision, ...payload },
    });
    assert.equal(response.statusCode, 200, response.body);
    state = response.json();
    records.push({ path, payload, state });
    await writeFile(
      `${directory}/transcript.json`,
      JSON.stringify({ at: new Date().toISOString(), records }, null, 2),
    );
    console.log(`${path} saved; revision ${state.revision}; minute ${state.minute}`);
  }
  await call('workshop', { message: concept });
  let draft = state.workshop!.draft!;
  assert.ok(draft, 'model must draft the requested character');
  assert.equal(draft.debt, 0);
  assert.ok(draft.expertise.some((e) => e.name.includes('水下')));
  assert.ok(draft.abilities.length);
  assert.ok(!draft.inventory.some((i) => i.weapon), 'the player requested no firearm');
  await call('workshop', {
    message:
      '保留这个人的其他设定和随身导体。异能只改为接触连续金属、六米范围、最多十秒，基础能耗定为3，负荷增加1；不能穿过断裂处、不能从震动直接识别人名。我想保留自己解释线索的空间。另外明确我擅长水下切割，但不擅长欺骗交涉。仍然不要给枪或债务，请更新完整草案。',
  });
  draft = state.workshop!.draft!;
  assert.equal(draft.debt, 0);
  assert.equal(draft.abilities[0].cost, 3);
  assert.equal(draft.abilities[0].strain, 1);
  assert.match(draft.abilities[0].limits, /六|6/);
  assert.ok(
    draft.inventory.some((i) => i.kind === 'crystal'),
    'the negotiated conductor must survive revision',
  );
  await call('begin', { version: state.workshop!.version });
  assert.equal(state.characters[0].ready, true);
  assert.equal(state.characters[0].location, 'dock');
  assert.ok(state.entities.some((e) => e.name.includes('叶遥')));
  const before = state.minute;
  await call('actions', {
    intent:
      '场外问主持人：我刚才谈妥的异能有哪些限制？水下切割专长能帮我做什么？只解释档案，不行动。',
  });
  assert.equal(state.minute, before);
  assert.equal(state.proposal, null);
  const energy = state.characters[0].energy;
  await call('actions', {
    intent: `我把随身结晶握在掌心，手贴住码头手边的连续金属构件，使用${draft.abilities[0].name}，花十秒辨别六米内有没有持续转动的机械震动，只确定方向与节奏，不判断身份。我现在只做这次测试。`,
  });
  const powerState = state as PublicState;
  assert.ok(powerState.proposal, 'a power action needs a real costed ruling');
  assert.equal(powerState.proposal.powerCost, 3);
  await call('decisions', { proposalId: powerState.proposal.id, decision: 'confirm' });
  assert.equal(state.characters[0].energy, energy - 3);
  assert.ok(state.journal.at(-1)?.roll);
  console.log(
    `PASS: free concept -> revision -> custom opening -> conversation -> custom ability. Evidence: ${directory}/transcript.json`,
  );
} finally {
  await app.close();
}
