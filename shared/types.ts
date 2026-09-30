import { z } from 'zod';
export const statNames = {
  STR: '力量',
  AGI: '敏捷',
  CON: '体质',
  PER: '感知',
  INT: '智力',
  WIL: '意志',
  RSN: '共鸣',
} as const;
export type Stat = keyof typeof statNames;
export const skillNames = {
  firearms: '枪械',
  melee: '近战',
  athletics: '体能',
  stealth: '隐蔽',
  observe: '观察',
  technical: '技术',
  medicine: '医疗',
  survival: '生存',
  persuade: '交涉',
  resonance: '异能控制',
} as const;
export type Skill = keyof typeof skillNames;
export const skillKeys = Object.keys(skillNames) as [Skill, ...Skill[]];
export const schoolNames = {
  none: '未觉醒',
  body: '身体强化系',
  element: '元素共鸣系',
  sense: '感知扩张系',
  space: '空间干涉系',
  mind: '精神支配系',
} as const;
export type School = keyof typeof schoolNames;
export const profileNames = {
  soldier: '退役军人',
  mechanic: '维修技师',
  medic: '医护人员',
  scavenger: '回收者',
} as const;
export type Profile = keyof typeof profileNames;
const short = z.string().min(1).max(180),
  id = z.string().min(1).max(80),
  positive = z.number().int().positive();
const stats = z.object({
  STR: z.number().int().min(1).max(10),
  AGI: z.number().int().min(1).max(10),
  CON: z.number().int().min(1).max(10),
  PER: z.number().int().min(1).max(10),
  INT: z.number().int().min(1).max(10),
  WIL: z.number().int().min(1).max(10),
  RSN: z.number().int().min(0).max(10),
});
export const expertiseSchema = z
  .object({
    name: z.string().min(1).max(80),
    attribute: z.enum(['STR', 'AGI', 'CON', 'PER', 'INT', 'WIL', 'RSN']),
    training: z.number().int().min(0).max(40),
    scope: z.string().min(1).max(600),
  })
  .strict();
export const abilitySchema = z
  .object({
    id,
    name: short,
    school: z.enum(['body', 'element', 'sense', 'space', 'mind']),
    description: z.string().min(1).max(1200),
    applications: z.string().min(1).max(1200),
    limits: z.string().min(1).max(1200),
    cost: z.number().int().min(1).max(30),
    strain: z.number().int().min(1).max(10),
    consequences: z.string().min(1).max(700),
  })
  .strict();
export type Ability = z.infer<typeof abilitySchema>;
export const personalSchema = z.object({
  identity: z.string().max(300).default(''),
  appearance: z.string().max(1000).default(''),
  motives: z.string().max(1600).default(''),
  relationships: z.string().max(2400).default(''),
  preferences: z.string().max(1600).default(''),
  boundaries: z.string().max(1600).default(''),
  advantages: z.string().max(1600).default(''),
  complications: z.string().max(1600).default(''),
  notes: z.string().max(2400).default(''),
});
export const itemSchema = z.object({
  id,
  name: short,
  quantity: z.number().int().nonnegative(),
  weight: z.number().min(0).max(100),
  value: z.number().min(0).max(100000),
  kind: z.enum([
    'gear',
    'ammo',
    'food',
    'water',
    'medical',
    'material',
    'crystal',
    'weapon',
    'evidence',
  ]),
  description: z.string().max(500),
  armor: z.number().int().min(0).max(3).optional(),
  medical: z.enum(['bandage', 'surgical']).optional(),
  weapon: z
    .object({
      capacity: positive.max(100),
      loaded: z.number().int().min(0).max(100),
      ammo: id,
      damage: positive.max(4),
      range: positive.max(1000),
    })
    .optional(),
});
export type Item = z.infer<typeof itemSchema>;
export const woundSchema = z.object({
  id,
  part: z.enum(['头部', '躯干', '左臂', '右臂', '左腿', '右腿']),
  severity: positive.max(4),
  bleeding: z.number().min(0).max(3),
  cause: short,
  treatedAt: z.number().nullable(),
});
export type Wound = z.infer<typeof woundSchema>;
export const conditionSchema = z
  .object({
    id,
    name: short,
    description: z.string().min(1).max(1000),
    expiresAt: z.number().nonnegative().nullable(),
    modifier: z.number().int().min(-40).max(40),
    skills: z.array(z.string().min(1).max(80)).max(24),
  })
  .strict();
