import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { DshDirector, loadEnv } from '../server/ai/dsh.js';
import {
  advanceTime,
  character,
  commit,
  nativePlan,
  newSession,
  propose,
} from '../server/engine.js';
await loadEnv();
class TracingDirector extends DshDirector {
  calls: string[] = [];
  override async request<T>(
    task: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    const reply = await super.request(task, schema, signal);
    const tool =
      reply && typeof reply === 'object' && 'tool' in reply ? String(reply.tool) : 'reply';
    this.calls.push(tool);
    console.log('Game tool:', tool);
    return reply;
  }
}
const director = new TracingDirector();
let state = newSession(
  'GMSMOK',
  'dsh',
  character({
    name: '吴铮',
    profile: 'medic',
    school: 'none',
    background: '想联系镇外的药品商人。',
  }),
);
const c = state.characters[0];
const move = { kind: 'travel' as const, target: 'dock' };
state.proposal = propose(state, c.id, '前往码头', nativePlan(state, c, move), move);
state = commit(state, c.id, state.proposal.id, () => 1);
const intent =
  '我把两份饮用水作为报酬交给码头拾荒队，商量让他们两小时后去中央商业街，替我查看有没有能换药的商人；只约定到时出发，不让他们现在离开，也不跟我同行。';
const plan = await director.plan(state, c.id, intent, new AbortController().signal);
console.log(
  'World edits:',
  plan.success.world?.map((e) => e.op),
);
state.proposal = propose(state, c.id, intent, plan);
state = commit(state, c.id, state.proposal.id, () => 1);
const scheduled = state.clocks.filter(
  (e) =>
    ![
      'scav-move',
      'ueg-drops',
      'major-strain',
      'jin-leaves',
      'lu-depart',
      'ueg-patrol',
      'supply-cut',
      'refinery',
      'withdraw',
      'town-fog',
    ].includes(e.id),
);
if (!scheduled.length)
  throw new Error('The accepted agreement did not create a future world event');
const before = structuredClone(state);
advanceTime(state, Math.max(...scheduled.map((e) => e.due)) - state.minute + 1, []);
if (state.entities.find((e) => e.id === 'scavs')!.location !== 'market')
  throw new Error('NPC did not follow the authored future movement');
await mkdir('.data/verification', { recursive: true });
await writeFile(
  '.data/verification/dsh-gm-tools.json',
  JSON.stringify(
    { at: new Date().toISOString(), calls: director.calls, intent, plan, before, after: state },
    null,
    2,
  ),
);
console.log('Verified: agreement persisted, future movement executed; calls:', director.calls);
