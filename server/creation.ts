import { randomUUID } from 'node:crypto';
import {
  characterSchema,
  characterDraftSchema,
  personalSchema,
  skillNames,
  type CharacterDraft,
  type SessionState,
} from '../shared/types.js';
import { actor, GameError } from './engine.js';
import { editWorld } from './world.js';

export function unformedCharacter() {
  return characterSchema.parse({
    id: randomUUID(),
    name: '尚未定名',
    profile: '',
    background: '',
    ready: false,
    personal: personalSchema.parse({}),
    expertise: [],
    abilities: [],
    debtTo: '',
    stats: { STR: 5, AGI: 5, CON: 5, PER: 5, INT: 5, WIL: 5, RSN: 0 },
    training: {},
    school: 'none',
    energy: 0,
    strain: 0,
    acclimated: 60,
    location: 'town',
    inventory: [],
    cash: 0,
    debt: 0,
    blood: 100,
    fatigue: 0,
    hunger: 0,
    thirst: 0,
    wounds: [],
    status: 'active',
    stance: 'exposed',
  });
}
export function openWorkshop(s: SessionState, characterId: string, seed: string) {
  s.workshops[characterId] = {
    seed,
    requestId: randomUUID(),
    version: 0,
    messages: [],
    draft: null,
    questions: [],
    accepted: false,
  };
  if (s.characters.every((c) => !c.ready)) {
    s.journal = [];
    s.facts = ['2037年3月15日，零号井附近的黑雾开始向外扩散。'];
  }
}
export function validateDraft(
  s: SessionState,
  actorId: string,
  raw: CharacterDraft,
): CharacterDraft {
  const d = characterDraftSchema.parse(raw);
  if (!s.locations.some((l) => l.id === d.location))
    throw new GameError('开局地点需要在原作地图中。');
  if (s.characters.some((c) => c.id !== actorId && c.name === d.name))
    throw new GameError('房间内已有同名角色，请补充代号。');
  for (const items of [d.inventory, ...d.opening.contacts.map((c) => c.inventory)]) {
    if (
      new Set(items.map((i) => i.id)).size !== items.length ||
      items.some(
        (i) =>
          i.quantity < 1 || (i.weapon && (i.quantity !== 1 || i.weapon.loaded > i.weapon.capacity)),
      )
    )
      throw new GameError('装备编号须唯一、数量须为正，每支枪单独记录且弹仓不得超量。');
  }
  if (
    new Set(d.abilities.map((a) => a.id)).size !== d.abilities.length ||
    new Set(d.expertise.map((e) => e.name)).size !== d.expertise.length
  )
    throw new GameError('异能和专长需要各自唯一的编号或名称。');
  if (
    d.expertise.some((e) => e.name in skillNames) ||
    Object.keys(d.training).some((k) => !(k in skillNames))
  )
    throw new GameError(
      'training 只记录通用技能；自定义技能写入 expertise，名称不得覆盖通用技能编号。',
    );
  if (d.debt > 0 && !d.debtTo.trim()) throw new GameError('欠款需要明确债权人和来由。');
  const ids = new Set([...s.entities.map((e) => e.id), ...s.characters.map((c) => c.id)]);
  for (const e of d.opening.contacts) {
    if (ids.has(e.id) || e.location !== d.location)
      throw new GameError(
        '开场新人物或物件须使用新编号，并位于开局现场。既有人物直接沿用世界记录。',
      );
    ids.add(e.id);
  }
  return d;
}
export function adoptCharacter(s: SessionState, actorId: string, version: number) {
  const workshop = s.workshops[actorId];
  const c = actor(s, actorId);
  if (c.ready || !workshop || workshop.accepted || !workshop.draft || workshop.version !== version)
    throw new GameError('角色草案已更新或已采用，请查看最新档案。', 409);
  const d = validateDraft(s, actorId, workshop.draft);
  Object.assign(c, {
    name: d.name,
    profile: d.personal.identity.slice(0, 120),
    background: d.background,
    personal: d.personal,
    stats: d.stats,
    training: d.training,
    expertise: d.expertise,
    abilities: d.abilities,
    inventory: d.inventory,
    cash: d.cash,
    debt: d.debt,
    debtTo: d.debtTo,
    location: d.location,
    school: d.abilities[0]?.school ?? 'none',
    energy: d.stats.RSN * 3,
    acclimated: s.locations.find((l) => l.id === d.location)!.zone < 0 ? 0 : 60,
    ready: true,
  });
  const facts: string[] = [];
  editWorld(
    s,
    d.opening.contacts.map((entity) => ({
      op: 'entity.create',
      entity: { ...entity, secret: '', visible: true },
      reason: `${d.name}与主持人确认的开局关系或物资`,
    })),
    'model',
    facts,
  );
  s.facts.push(...d.opening.facts);
  s.journal.push({
    id: randomUUID(),
    minute: s.minute,
    actor: c.name,
    title: d.opening.title,
    text: d.opening.text,
    facts: d.opening.facts,
  });
  workshop.accepted = true;
}