export const characterSchema = z.object({
  id,
  name: short,
  profile: z.string().max(120),
  background: z.string().max(6000),
  ready: z.boolean().default(true),
  personal: personalSchema.default({}),
  expertise: z.array(expertiseSchema).max(24).default([]),
  abilities: z.array(abilitySchema).max(16).default([]),
  conditions: z.array(conditionSchema).default([]),
  debtTo: z.string().max(200).default('铁壁安保'),
  stats,
  training: z.record(z.number().int().min(0).max(40)),
  school: z.enum(['none', 'body', 'element', 'sense', 'space', 'mind']),
  energy: z.number().min(0),
  strain: z.number().min(0),
  acclimated: z.number().min(0),
  location: id,
  inventory: z.array(itemSchema),
  cash: z.number().nonnegative(),
  debt: z.number().nonnegative(),
  blood: z.number().min(0).max(100),
  fatigue: z.number().min(0).max(100),
  hunger: z.number().min(0),
  thirst: z.number().min(0),
  wounds: z.array(woundSchema),
  status: z.enum(['active', 'unconscious', 'dead']),
  stance: z.enum(['exposed', 'cover', 'hidden']),
});
export type Character = z.infer<typeof characterSchema>;
export const entitySchema = z.object({
  id,
  name: short,
  kind: z.enum(['person', 'container', 'machine', 'feature']),
  location: id,
  description: z.string().max(1200),
  state: z.string().max(700),
  visible: z.boolean(),
  secret: z.string().max(1600),
  faction: z.string().max(60),
  attitude: z.number().int().min(-3).max(3),
  health: z.number().min(0).max(12),
  armor: z.number().int().min(0).max(3),
  hostile: z.boolean(),
  attack: z.number().min(0).max(90),
  damage: z.number().int().min(0).max(4),
  ammo: z.number().int().nonnegative(),
  cash: z.number().nonnegative(),
  inventory: z.array(itemSchema),
  merchant: z.boolean(),
  nextMove: z.number().nonnegative(),
  properties: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type Entity = z.infer<typeof entitySchema>;
export const locationSchema = z.object({
  id,
  name: short,
  zone: z.number().int().min(-1).max(5),
  x: z.number(),
  y: z.number(),
  description: z.string(),
  shelter: z.boolean(),
  danger: z.number().int().min(0).max(5),
});
export type Location = z.infer<typeof locationSchema>;
export const routeSchema = z.object({
  id,
  from: id,
  to: id,
  minutes: positive,
  description: short,
});
export type Route = z.infer<typeof routeSchema>;
export const environmentSchema = z.object({
  tide: z.enum(['advancing', 'contained', 'closed']),
  heldZone: z.number().int().min(0).max(5),
  reason: z.string(),
});
export const fogBoundary = (minute: number, environment?: z.infer<typeof environmentSchema>) =>
  environment?.tide === 'closed'
    ? 6
    : environment?.tide === 'contained'
      ? environment.heldZone
      : [5, 5, 4, 4, 3, 3, 2, 0][Math.min(7, Math.floor(minute / 10080))];
const entityDraftSchema = z
  .object({
    id,
    name: short,
    kind: entitySchema.shape.kind,
    location: id,
    description: z.string().max(1200),
    secret: z.string().max(1600).default(''),
    faction: z.string().max(60).default('独立'),
    inventory: z.array(itemSchema).max(25).default([]),
    merchant: z.boolean().default(false),
    hostile: z.boolean().default(false),
    attack: z.number().min(0).max(90).default(0),
    damage: z.number().int().min(0).max(4).default(0),
    ammo: z.number().int().nonnegative().max(500).default(0),
    health: z.number().min(1).max(12).default(6),
    armor: z.number().int().min(0).max(3).default(0),
    cash: z.number().min(0).max(10000).default(0),
    visible: z.boolean().default(true),
  })
  .strict();
export const worldEditSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('environment.patch'),
      tide: z.enum(['advancing', 'contained', 'closed']),
      reason: short,
    })
    .strict(),
  z.object({ op: z.literal('entity.create'), entity: entityDraftSchema, reason: short }).strict(),
  z
    .object({
      op: z.literal('entity.patch'),
      entityId: id,
      changes: entitySchema
        .pick({
          description: true,
          state: true,
          secret: true,
          location: true,
          attitude: true,
          hostile: true,
          properties: true,
        })
        .partial()
        .strict(),
      reason: short,
    })
    .strict(),
  z.object({ op: z.literal('site.create'), site: locationSchema, reason: short }).strict(),
  z
    .object({
      op: z.literal('site.patch'),
      siteId: id,
      changes: locationSchema
        .pick({ description: true, shelter: true, danger: true })
        .partial()
        .strict(),
      reason: short,
    })
    .strict(),
  z
    .object({
      op: z.literal('ruling.record'),
      scope: short,
      trigger: short,
      ruling: z.string().min(1).max(600),
      reason: short,
    })
    .strict(),
  z.object({ op: z.literal('event.cancel'), eventId: id, reason: short }).strict(),
]);
export type WorldEdit = z.infer<typeof worldEditSchema>;
export const clockSchema = z
  .object({
    id,
    owner: id,
    requiresTide: z.enum(['advancing', 'contained', 'closed']).optional(),
    due: z.number().min(0),
    summary: short,
    public: z.boolean(),
    guards: z
      .array(
        z
          .object({
            entityId: id,
            alive: z.boolean().optional(),
            at: id.optional(),
            withoutItem: id.optional(),
            property: z
              .object({
                key: short,
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              })
              .optional(),
          })
          .strict(),
      )
      .max(8),
    edits: z.array(worldEditSchema).min(1).max(8),
    status: z.enum(['pending', 'fired', 'cancelled']).default('pending'),
  })
  .strict();
