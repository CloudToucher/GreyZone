import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, commit, record } from './fixtures.js';
import { context, project } from '../server/projection.js';
import type { Roll } from '../shared/types.js';

test('交易与付款批量原子执行；重试不重复扣款，坏参数全部回滚', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const transfer = {
    key: 'deal',
    changes: [
      {
        op: 'transfer',
        itemId: 'rope',
        to: 'pc-b',
        quantity: 2,
        price: 15,
        reason: '双方同意买两米绳',
      },
    ],
  };
  f.tools.call('state_apply', transfer, f.run.id);
  f.tools.call('state_apply', transfer, f.run.id);
  const draft = f.store.run(f.run.id).draft;
  assert.equal(
    draft.records['pc-a'].data.resources &&
      (draft.records['pc-a'].data.resources as { cash: number }).cash,
    115,
  );
  assert.equal((draft.records['pc-b'].data.resources as { cash: number }).cash, 85);
  assert.equal(
    Object.values(draft.records)
      .filter((r) => r.kind === 'item')
      .reduce((n, r) => n + Number(r.data.quantity), 0),
    6,
  );
  assert.equal(
    (f.store.room(f.room.id).world.records['pc-b'].data.resources as { cash: number }).cash,
    100,
  );
  assert.throws(
    () =>
      f.tools.call(
        'state_apply',
        {
          key: 'bad',
          changes: [
            { op: 'adjust', id: 'pc-b', resource: 'cash', amount: 10, reason: '测试' },
            { op: 'transfer', itemId: 'rope', to: 'pc-b', quantity: 999, reason: '不足' },
          ],
        },
        f.run.id,
      ),
    /数量不足/,
  );
  assert.deepEqual(f.store.run(f.run.id).draft, draft);
  f.tools.call('turn_commit', commit(), f.run.id);
  f.tools.call('turn_commit', commit(), f.run.id);
  assert.equal(f.store.room(f.room.id).journal.length, 1);
  assert.equal(f.store.run(f.run.id).status, 'completed');
  assert.throws(() => f.tools.call('turn_commit', { ...commit(), finish: false }, f.run.id), /key/);
});

test('同名 key 可以跨工具复用；同工具不能改变已完成的参数', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.tools.call('state_apply', { key: 'round', changes: [] }, f.run.id);
  f.tools.call('time_advance', { key: 'round', minutes: 2, reason: '共同经过时间' }, f.run.id);
  f.tools.call('turn_commit', commit('round'), f.run.id);
  assert.equal(f.store.room(f.room.id).world.minute, 2);
});

test('重试只改变 JSON 字段顺序仍视为同一操作；索引更新时间及引用由系统维护', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.tools.call(
    'state_apply',
    {
      key: 'patch',
      changes: [
        {
          op: 'patch',
          id: 'pc-a',
          changes: { data: { goals: '找到同伴', relationships: { ally: 'pc-b', trust: '合作' } } },
          reason: '同意合作',
        },
      ],
    },
    f.run.id,
  );
  f.tools.call(
    'state_apply',
    {
      key: 'patch',
      changes: [
        {
          op: 'patch',
          id: 'pc-a',
          changes: { data: { relationships: { trust: '合作', ally: 'pc-b' }, goals: '找到同伴' } },
          reason: '同意合作',
        },
      ],
    },
    f.run.id,
  );
  assert.equal(f.store.run(f.run.id).changes.length, 1);
  f.tools.call('turn_commit', commit(), f.run.id);
  const index = f.store.recordInfo(f.room.id, 'pc-a');
  assert.ok('references' in index && index.references?.includes('pc-b'));
  assert.ok('updatedAt' in index && index.updatedAt);
});

test('暗骰及检定依据不泄漏；公开骰子只随对应阶段发布', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const base = {
    actorId: 'pc-a',
    attribute: 'body',
    purpose: '观察',
    basis: 'SECRET MOTIVE',
    difficulty: 8,
  };
  f.tools.call(
    'checks_resolve',
    {
      key: 'dice',
      checks: [
        { ...base, id: 'secret', audience: [] },
        { ...base, id: 'public', audience: ['table'] },
      ],
    },
    f.run.id,
  );
  assert.equal(project(f.store, f.store.room(f.room.id), f.host.seat).rolls.length, 0);
  f.tools.call('turn_commit', commit(), f.run.id);
  const view = project(f.store, f.store.room(f.room.id), f.host.seat);
  assert.equal(view.rolls.length, 1);
  assert.equal(view.rolls[0].id, 'public');
  assert.ok(!view.journal[0].checkIds?.includes('secret'));
  assert.ok(!JSON.stringify(view).includes('SECRET MOTIVE'));
});

