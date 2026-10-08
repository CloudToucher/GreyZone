// Browser fixture only. Production never imports this scripted director.
import { createApp } from '../../server/app.js';
import { Store } from '../../server/store.js';
import { GameTools } from '../../server/tools.js';
import { ManualDirector } from '../fixtures.js';
const game = createApp({
  store: new Store(':memory:'),
  director: (store, library, notify) => {
    const tools = new GameTools(store, library, notify, () => 13);
    return new (class extends ManualDirector {
      async launch(id: string) {
        const r = store.run(id);
        if (r.status !== 'running') return;
        if (r.kind === 'workshop') {
          tools.call(
            'turn_commit',
            {
              key: 'create',
              changes: [
                {
                  op: 'patch',
                  id: r.ownerCharacter,
                  changes: {
                    data: {
                      specialties: ['潜水作业', '机械维修', '观察'],
                      background: r.request,
                      resources: { cash: 100 },
                    },
                  },
                  reason: '玩家明确的建角设想',
                },
                {
                  op: 'create',
                  record: {
                    id: 'kit-' + r.ownerCharacter,
                    kind: 'item',
                    name: '维修工具卷',
                    audience: [r.ownerCharacter],
                    data: {
                      owner: r.ownerCharacter,
                      quantity: 1,
                      description: '扳手、螺丝刀和绝缘胶带',
                    },
                    secret: '',
                  },
                  reason: '职业自有工具',
                },
              ],
              passages: [
                {
                  text: '修理棚门口留着两行湿脚印。你的档案已经整理好，装备和现金都已记入角色表。采用档案后，你可以决定从哪里开始。',
                  audience: [r.ownerCharacter],
                },
              ],
            },
            r.id,
          );
        } else if (r.kind === 'round') {
          if (r.actions.some((a) => a.text.includes('分别决定'))) {
            if (!r.question) {
              tools.call(
                'turn_ask',
                {
                  key: 'ask',
                  prompt: '门后有新的危险，请各角色分别决定是否进入。',
                  characters: [...new Set(r.actions.map((a) => a.characterId))],
                },
                r.id,
              );
              return;
            }
            tools.call(
              'turn_commit',
              {
                key: 'answers',
                passages: [
                  {
                    text: Object.entries(r.question.answers)
                      .map(([pc, text]) => `${r.draft.records[pc].name}：${text}`)
                      .join('\n'),
                    audience: ['table'],
                  },
                ],
                decisions: r.actions.map((a) => ({
                  actionId: a.id,
                  status: 'done',
                  reason: '按各自回答执行',
                })),
              },
              r.id,
            );
            return;
          }
          tools.call(
            'checks_resolve',
            {
              key: 'roll',
              checks: r.actions.map((a) => ({
                id: 'check-' + a.id,
                actorId: a.characterId,
                attribute: 'perception',
                difficulty: 12,
                purpose: '寻找脚印通向哪里',
                basis: '现场痕迹清楚',
                audience: a.audience,
              })),
            },
            r.id,
          );
          tools.call('time_advance', { key: 'time', minutes: 5, reason: '观察现场' }, r.id);
          tools.call(
            'turn_commit',
            {
              key: 'end',
              passages: r.actions.map((a) => ({
                text: '你沿着潮湿的脚印走到码头入口。铁门没有上锁，栏杆下有新刮开的漆。棚里的机械师停下手里的活，说：「刚才有人借走了一卷绳，往南边去了。」',
                audience: a.audience,
              })),
              decisions: r.actions.map((a) => ({
                actionId: a.id,
                status: 'done',
                reason: '观察完毕',
              })),
            },
            r.id,
          );
        } else
          tools.call(
            'turn_commit',
            {
              key: 'discuss',
              passages: [
                {
                  text: '这是场外讨论，世界时间保持不变。',
                  audience: r.responseAudience ?? ['table'],
                },
              ],
            },
            r.id,
          );
      }
    })(store);
  },
});
await game.app.listen({ host: '127.0.0.1', port: 4329 });
