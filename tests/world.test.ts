import test from 'node:test';
import assert from 'node:assert/strict';
import {
  character,
  newSession,
  emptyPlan,
  propose,
  commit,
  advanceTime,
  publicView,
} from '../server/engine.js';
import { editWorld, queryWorld } from '../server/world.js';
import { adjudicate } from '../server/ai/adjudicator.js';
import { worldMutationSchema, type WorldMutation } from '../shared/types.js';
import { stock } from '../server/content.js';
const setup = () =>
  newSession(
    'ABC123',
    'dsh',
    character({ name: '机修员', profile: 'mechanic', school: 'none', background: '修设备' }),
  );
test('AI can author a NPC, schedule its own action and record a scoped ruling transactionally', () => {
  const s = setup(),
    c = s.characters[0],
    p = emptyPlan('和临时送货员约定碰头', 5);
  const create = worldMutationSchema.parse({
    op: 'entity.create',
    entity: {
      id: 'courier',
      name: '临时送货员',
      kind: 'person',
      location: 'town',
      description: '沾着机油的送货员。',
      secret: '怕路上的收费口。',
    },
    reason: '老高常用的临时运送工',
  });
  p.success.world = [
    create,
    {
      op: 'event.schedule',
      event: {
        id: 'courier-departs',
        owner: 'courier',
        due: 60,
        summary: '送货员依照约定去码头。',
        public: true,
        guards: [{ entityId: 'courier', alive: true, at: 'town' }],
        edits: [
          {
            op: 'entity.patch',
            entityId: 'courier',
            changes: { location: 'dock', state: '等待交货' },
            reason: '按约定行动',
          },
        ],
        status: 'pending',
      },
      reason: '约定一小时内去码头',
    },
    {
      op: 'ruling.record',
      scope: '绊线警报',
      trigger: '有人拉动钢丝',
      ruling: '罐片碰撞能发声；雨中声音可能被掩盖。',
      reason: '机械结构和环境共同决定效果',
    },
  ];
  s.proposal = propose(s, c.id, p.summary, p);
  assert.ok(!s.entities.some((e) => e.id === 'courier'));
  const next = commit(s, c.id, s.proposal.id, () => 1);
  assert.ok(next.entities.some((e) => e.id === 'courier'));
  assert.equal(next.rulings.length, 1);
  assert.equal(next.audit.length, 1);
  advanceTime(next, 55, []);
  assert.equal(next.entities.find((e) => e.id === 'courier')!.location, 'dock');
  assert.ok(next.clocks.some((e) => e.id === 'courier-departs' && e.status === 'fired'));
  const publicJson = JSON.stringify(publicView(next, c.id, true, null));
  assert.ok(!publicJson.includes('怕路上的收费口'));
  assert.ok(!publicJson.includes('"clocks"'));
  assert.ok(!publicJson.includes('"audit"'));
});
test('player intervention changes autonomous clocks without adding a new branch to the engine', () => {
  const s = setup();
  s.entities.find((e) => e.id === 'scavs')!.inventory.push(stock('water', 2));
  advanceTime(s, 721, []);
  assert.equal(s.entities.find((e) => e.id === 'scavs')!.location, 'dock');
  assert.equal(s.clocks.find((e) => e.id === 'scav-move')!.status, 'cancelled');
  assert.ok(!s.facts.some((f) => f.includes('因缺水转往')));
});
test('world editor cannot patch player sheets or existing inventory/cash through arbitrary fields', () => {
  const s = setup();
  assert.throws(() =>
    worldMutationSchema.parse({
      op: 'entity.patch',
      entityId: 'gao',
      changes: { cash: 99999 },
      reason: '送金钱',
    }),
  );
  assert.throws(
    () =>
      editWorld(
        s,
        [
          {
            op: 'entity.patch',
            entityId: s.characters[0].id,
            changes: { state: '已经死了' },
            reason: '越权',
          },
        ],
        'model',
        [],
      ),
    /只能修改NPC/,
  );
  const before = JSON.stringify(s),
    p = emptyPlan('错误的多步编辑');
  p.success.world = [
    { op: 'entity.patch', entityId: 'gao', changes: { state: '已改变' }, reason: '测试' },
    { op: 'entity.patch', entityId: 'missing', changes: { state: '错误' }, reason: '测试' },
  ];
  assert.throws(() => propose(s, s.characters[0].id, '测试', p));
  assert.equal(JSON.stringify(s), before);
});
test('tool loop queries long term facts, gets validation feedback and revises without state writes', async () => {
  const s = setup();
  s.secrets.push('档案甲：维修管道通到码头。');
  const before = JSON.stringify(s);
  let turn = 0;
  const good = emptyPlan('说明维修条件', 5),
    bad = structuredClone(good);
  bad.costs = [{ itemId: 'missing', quantity: 1 }];
  const p = await adjudicate(
    async (prompt) => {
      turn++;
      if (turn === 1) return { tool: 'query', args: { scope: 'facts', query: '档案甲', limit: 2 } };
      if (turn === 2) {
        assert.ok(prompt.includes('维修管道通到码头'));
        return { tool: 'validate', plan: bad };
      }
      assert.ok(prompt.includes('缺少物资'));
      return { tool: 'propose', plan: good };
    },
    s,
    s.characters[0].id,
    '商量修东西',
    new AbortController().signal,
    '测试协议',
  );
  assert.equal(turn, 3);
  assert.equal(p.summary, good.summary);
  assert.equal(JSON.stringify(s), before);
  assert.equal(queryWorld(s, { scope: 'entity', query: '老高', limit: 1 }).total, 1);
});
test('a cancelled future event is not executed later in the same clock batch', () => {
  const s = setup();
  const cancel: WorldMutation = {
    op: 'event.cancel',
    eventId: 'scav-move',
    reason: '另有饮水安排',
  };
  s.clocks.unshift({
    id: 'earlier',
    owner: 'gao',
    due: 600,
    summary: '老高协调饮水',
    public: false,
    guards: [],
    edits: [cancel],
    status: 'pending',
  });
  advanceTime(s, 800, []);
  assert.equal(s.entities.find((e) => e.id === 'scavs')!.location, 'dock');
  assert.equal(s.clocks.find((c) => c.id === 'scav-move')!.status, 'cancelled');
});
test('a GM-authored rift closure changes actual fog and power rules, not just prose', () => {
  const s = setup();
  s.characters[0].school = 'sense';
  s.characters[0].stats.RSN = 2;
  s.characters[0].energy = 6;
  s.characters[0].inventory.push(stock('crystal_c'));
  editWorld(
    s,
    [{ op: 'environment.patch', tide: 'closed', reason: '已建立的关闭程序在零号井执行完毕。' }],
    'model',
    [],
  );
  assert.equal(publicView(s, s.characters[0].id, true, null).fogZone, 6);
  const p = emptyPlan('探测');
  p.skill = 'resonance';
  p.power = 'sense';
  assert.throws(() => propose(s, s.characters[0].id, '探测', p), /异能/);
  const facts: string[] = [];
  advanceTime(s, 60, facts);
  assert.ok(!facts.some((f) => f.includes('推进到')));
});