export type WorldClock = z.infer<typeof clockSchema>;
export const worldMutationSchema = z.union([
  worldEditSchema,
  z.object({ op: z.literal('event.schedule'), event: clockSchema, reason: short }).strict(),
]);
export type WorldMutation = z.infer<typeof worldMutationSchema>;
export const effectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('condition.add'), condition: conditionSchema }).strict(),
  z.object({ type: z.literal('condition.remove'), conditionId: id }).strict(),
  z.object({ type: z.literal('reveal'), entityId: id }).strict(),
  z
    .object({ type: z.literal('fact'), text: z.string().min(1).max(600), private: z.boolean() })
    .strict(),
  z.object({ type: z.literal('state'), entityId: id, text: z.string().min(1).max(600) }).strict(),
  z
    .object({
      type: z.literal('attitude'),
      entityId: id,
      delta: z.number().int().min(-2).max(2),
      hostile: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('transfer'),
      from: id,
      to: id,
      itemId: id,
      quantity: positive.max(1000),
      price: z.number().int().min(0).max(100000),
    })
    .strict(),
  z.object({ type: z.literal('create'), item: itemSchema, basis: short }).strict(),
  z
    .object({
      type: z.literal('spawn'),
      name: short,
      kind: z.enum(['person', 'container', 'feature']),
      description: z.string().min(1).max(600),
      secret: z.string().max(600),
    })
    .strict(),
  z
    .object({
      type: z.literal('damage'),
      target: id,
      severity: positive.max(4),
      part: woundSchema.shape.part,
      cause: short,
    })
    .strict(),
  z.object({ type: z.literal('stabilize'), woundId: id, patientId: id.optional() }).strict(),
  z.object({ type: z.literal('reload'), itemId: id }).strict(),
  z.object({ type: z.literal('sustain'), itemId: id, patientId: id.optional() }).strict(),
  z
    .object({
      type: z.literal('payment'),
      entityId: id,
      amount: positive,
      purpose: z.enum(['service', 'debt']),
    })
    .strict(),
  z
    .object({
      type: z.literal('contract'),
      contractId: id,
      operation: z.enum(['accept', 'deliver']),
    })
    .strict(),
  z.object({ type: z.literal('shelter'), description: short }).strict(),
  z.object({ type: z.literal('stance'), stance: characterSchema.shape.stance }).strict(),
  z.object({ type: z.literal('move'), destination: id }).strict(),
  z
    .object({
      type: z.literal('route'),
      destination: id,
      minutes: positive.max(480),
      description: short,
    })
    .strict(),
  z
    .object({ type: z.literal('reputation'), faction: id, delta: z.number().int().min(-2).max(2) })
    .strict(),
]);
export type Effect = z.infer<typeof effectSchema>;
const outcomeSchema = z
  .object({
    text: z.string().min(1).max(4000),
    effects: z.array(effectSchema).max(16),
    world: z.array(worldMutationSchema).max(12).optional(),
  })
  .strict();
