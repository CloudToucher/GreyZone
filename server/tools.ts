import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  attributes,
  audience,
  identifier,
  json,
  recordSchema,
  type World,
  type GameRecord,
  type Run,
  type Roll,
  type Data,
  type Change,
  type Published,
} from '../shared/types.js';
import { Store, Fault, uid } from './store.js';
import { Library } from './library.js';
import { context, due } from './projection.js';
import { calendarLabel } from '../shared/types.js';

const text = z.string().min(1).max(12000),
  key = identifier.describe(
    '同一工具内每个新操作用不同 key，例如本轮ID:时间1。重试同一操作沿用原 key。不同工具可共用 key。',
  ),
  reason = z.string().min(1).max(1200);
const ops = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), record: recordSchema, reason }).strict(),
  z
    .object({
      op: z.literal('patch'),
      id: identifier,
      changes: z
        .object({
          name: z.string().min(1).max(150).optional(),
          audience: audience.optional(),
          secret: z.string().max(12000).optional(),
          data: z.record(json).optional(),
        })
        .strict(),
      reason,
    })
    .strict(),
  z
    .object({
      op: z.literal('adjust'),
      id: identifier,
      resource: identifier,
      amount: z.number().finite(),
      reason,
    })
    .strict(),
  z
    .object({
      op: z.literal('transfer'),
      itemId: identifier,
      to: identifier,
      quantity: z.number().int().positive(),
      price: z.number().nonnegative().default(0),
      reason,
    })
    .strict(),
  z
    .object({
      op: z.literal('condition'),
      id: identifier,
      condition: z
        .object({
          id: identifier,
          name: text,
          description: text,
          severity: z.enum(['轻伤', '重伤', '危重伤', '状态']).default('状态'),
          part: z.string().default(''),
          expiresAt: z.number().nonnegative().nullable().default(null),
          remedy: z.string().default(''),
          deadline: z.number().nonnegative().nullable().default(null),
        })
        .strict()
        .optional(),
      remove: identifier.optional(),
      reason,
    })
    .strict(),
]);
const operationList = z.array(ops).max(80);
const attribute = z.enum(['body', 'agility', 'perception', 'mind']);
const participant = z
  .object({
    actorId: identifier,
    attribute,
    specialty: z.string().optional(),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    modifier: z.number().int().min(-10).max(10).default(0),
  })
  .strict();
const checkSchema = participant.extend({
  id: identifier,
  purpose: reason,
  basis: reason,
  difficulty: z.number().int().min(1).max(40).optional(),
  opponent: participant.optional(),
  audience,
});
const passage = z
  .object({
    text: text.describe(
      '面向玩家的现场叙述：外部动作、可观察线索、NPC对白。不得代写玩家未提交的思想、新台词、承诺或下一步决定；不复述整张档案。',
    ),
    audience,
  })
  .strict();
