import { randomInt, randomUUID } from 'node:crypto';
import {
  capacity,
  fogBoundary,
  carriedWeight,
  planSchema,
  personalSchema,
  characterSchema,
  type Amendment,
  type Conversation,
  skillNames,
  type Character,
  type CharacterInput,
  type Command,
  type Effect,
  type Entry,
  type Item,
  type Plan,
  type Proposal,
  type PublicState,
  type SessionState,
  type Skill,
  type Stat,
  type Wound,
} from '../shared/types.js';
import { entities, goods, locations, powers, routes, stock } from './content.js';
import { editWorld, initialClocks, runClocks } from './world.js';
export class GameError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
export type Die = () => number;
const rollDie: Die = () => randomInt(1, 101);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const actor = (s: SessionState, id: string) => {
  const c = s.characters.find((c) => c.id === id);
  if (!c) throw new GameError('角色不存在。');
  return c;
};
export const place = (s: SessionState, id: string) => {
  const p = s.locations.find((l) => l.id === id);
  if (!p) throw new GameError('地点不存在。');
  return p;
};
export const fogZone = (minute: number) =>
  [5, 5, 4, 4, 3, 3, 2, 0][Math.min(7, Math.floor(minute / 10080))];
const has = (c: { inventory: Item[] }, id: string, n = 1) =>
  c.inventory.some((i) => i.id === id && i.quantity >= n);
const take = (c: { inventory: Item[] }, id: string, n: number) => {
  const i = c.inventory.find((i) => i.id === id);
  if (!i || i.quantity < n) throw new GameError(`缺少物资：${i?.name ?? id} × ${n}。`);
  i.quantity -= n;
  c.inventory = c.inventory.filter((i) => i.quantity > 0);
  return { ...structuredClone(i), quantity: n };
};
function add(c: { inventory: Item[] }, i: Item) {
  const existing = c.inventory.find((v) => v.id === i.id);
  if (existing) {
    if (i.weapon) throw new GameError('同型枪械请使用单独物品编号，不能叠加弹仓。');
    existing.quantity += i.quantity;
  } else c.inventory.push(structuredClone(i));
}
const linked = (s: SessionState, from: string, to: string) =>
  s.routes.find((r) => (r.from === from && r.to === to) || (r.to === from && r.from === to));
