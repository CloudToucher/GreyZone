import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  fogBoundary,
  worldMutationSchema,
  type SessionState,
  type WorldMutation,
  type WorldClock,
} from '../shared/types.js';
import { canon, goods, powers } from './content.js';
// The world editor has no capability to write player sheets, dice, receipts or authentication data.
export function editWorld(
  s: SessionState,
  input: WorldMutation[],
  source: 'model' | 'clock',
  facts: string[],
) {
  const edits = z.array(worldMutationSchema).max(12).parse(input);
  const site = (id: string) => {
    const l = s.locations.find((l) => l.id === id);
    if (!l) throw new Error('世界编辑引用了不存在的地点。');
    return l;
  };
  for (const edit of edits) {
    switch (edit.op) {
      case 'environment.patch':
        s.environment = {
          tide: edit.tide,
          heldZone: Math.min(5, fogBoundary(s.minute, s.environment)),
          reason: edit.reason,
        };
        facts.push(
          `区域状态改变：${edit.tide === 'closed' ? '裂隙关闭，异能失效，黑潮停止覆盖' : edit.tide === 'contained' ? '黑潮扩张被遏制' : '黑潮重新扩张'}。${edit.reason}`,
        );
        s.facts.push(facts.at(-1)!);
        break;
      case 'entity.create': {
        const e = edit.entity;
        site(e.location);
        if (s.entities.some((x) => x.id === e.id) || s.characters.some((c) => c.id === e.id))
          throw new Error('新对象编号重复。');
        if (s.entities.length >= 250) throw new Error('世界对象数量达到当前存档上限。');
        if (new Set(e.inventory.map((i) => i.id)).size !== e.inventory.length)
          throw new Error('新对象库存含有重复物品编号。');
        for (const item of e.inventory)
          if (item.weapon && item.weapon.loaded > item.weapon.capacity)
            throw new Error('新对象弹仓不合法。');
        s.entities.push({ ...e, state: '刚进入记录', attitude: 0, nextMove: s.minute + 360 });
        if (e.visible && s.characters.some((c) => c.location === e.location))
          facts.push(`现场出现：${e.name}。`);
        break;
      }
      case 'entity.patch': {
        const e = s.entities.find((e) => e.id === edit.entityId);
        if (!e) throw new Error('世界编辑只能修改NPC或场景对象。');
        if (edit.changes.location) site(edit.changes.location);
        Object.assign(e, edit.changes);
        break;
      }
      case 'site.create':
        if (s.locations.some((l) => l.id === edit.site.id) || s.locations.length >= 100)
          throw new Error('地点编号重复或数量过多。');
        s.locations.push(edit.site);
        break;
      case 'site.patch':
        Object.assign(site(edit.siteId), edit.changes);
        break;
      case 'ruling.record':
        s.rulings.push({
          id: randomUUID(),
          scope: edit.scope,
          trigger: edit.trigger,
          ruling: edit.ruling,
          minute: s.minute,
        });
        s.rulings = s.rulings.slice(-150);
        facts.push(`裁定先例：${edit.scope} — ${edit.ruling}`);
        break;
      case 'event.schedule': {
        if (edit.event.due <= s.minute || edit.event.due > s.minute + 90 * 1440)
          throw new Error('新事件须在未来90天以内。');
        if (
          s.clocks.some((e) => e.id === edit.event.id) ||
          s.clocks.filter((e) => e.status === 'pending').length >= 80
        )
          throw new Error('事件编号重复或待执行事件过多。');
        if (!s.entities.some((e) => e.id === edit.event.owner))
          throw new Error('事件缺少有效的NPC责任主体。');
        for (const g of edit.event.guards)
          if (!s.entities.some((e) => e.id === g.entityId))
            throw new Error('事件条件引用未知对象。');
        for (const patch of edit.event.edits) {
          if (patch.op === 'entity.patch' && !s.entities.some((e) => e.id === patch.entityId))
            throw new Error('事件引用未知对象。');
          if (patch.op === 'entity.patch' && patch.changes.location) site(patch.changes.location);
        }
        s.clocks.push({ ...edit.event, status: 'pending' });
        break;
      }
      case 'event.cancel': {
        const clock = s.clocks.find((e) => e.id === edit.eventId);
        if (!clock) throw new Error('要取消的事件不存在。');
        if (clock.status === 'pending') clock.status = 'cancelled';
        break;
      }
    }
  }
  if (edits.length) {
    s.audit.push({
      id: randomUUID(),
      minute: s.minute,
      source,
      reason: edits.map((e) => e.reason).join('；'),
      edits,
    });
    s.audit = s.audit.slice(-300);
  }
}
export function runClocks(s: SessionState, facts: string[]) {
  for (const ref of [...s.clocks].sort((a, b) => a.due - b.due)) {
    const clock = s.clocks.find((e) => e.id === ref.id)!;
    if (clock.status !== 'pending' || clock.due > s.minute) continue;
    if (clock.requiresTide && clock.requiresTide !== s.environment.tide) {
      clock.status = 'cancelled';
      continue;
    }
    const allowed = clock.guards.every((g) => {
      const e = s.entities.find((e) => e.id === g.entityId);
      return (
        !!e &&
        (g.alive === undefined || g.alive === e.health > 0) &&
        (!g.at || e.location === g.at) &&
        (!g.withoutItem || !e.inventory.some((i) => i.id === g.withoutItem && i.quantity > 0)) &&
        (!g.property || e.properties?.[g.property.key] === g.property.value)
      );
    });
    if (!allowed) {
      clock.status = 'cancelled';
      continue;
    }
    // Apply each due event atomically too: invalid generated future edits cannot brick a room.
    const draft = structuredClone(s),
      notes: string[] = [];
    try {
      editWorld(draft, clock.edits, 'clock', notes);
      draft.clocks.find((e) => e.id === clock.id)!.status = 'fired';
      Object.assign(s, draft);
      if (clock.public) {
        s.facts.push(clock.summary);
        facts.push(clock.summary);
      }
      facts.push(...notes);
    } catch {
      const actual = s.clocks.find((e) => e.id === clock.id)!;
      actual.status = 'cancelled';
      s.secrets.push(`事件 ${clock.id} 因引用失效未执行，需要主持人重新评估。`);
    }
  }
}
const patch = (
  entityId: string,
  changes: Extract<WorldMutation, { op: 'entity.patch' }>['changes'],
  reason: string,
): WorldMutation & { op: 'entity.patch' } => ({ op: 'entity.patch', entityId, changes, reason });
export function initialClocks(): WorldClock[] {
  const clocks: WorldClock[] = [
    {
      id: 'scav-move',
      owner: 'scavs',
      due: 720,
      summary: '码头拾荒队因缺水转往中央商业街。',
      public: true,
      guards: [{ entityId: 'scavs', alive: true, at: 'dock', withoutItem: 'water' }],
      edits: [
        patch('scavs', { location: 'market', state: '寻找饮水与新的交易对象' }, '缺水驱动迁移'),
      ],
      status: 'pending',
    },
    {
      id: 'ueg-drops',
      owner: 'security',
      due: 7 * 1440,
      summary: '高地上空的UEG补给无人机变得频繁。',
      public: true,
      guards: [{ entityId: 'security', alive: true }],
      edits: [
        patch('security', { state: 'UEG开始加速运送补给，安保机保护精炼设施' }, 'UEG抢收资源'),
      ],
      status: 'pending',
    },
    {
      id: 'major-strain',
      owner: 'major',
      due: 14 * 1440,
      summary: '守望者传来一次共鸣失控事件，社区限制武装人员进入。',
      public: true,
      guards: [{ entityId: 'major', alive: true }],
      edits: [patch('major', { state: '共鸣失控后，正在寻找可靠的接班人' }, '原设定的共鸣压力')],
      status: 'pending',
    },
    {
      id: 'jin-leaves',
      owner: 'jin',
      due: 14 * 1440,
      summary: '烬离开前哨，前往旧采石场。',
      public: true,
      guards: [{ entityId: 'jin', alive: true, at: 'watch' }],
      edits: [
        patch('jin', { location: 'quarry', state: '在采石场扎营研究黑潮信号' }, '主动接近镜界'),
      ],
      status: 'pending',
    },
    {
      id: 'lu-depart',
      owner: 'lu',
      due: 21 * 1440,
      summary: '老吕等不到关门数据，自行前往地下实验室。',
      public: true,
      guards: [{ entityId: 'lu', alive: true, at: 'watch', withoutItem: 'data' }],
      edits: [
        patch(
          'lu',
          { location: 'lab-a', state: '独自寻找关门数据，缺少战斗支援' },
          '人物目标驱动行动',
        ),
      ],
      status: 'pending',
    },
    {
      id: 'ueg-patrol',
      owner: 'drone',
      due: 21 * 1440,
      summary: 'UEG巡逻范围扩展到了异常荒野。',
      public: true,
      guards: [{ entityId: 'drone', alive: true }],
      edits: [patch('drone', { location: 'wild' }, 'UEG猎手部署')],
      status: 'pending',
    },
    {
      id: 'supply-cut',
      owner: 'supply',
      due: 28 * 1440,
      summary: '铁壁减少运输，补给仓库报告下一批补货延期。',
      public: true,
      guards: [{ entityId: 'supply', alive: true }],
      edits: [patch('supply', { state: '供应线收缩，无常规补货' }, '黑潮逼近供应线路')],
      status: 'pending',
    },
    {
      id: 'refinery',
      owner: 'security',
      due: 35 * 1440,
      summary: 'UEG精炼厂满负荷运转，能源信号在地下增强。',
      public: true,
      guards: [{ entityId: 'security', alive: true }],
      edits: [patch('security', { state: '精炼厂封锁加强' }, '抢收结晶')],
      status: 'pending',
    },
    {
      id: 'withdraw',
      owner: 'fang',
      due: 42 * 1440,
      summary: '铁壁开始撤出非核心人员，方远准备清算合同。',
      public: true,
      guards: [{ entityId: 'fang', alive: true }],
      edits: [patch('fang', { state: '准备撤离，与在册回收者逐一清算' }, '公司优先保全资产')],
      status: 'pending',
    },
    {
      id: 'town-fog',
      owner: 'fang',
      due: 49 * 1440,
      summary: '黑雾抵达镇外。方远离开合同中心，前往封锁线。',
      public: true,
      guards: [{ entityId: 'fang', alive: true, at: 'town' }],
      edits: [patch('fang', { location: 'outside', state: '等待军方放行' }, '撤出围栏镇')],
      status: 'pending',
    },
  ];
  for (const clock of clocks) if (clock.id !== 'scav-move') clock.requiresTide = 'advancing';
  return clocks;
}
export const querySchema = z
  .object({
    scope: z.enum(['entity', 'map', 'journal', 'clocks', 'rules', 'catalog', 'facts']),
    query: z.string().max(200),
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict();
export function queryWorld(s: SessionState, args: z.infer<typeof querySchema>) {
  const q = args.query.toLowerCase(),
    matches = (v: unknown) => !q || JSON.stringify(v).toLowerCase().includes(q);
  const sets: Record<string, unknown[]> = {
    entity: [...s.entities, ...s.characters.filter((c) => c.ready)],
    map: [...s.locations, ...s.routes],
    journal: s.journal,
    clocks: s.clocks,
    rules: [
      {
        canon,
        legacyExamples: powers,
        note: '这些是旧角色的示例能力，新角色以已确认 abilities 为准。',
      },
      ...s.rulings,
      ...s.precedents,
    ],
    catalog: Object.values(goods),
    facts: [...s.facts, ...s.secrets],
  };
  const all = sets[args.scope].filter(matches);
  return { scope: args.scope, total: all.length, records: all.slice(-args.limit) };
}