const decision = z.object({
  actionId: identifier,
  status: z.enum(['done', 'partial', 'deferred', 'interrupted', 'rejected']),
  reason: reason.describe('面向该行动接收者的结果说明，不包含主持秘密。'),
});
export const schemas = {
  context_get: z
    .object({
      ids: z.array(identifier).max(30).optional(),
      documents: z.array(z.string().max(160)).max(5).optional(),
    })
    .strict(),
  context_search: z
    .object({
      query: z.string().min(1).max(300),
      scope: z.enum(['all', 'records', 'documents', 'history']).default('all'),
      limit: z.number().int().min(1).max(12).default(5),
    })
    .strict(),
  checks_resolve: z.object({ key, checks: z.array(checkSchema).min(1).max(16) }).strict(),
  state_apply: z.object({ key, changes: operationList }).strict(),
  time_advance: z.object({ key, minutes: z.number().min(0).max(525600), reason }).strict(),
  turn_commit: z
    .object({
      key,
      changes: operationList.default([]),
      passages: z.array(passage).min(1).max(16),
      decisions: z.array(decision).default([]),
      finish: z.boolean().default(true),
    })
    .strict(),
  turn_ask: z
    .object({ key, prompt: text, characters: z.array(identifier).min(1).max(24) })
    .strict(),
};
export const descriptions: Record<keyof typeof schemas, string> = {
  context_get:
    '批量读取指定记录或 Markdown 资料。空参数返回当前权威局势（含已掷骰、草稿变化）。只读，勿反复读取已提供内容。',
  context_search:
    '按中文词语、名称或 ID 检索资料、人物、历史；只返回相关片段。用 context_get 读取需要的全文。',
  checks_resolve:
    '真实 d20 检定；属性及专长从档案读取。选择 difficulty 或 opponent 二者之一。独立检定可批量；依赖上一步结果的检定分别调用。同 id 的依据和骰子永久锁定，恢复时沿用，不另起 id 重掷。',
  state_apply:
    '一次暂存多个变化。patch.data 递归合并，数组整体替换；adjust 对 resources 下一个数值增减；transfer 转移物品并由接收者支付灰币；condition 增改或解除状态。每项 reason 说明依据。常用变化可直接放 turn_commit，省去此调用。',
  time_advance:
    '按主持判断推进草稿时间（分钟，可小数）。计算到期状态和周期消耗提醒，不替主持执行人物行为、伤害或剧情。一次并行行动只推进一次共同经过时间。场外讨论和建角不能使用。',
  turn_commit:
    '原子提交变化与玩家叙述，系统同步角色、日志、视图。所有变化可批量放 changes，无需先 state_apply。passages 分别指定能获知的角色，table 为全桌，[] 为 GM。finish=true 结束本批并要求每个 actionId 有裁决；false 发布阶段成果并继续。首次建角务必更新本次 ownerCharacter 的 name、stats、背景、specialties、abilities、资源及装备；不修改 ready/delegated。',
  turn_ask:
    '只有遇到新选择、真正的歧义或玩家尚未知晓的重大风险时向指定角色询问并暂停。已经执行的成果先用 turn_commit(finish=false)发布；没有发生的保持草稿。调用后停止，不继续执行等待回答的步骤。',
};

function safeKeys(value: unknown) {
  if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Fault('非法字段。');
      safeKeys(v);
    }
}
function merge(target: Data, patch: Data): Data {
  const result = structuredClone(target);
  for (const [k, v] of Object.entries(patch))
    result[k] =
      v !== null &&
      !Array.isArray(v) &&
      typeof v === 'object' &&
      result[k] !== null &&
      !Array.isArray(result[k]) &&
      typeof result[k] === 'object'
        ? merge(result[k] as Data, v)
        : structuredClone(v);
  return result;
}
export function validateWorld(world: World, playerIds: string[]) {
  for (const r of Object.values(world.records)) {
    recordSchema.parse(r);
    safeKeys(r);
    if (
      r.data.aliasOf &&
      (r.kind === 'character' ||
        r.data.aliasOf === r.id ||
        !world.records[String(r.data.aliasOf)] ||
        world.records[String(r.data.aliasOf)].data.aliasOf ||
        world.records[String(r.data.aliasOf)].kind !== r.kind)
    )
      throw new Fault('别名必须指向同类已有权威记录，不能用于玩家角色、循环或多层引用。');
    if (r.audience.some((id) => id !== 'table' && !playerIds.includes(id)))
      throw new Fault(`${r.name}引用了不存在的玩家视野。`);
    if (r.data.location && !world.records[String(r.data.location)])
      throw new Fault(`${r.name}的位置不存在。`);
    if (r.data.resources)
      for (const value of Object.values(r.data.resources as Data))
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
          throw new Fault(`${r.name}的资源必须为非负数。`);
    if (r.kind === 'item') {
      if (
        !Number.isInteger(r.data.quantity) ||
        Number(r.data.quantity) < 0 ||
        !world.records[String(r.data.owner)]
      )
        throw new Fault(`${r.name}缺少有效持有人或数量。`);
    }
    if (r.kind === 'character' || r.data.stats) {
      const stats = r.data.stats as Data;
      if (
        !stats ||
        Object.keys(attributes).some(
          (k) => !Number.isInteger(stats[k]) || Number(stats[k]) < 0 || Number(stats[k]) > 3,
        )
      )
        throw new Fault(`${r.name}的四项属性须为 0—3。`);
      if (
        !Array.isArray(r.data.specialties) ||
        r.data.specialties.some((s) => typeof s !== 'string')
      )
        throw new Fault(`${r.name}需要专长名称列表。`);
    }
    if (
      r.data.conditions &&
      (!Array.isArray(r.data.conditions) ||
        r.data.conditions.some(
          (c) => !c || typeof c !== 'object' || Array.isArray(c) || typeof c.id !== 'string',
        ))
    )
      throw new Fault('状态格式不正确。');
    if (
      r.kind === 'clock' &&
      (typeof r.data.due !== 'number' ||
        r.data.due < 0 ||
        !['pending', 'resolved', 'cancelled'].includes(String(r.data.status)))
    )
      throw new Fault('提醒须有到期分钟和 pending/resolved/cancelled 状态。');
  }
}