test('检定读角色属性、最多一项专长；优劣抵消，真实结果立即保存且不可重掷', (t) => {
  let n = 0;
  const f = fixture(() => [4, 18, 7, 9][n++]);
  t.after(() => f.store.close());
  const check = {
    id: 'check-1',
    actorId: 'pc-a',
    attribute: 'body',
    specialty: '维修',
    advantage: true,
    disadvantage: true,
    purpose: '修泵',
    basis: '有工具但受伤，优劣抵消',
    difficulty: 8,
    audience: ['pc-a'],
  };
  const result = f.tools.call('checks_resolve', { key: 'c', checks: [check] }, f.run.id) as {
    checks: Roll[];
  };
  assert.deepEqual(result.checks[0].dice, [4]);
  assert.equal(result.checks[0].total, 8);
  assert.equal(result.checks[0].success, true);
  assert.deepEqual(
    f.tools.call('checks_resolve', { key: 'retry-new-request', checks: [check] }, f.run.id),
    result,
  );
  assert.equal(n, 1);
  assert.throws(
    () =>
      f.tools.call(
        'checks_resolve',
        { key: 'changed', checks: [{ ...check, difficulty: 9 }] },
        f.run.id,
      ),
    /锁定/,
  );
  const opposed = f.tools.call(
    'checks_resolve',
    {
      key: 'opposed',
      checks: [
        {
          ...check,
          id: 'c2',
          difficulty: undefined,
          advantage: true,
          disadvantage: false,
          opponent: { actorId: 'pc-b', attribute: 'agility' },
        },
      ],
    },
    f.run.id,
  ) as { checks: Roll[] };
  assert.equal(opposed.checks[0].total, 22);
  assert.equal(opposed.checks[0].opponent?.total, 10);
  assert.equal(opposed.checks[0].outcome, 'win');
  assert.equal(f.store.room(f.room.id).journal.length, 0);
});

test('批量骰子中途错误不能抹去已经产生的结果', (t) => {
  let n = 0;
  const f = fixture(() => ++n);
  t.after(() => f.store.close());
  const c = {
    id: 'same',
    actorId: 'pc-a',
    attribute: 'mind',
    difficulty: 12,
    purpose: '判断',
    basis: '现场信息',
    audience: [],
  };
  assert.throws(
    () =>
      f.tools.call(
        'checks_resolve',
        { key: 'mixed', checks: [c, { ...c, difficulty: 16 }] },
        f.run.id,
      ),
    /锁定/,
  );
  assert.equal(f.store.rolls(f.run.id).length, 1);
  assert.equal(n, 1);
  const again = f.tools.call('checks_resolve', { key: 'recovered', checks: [c] }, f.run.id) as {
    checks: Roll[];
  };
  assert.equal(again.checks[0].selected, 1);
  assert.equal(n, 1);
});

test('时间处理期限与周期提醒，不自动杀人或发动敌人攻击', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.tools.call(
    'state_apply',
    {
      key: 'setup',
      changes: [
        {
          op: 'condition',
          id: 'pc-a',
          condition: {
            id: 'bleed',
            name: '出血',
            description: '腿部伤口仍在流血',
            severity: '危重伤',
            deadline: 3,
          },
          reason: '实际受伤',
        },
        {
          op: 'condition',
          id: 'pc-a',
          condition: { id: 'ring', name: '耳鸣', description: '高频鸣声', expiresAt: 2 },
          reason: '能力代价',
        },
        {
          op: 'create',
          record: {
            ...record('supply', 'clock', []),
            data: { due: 1, every: 2, costs: { water: 1 }, status: 'pending' },
          },
          reason: '双方约定每两分钟消耗一份水',
        },
      ],
    },
    f.run.id,
  );
  const result = f.tools.call(
    'time_advance',
    { key: 'time', minutes: 5, reason: '处理伤势' },
    f.run.id,
  ) as { expired: string[]; due: { id: string; cycles: number }[] };
  assert.equal(result.expired.length, 1);
  assert.equal(result.due.find((x) => x.id === 'supply')?.cycles, 3);
  assert.ok(result.due.some((x) => x.id === 'pc-a:bleed'));
  assert.equal(
    (f.store.run(f.run.id).draft.records['pc-a'].data.conditions as unknown[]).length,
    1,
  );
  assert.equal(f.store.room(f.room.id).world.minute, 0);
});

test('阶段提交与后续草稿分离，顺延回到行动板而且不重复', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.tools.call(
    'turn_commit',
    {
      ...commit('checkpoint', false),
      changes: [{ op: 'adjust', id: 'pc-a', resource: 'cash', amount: -5, reason: '买材料' }],
      decisions: [],
    },
    f.run.id,
  );
  f.tools.call(
    'state_apply',
    {
      key: 'draft',
      changes: [{ op: 'adjust', id: 'pc-a', resource: 'cash', amount: -2, reason: '后续尚未发布' }],
    },
    f.run.id,
  );
  assert.equal(
    (f.store.room(f.room.id).world.records['pc-a'].data.resources as { cash: number }).cash,
    95,
  );
  f.tools.call(
    'turn_commit',
    {
      ...commit('end'),
      decisions: [{ actionId: 'action-1', status: 'deferred', reason: '目标暂时离开' }],
    },
    f.run.id,
  );
  assert.equal(f.store.room(f.room.id).board.length, 1);
  assert.equal(f.store.room(f.room.id).journal.length, 2);
});

