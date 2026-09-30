import test from 'node:test';
import assert from 'node:assert/strict';
import {
  character,
  commit,
  damage,
  emptyPlan,
  fogZone,
  nativePlan,
  newSession,
  propose,
  publicView,
  advanceTime,
} from '../server/engine.js';
import { stock } from '../server/content.js';
import type { Command, Plan, SessionState } from '../shared/types.js';
const setup = () =>
  newSession(
    'ABC123',
    'local',
    character({ name: '测试员', profile: 'mechanic', school: 'sense', background: '测试' }),
  );
function run(s: SessionState, cmd: Command, die = 1) {
  const c = s.characters[0];
  const plan = nativePlan(s, c, cmd);
  s.proposal = propose(s, c.id, cmd.kind, plan, cmd);
  return commit(s, c.id, s.proposal.id, () => die);
}
function custom(s: SessionState, p: Plan, die = 1) {
  const c = s.characters[0];
  s.proposal = propose(s, c.id, p.summary, p);
  return commit(s, c.id, s.proposal.id, () => die);
}
test('original geography is open without chapters, travel changes only the acting character', () => {
  let s = setup();
  s.characters.push(character({ name: '队友', profile: 'medic', school: 'none', background: '' }));
  assert.ok(s.locations.some((l) => l.id === 'well'));
  s = run(s, { kind: 'travel', target: 'dock' });
  assert.equal(s.minute, 20);
  assert.equal(s.characters[0].location, 'dock');
  assert.equal(s.characters[1].location, 'town');
  assert.equal(s.contracts.filter((t) => t.status === 'accepted').length, 0);
  assert.throws(() => nativePlan(s, s.characters[0], { kind: 'travel', target: 'well' }), /直接/);
});
test('free crafting consumes real materials, creates persistent custom gear and a precedent', () => {
  let s = setup();
  const p = emptyPlan('用钢丝和罐片制作门后警报', 20);
  p.skill = 'technical';
  p.costs = [
    { itemId: 'wire', quantity: 1 },
    { itemId: 'scrap', quantity: 1 },
  ];
  p.precedent = '钢丝拉动罐片能发出声音，不需要电源。';
  p.success.effects = [
    {
      type: 'create',
      item: {
        id: 'tripwire-alarm',
        name: '罐片警报',
        quantity: 1,
        weight: 0.3,
        value: 25,
        kind: 'gear',
        description: '三米钢丝牵动罐片，仅能发出声音。',
      },
      basis: '钢丝一卷与金属零件一份',
    },
  ];
  s = custom(s, p);
  assert.ok(s.characters[0].inventory.some((i) => i.id === 'tripwire-alarm'));
  assert.equal(s.characters[0].inventory.find((i) => i.id === 'wire')!.quantity, 1);
  assert.equal(s.precedents.length, 1);
  const bad = structuredClone(p);
  bad.success.effects = [{ type: 'create', item: stock('crystal_c'), basis: '白送' }];
  assert.throws(() => propose(s, s.characters[0].id, '造结晶', bad), /加工|材料/);
});
test('scouting a novel route and negotiating with an NPC persist independently of quests', () => {
  let s = setup(),
    p = emptyPlan('勘查旧排污管道', 60);
  p.skill = 'survival';
  p.success.effects = [
    { type: 'route', destination: 'market', minutes: 75, description: '经东侧废弃排污管道' },
  ];
  s = custom(s, p);
  assert.ok(s.routes.some((r) => r.from === 'town' && r.to === 'market'));
  s = run(s, { kind: 'travel', target: 'market' });
  assert.equal(s.characters[0].location, 'market');
  s = setup();
  p = emptyPlan('协商提供发电机维修服务', 10);
  p.skill = 'persuade';
  p.success.effects = [
    { type: 'attitude', entityId: 'saw', delta: 1, hostile: false },
    { type: 'fact', text: '锯子同意明天让测试员借用工坊。', private: false },
  ];
  s = custom(s, p);
  assert.equal(s.entities.find((e) => e.id === 'saw')!.attitude, 1);
  assert.ok(s.facts.some((f) => f.includes('借用工坊')));
});
test('ammunition, cash and merchant stock are conserved; failures still cost shots', () => {
  let s = setup();
  s = run(s, { kind: 'buy', entityId: 'gao', itemId: 'ammo762', quantity: 3 });
  assert.equal(s.characters[0].cash, 294);
  assert.equal(
    s.entities.find((e) => e.id === 'gao')!.inventory.find((i) => i.id === 'ammo762')!.quantity,
    147,
  );
  s.characters[0].location = 'post';
  s = run(s, { kind: 'attack', target: 'drone' }, 100);
  assert.equal(s.characters[0].inventory.find((i) => i.id === 'rifle')!.weapon!.loaded, 9);
  assert.equal(s.entities.find((e) => e.id === 'drone')!.health, 6);
  assert.equal(s.entities.find((e) => e.id === 'drone')!.ammo, 29);
  s = run(s, { kind: 'reload', itemId: 'rifle' }, 100);
  assert.equal(s.characters[0].inventory.find((i) => i.id === 'rifle')!.weapon!.loaded, 10);
  assert.equal(s.characters[0].inventory.find((i) => i.id === 'ammo762')!.quantity, 32);
});
test('bleeding persists, bandaging does not heal wounds, neglect can kill without rescue', () => {
  let s = setup();
  damage(s.characters[0], 3, '左腿', '枪伤', []);
  const w = s.characters[0].wounds[0];
  s = run(s, { kind: 'bandage', woundId: w.id });
  assert.equal(s.characters[0].wounds[0].severity, 3);
  assert.equal(s.characters[0].wounds[0].bleeding, 0);
  assert.equal(s.characters[0].blood, 82);
  damage(s.characters[0], 4, '左臂', '重创', []);
  s = run(s, { kind: 'rest', hours: 4 });
  assert.equal(s.characters[0].status, 'dead');
  assert.ok(s.characters[0].inventory.length > 0);
  assert.throws(() => nativePlan(s, s.characters[0], { kind: 'inspect' }), /死亡/);
});
test('a teammate can provide medical care but cannot spend the other player’s money or move them', () => {
  let s = setup();
  const other = character({ name: '伤员', profile: 'soldier', school: 'none', background: '' });
  s.characters.push(other);
  damage(other, 3, '左腿', '枪伤', []);
  s = run(s, { kind: 'bandage', woundId: other.wounds[0].id, patientId: other.id });
  assert.equal(s.characters[1].wounds[0].bleeding, 0);
  assert.equal(s.characters[0].inventory.find((i) => i.id === 'bandage')!.quantity, 2);
  const p = emptyPlan('非法拿走同伴的物品');
  p.success.effects = [
    {
      type: 'transfer',
      from: other.id,
      to: s.characters[0].id,
      itemId: 'water',
      quantity: 1,
      price: 0,
    },
  ];
  assert.throws(() => propose(s, s.characters[0].id, '盗取', p), /对象不在/);
});
test('powers enforce boundary, conductor, energy, repeated strain and backlash', () => {
  let s = setup();
  const p = emptyPlan('脉冲探测', 0.1);
  p.skill = 'resonance';
  p.power = 'sense';
  p.success.effects = [{ type: 'fact', text: '门外有一个活动轮廓，身份不明。', private: false }];
  s = custom(s, p);
  assert.equal(s.characters[0].energy, 4);
  assert.ok(s.characters[0].strain > 0.9);
  s = custom(s, p);
  assert.equal(s.characters[0].energy, 2);
  assert.throws(() => propose(s, s.characters[0].id, '再次探测', p), /能量/);
  s.characters[0].location = 'outside';
  assert.throws(() => propose(s, s.characters[0].id, '探测', p), /异能需要/);
  s = setup();
  s.characters[0].stats.WIL = 1;
  s = custom(s, p);
  assert.ok(s.characters[0].wounds.length > 0);
  assert.equal(s.characters[0].energy, 2);
});
test('world clocks use elapsed minutes, NPCs act and contracts expire without player missions', () => {
  const s = setup();
  advanceTime(s, 720, []);
  assert.equal(s.entities.find((e) => e.id === 'scavs')!.location, 'market');
  advanceTime(s, 14 * 1440, []);
  assert.equal(fogZone(s.minute), 4);
  assert.equal(s.contracts[0].status, 'expired');
  assert.ok(s.events.includes('major-strain'));
  assert.ok(s.entities.find((e) => e.id === 'jin')!.location === 'quarry');
});
test('proposals reveal neither undiscovered objects nor conditional rewards nor private motives', () => {
  const s = setup(),
    p = emptyPlan('与鸦交谈');
  p.success.effects = [{ type: 'fact', text: 'PRIVATE_SUCCESS', private: false }];
  p.success.text = 'PRIVATE_SUCCESS';
  p.method = '说明来意';
  s.proposal = propose(s, s.characters[0].id, '说话', p);
  const data = JSON.stringify(publicView(s, s.characters[0].id, true, null));
  assert.ok(!data.includes('PRIVATE_SUCCESS'));
  assert.ok(!data.includes('pharma-cache'));
  assert.ok(!data.includes('妹妹失踪'));
  assert.ok(!data.includes('secrets'));
  assert.ok(data.includes('说明来意'));
});
test('contract settlement transfers the actual item and is paid exactly once', () => {
  let s = setup();
  s = run(s, { kind: 'contract', target: 'medicine' });
  s.characters[0].inventory.push(stock('antibiotics', 2));
  s = run(s, { kind: 'deliver', target: 'medicine' });
  assert.equal(s.characters[0].cash, 540);
  assert.equal(s.contracts[0].status, 'completed');
  assert.ok(!s.characters[0].inventory.some((i) => i.id === 'antibiotics'));
  assert.throws(() => nativePlan(s, s.characters[0], { kind: 'deliver', target: 'medicine' }));
});
test('an exposed teammate cannot pause hostile NPCs while another character waits in town', () => {
  let s = setup();
  const other = character({ name: '冒险同伴', profile: 'soldier', school: 'none', background: '' });
  other.location = 'post';
  s.characters.push(other);
  s = run(s, { kind: 'rest', hours: 1 });
  assert.equal(s.characters[1].status, 'dead');
  assert.ok(s.entities.find((e) => e.id === 'drone')!.ammo < 30);
});
