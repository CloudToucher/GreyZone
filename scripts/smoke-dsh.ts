import { mkdir, writeFile } from 'node:fs/promises';
import { DshDirector, loadEnv } from '../server/ai/dsh.js';
import { character, commit, newSession, propose } from '../server/engine.js';
await loadEnv();
let state = newSession(
  'SMOKE2',
  'dsh',
  character({
    name: '陈骁',
    profile: 'mechanic',
    school: 'sense',
    background: '修过港口机电设备，欠债留在灰区。',
  }),
);
const director = new DshDirector();
const intents = [
  '用随身细钢丝和一份金属零件做一个拉动就会碰响罐片的简易警报。我用多功能工具加工，先做成可携带的装置，不现在安装。',
  '我去找老高，说我会修机械、电路，想用一次维修服务换他告诉我石化工厂门口现在谁收通行费。不付款，不开枪，先听他是否愿意谈。',
];
const records = [];
for (const intent of intents) {
  console.log('Assessing:', intent);
  const plan = await director.plan(
    state,
    state.characters[0].id,
    intent,
    new AbortController().signal,
  );
  console.log(
    'Plan:',
    plan.summary,
    plan.skill,
    plan.minutes,
    plan.success.effects.map((e) => e.type),
  );
  const proposal = propose(state, state.characters[0].id, intent, plan);
  state.proposal = proposal;
  state = commit(state, state.characters[0].id, proposal.id, () => 1);
  records.push({ intent, plan, entry: state.journal.at(-1) });
  console.log('Committed:', state.minute, state.journal.at(-1)?.facts);
}
if (
  !state.characters[0].inventory.some(
    (i) =>
      ![
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
        'crystal_c',
      ].includes(i.id),
  )
)
  throw new Error('Free crafting did not create a new inventory item');
await mkdir('.data/verification', { recursive: true });
await writeFile(
  '.data/verification/dsh-sandbox-smoke.json',
  JSON.stringify({ at: new Date().toISOString(), records, state }, null, 2),
);