test('房主也看不到私密人物、暗骰、日志、地图连接与内部裁定依据', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.tools.call(
    'turn_commit',
    {
      ...commit(),
      changes: [
        {
          op: 'create',
          record: {
            ...record('hidden', 'place', ['pc-b']),
            secret: 'SECRET',
            data: { description: 'PRIVATE' },
          },
          reason: 'SECRET',
        },
        {
          op: 'patch',
          id: 'fence',
          changes: { data: { links: ['industry', 'hidden'] } },
          reason: 'SECRET',
        },
      ],
      passages: [
        { text: 'PRIVATE', audience: ['pc-b'] },
        { text: 'SECRET', audience: [] },
      ],
    },
    f.run.id,
  );
  const view = project(f.store, f.store.room(f.room.id), f.host.seat);
  assert.ok(!JSON.stringify(view).includes('SECRET'));
  assert.ok(!JSON.stringify(view).includes('PRIVATE'));
  assert.ok(!JSON.stringify(view).includes('hidden'));
  assert.ok(
    JSON.stringify(project(f.store, f.store.room(f.room.id), f.guest.seat)).includes('PRIVATE'),
  );
});

test('建角和场外讨论遵守世界与回应范围；托管权始终在玩家手中', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const r = f.store.run(f.run.id);
  r.kind = 'workshop';
  r.ownerCharacter = 'pc-a';
  r.responseAudience = ['pc-a'];
  r.actions = [];
  f.store.saveRun(r);
  assert.throws(
    () =>
      f.tools.call(
        'state_apply',
        {
          key: 'control',
          changes: [
            {
              op: 'patch',
              id: 'pc-a',
              changes: { data: { delegated: true } },
              reason: '不能代替玩家授权',
            },
          ],
        },
        r.id,
      ),
    /所有者/,
  );
  assert.throws(
    () =>
      f.tools.call(
        'state_apply',
        {
          key: 'other',
          changes: [{ op: 'patch', id: 'pc-b', changes: { name: '改名' }, reason: '不能改别人' }],
        },
        r.id,
      ),
    /建角只能/,
  );
  assert.throws(
    () => f.tools.call('time_advance', { key: 'time', minutes: 1, reason: '场外' }, r.id),
    /不推进时间/,
  );
  assert.throws(
    () =>
      f.tools.call(
        'turn_commit',
        { key: 'leak', passages: [{ text: '草案', audience: ['table'] }] },
        r.id,
      ),
    /responseAudience/,
  );
  r.kind = 'discussion';
  f.store.saveRun(r);
  assert.throws(
    () =>
      f.tools.call(
        'state_apply',
        {
          key: 'world',
          changes: [
            { op: 'adjust', id: 'pc-a', resource: 'cash', amount: 10, reason: '聊天不能变钱' },
          ],
        },
        r.id,
      ),
    /场外讨论/,
  );
  assert.equal(context(f.room, r, f.store).run.responseAudience?.[0], 'pc-a');
});

test('已有 NPC 不因换场景重复创建；有说明的同名不同人仍可创建', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const old = f.room.world.records.zheng;
  assert.throws(
    () =>
      f.tools.call(
        'state_apply',
        {
          key: 'duplicate',
          changes: [{ op: 'create', record: { ...old, id: 'new-doctor' }, reason: '忘了已有记录' }],
        },
        f.run.id,
      ),
    /同名对象已经存在：zheng/,
  );
  f.tools.call(
    'state_apply',
    {
      key: 'distinct',
      changes: [
        {
          op: 'create',
          record: {
            ...old,
            id: 'another-zheng',
            data: { ...old.data, distinctIdentityReason: '另一位同姓居民，和镇医并非同一人' },
          },
          reason: '独立人物',
        },
      ],
    },
    f.run.id,
  );
  assert.ok(f.store.run(f.run.id).draft.records['another-zheng']);
});

test('建角可以创建私密起始地点与背景人物，不强制围栏镇开场', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const run = f.store.run(f.run.id);
  run.kind = 'workshop';
  run.ownerCharacter = 'pc-a';
  run.responseAudience = ['pc-a'];
  run.actions = [];
  f.store.saveRun(run);
  f.tools.call(
    'turn_commit',
    {
      key: 'personal-start',
      changes: [
        {
          op: 'create',
          record: { ...record('barge-home', 'place'), name: '自家的修船驳' },
          reason: '玩家的自定起点',
        },
        {
          op: 'create',
          record: {
            ...record('sister', 'npc'),
            name: '姐姐',
            data: { location: 'barge-home', goal: '修好船' },
          },
          reason: '玩家认可的家庭关系',
        },
        {
          op: 'patch',
          id: 'pc-a',
          changes: { data: { location: 'barge-home' } },
          reason: '从自家船上开始',
        },
      ],
      passages: [{ text: '你在修船驳上，姐姐正在拆泵。', audience: ['pc-a'] }],
    },
    run.id,
  );
  assert.equal(f.store.room(f.room.id).world.records['pc-a'].data.location, 'barge-home');
  assert.ok(
    !JSON.stringify(project(f.store, f.store.room(f.room.id), f.guest.seat)).includes('barge-home'),
  );
});
