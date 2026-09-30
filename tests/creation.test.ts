import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { diverDraft, fixtureDirector } from './fixtures.js';
import {
  adoptCharacter,
  openWorkshop,
  unformedCharacter,
  validateDraft,
} from '../server/creation.js';
import {
  advanceTime,
  amendSheet,
  commit,
  directorContext,
  emptyPlan,
  newSession,
  propose,
  skillChance,
} from '../server/engine.js';
import { createWithModel } from '../server/ai/creation.js';
import { validateRoom } from '../server/store.js';
import type { PublicState } from '../shared/types.js';
import { draftNotices } from '../shared/types.js';
test('collaborative creation, revisions, adoption, custom powers, conversation, ownership and retry survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'greyzone-creation-'));
  let app = await createApp({
    directory,
    serveStatic: false,
    director: fixtureDirector,
    die: () => 1,
  });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { concept: '沈沅，潜水员，自定义金属感知，无枪无债' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const r = created.json(),
      headers = { authorization: `Bearer ${r.token}` };
    let s: PublicState = r.state;
    const call = async (path: string, body: Record<string, unknown>, who = headers) =>
      app.inject({
        method: 'POST',
        url: `/api/rooms/${r.room}/${path}`,
        headers: who,
        payload: { requestId: randomUUID(), revision: s.revision, ...body },
      });
    assert.equal(s.characters[0].ready, false);
    assert.deepEqual(s.characters[0].inventory, []);
    assert.equal(s.journal.length, 0);
    assert.equal((await call('actions', { intent: '行动' })).statusCode, 400);
    const first = {
      requestId: randomUUID(),
      revision: s.revision,
      message: '沈沅，潜水员，自定义金属感知，无枪无债',
    };
    let result = await call('workshop', first);
    assert.equal(result.statusCode, 200, result.body);
    s = result.json();
    assert.equal(s.workshop?.draft?.debt, 0);
    assert.equal(s.minute, 0);
    result = await call('workshop', first);
    assert.equal(result.json().revision, s.revision);
    assert.equal(result.json().workshop.messages.length, 2);
    result = await call('workshop', { message: '改为六米，成本3，其余保留' });
    s = result.json();
    assert.equal(s.workshop!.draft!.abilities[0].cost, 3);
    assert.equal(s.workshop!.draft!.inventory[0].id, 'breather');
    const begin = { requestId: randomUUID(), revision: s.revision, version: s.workshop!.version };
    result = await call('begin', begin);
    assert.equal(result.statusCode, 200, result.body);
    s = result.json();
    assert.equal(s.characters[0].location, 'dock');
    assert.equal(s.characters[0].debt, 0);
    assert.equal(s.characters[0].abilities[0].cost, 3);
    assert.equal(s.characters[0].expertise[0].name, '水下切割');
    assert.ok(s.entities.some((e) => e.name === '叶遥'));
    assert.equal((await call('begin', begin)).json().journal.length, 1);
    result = await call('actions', { intent: '场外：异能如何使用' });
    s = result.json();
    assert.equal(s.minute, 0);
    assert.equal(s.proposal, null);
    result = await call('actions', { intent: '我向叶遥打招呼' });
    s = result.json();
    assert.equal(s.minute, 1);
    assert.equal(s.proposal, null);
    result = await call('actions', { intent: '发动异能' });
    s = result.json();
    assert.equal(s.proposal?.powerCost, 3);
    const proposal = s.proposal!;
    result = await call('actions', { intent: '为什么需要这个代价？' });
    s = result.json();
    assert.equal(s.proposal!.id, proposal.id);
    assert.equal(s.minute, 1);
    result = await call('decisions', { proposalId: proposal.id, decision: 'confirm' });
    s = result.json();
    assert.equal(s.characters[0].energy, 6);
    result = await call('actions', { intent: '新增专长：船舶焊接' });
    s = result.json();
    const amendment = s.sheetProposal!;
    assert.equal(s.characters[0].expertise.length, 1);
    const guest = (
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${r.room}/join`,
        payload: { concept: '同伴，港务档案员' },
      })
    ).json();
    s = (await app.inject({ url: `/api/rooms/${r.room}`, headers })).json();
    assert.ok(!('workshops' in s));
    assert.equal(s.characters.length, 1);
    assert.equal(guest.state.sheetProposal, null);
    assert.equal(guest.state.workshop.seed, '同伴，港务档案员');
    assert.equal(
      (
        await call(
          'sheet-decisions',
          { proposalId: amendment.id, decision: 'confirm' },
          { authorization: `Bearer ${guest.token}` },
        )
      ).statusCode,
      409,
    );
    result = await call('sheet-decisions', { proposalId: amendment.id, decision: 'confirm' });
    s = result.json();
    assert.equal(s.characters[0].expertise.length, 2);
    assert.equal(s.characters[0].energy, 6);
    await app.close();
    app = await createApp({ directory, serveStatic: false, director: fixtureDirector });
    s = (await app.inject({ url: `/api/rooms/${r.room}`, headers })).json();
    assert.equal(s.characters[0].expertise[1].name, '船舶焊接');
    assert.equal(s.workshop!.messages.length, 4);
  } finally {
    await app.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('greyzone-creation-'));
    await rm(target, { recursive: true, force: true });
  }
});

test('custom expertise, untrained methods, semantic conditions and custom supplies have actual effects', () => {
  const c = unformedCharacter(),
    s = newSession('CUSTOM', 'dsh', c);
  openWorkshop(s, c.id, '潜水员');
  s.workshops[c.id].draft = diverDraft();
  s.workshops[c.id].version = 1;
  adoptCharacter(s, c.id, 1);
  assert.equal(skillChance(c, '水下切割'), 60);
  assert.equal(skillChance(c, '新办法', 0, 'PER'), 35);
  let p = emptyPlan('暂时专注', 0.1);
  p.success.effects = [
    {
      type: 'condition.add',
      condition: {
        id: 'focus',
        name: '集中注意',
        description: '对水下结构保持注意力。',
        expiresAt: 2,
        modifier: 10,
        skills: ['水下切割'],
      },
    },
  ];
  s.proposal = propose(s, c.id, '专注', p);
  let next = commit(s, c.id, s.proposal.id, () => 1);
  assert.equal(skillChance(next.characters[0], '水下切割'), 70);
  advanceTime(next, 3, []);
  assert.equal(skillChance(next.characters[0], '水下切割'), 60);
  next.characters[0].thirst = 5;
  p = emptyPlan('喝自带水', 1);
  p.costs = [{ itemId: 'flask', quantity: 1 }];
  p.success.effects = [{ type: 'sustain', itemId: 'flask' }];
  next.proposal = propose(next, c.id, '喝水', p);
  next = commit(next, c.id, next.proposal.id);
  assert.ok(next.characters[0].thirst < 2);
  assert.equal(directorContext(next, c.id).actor.personal.preferences, c.personal.preferences);
  const before = next.characters[0].energy;
  amendSheet(
    next,
    c.id,
    {
      tool: 'amend',
      text: '提高能量上限',
      reason: '有训练依据且玩家确认',
      changes: { stats: { RSN: 4 } },
    },
    true,
  );
  assert.equal(next.characters[0].energy, before);
  p = emptyPlan('缩小感知范围，减少消耗', 0.1);
  p.power = 'sense';
  p.abilityId = 'metal-touch';
  p.skill = 'resonance';
  p.powerTerms = { cost: 1, strain: 2, reason: '只感知接触点，代价转为更高的集中负荷。' };
  next.proposal = propose(next, c.id, '集中在接触点', p);
  assert.equal(next.proposal.powerCost, 1);
  assert.ok(next.proposal.plan.risks.some((r) => r.includes('集中负荷')));
  next = commit(next, c.id, next.proposal.id, () => 100);
  assert.equal(next.characters[0].energy, before - 1);
  assert.ok(next.characters[0].strain > 1.9);
  // Known but currently unavailable powers are allowed in the fiction; use-time checks enforce conditions.
  const draft = diverDraft();
  draft.opening.contacts = [];
  draft.inventory = draft.inventory.filter((i) => i.kind !== 'crystal');
  assert.doesNotThrow(() => validateDraft(s, c.id, draft));
  assert.ok(draftNotices(draft).some((n) => n.includes('没有结晶')));
});

test('creation tool repairs invalid bookkeeping without replacing player intent; transport failure keeps previous draft', async () => {
  const c = unformedCharacter(),
    s = newSession('REPAIR', 'dsh', c);
  openWorkshop(s, c.id, '无债务潜水员');
  const invalid = diverDraft();
  invalid.inventory.push(invalid.inventory[0]);
  let calls = 0;
  const result = await createWithModel(
    async (prompt) => {
      calls++;
      const packet = JSON.parse(prompt);
      assert.equal(packet.playerMessage, '我不想带枪');
      return { text: '无枪方案', draft: calls === 1 ? invalid : diverDraft(), questions: [] };
    },
    s,
    c.id,
    '我不想带枪',
    new AbortController().signal,
  );
  assert.equal(calls, 2);
  assert.equal(result.draft!.debt, 0);
  assert.equal(s.workshops[c.id].draft, null);
  s.workshops[c.id].draft = diverDraft();
  const original = structuredClone(s);
  await assert.rejects(
    createWithModel(
      async () => {
        throw new Error('offline');
      },
      s,
      c.id,
      '改动',
      new AbortController().signal,
    ),
  );
  assert.deepEqual(s, original);
});

test('v2 saves gain new semantic fields without changing identity, equipment or credentials', () => {
  const c = unformedCharacter();
  c.ready = true;
  const s = newSession('MIGRAT', 'local', c);
  const raw = JSON.parse(
    JSON.stringify({
      format: 2,
      state: s,
      seats: [{ characterId: c.id, host: true, tokenHash: 'a'.repeat(64) }],
      receipts: [],
    }),
  );
  for (const key of ['personal', 'expertise', 'abilities', 'conditions', 'ready', 'debtTo'])
    delete raw.state.characters[0][key];
  delete raw.state.workshops;
  delete raw.state.sheetProposals;
  const loaded = validateRoom(raw);
  assert.equal(loaded.state.characters[0].id, c.id);
  assert.equal(loaded.state.characters[0].ready, true);
  assert.deepEqual(loaded.state.workshops, {});
  assert.equal(loaded.seats[0].tokenHash, 'a'.repeat(64));
});