const localEntity = (s: SessionState, c: Character, id: string) => {
  const e = s.entities.find((e) => e.id === id && e.location === c.location);
  if (!e) throw new GameError('该对象不在角色所在地点，不能远程操作。');
  return e;
};
const requireActive = (c: Character) => {
  if (!c.ready) throw new GameError('先与主持人谈妥角色，再进入场景。');
  if (c.status !== 'active')
    throw new GameError(
      c.status === 'dead' ? '角色已死亡，不能继续行动。' : '角色失去意识，需要同伴救治。',
    );
};
const patient = (s: SessionState, c: Character, id?: string) => {
  const p = id ? actor(s, id) : c;
  if (!p.ready || p.location !== c.location || p.status === 'dead')
    throw new GameError('病人不在身边，或已经死亡。');
  return p;
};
export function character(input: CharacterInput): Character {
  const stats = {
    STR: 5,
    AGI: 5,
    CON: 5,
    PER: 5,
    INT: 5,
    WIL: 5,
    RSN: input.school === 'none' ? 0 : 2,
  };
  const training: Record<string, number> = {};
  if (input.profile === 'soldier') {
    stats.STR = 6;
    stats.CON = 6;
    training.firearms = 30;
    training.melee = 15;
    training.athletics = 15;
  }
  if (input.profile === 'mechanic') {
    stats.INT = 7;
    training.technical = 30;
    training.observe = 15;
    training.firearms = 10;
  }
  if (input.profile === 'medic') {
    stats.INT = 6;
    stats.WIL = 6;
    training.medicine = 30;
    training.persuade = 15;
    training.observe = 15;
  }
  if (input.profile === 'scavenger') {
    stats.PER = 6;
    stats.AGI = 6;
    training.survival = 25;
    training.stealth = 20;
    training.observe = 15;
  }
  if (input.school !== 'none') training.resonance = 15;
  return {
    id: randomUUID(),
    ...input,
    ready: true,
    personal: personalSchema.parse({}),
    expertise: [],
    abilities: [],
    conditions: [],
    debtTo: '铁壁安保',
    stats,
    training,
    energy: stats.RSN * 3,
    strain: 0,
    acclimated: 60,
    location: 'town',
    inventory: [
      'rifle',
      'ammo762',
      'vest',
      'bandage',
      'medkit',
      'ration',
      'water',
      'tools',
      'wire',
      'scrap',
      ...(input.school === 'none' ? [] : ['crystal_c']),
    ].map((k) => stock(k)),
    cash: 300,
    debt: 1200,
    blood: 100,
    fatigue: 0,
    hunger: 0,
    thirst: 0,
    wounds: [],
    status: 'active',
    stance: 'exposed',
  };
}
export function newSession(id: string, mode: SessionState['mode'], c: Character): SessionState {
  return {
    schemaVersion: 2,
    clocks: initialClocks(),
    rulings: [],
    audit: [],
    environment: { tide: 'advancing', heldZone: 5, reason: '零号井的黑潮正在向外围扩散。' },
    id,
    revision: 0,
    createdAt: new Date().toISOString(),
    mode,
    minute: 0,
    characters: [c],
    workshops: {},
    sheetProposals: {},
    locations: structuredClone(locations),
    routes: structuredClone(routes),
    entities: structuredClone(entities),
    facts: [
      '2037年3月15日。零号井附近出现黑雾的消息已传到围栏镇。',
      '随身装备已计入铁壁的1200灰币欠款；没有免费救援条款。',
    ],
    secrets: [],
    precedents: [],
    reputation: { 铁壁安保: 0, 黑水亚洲: 0, 龙盾国际: 0, 守望者: 0, 拾荒者: 0, UEG: 0 },
    contracts: [
      {
        id: 'medicine',
        name: '老郑的药柜',
        issuer: 'zheng',
        description: '带回两盒密封抗生素。旧药厂可能还有库存。老郑收药，不要求你替谁杀人。',
        reward: 240,
        itemId: 'antibiotics',
        quantity: 2,
        deadline: 10080,
        status: 'offered',
      },
      {
        id: 'generator',
        name: '修好发电机',
        issuer: 'saw',
        description: '锯子需要一块柴油机控制模块。采石场有工程机械，取件方式由你决定。',
        reward: 400,
        itemId: 'module',
        quantity: 1,
        deadline: 20160,
        status: 'offered',
      },
      {
        id: 'records',
        name: '观测记录收购',
        issuer: 'fang',
        description: '铁壁收购UEG离线观测介质。交货不等于查清数据的用途，也不阻止你先找别人谈。',
        reward: 900,
        itemId: 'data',
        quantity: 1,
        deadline: 40320,
        status: 'offered',
      },
    ],
    events: [],
    proposal: null,
    journal: [
      {
        id: randomUUID(),
        minute: 0,
        title: '围栏镇，早上六点',
        text:
          locations.find((l) => l.id === 'town')!.description +
          ' 方远把一份空白合同推到桌边。你可以接工，也可以先打听人、准备物资，或直接离开镇子。',
        facts: ['你决定目的地、同行对象和做事办法。每次确认行动后，世界时间才会推进。'],
      },
    ],
  };
}
const statFor: Record<Skill, Stat> = {
  firearms: 'AGI',
  melee: 'STR',
  athletics: 'CON',
  stealth: 'AGI',
  observe: 'PER',
  technical: 'INT',
  medicine: 'INT',
  survival: 'PER',
  persuade: 'WIL',
  resonance: 'WIL',
};
export function skillChance(c: Character, skill: string, modifier = 0, chosenAttribute?: Stat) {
  const expertise = c.expertise.find((e) => e.name === skill);
  const attribute = chosenAttribute ?? expertise?.attribute ?? statFor[skill as Skill];
  if (!attribute) throw new GameError(`角色尚未记录“${skill}”专长，使用相应通用检定。`);
  const injury = c.wounds.reduce((n, w) => n + w.severity * 3, 0);
  return clamp(
    c.stats[attribute] * 5 +
      (expertise?.training ?? c.training[skill] ?? 0) +
      modifier -
      injury -
      Math.floor(c.fatigue / 10) * 5 -
      (carriedWeight(c) > capacity(c) ? 15 : 0) +
      c.conditions
        .filter((e) => !e.skills.length || e.skills.includes(skill))
        .reduce((n, e) => n + e.modifier, 0),
    5,
    95,
  );
}
export const emptyPlan = (summary: string, minutes = 1): Plan => ({
  summary,
  activity: 'effort',
  method: summary,
  minutes,
  skill: null,
  modifier: 0,
  difficultyReason: '条件明确，无需随机检定。',
  costs: [],
  weaponId: null,
  shots: 0,
  power: null,
  risks: ['时间会推进；在场威胁和持续出血仍会结算。'],
  success: { text: summary, effects: [] },
  failure: { text: '行动未能完成。', effects: [] },
  precedent: '',
});
export function nativePlan(s: SessionState, c: Character, cmd: Command): Plan {
  requireActive(c);
  let p = emptyPlan('行动');
  switch (cmd.kind) {
    case 'travel': {
      const dest = place(s, cmd.target),
        r = linked(s, c.location, dest.id);
      if (!r) throw new GameError('没有直接的已知路线。可逐段前进，或描述另寻道路的办法。');
      if (carriedWeight(c) > capacity(c) * 1.5)
        throw new GameError('负重超过最大搬运量，请先处理物资。');
      p = emptyPlan(
        `前往${dest.name}`,
        Math.ceil(r.minutes * (carriedWeight(c) > capacity(c) ? 1.5 : 1)),
      );
      p.method = r.description;
      p.success = {
        text: `你沿已知路线抵达${dest.name}。${dest.description}`,
        effects: [{ type: 'move', destination: dest.id }],
      };
      p.risks = [
        `路程 ${p.minutes} 分钟；途中消耗体力，抵达后处理当地威胁。`,
        ...(dest.danger >= 3 ? ['目的地有武装或异常风险；抵达不等于控制该区域。'] : []),
      ];
      break;
    }
    case 'inspect': {
      p = emptyPlan('观察附近的出入口、人员与物资', 10);
      p.skill = 'observe';
      p.difficultyReason = '留意掩体与不显眼的入口，需要观察检定。';
      const hidden = s.entities.filter((e) => e.location === c.location && !e.visible);
      p.success = {
        text: hidden.length
          ? hidden.map((e) => e.description).join('\n')
          : '你确认了附近的出入口和人员位置，没有发现更多隐藏物资。',
        effects: [
          ...hidden.map((e) => ({ type: 'reveal' as const, entityId: e.id })),
          { type: 'stance', stance: 'cover' },
        ],
      };
      p.failure.text = '你花了一些时间查看现场，没有找到新的可靠线索。';
      break;
    }
    case 'reload': {
      const gun = c.inventory.find((i) => i.id === cmd.itemId)?.weapon;
      if (!gun) throw new GameError('这不是可装填的枪械。');
      const n = Math.min(
        gun.capacity - gun.loaded,
        c.inventory.find((i) => i.id === gun.ammo)?.quantity ?? 0,
      );
      if (!n) throw new GameError('弹仓已满或没有匹配的弹药。');
      p = emptyPlan(`装填 ${n} 发弹药`, 0.5);
      p.costs = [{ itemId: gun.ammo, quantity: n }];
      p.success.effects = [{ type: 'reload', itemId: cmd.itemId }];
      break;
    }
    case 'consume': {
      const i = c.inventory.find((i) => i.id === cmd.itemId);
      if (!i || !['food', 'water'].includes(i.kind)) throw new GameError('请选择饮水或口粮。');
      p = emptyPlan(`使用${i.name}`, i.kind === 'water' ? 1 : 10);
      p.costs = [{ itemId: i.id, quantity: 1 }];
      p.success.effects = [{ type: 'sustain', itemId: i.id }];
      break;
    }
    case 'rest': {
      if (s.entities.some((e) => e.location === c.location && e.hostile && e.health > 0))
        throw new GameError('在场敌人仍有行动能力，无法休息。');
      if (!place(s, c.location).shelter)
        throw new GameError('这里没有可靠遮蔽。先描述搭建或寻找临时宿营点的办法。');
      p = emptyPlan(`休息 ${cmd.hours} 小时`, cmd.hours * 60);
      p.activity = 'rest';
      p.risks = [
        '休息不能替代止血与清创。伤口持续失血，饥渴与世界时钟照常推进。',
        '每小时恢复12点疲劳、1点能量；处理过的伤口至少一天才改善一级。',
      ];
      break;
    }
    case 'bandage': {
      const target = patient(s, c, cmd.patientId);
      if (!target.wounds.some((w) => w.id === cmd.woundId && w.bleeding > 0))
        throw new GameError('这处伤口不需要止血。');
      p = emptyPlan('压迫包扎出血部位', 3);
      p.costs = [
        {
          itemId:
            c.inventory.find(
              (i) => i.quantity > 0 && (i.medical === 'bandage' || i.id === 'bandage'),
            )?.id ?? 'bandage',
          quantity: 1,
        },
      ];
      p.success.effects = [{ type: 'stabilize', woundId: cmd.woundId, patientId: cmd.patientId }];
      p.risks = ['包扎期间仍会失血。止血后伤势仍在，需要清创和恢复。'];
      break;
    }
    case 'treat': {
      const target = patient(s, c, cmd.patientId);
      if (!target.wounds.some((w) => w.id === cmd.woundId)) throw new GameError('伤口不存在。');
      p = emptyPlan('清创并更换敷料', 30);
      p.skill = 'medicine';
      p.difficultyReason = '清创需要医疗训练，包扎后处理更安全。';
      p.costs = [
        {
          itemId:
            c.inventory.find(
              (i) => i.quantity > 0 && (i.medical === 'surgical' || i.id === 'medkit'),
            )?.id ?? 'medkit',
          quantity: 1,
        },
      ];
      p.success.effects = [{ type: 'stabilize', woundId: cmd.woundId, patientId: cmd.patientId }];
      break;
    }
    case 'buy':
    case 'sell': {
      const e = localEntity(s, c, cmd.entityId);
      if (!e.merchant || e.hostile || e.health <= 0) throw new GameError('对方现在不提供交易。');
      const source = cmd.kind === 'buy' ? e : c;
      const i = source.inventory.find((i) => i.id === cmd.itemId);
      if (!i) throw new GameError('该物品不在库存中。');
      const price = Math.ceil(
        i.value *
          cmd.quantity *
          (cmd.kind === 'buy' ? 1 + Math.floor(s.minute / 10080) * 0.1 : 0.5),
      );
      p = emptyPlan(`${cmd.kind === 'buy' ? '购买' : '出售'}${i.name} × ${cmd.quantity}`, 5);
      p.success.effects = [
        {
          type: 'transfer',
          from: source.id,
          to: cmd.kind === 'buy' ? c.id : e.id,
          itemId: i.id,
          quantity: cmd.quantity,
          price,
        },
      ];
      p.method = `与${e.name}交易，总价 ${price} 灰币。`;
      break;
    }
    case 'contract':
    case 'deliver': {
      const contract = s.contracts.find((t) => t.id === cmd.target);
      if (!contract) throw new GameError('合同不存在。');
      localEntity(s, c, contract.issuer);
      if (cmd.kind === 'contract' && contract.status !== 'offered')
        throw new GameError('这份合同现在不可接受。');
      if (
        cmd.kind === 'deliver' &&
        (contract.status !== 'accepted' || !has(c, contract.itemId, contract.quantity))
      )
        throw new GameError('先接受合同并带齐交付物。');
      p = emptyPlan(`${cmd.kind === 'contract' ? '接受' : '交付'}：${contract.name}`, 5);
      p.success.effects = [
        {
          type: 'contract',
          contractId: contract.id,
          operation: cmd.kind === 'contract' ? 'accept' : 'deliver',
        },
      ];
      if (cmd.kind === 'deliver') {
        p.method = `交付物资，领取 ${contract.reward} 灰币。`;
      }
      break;
    }
    case 'attack': {
      const e = localEntity(s, c, cmd.target);
      if (!e.visible || e.health <= 0) throw new GameError('没有可射击的目标。');
      const i = c.inventory.find((i) => i.weapon);
      if (!i?.weapon) throw new GameError('没有枪械。');
      p = emptyPlan(`向${e.name}开枪`, 0.1);
      p.skill = 'firearms';
      p.difficultyReason = '现场射击；精确距离、瞄准或绕侧可另行描述。';
      p.weaponId = i.id;
      p.shots = 1;
      p.success = {
        text: `你朝${e.name}开了一枪。`,
        effects: [
          { type: 'damage', target: e.id, severity: i.weapon.damage, part: '躯干', cause: i.name },
          { type: 'attitude', entityId: e.id, delta: -2, hostile: true },
        ],
      };
      p.failure = {
        text: `子弹没有命中${e.name}。枪声暴露了你的位置。`,
        effects: [{ type: 'attitude', entityId: e.id, delta: -2, hostile: true }],
      };
      p.risks = ['弹药照常消耗；目标存活且能攻击时会反击。中弹可能致残或死亡。'];
      break;
    }
  }
  return p;
}
export function damage(
  c: Character,
  severity: number,
  part: Wound['part'],
  cause: string,
  facts: string[],
) {
  if (c.status === 'dead') return;
  const protection =
    part === '躯干'
      ? Math.max(
          0,
          ...c.inventory
            .filter((i) => i.quantity > 0)
            .map((i) => i.armor ?? (i.id === 'vest' ? 1 : 0)),
        )
      : 0;
  severity = clamp(severity - protection, 1, 4);
  const w: Wound = {
    id: randomUUID(),
    severity,
    part,
    cause,
    bleeding: [0, 0, 0.3, 1, 3][severity],
    treatedAt: null,
  };
  c.wounds.push(w);
  c.blood = Math.max(0, c.blood - severity * 5);
  facts.push(
    `${c.name}：${part} ${severity}级伤，${w.bleeding ? `出血 ${w.bleeding}/分钟` : '无持续出血'}。`,
  );
  if (part === '头部' && severity === 4) c.blood = 0;
  updateStatus(c, facts);
}
function updateStatus(c: Character, facts: string[]) {
  const prior = c.status;
  if (c.blood <= 0 || c.wounds.reduce((n, w) => n + w.severity, 0) >= 12) c.status = 'dead';
  else if (c.status !== 'dead') c.status = c.blood < 35 ? 'unconscious' : 'active';
  if (c.status !== prior)
    facts.push(
      `${c.name}${c.status === 'dead' ? '死亡。装备留在遗体上，没有自动救援。' : c.status === 'unconscious' ? '失去意识。' : '恢复意识。'}`,
    );
}
function applyEffects(
  s: SessionState,
  c: Character,
  effects: Effect[],
  p: Plan,
  facts: string[],
  spent: Item[] = [],
) {
  const budget = new Map<string, number>();
  for (const cost of p.costs)
    budget.set(cost.itemId, (budget.get(cost.itemId) ?? 0) + cost.quantity);
  const claim = (ids: string[], n = 1) => {
    const id = ids.find((id) => (budget.get(id) ?? 0) >= n);
    if (!id) throw new GameError('该效果需要独立的耗材，不能重复使用已经消耗的物品。');
    budget.set(id, budget.get(id)! - n);
    return id;
  };
  for (const effect of effects) {
    switch (effect.type) {
      case 'condition.add': {
        if (effect.condition.expiresAt !== null && effect.condition.expiresAt <= s.minute)
          throw new GameError('临时状态的失效时间需要晚于本次行动完成。');
        c.conditions = c.conditions.filter((e) => e.id !== effect.condition.id);
        c.conditions.push(effect.condition);
        facts.push(`${effect.condition.name}：${effect.condition.description}`);
        break;
      }
      case 'condition.remove':
        if (!c.conditions.some((e) => e.id === effect.conditionId))
          throw new GameError('该状态已经不在角色身上。');
        c.conditions = c.conditions.filter((e) => e.id !== effect.conditionId);
        break;
      case 'fact':
        (effect.private ? s.secrets : s.facts).push(effect.text);
        if (!effect.private) facts.push(effect.text);
        break;
      case 'reveal': {
        const e = localEntity(s, c, effect.entityId);
        e.visible = true;
        facts.push(`发现：${e.name}。`);
        break;
      }
      case 'state': {
        const e = localEntity(s, c, effect.entityId);
        e.state = effect.text;
        e.visible = true;
        facts.push(`${e.name}：${effect.text}`);
        break;
      }
      case 'attitude': {
        const e = localEntity(s, c, effect.entityId);
        e.attitude = clamp(e.attitude + effect.delta, -3, 3);
        e.hostile = effect.hostile;
        facts.push(`${e.name}：${e.hostile ? '敌对' : e.attitude > 0 ? '关系改善' : '态度改变'}。`);
        break;
      }
      case 'transfer': {
        const from = effect.from === c.id ? c : localEntity(s, c, effect.from);
        const other = s.characters.find((x) => x.id === effect.to && x.id !== c.id);
        if (
          other &&
          (!other.ready || other.location !== c.location || effect.price !== 0 || from.id !== c.id)
        )
          throw new GameError('只能把自己的物品免费交给身边的同伴，不能替对方花钱。');
        const to = other ?? (effect.to === c.id ? c : localEntity(s, c, effect.to));
        if (from.id === to.id) throw new GameError('转移双方不能相同。');
        if (to.cash < effect.price) throw new GameError('交易方没有足够灰币。');
        const item = take(from, effect.itemId, effect.quantity);
        add(to, item);
        to.cash -= effect.price;
        from.cash += effect.price;
        facts.push(
          `${item.name} × ${item.quantity}：${from.name} → ${to.name}${effect.price ? `，${effect.price} 灰币` : ''}。`,
        );
        break;
      }
      case 'create': {
        if (!p.costs.length || effect.item.quantity < 1)
          throw new GameError('制作需要明确消耗的材料与正数产出。');
        if (effect.item.weapon && effect.item.weapon.loaded > 0)
          throw new GameError('新制枪械须以空弹仓入库，再从真实弹药库存装填。');
        if (effect.item.kind === 'evidence' && effect.item.id in goods)
          throw new GameError('不能通过制作伪造既有关键证据的身份。仿制件应使用新编号。');
        if (c.inventory.some((i) => i.id === effect.item.id))
          throw new GameError('制作物需要独立编号。');
        add(c, effect.item);
        facts.push(`制成${effect.item.name} × ${effect.item.quantity}；${effect.basis}`);
        break;
      }
      case 'spawn': {
        if (s.entities.filter((e) => e.location === c.location).length >= 40)
          throw new GameError('现场对象过多，请先处理已有对象。');
        s.entities.push({
          id: randomUUID(),
          name: effect.name,
          kind: effect.kind,
          location: c.location,
          description: effect.description,
          secret: effect.secret,
          state: '尚未进一步接触',
          visible: true,
          faction: '独立',
          attitude: 0,
          health: 6,
          armor: 0,
          hostile: false,
          attack: 0,
          damage: 0,
          ammo: 0,
          cash: 0,
          inventory: [],
          merchant: false,
          nextMove: s.minute + 360,
        });
        facts.push(`现场：${effect.name}。`);
        break;
      }
      case 'damage': {
        if (effect.target === c.id) damage(c, effect.severity, effect.part, effect.cause, facts);
        else {
          if (s.characters.some((x) => x.id === effect.target))
            throw new GameError('不能替另一名玩家决定受伤或行动。');
          const e = localEntity(s, c, effect.target);
          e.health = Math.max(0, e.health - Math.max(1, effect.severity - e.armor));
          if (e.health === 0) {
            e.hostile = false;
            e.state = '失去行动能力';
          }
          facts.push(`${e.name}受到伤害，状态：${e.health === 0 ? '失去行动能力' : '仍能行动'}。`);
        }
        break;
      }
      case 'stabilize': {
        const target = patient(s, c, effect.patientId);
        const w = target.wounds.find((w) => w.id === effect.woundId);
        if (!w) throw new GameError('伤口不存在。');
        const material = claim(
          spent.filter((i) => i.medical || ['medkit', 'bandage'].includes(i.id)).map((i) => i.id),
        );
        w.bleeding = 0;
        if (material === 'medkit' || spent.find((i) => i.id === material)?.medical === 'surgical')
          w.treatedAt = s.minute;
        facts.push(
          `${target.name}的${w.part}已止血${w.treatedAt !== null ? '并清创' : ''}；伤势未消失。`,
        );
        break;
      }
      case 'reload': {
        const gun = c.inventory.find((i) => i.id === effect.itemId)?.weapon;
        if (!gun) throw new GameError('装填目标不是枪械。');
        const n = budget.get(gun.ammo) ?? 0;
        if (!n || gun.loaded + n > gun.capacity) throw new GameError('装填数量或弹仓容量不符。');
        claim([gun.ammo], n);
        gun.loaded += n;
        facts.push(`弹仓：${gun.loaded}/${gun.capacity}。`);
        break;
      }
      case 'sustain': {
        const target = patient(s, c, effect.patientId),
          i = spent.find((i) => i.id === effect.itemId);
        if (!i || !['food', 'water'].includes(i.kind) || target.status !== 'active')
          throw new GameError('只能给清醒的人使用饮食。');
        claim([i.id]);
        if (i.kind === 'water') target.thirst = Math.max(0, target.thirst - 4);
        else target.hunger = Math.max(0, target.hunger - 12);
        facts.push(`${target.name}补充了${i.kind === 'water' ? '饮水' : '食物'}。`);
        break;
      }
      case 'payment': {
        const e = localEntity(s, c, effect.entityId);
        if (c.cash < effect.amount) throw new GameError('灰币不足。');
        if (effect.purpose === 'debt') {
          if (
            !(
              c.debtTo.includes(e.name) ||
              c.debtTo.includes(e.id) ||
              (e.id === 'fang' && c.debtTo.includes('铁壁'))
            ) ||
            effect.amount > c.debt
          )
            throw new GameError('偿债对象或金额不符。');
          c.debt -= effect.amount;
        }
        c.cash -= effect.amount;
        e.cash += effect.amount;
        facts.push(
          `支付给${e.name} ${effect.amount} 灰币${effect.purpose === 'debt' ? '，记入还款' : ''}。`,
        );
        break;
      }
      case 'contract': {
        const t = s.contracts.find((x) => x.id === effect.contractId);
        if (!t) throw new GameError('合同不存在。');
        const issuer = localEntity(s, c, t.issuer);
        if (issuer.health <= 0 || issuer.hostile || t.deadline <= s.minute)
          throw new GameError('合同已不能按原条件执行。');
        if (effect.operation === 'accept') {
          if (t.status !== 'offered') throw new GameError('合同不能重复承接。');
          t.status = 'accepted';
          facts.push(`接受合同：${t.name}。`);
        } else {
          if (t.status !== 'accepted') throw new GameError('先接受合同，且只能交付一次。');
          const item = take(c, t.itemId, t.quantity);
          add(issuer, item);
          t.status = 'completed';
          c.cash += t.reward;
          facts.push(`交付${item.name} × ${item.quantity}，领取 ${t.reward} 灰币。`);
        }
        break;
      }
      case 'shelter': {
        place(s, c.location).shelter = true;
        s.facts.push(effect.description);
        facts.push(`记录可用庇护处：${effect.description}。`);
        break;
      }
      case 'stance':
        c.stance = effect.stance;
        facts.push(
          `姿态：${effect.stance === 'cover' ? '依托掩体' : effect.stance === 'hidden' ? '保持隐蔽' : '暴露'}。`,
        );
        break;
      case 'move': {
        const r = linked(s, c.location, effect.destination);
        if (!r || p.minutes < r.minutes) throw new GameError('移动缺少可行路线或足够时间。');
        c.location = effect.destination;
        c.stance = 'exposed';
        if (place(s, c.location).zone < 0) c.acclimated = 0;
        facts.push(`抵达${place(s, c.location).name}。`);
        break;
      }
      case 'route': {
        place(s, effect.destination);
        if (effect.destination === c.location || effect.minutes < 10)
          throw new GameError('路线的终点或时间不合理。');
        if (!linked(s, c.location, effect.destination))
          s.routes.push({
            id: randomUUID(),
            from: c.location,
            to: effect.destination,
            minutes: effect.minutes,
            description: effect.description,
          });
        facts.push(`记录新路线：${effect.description}。`);
        break;
      }
      case 'reputation':
        if (!(effect.faction in s.reputation)) throw new GameError('未知势力。');
        s.reputation[effect.faction] = clamp(s.reputation[effect.faction] + effect.delta, -10, 10);
        facts.push(`${effect.faction}关系 ${effect.delta > 0 ? '+' : ''}${effect.delta}。`);
        break;
    }
  }
}
export function propose(
  s: SessionState,
  actorId: string,
  intent: string,
  raw: Plan,
  command?: Command,
): Proposal {
  const c = actor(s, actorId);
  requireActive(c);
  const p = planSchema.parse(raw),
    zone = place(s, c.location).zone;
  if (p.weaponId) {
    const w = c.inventory.find((i) => i.id === p.weaponId)?.weapon;
    if (!w || p.shots < 1 || w.loaded < p.shots)
      throw new GameError('枪械或已装填弹药不足，先装填或换一种办法。');
  } else if (p.shots) throw new GameError('射击缺少枪械。');
  let powerCost = 0,
    instability = 0;
  const ability = p.abilityId ? c.abilities.find((a) => a.id === p.abilityId) : undefined;
  if (p.powerTerms && !p.power) throw new GameError('临时异能条件需要对应的异能行动。');
  if (p.abilityId && (!ability || ability.school !== p.power))
    throw new GameError('该异能不在已确认档案中，或学派不符。');
  if (p.power && c.abilities.length && !ability)
    throw new GameError('使用异能时须引用已确认能力的 abilityId。');
  if (p.power) {
    if (s.environment.tide === 'closed') throw new GameError('裂隙已经关闭，区域中的异能失效。');
    if (
      (!ability && c.school !== p.power) ||
      zone < 0 ||
      c.acclimated < 60 ||
      !c.inventory.some((i) => i.kind === 'crystal' && i.quantity > 0)
    )
      throw new GameError('异能需要已觉醒的对应学派、灰区内适应至少一小时，并接触随身结晶。');
    powerCost =
      (p.powerTerms?.cost ?? ability?.cost ?? powers[p.power].cost) +
      Math.floor(c.strain) +
      (zone >= fogBoundary(s.minute, s.environment) ? 1 : 0);
    if (c.energy < powerCost)
      throw new GameError(`异能需要 ${powerCost} 点能量，目前只有 ${Math.floor(c.energy)} 点。`);
    instability = clamp(
      (c.stats.RSN +
        c.strain +
        (p.powerTerms?.strain ?? ability?.strain ?? 1) +
        (zone >= fogBoundary(s.minute, s.environment) ? 1 : 0) -
        c.stats.WIL) *
        15,
      0,
      90,
    );
  }
  if (p.skill === null && p.power) throw new GameError('异能需要控制检定。');
  if (
    p.activity === 'rest' &&
    (!place(s, c.location).shelter ||
      p.costs.length ||
      p.shots ||
      p.power ||
      p.success.effects.length ||
      p.failure.effects.length)
  )
    throw new GameError('休息需要可靠遮蔽，并且不能同时执行其他工作。');
  const creations = [
    ...p.success.effects.filter((e) => e.type === 'create'),
    ...p.failure.effects.filter((e) => e.type === 'create'),
  ];
  if (creations.length) {
    for (const e of creations)
      if (
        e.item.kind === 'crystal' &&
        !p.costs.some((cost) => c.inventory.find((i) => i.id === cost.itemId)?.kind === 'crystal')
      )
        throw new GameError('结晶加工必须有原结晶材料，不能凭空转化。');
    const weight = p.costs.reduce(
      (n, x) => n + (c.inventory.find((i) => i.id === x.itemId)?.weight ?? 0) * x.quantity,
      0,
    );
    for (const branch of [p.success, p.failure]) {
      const items = branch.effects.filter((e) => e.type === 'create').map((e) => e.item);
      if (items.reduce((n, i) => n + i.weight * i.quantity, 0) > weight + 0.01)
        throw new GameError('制作物的重量缺少材料依据。');
    }
  }
  for (const branch of [p.success, p.failure]) {
    if (
      branch.effects.filter((e) => e.type === 'move').length > 1 ||
      (branch.effects.some((e) => e.type === 'move') &&
        branch.effects.some((e) => e.type === 'route'))
    )
      throw new GameError('先完成当前一步：新路线勘查和移动需要分别裁定。');
    const clone = structuredClone(s),
      a = actor(clone, actorId);
    const spent = p.costs.map((cost) => take(a, cost.itemId, cost.quantity));
    clone.minute = s.minute + p.minutes;
    try {
      editWorld(clone, branch.world ?? [], 'model', []);
    } catch (e) {
      throw new GameError(e instanceof Error ? e.message : '世界编辑校验失败。');
    }
    for (const effect of branch.effects)
      if (
        effect.type === 'contract' &&
        (s.contracts.find((t) => t.id === effect.contractId)?.deadline ?? 0) <= s.minute + p.minutes
      )
        throw new GameError('完成这次交涉时合同已经过期，请重新协商。');
    applyEffects(clone, a, branch.effects, p, [], spent);
  }
  const threat = s.entities.some((e) => e.location === c.location && e.hostile && e.health > 0);
  if (threat && p.minutes > 1 && !p.success.effects.some((e) => e.type === 'move'))
    throw new GameError('敌人正在威胁你，请先处理数秒内的动作、寻找掩体或撤退。');
  const risks: string[] = [];
  if (p.powerTerms)
    risks.push(
      `本次异能用法：${p.powerTerms.reason}；基础能耗 ${p.powerTerms.cost}，负荷 +${p.powerTerms.strain}。`,
    );
  if (c.wounds.some((w) => w.bleeding > 0))
    risks.push(
      `持续出血约 ${(c.wounds.reduce((n, w) => n + w.bleeding, 0) * p.minutes).toFixed(1)}；可能失去意识或死亡。`,
    );
  if (threat) risks.push('在场敌人会在本次行动后攻击，隐蔽、掩体、距离和弹药影响反击。');
  for (const other of s.characters.filter(
    (x) => x.ready && x.id !== actorId && x.status !== 'dead',
  ))
    if (
      s.entities.some(
        (e) => e.location === other.location && e.hostile && e.health > 0 && e.ammo > 0,
      )
    )
      risks.push(`同伴${other.name}仍处在敌人火力下；共享时间推进会使其遭到攻击。`);
  p.risks = [...risks, ...p.risks].slice(0, 6);
  const fog = zone >= fogBoundary(s.minute, s.environment) && zone >= 0 ? -20 : 0;
  return {
    id: randomUUID(),
    actorId,
    intent,
    plan: p,
    command,
    chance: p.skill ? skillChance(c, p.skill, p.modifier + fog, p.attribute) : null,
    powerCost,
    instability,
  };
}
export function advanceTime(
  s: SessionState,
  minutes: number,
  facts: string[],
  restingId?: string,
  deferClocks = false,
) {
  const before = s.minute;
  s.minute = Math.round((s.minute + minutes) * 10) / 10;
  for (const c of s.characters) {
    if (!c.ready || c.status === 'dead') continue;
    for (const condition of c.conditions.filter(
      (e) => e.expiresAt !== null && e.expiresAt <= s.minute,
    ))
      facts.push(`${c.name}的“${condition.name}”结束。`);
    c.conditions = c.conditions.filter((e) => e.expiresAt === null || e.expiresAt > s.minute);
    const elapsed = minutes / 60;
    c.blood = Math.max(0, c.blood - c.wounds.reduce((n, w) => n + w.bleeding, 0) * minutes);
    c.hunger += elapsed;
    c.thirst += elapsed;
    c.fatigue = clamp(
      c.fatigue +
        elapsed * (restingId === c.id ? -12 : 1.5) +
        (c.thirst > 8 ? elapsed * 3 : 0) +
        (c.hunger > 24 ? elapsed : 0),
      0,
      100,
    );
    if (c.thirst > 36) c.blood = Math.max(0, c.blood - elapsed * 3);
    c.strain = Math.max(0, c.strain - elapsed);
    if (place(s, c.location).zone < 0) c.acclimated = 0;
    else c.acclimated = Math.min(60, c.acclimated + minutes);
    if (restingId === c.id && !c.wounds.some((w) => w.bleeding > 0)) {
      c.energy = Math.min(c.stats.RSN * 3, c.energy + elapsed);
      c.blood = Math.min(100, c.blood + elapsed);
      for (const w of c.wounds) {
        if (w.treatedAt !== null && s.minute - w.treatedAt >= 1440) {
          w.severity--;
          w.treatedAt = s.minute;
          facts.push(`${c.name}的${w.part}伤势改善一级。`);
        }
      }
      c.wounds = c.wounds.filter((w) => w.severity > 0);
    } else if (
      c.status === 'unconscious' &&
      place(s, c.location).shelter &&
      !c.wounds.some((w) => w.bleeding > 0)
    )
      c.blood = Math.min(100, c.blood + elapsed * 0.5);
    if (place(s, c.location).zone >= fogBoundary(s.minute, s.environment)) {
      c.fatigue = clamp(c.fatigue + elapsed * 4, 0, 100);
      if (minutes >= 30)
        facts.push(`${c.name}暴露在黑潮覆盖区，额外疲劳 ${Math.round(elapsed * 4)}。`);
    }
    updateStatus(c, facts);
  }
  for (const t of s.contracts)
    if (t.deadline <= s.minute && ['offered', 'accepted'].includes(t.status)) {
      t.status = 'expired';
      facts.push(`合同已过期：${t.name}。`);
    }
  if (!deferClocks) runClocks(s, facts);
  s.events = s.clocks.filter((e) => e.status === 'fired').map((e) => e.id);
  if (
    s.environment.tide === 'advancing' &&
    fogBoundary(before, s.environment) !== fogBoundary(s.minute, s.environment)
  )
    facts.push(`黑潮前锋推进到 ${fogBoundary(s.minute, s.environment)} 区。`);
}
function react(s: SessionState, c: Character, die: Die, facts: string[]) {
  if (c.status === 'dead') return;
  for (const e of s.entities.filter(
    (e) => e.location === c.location && e.hostile && e.health > 0 && e.attack > 0 && e.ammo > 0,
  )) {
    const target = clamp(
        e.attack - (c.stance === 'cover' ? 25 : c.stance === 'hidden' ? 45 : 0),
        5,
        95,
      ),
      value = die();
    e.ammo--;
    facts.push(
      `${e.name}攻击：D100 ${value} / ${target}，${value <= target ? '命中' : '未命中'}。`,
    );
    if (value <= target) {
      const part = die() <= 15 ? '头部' : die() <= 60 ? '躯干' : '左腿';
      damage(c, e.damage, part, e.name, facts);
    }
  }
}
export function commit(
  source: SessionState,
  actorId: string,
  proposalId: string,
  die: Die = rollDie,
): SessionState {
  const s = structuredClone(source),
    q = s.proposal;
  if (!q || q.id !== proposalId || q.actorId !== actorId)
    throw new GameError('这份裁定不属于当前角色或已经失效。', 409);
  const c = actor(s, actorId);
  requireActive(c);
  const p = q.plan,
    facts: string[] = [];
  propose(s, actorId, q.intent, p, q.command);
  const spent: Item[] = [];
  for (const cost of p.costs) {
    const i = take(c, cost.itemId, cost.quantity);
    spent.push(i);
    facts.push(`消耗：${i.name} × ${cost.quantity}。`);
  }
  if (p.weaponId) {
    c.inventory.find((i) => i.id === p.weaponId)!.weapon!.loaded -= p.shots;
    c.stance = 'exposed';
    facts.push(`射击 ${p.shots} 发。`);
  }
  if (q.powerCost) {
    c.energy -= q.powerCost;
    const strain =
      p.powerTerms?.strain ?? c.abilities.find((a) => a.id === p.abilityId)?.strain ?? 1;
    c.strain += strain;
    facts.push(`异能消耗 ${q.powerCost} 能量；负荷增加 ${strain}。`);
  }
  const value = q.chance === null ? null : die(),
    success = value === null || value <= q.chance!;
  const outcome = success ? p.success : p.failure;
  // Existing wounds bleed during preparation. A newly inflicted wound starts bleeding on subsequent elapsed time.
  advanceTime(s, p.minutes, facts, p.activity === 'rest' ? c.id : undefined, true);
  if (c.status === 'active') {
    editWorld(s, outcome.world ?? [], 'model', facts);
    applyEffects(s, c, outcome.effects, p, facts, spent);
    if (p.power && q.instability > 0) {
      const v = die();
      facts.push(`失控检定：D100 ${v}，失控概率 ${q.instability}%。`);
      if (v <= q.instability) {
        c.energy = Math.max(0, c.energy - 2);
        damage(c, 2, '躯干', '共鸣反噬', facts);
        c.stance = 'exposed';
        facts.push('共鸣反噬暴露位置，并额外损失 2 点能量。');
      }
    }
    runClocks(s, facts);
    const moved = outcome.effects.some((e) => e.type === 'move');
    for (const other of s.characters) {
      if (!other.ready) continue;
      const rounds =
        other.id === c.id && moved ? 1 : Math.max(1, Math.min(30, Math.floor(p.minutes * 10)));
      for (let round = 0; round < rounds && other.status !== 'dead'; round++) {
        if (
          !s.entities.some(
            (e) => e.location === other.location && e.hostile && e.health > 0 && e.ammo > 0,
          )
        )
          break;
        react(s, other, die, facts);
      }
    }
  } else runClocks(s, facts);
  s.events = s.clocks.filter((e) => e.status === 'fired').map((e) => e.id);
  if (p.precedent && success) s.precedents.push(p.precedent);
  s.precedents = s.precedents.slice(-100);
  s.proposal = null;
  const entry: Entry = {
    id: randomUUID(),
    minute: s.minute,
    actor: c.name,
    intent: q.intent,
    title: c.status === 'dead' ? '角色死亡' : success ? '行动完成' : '行动失败',
    text:
      c.status === 'active'
        ? outcome.text
        : '你的身体已经无法完成后续动作。现场不会因为你倒下而暂停。',
    facts,
    ...(value !== null && p.skill
      ? { roll: { skill: p.skill, target: q.chance!, value, success } }
      : {}),
  };
  s.journal.push(entry);
  return s;
}
export function publicView(
  s: SessionState,
  me: string,
  isHost: boolean,
  busy: string | null,
): PublicState {
  const {
    secrets: _secrets,
    clocks: _clocks,
    audit: _audit,
    workshops,
    sheetProposals,
    entities: all,
    proposal: q,
    ...rest
  } = structuredClone(s);
  const c = actor(s, me);
  const visible = all
    .filter((e) => e.visible && e.location === c.location)
    .map(
      ({
        secret: _secret,
        attack: _attack,
        damage: _damage,
        ammo: _ammo,
        nextMove: _nextMove,
        cash: _cash,
        inventory,
        ...e
      }) => ({
        ...e,
        inventory: e.merchant || e.kind === 'container' || e.health === 0 ? inventory : [],
      }),
    );
  return {
    ...rest,
    workshop: workshops[me] ?? null,
    sheetProposal: sheetProposals[me] ?? null,
    characters: rest.characters.filter((c) => c.ready || c.id === me),
    me,
    isHost,
    busy,
    entities: visible,
    fogZone: fogBoundary(s.minute, s.environment),
    proposal: q
      ? {
          id: q.id,
          actorId: q.actorId,
          intent: q.intent,
          chance: q.chance,
          powerCost: q.powerCost,
          instability: q.instability,
          summary: q.plan.summary,
          method: q.plan.method,
          minutes: q.plan.minutes,
          skill: q.plan.skill,
          modifier: q.plan.modifier,
          difficultyReason: q.plan.difficultyReason,
          costs: [
            ...q.plan.costs.map(
              (x) =>
                `${actor(s, q.actorId).inventory.find((i) => i.id === x.itemId)?.name ?? x.itemId} × ${x.quantity}`,
            ),
            ...(q.plan.shots ? [`弹药 ${q.plan.shots} 发`] : []),
          ],
          risks: q.plan.risks,
        }
      : null,
  };
}
export function directorContext(s: SessionState, id: string) {
  const c = actor(s, id);
  return {
    actor: c,
    minute: s.minute,
    environment: s.environment,
    location: place(s, c.location),
    geography: s.locations.map(({ id, name, zone }) => ({ id, name, zone })),
    routes: s.routes.filter((r) => r.from === c.location || r.to === c.location),
    nearby: s.entities.filter((e) => e.location === c.location),
    otherPlayers: s.characters
      .filter((x) => x.ready && x.id !== id)
      .map((other) => ({
        id: other.id,
        name: other.name,
        location: other.location,
        ...(other.location === c.location ? { status: other.status, wounds: other.wounds } : {}),
      })),
    facts: s.facts.slice(-16),
    privateFacts: s.secrets.slice(-8),
    precedents: s.precedents.slice(-8),
    rulings: s.rulings.slice(-6),
    contracts: s.contracts,
    recent: s.journal.slice(-5),
    pendingSheetRevision: s.sheetProposals[id] ?? null,
    pendingAction: s.proposal?.actorId === id ? s.proposal : null,
    memoryIndex: {
      journalEntries: s.journal.length,
      entities: s.entities.length,
      clocks: s.clocks.filter((e) => e.status === 'pending').length,
      rulings: s.rulings.length,
      tools: 'query可按关键词检索完整实体、时钟、历史、规则与物资模板。',
    },
    skills: Object.fromEntries(Object.keys(skillNames).map((k) => [k, skillChance(c, k as Skill)])),
    power: c.abilities.length ? c.abilities : c.school === 'none' ? null : powers[c.school],
    reputation: s.reputation,
  };
}