export const planSchema = z
  .object({
    summary: short,
    activity: z.enum(['effort', 'rest']).default('effort'),
    method: z.string().min(1).max(700),
    minutes: z.number().min(0.1).max(480),
    skill: z.string().min(1).max(80).nullable(),
    attribute: z.enum(['STR', 'AGI', 'CON', 'PER', 'INT', 'WIL', 'RSN']).optional(),
    modifier: z.number().int().min(-40).max(20),
    difficultyReason: short,
    costs: z.array(z.object({ itemId: id, quantity: positive.max(1000) }).strict()).max(8),
    weaponId: id.nullable(),
    shots: z.number().int().min(0).max(30),
    power: z.enum(['body', 'element', 'sense', 'space', 'mind']).nullable(),
    abilityId: id.optional(),
    powerTerms: z
      .object({
        cost: z.number().int().min(1).max(60),
        strain: z.number().int().min(0).max(20),
        reason: z.string().min(1).max(700),
      })
      .strict()
      .optional(),
    risks: z.array(short).min(1).max(6),
    success: outcomeSchema,
    failure: outcomeSchema,
    precedent: z.string().max(500),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('travel'), target: id }).strict(),
  z.object({ kind: z.literal('inspect') }).strict(),
  z.object({ kind: z.literal('reload'), itemId: id }).strict(),
  z.object({ kind: z.literal('rest'), hours: z.number().int().min(1).max(8) }).strict(),
  z.object({ kind: z.literal('consume'), itemId: id }).strict(),
  z.object({ kind: z.literal('bandage'), woundId: id, patientId: id.optional() }).strict(),
  z.object({ kind: z.literal('treat'), woundId: id, patientId: id.optional() }).strict(),
  z
    .object({ kind: z.literal('buy'), entityId: id, itemId: id, quantity: positive.max(100) })
    .strict(),
  z
    .object({ kind: z.literal('sell'), entityId: id, itemId: id, quantity: positive.max(100) })
    .strict(),
  z.object({ kind: z.literal('contract'), target: id }).strict(),
  z.object({ kind: z.literal('deliver'), target: id }).strict(),
  z.object({ kind: z.literal('attack'), target: id }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const proposalSchema = z.object({
  id,
  actorId: id,
  intent: z.string(),
  plan: planSchema,
  command: commandSchema.optional(),
  chance: z.number().nullable(),
  powerCost: z.number(),
  instability: z.number(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const entrySchema = z.object({
  id,
  minute: z.number(),
  actor: z.string().optional(),
  intent: z.string().optional(),
  title: short,
  text: z.string(),
  facts: z.array(z.string()),
  roll: z
    .object({
      skill: z.string(),
      target: z.number(),
      value: z.number(),
      success: z.boolean(),
    })
    .optional(),
});
export type Entry = z.infer<typeof entrySchema>;
export const characterDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    background: z.string().min(1).max(6000),
    personal: personalSchema,
    stats,
    training: z.record(z.number().int().min(0).max(40)),
    expertise: z.array(expertiseSchema).max(24),
    abilities: z.array(abilitySchema).max(16),
    inventory: z.array(itemSchema).max(60),
    cash: z.number().min(0).max(100000),
    debt: z.number().min(0).max(100000),
    debtTo: z.string().max(200),
    location: id,
    rationale: z.string().min(1).max(2000),
    opening: z
      .object({
        title: short,
        text: z.string().min(1).max(4000),
        facts: z.array(z.string().max(600)).max(12),
        contacts: z.array(entityDraftSchema.omit({ secret: true, visible: true })).max(6),
      })
      .strict(),
  })
  .strict();
export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export function draftNotices(d: CharacterDraft): string[] {
  const notices: string[] = [];
  if (d.abilities.length && !d.inventory.some((i) => i.kind === 'crystal' && i.quantity > 0))
    notices.push(
      '已记录异能，但随身没有结晶导体，目前无法施术。可以与主持人补充来源，也可以把寻找导体作为开局目标。',
    );
  if (d.abilities.some((a) => a.cost > d.stats.RSN * 3))
    notices.push('部分能力的基础能耗超过当前能量上限，需要先取得额外条件或调整用法。');
  const weight = d.inventory.reduce((n, i) => n + i.weight * i.quantity, 0);
  if (weight > d.stats.STR * 3)
    notices.push(
      `随身负重 ${weight.toFixed(1)} kg，超过通常承载 ${d.stats.STR * 3} kg。可以商量存放、运输或减少携带。`,
    );
  return notices;
}
export const creationReplySchema = z
  .object({
    text: z.string().min(1).max(6000),
    draft: characterDraftSchema.nullable(),
    questions: z.array(z.string().max(400)).max(3),
  })
  .strict();
export type CreationReply = z.infer<typeof creationReplySchema>;
export const workshopSchema = z.object({
  requestId: z.string().uuid(),
  seed: z.string().max(12000),
  version: z.number().int().nonnegative(),
  messages: z.array(z.object({ role: z.enum(['player', 'gm']), text: z.string() })),
  draft: characterDraftSchema.nullable(),
  questions: z.array(z.string()),
  accepted: z.boolean().default(false),
});
export type Workshop = z.infer<typeof workshopSchema>;
export const conversationSchema = z
  .object({
    tool: z.literal('reply'),
    text: z.string().min(1).max(6000),
    record: personalSchema
      .pick({ motives: true, preferences: true, boundaries: true, notes: true })
      .partial()
      .optional(),
  })
  .strict();
export type Conversation = z.infer<typeof conversationSchema>;
export const sheetChangesSchema = z
  .object({
    background: characterSchema.shape.background.optional(),
    personal: personalSchema.partial().optional(),
    stats: stats.partial().optional(),
    training: characterSchema.shape.training.optional(),
    expertise: characterSchema.shape.expertise.optional(),
    abilities: characterSchema.shape.abilities.optional(),
  })
  .strict();
export const amendmentSchema = z
  .object({
    tool: z.literal('amend'),
    text: z.string().min(1).max(4000),
    reason: z.string().min(1).max(1200),
    changes: sheetChangesSchema,
  })
  .strict();
export type Amendment = z.infer<typeof amendmentSchema>;
export const sheetProposalSchema = amendmentSchema.extend({ id, actorId: id });
export const contractSchema = z.object({
  id,
  name: short,
  issuer: id,
  description: z.string(),
  reward: z.number(),
  itemId: id,
  quantity: positive,
  deadline: z.number(),
  status: z.enum(['offered', 'accepted', 'completed', 'expired']),
});
export type Contract = z.infer<typeof contractSchema>;
export const sessionSchema = z.object({
  schemaVersion: z.literal(2),
  id,
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  mode: z.enum(['dsh', 'local']),
  minute: z.number().nonnegative(),
  characters: z.array(characterSchema).min(1).max(4),
  workshops: z.record(workshopSchema).default({}),
  sheetProposals: z.record(sheetProposalSchema).default({}),
  locations: z.array(locationSchema),
  routes: z.array(routeSchema),
  entities: z.array(entitySchema),
  facts: z.array(z.string()),
  secrets: z.array(z.string()),
  precedents: z.array(z.string()),
  reputation: z.record(z.number()),
  contracts: z.array(contractSchema),
  events: z.array(z.string()),
  journal: z.array(entrySchema),
  proposal: proposalSchema.nullable(),
  clocks: z.array(clockSchema).default([]),
  environment: environmentSchema.default({
    tide: 'advancing',
    heldZone: 5,
    reason: '零号井的黑潮正在向外围扩散。',
  }),
  rulings: z
    .array(z.object({ id, scope: short, trigger: short, ruling: z.string(), minute: z.number() }))
    .default([]),
  audit: z
    .array(
      z.object({
        id,
        minute: z.number(),
        source: z.enum(['model', 'clock']),
        reason: z.string(),
        edits: z.array(worldMutationSchema),
      }),
    )
    .default([]),
});
export type SessionState = z.infer<typeof sessionSchema>;
export type PublicEntity = Omit<
  Entity,
  'secret' | 'attack' | 'damage' | 'ammo' | 'nextMove' | 'cash' | 'inventory'
> & { inventory: Item[] };
export interface PublicState extends Omit<
  SessionState,
  'secrets' | 'entities' | 'proposal' | 'clocks' | 'audit' | 'workshops' | 'sheetProposals'
> {
  workshop: Workshop | null;
  sheetProposal: z.infer<typeof sheetProposalSchema> | null;
  me: string;
  isHost: boolean;
  busy: string | null;
  entities: PublicEntity[];
  proposal:
    | (Pick<Proposal, 'id' | 'actorId' | 'intent' | 'chance' | 'powerCost' | 'instability'> & {
        summary: string;
        method: string;
        minutes: number;
        skill: string | null;
        modifier: number;
        difficultyReason: string;
        costs: string[];
        risks: string[];
      })
    | null;
  fogZone: number;
}
export interface SessionCredentials {
  room: string;
  token: string;
}
export const characterInput = z
  .object({
    name: z.string().trim().min(1).max(16),
    profile: z.enum(['soldier', 'mechanic', 'medic', 'scavenger']),
    background: z.string().trim().max(400).default('欠着铁壁的债，靠回收工作维持生活。'),
    school: z.enum(['none', 'body', 'element', 'sense', 'space', 'mind']).default('none'),
  })
  .strict();
export type CharacterInput = z.infer<typeof characterInput>;
export const conceptInput = z.object({ concept: z.string().trim().min(1).max(12000) }).strict();
export const actionInput = z
  .object({
    requestId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    intent: z.string().trim().min(1).max(1600),
    command: commandSchema.optional(),
  })
  .strict();
export type ActionInput = z.infer<typeof actionInput>;
export const gameDate = (minute: number) =>
  new Date(Date.UTC(2037, 2, 15, 6) + minute * 60000).toISOString().slice(0, 16).replace('T', ' ');
export const carriedWeight = (c: Character) =>
  c.inventory.reduce((n, i) => n + i.quantity * i.weight, 0);
export const capacity = (c: Character) => c.stats.STR * 3;