export class GameTools {
  constructor(
    public store: Store,
    public library: Library,
    public changed: (room: string) => void = () => {},
    private die: () => number = () => randomInt(1, 21),
  ) {}
  private active(runId: string) {
    const run = this.store.run(runId);
    if (run.status !== 'running') throw new Fault('本轮已经暂停或结束。', 409);
    return run;
  }
  private ids(run: Run) {
    return this.store.seats(run.roomId).flatMap((s) => s.characters);
  }
  private get(world: World, id: string) {
    const r = world.records[id];
    if (!r) throw new Fault(`记录不存在：${id}`);
    return r;
  }
  private accessAudience(run: Run, a: string[]) {
    if (a.some((x) => x !== 'table' && !this.ids(run).includes(x)))
      throw new Fault('可见范围引用了不存在的角色。');
  }
  private change(run: Run, r: GameRecord, summary: string, reason: string, privateOnly = false) {
    run.changes.push({
      recordId: r.id,
      name: r.name,
      summary,
      reason,
      audience: privateOnly ? [] : r.audience,
    });
  }
  private apply(run: Run, changes: z.infer<typeof operationList>) {
    if (changes.length && run.kind === 'discussion')
      throw new Fault('场外讨论不能修改世界。请将实际行动提交到行动板。');
    for (const op of changes) {
      safeKeys(op);
      const id = op.op === 'create' ? op.record.id : op.op === 'transfer' ? op.itemId : op.id;
      if (run.kind === 'workshop') {
        const target = op.op === 'create' ? op.record : run.draft.records[id];
        const personalNote =
          target &&
          ['fact', 'ruling', 'relation', 'place', 'npc'].includes(target.kind) &&
          target.audience.length > 0 &&
          target.audience.every((id) => id === run.ownerCharacter);
        if (
          id !== run.ownerCharacter &&
          !(target?.kind === 'item' && target.data.owner === run.ownerCharacter) &&
          !personalNote
        )
          throw new Fault('建角只能维护本角色、自己的初始物品及仅本人可见的背景记录、地点和人物。');
        if (op.op === 'transfer') throw new Fault('建角不转移他人的物资。');
        const changedAudience =
          op.op === 'create'
            ? op.record.audience
            : op.op === 'patch'
              ? op.changes.audience
              : undefined;
        if (changedAudience?.some((id) => id !== run.ownerCharacter))
          throw new Fault('建角资料仅向当前角色开放；入场后的认识与分享另行裁定。');
      }
      if (op.op === 'create') {
        if (run.draft.records[id]) throw new Fault('记录已存在，请用 patch：' + id);
        if (
          ['npc', 'place', 'faction'].includes(op.record.kind) &&
          !op.record.data.distinctIdentityReason
        ) {
          const existing = Object.values(run.draft.records).find(
            (r) =>
              !r.data.aliasOf &&
              r.kind === op.record.kind &&
              r.name.trim() === op.record.name.trim(),
          );
          if (existing)
            throw new Fault(
              `同名对象已经存在：${existing.id}。请读取并增量更新；确为同名不同对象时在data.distinctIdentityReason说明区别。`,
            );
        }
        if (op.record.kind === 'character')
          throw new Fault('玩家角色由玩家从网页创建，NPC 请使用 npc。');
        run.draft.records[id] = structuredClone(op.record);
        this.change(run, op.record, `新增：${op.record.name}`, op.reason);
        continue;
      }
      const r = this.get(run.draft, id);
      if (r.data.aliasOf) throw new Fault(`此记录已归并，请操作 ${r.data.aliasOf}。`);
      if (op.op === 'patch') {
        if (op.changes.data && ('ready' in op.changes.data || 'delegated' in op.changes.data))
          throw new Fault('入场与托管由角色所有者决定。');
        const before = structuredClone(r);
        Object.assign(r, {
          ...op.changes,
          data: op.changes.data ? merge(r.data, op.changes.data) : r.data,
        });
        // Audit both visibility changes without delivering previously hidden contents.
        const numericChanges = (before: Data, after: Data, path = ''): string[] =>
          Object.keys(after).flatMap((k) => {
            const a = before[k],
              b = after[k],
              p = path ? `${path}.${k}` : k;
            if (typeof b === 'number' && a !== b) return [`${p}：${a ?? 0} → ${b}`];
            return a &&
              b &&
              typeof a === 'object' &&
              typeof b === 'object' &&
              !Array.isArray(a) &&
              !Array.isArray(b)
              ? numericChanges(a, b, p)
              : [];
          });
        this.change(
          run,
          r,
          numericChanges(before.data, r.data).join('；') || `${r.name}的资料已更新`,
          op.reason,
          Object.keys(op.changes).every((k) => k === 'secret'),
        );
        if (before.kind === 'item' && op.changes.data?.owner && before.data.owner !== r.data.owner)
          throw new Fault('物品换主人请使用 transfer，确保数量与付款同时入账。');
      } else if (op.op === 'adjust') {
        const resources = (r.data.resources ?? {}) as Data;
        const before = resources[op.resource] ?? 0;
        if (typeof before !== 'number') throw new Fault('只能调整数值资源。');
        resources[op.resource] = Math.round((before + op.amount) * 1000000) / 1000000;
        r.data.resources = resources;
        this.change(run, r, `${op.resource}：${before} → ${resources[op.resource]}`, op.reason);
      } else if (op.op === 'condition') {
        if (Boolean(op.remove) === Boolean(op.condition))
          throw new Fault('提供 condition 或 remove 其中一项。');
        const list = (r.data.conditions ?? []) as Data[];
        r.data.conditions = list.filter((c) => c.id !== (op.remove ?? op.condition!.id));
        if (op.condition) (r.data.conditions as Data[]).push(op.condition);
        this.change(
          run,
          r,
          op.condition
            ? `${op.condition.severity}：${op.condition.name}`
            : '解除状态：' + op.remove,
          op.reason,
        );
      } else if (op.op === 'transfer') {
        if (r.kind !== 'item' || op.quantity > Number(r.data.quantity))
          throw new Fault('物品数量不足。');
        const from = this.get(run.draft, String(r.data.owner)),
          to = this.get(run.draft, op.to);
        if (from.id === to.id) throw new Fault('物品已由该角色持有。');
        if (op.price) {
          const payer = (to.data.resources ?? {}) as Data,
            payee = (from.data.resources ?? {}) as Data;
          if (Number(payer.cash ?? 0) < op.price) throw new Fault('付款方灰币不足。');
          payer.cash = Number(payer.cash ?? 0) - op.price;
          payee.cash = Number(payee.cash ?? 0) + op.price;
          to.data.resources = payer;
          from.data.resources = payee;
          this.change(run, from, `收到 ${op.price} 灰币`, op.reason);
          this.change(run, to, `支付 ${op.price} 灰币`, op.reason);
        }
        const receiverVisibility = to.kind === 'character' ? [to.id] : to.audience;
        const visibility = [...new Set([...r.audience, ...receiverVisibility])];
        if (op.quantity === r.data.quantity) {
          r.data.owner = to.id;
          r.audience = receiverVisibility;
        } else {
          r.data.quantity = Number(r.data.quantity) - op.quantity;
          const split = {
            ...structuredClone(r),
            id: uid('item'),
            audience: receiverVisibility,
            data: { ...r.data, owner: to.id, quantity: op.quantity },
          };
          run.draft.records[split.id] = split;
        }
        this.change(
          run,
          { ...r, audience: visibility },
          `${from.name} → ${to.name}：${r.name} × ${op.quantity}`,
          op.reason,
        );
      }
    }
    validateWorld(run.draft, this.ids(run));
  }
  private roll(world: World, p: z.infer<typeof participant>) {
    const r = this.get(world, p.actorId),
      stats = r.data.stats as Data | undefined;
    if (!stats || typeof stats[p.attribute] !== 'number')
      throw new Fault(`${r.name}尚无该属性；先查阅或建立档案。`);
    if (p.specialty && !(r.data.specialties as string[]).includes(p.specialty))
      throw new Fault(`角色没有专长：${p.specialty}`);
    const modifier = Number(stats[p.attribute]) + (p.specialty ? 2 : 0) + p.modifier;
    const dice = [this.die()];
    if (p.advantage !== p.disadvantage) dice.push(this.die());
    const selected =
      p.advantage && !p.disadvantage
        ? Math.max(...dice)
        : p.disadvantage && !p.advantage
          ? Math.min(...dice)
          : dice[0];
    return { dice, selected, modifier, total: selected + modifier };
  }
  call(name: keyof typeof schemas, raw: unknown, runId: string): unknown {
    const started = Date.now();
    let result: unknown, error: string | undefined;
    try {
      result = this.executeCall(name, raw, runId);
      return result;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const run = this.store.run(runId);
      run.metrics.toolCalls++;
      this.store.saveRun(run);
      this.store.db.prepare('INSERT INTO metrics(run,data) VALUES(?,?)').run(
        runId,
        JSON.stringify({
          kind: 'tool',
          name,
          elapsedMs: Date.now() - started,
          inputBytes: Buffer.byteLength(JSON.stringify(raw) ?? ''),
          outputBytes: Buffer.byteLength(JSON.stringify(result) ?? ''),
          ...(error ? { error } : {}),
        }),
      );
    }
  }
  private executeCall(name: keyof typeof schemas, raw: unknown, runId: string): unknown {
    const args = schemas[name].parse(raw);
    safeKeys(args);
    const run = this.store.run(runId);
    if (name === 'context_get') {
      const a = schemas.context_get.parse(args);
      const result =
        a.ids || a.documents
          ? {
              records: (a.ids ?? []).map((id) => this.get(run.draft, id)),
              index: (a.ids ?? []).map((id) => this.store.recordInfo(run.roomId, id)),
              documents: (a.documents ?? []).map((id) => this.library.get(id)),
            }
          : context(this.store.room(run.roomId), run, this.store);
      return result;
    }
    if (name === 'context_search') {
      const a = schemas.context_search.parse(args),
        q = a.query.toLowerCase(),
        terms = q.split(/[\s,，、]+/u);
      const matches = (s: string) => terms.some((t) => s.toLowerCase().includes(t));
      const excerpt = (value: unknown) => {
        const text = JSON.stringify(value);
        const at = Math.max(
          0,
          terms
            .map((t) => text.toLowerCase().indexOf(t))
            .filter((n) => n >= 0)
            .sort((a, b) => a - b)[0] ?? 0,
        );
        return text.slice(Math.max(0, at - 80), at + 720);
      };
      const result = {
        records: ['all', 'records'].includes(a.scope)
          ? Object.values(run.draft.records)
              .filter((r) => matches(JSON.stringify(r)))
              .slice(0, a.limit)
              .map((r) => ({
                kind: r.kind,
                name: r.name,
                excerpt: excerpt(r),
                ...this.store.recordInfo(run.roomId, r.id),
              }))
          : [],
        documents: ['all', 'documents'].includes(a.scope)
          ? this.library.search(a.query, a.limit)
          : [],
        history: ['all', 'history'].includes(a.scope)
          ? this.store
              .room(run.roomId)
              .journal.filter((e) => matches(JSON.stringify(e)))
              .slice(-a.limit)
              .map((e) => ({ id: e.id, runId: e.runId, minute: e.minute, excerpt: excerpt(e) }))
          : [],
      };
      return result;
    }
    const a = args as { key: string };
    const result = this.store.once(
      'tool:' + runId + ':' + name,
      a.key,
      { name, args },
      () => this.mutate(name, args, runId),
      name !== 'checks_resolve',
    );
    this.changed(run.roomId);
    return result;
  }
  private mutate(name: keyof typeof schemas, raw: unknown, runId: string): unknown {
    const run = this.active(runId),
      room = this.store.room(run.roomId);
    if (room.worldVersion !== run.baseVersion)
      throw new Fault('世界版本发生变化，请恢复后重新查阅。', 409);
    if (name === 'checks_resolve') {
      if (run.kind !== 'round') throw new Fault('建角或场外讨论不需要检定。');
      const { checks } = schemas.checks_resolve.parse(raw);
      // Validate every participant before consuming any randomness.
      for (const c of checks) {
        if ((c.difficulty === undefined) === !c.opponent)
          throw new Fault('检定需提供 difficulty 或 opponent 其中之一。');
        this.accessAudience(run, c.audience);
        for (const p of [c, ...(c.opponent ? [c.opponent] : [])]) {
          const r = this.get(run.draft, p.actorId);
          if (
            !r.data.stats ||
            (p.specialty && !(r.data.specialties as string[]).includes(p.specialty))
          )
            throw new Fault('缺少属性或专长，先查阅档案。');
        }
      }
      return {
        checks: checks.map((c) =>
          this.store.recordRoll(run.id, c.id, c, () => {
            const result = this.roll(run.draft, c),
              other = c.opponent ? this.roll(run.draft, c.opponent) : undefined;
            return {
              id: c.id,
              runId: run.id,
              purpose: c.purpose,
              actorId: c.actorId,
              ...result,
              audience: c.audience,
              basis: c.basis,
              createdAt: new Date().toISOString(),
              ...(other && c.opponent
                ? {
                    opponent: { actorId: c.opponent.actorId, dice: other.dice, total: other.total },
                    outcome:
                      result.total === other.total
                        ? ('tie' as const)
                        : result.total > other.total
                          ? ('win' as const)
                          : ('loss' as const),
                  }
                : { difficulty: c.difficulty, success: result.total >= c.difficulty! }),
            };
          }),
        ),
      };
    }
    if (name === 'state_apply') {
      const a = schemas.state_apply.parse(raw),
        before = run.changes.length;
      this.apply(run, a.changes);
      this.store.saveRun(run);
      return { staged: run.changes.slice(before) };
    }
    if (name === 'time_advance') {
      if (run.kind !== 'round') throw new Fault('建角与场外讨论不推进时间。');
      const a = schemas.time_advance.parse(raw);
      run.draft.minute = Math.round((run.draft.minute + a.minutes) * 1000) / 1000;
      const expired: string[] = [];
      for (const r of Object.values(run.draft.records))
        if (Array.isArray(r.data.conditions)) {
          const removed = (r.data.conditions as Data[]).filter(
            (c) => typeof c.expiresAt === 'number' && c.expiresAt <= run.draft.minute,
          );
          r.data.conditions = (r.data.conditions as Data[]).filter((c) => !removed.includes(c));
          for (const c of removed) {
            expired.push(`${r.name}：${c.name}`);
            this.change(run, r, `状态到期：${c.name}`, a.reason);
          }
        }
      this.store.saveRun(run);
      return {
        minute: run.draft.minute,
        calendar: calendarLabel(run.draft.minute),
        expired,
        due: due(run.draft).map((r) => ({
          ...r,
          cycles:
            typeof r.data.every === 'number' && r.data.every > 0
              ? 1 + Math.floor((run.draft.minute - Number(r.data.due)) / r.data.every)
              : 1,
        })),
        instruction:
          '到期事项是需裁定的提醒。周期 costs × cycles 可批量记账；依据现场处理后 patch 时钟 due/status。',
      };
    }
    if (name === 'turn_ask') {
      const a = schemas.turn_ask.parse(raw);
      if (
        run.kind !== 'round' &&
        run.responseAudience &&
        !run.responseAudience.includes('table') &&
        a.characters.some((id) => !run.responseAudience!.includes(id))
      )
        throw new Fault('此私密讨论只能向原参与角色询问。');
      if (a.characters.some((id) => !this.ids(run).includes(id)))
        throw new Fault('询问对象不存在。');
      run.question = { prompt: a.prompt, characters: a.characters, answers: {} };
      run.status = 'waiting';
      this.store.saveRun(run);
      return { waiting: true, instruction: '已经向相关玩家提问。现在结束回复，等待玩家回答。' };
    }
    if (name === 'turn_commit') {
      const a = schemas.turn_commit.parse(raw);
      this.apply(run, a.changes);
      for (const p of a.passages) {
        this.accessAudience(run, p.audience);
        if (
          run.kind !== 'round' &&
          run.responseAudience &&
          !run.responseAudience.includes('table') &&
          p.audience.some((id) => !run.responseAudience!.includes(id))
        )
          throw new Fault('建角或私密讨论请沿用 responseAudience，不能向全桌发布。');
      }
      for (const d of a.decisions) {
        if (!run.actions.some((x) => x.id === d.actionId))
          throw new Fault('裁决引用了本轮不存在的行动。');
        run.decisions = run.decisions.filter((x) => x.actionId !== d.actionId);
        run.decisions.push(d);
      }
      if (a.finish && run.actions.some((x) => !run.decisions.some((d) => d.actionId === x.id)))
        throw new Fault(
          '还有行动没有裁决，请在 decisions 中标记 done/partial/deferred/interrupted/rejected，或 finish=false 继续。',
        );
      run.checkpoint++;
      const entry: Published = {
        id: uid('entry'),
        runId: run.id,
        minute: run.draft.minute,
        passages: a.passages,
        changes: run.changes,
        decisions: a.decisions,
        createdAt: new Date().toISOString(),
        checkIds: this.store
          .rolls(run.id)
          .filter(
            (roll) =>
              !room.journal.some(
                (e) =>
                  e.runId === run.id &&
                  (e.checkIds?.includes(roll.id) ?? roll.createdAt <= e.createdAt),
              ),
          )
          .map((r) => r.id),
      };
      const movements = Object.values(run.draft.records)
        .filter(
          (r) =>
            r.data.location &&
            room.world.records[r.id]?.data.location &&
            r.data.location !== room.world.records[r.id].data.location,
        )
        .map((r) => ({
          actorId: r.id,
          name: r.name,
          from: room.world.records[r.id].data.location,
          to: r.data.location,
          stageFromMinute: room.world.minute,
          stageToMinute: run.draft.minute,
        }));
      room.world = structuredClone(run.draft);
      room.revision++;
      room.worldVersion++;
      room.journal.push(entry);
      run.baseVersion = room.worldVersion;
      this.store.audit(run, { changes: run.changes, worldVersion: room.worldVersion, movements });
      run.changes = [];
      if (a.finish) {
        run.status = 'completed';
        for (const d of run.decisions.filter((d) => d.status === 'deferred')) {
          const source = run.actions.find((x) => x.id === d.actionId)!;
          room.board.push({ ...source, id: uid('action'), createdAt: new Date().toISOString() });
        }
      }
      this.store.saveRoom(room);
      this.store.saveRun(run);
      return {
        committed: true,
        checkpoint: run.checkpoint,
        finished: a.finish,
        changes: entry.changes.map((c) => ({ name: c.name, summary: c.summary })),
        instruction: a.finish
          ? '本轮已完成，请结束回复，无需重复叙述。'
          : '阶段成果已发布，继续处理未完成的行动。',
      };
    }
    throw new Fault('未知工具');
  }
}