// Only quiet, deterministic interactions may bypass review. Shared world time can still hurt other PCs.
export function canFlow(s: SessionState, p: Plan): boolean {
  return (
    p.skill === null &&
    !p.power &&
    !p.shots &&
    !p.costs.length &&
    p.minutes <= 5 &&
    !s.characters.some(
      (c) =>
        c.ready &&
        (c.wounds.some((w) => w.bleeding > 0) ||
          c.thirst > 30 ||
          s.entities.some((e) => e.location === c.location && e.hostile && e.health > 0)),
    ) &&
    !s.clocks.some((e) => e.status === 'pending' && e.due <= s.minute + p.minutes) &&
    [p.success, p.failure].every(
      (branch) =>
        !branch.world?.length &&
        branch.effects.every((e) => ['fact', 'state', 'reveal'].includes(e.type)),
    )
  );
}
export function converse(s: SessionState, actorId: string, intent: string, reply: Conversation) {
  const c = actor(s, actorId);
  const recorded = reply.record && Object.keys(reply.record).length > 0;
  if (recorded) Object.assign(c.personal, reply.record);
  s.journal.push({
    id: randomUUID(),
    minute: s.minute,
    actor: c.name,
    intent,
    title: '交谈',
    text: reply.text,
    facts: recorded ? ['更新角色的目标、偏好或自述笔记。'] : [],
  });
}
export function amendSheet(s: SessionState, actorId: string, amendment: Amendment, apply = false) {
  const c = actor(s, actorId),
    changes = amendment.changes;
  const next = characterSchema.parse({
    ...c,
    ...changes,
    personal: { ...c.personal, ...changes.personal },
    stats: { ...c.stats, ...changes.stats },
  });
  if (
    new Set(next.abilities.map((a) => a.id)).size !== next.abilities.length ||
    new Set(next.expertise.map((e) => e.name)).size !== next.expertise.length
  )
    throw new GameError('能力和专长名称不能重复。');
  if (
    Object.keys(next.training).some((k) => !(k in skillNames)) ||
    next.expertise.some((e) => e.name in skillNames)
  )
    throw new GameError('自定义专业请放在 expertise，通用训练放在 training。');
  // Raising the maximum never refills the current energy pool.
  next.energy = Math.min(c.energy, next.stats.RSN * 3);
  if (changes.abilities) next.school = next.abilities[0]?.school ?? 'none';
  if (apply) {
    Object.assign(c, next);
    s.journal.push({
      id: randomUUID(),
      minute: s.minute,
      actor: c.name,
      title: '角色档案修订',
      text: amendment.text,
      facts: [amendment.reason],
    });
    delete s.sheetProposals[actorId];
  }
}
