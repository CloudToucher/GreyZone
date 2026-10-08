import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { uid } from '../server/store.js';
import { loadLocalEnv } from '../server/config.js';
loadLocalEnv();

const continuing = !!process.env.LIVE_DIRECTORY;
const directory = resolve(
  process.env.LIVE_DIRECTORY ??
    resolve('.data/verification', 'live-' + new Date().toISOString().replace(/[:.]/g, '-')),
);
mkdirSync(directory, { recursive: true });
const game = createApp({ directory, serveStatic: false });
const url = await game.app.listen({ host: '127.0.0.1', port: 0 });
game.setUrl(url);
const rounds = Number(process.env.LIVE_ROUNDS ?? 20);
const entries: unknown[] = continuing
  ? JSON.parse(readFileSync(resolve(directory, 'transcript.json'), 'utf8'))
  : [];
let roomId = '';
let token = '';
async function request(route: string, payload: Record<string, unknown> = {}, auth = token) {
  const response = await game.app.inject({
    method: 'POST',
    url: route,
    headers: { authorization: 'Bearer ' + auth },
    payload: { requestId: uid('request'), ...payload },
  });
  const data = response.json();
  if (response.statusCode >= 400) throw new Error(`${route}: ${JSON.stringify(data)}`);
  return data;
}
async function settled(runId: string) {
  const start = Date.now();
  for (;;) {
    const run = game.store.run(runId);
    if (run.status !== 'running' && !game.director.stage(roomId)) {
      entries.push({
        runId,
        kind: run.kind,
        status: run.status,
        metrics: run.metrics,
        checks: game.store.rolls(runId),
        passages: game.store.room(roomId).journal.filter((e) => e.runId === runId),
      });
      writeFileSync(resolve(directory, 'transcript.json'), JSON.stringify(entries, null, 2));
      if (run.status === 'failed')
        throw new Error(`Run failed ${runId}: ${run.error}. See ${directory}`);
      return run;
    }
    if (Date.now() - start > 600000) throw new Error('Campaign timeout');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
try {
  const room = continuing
    ? JSON.parse(readFileSync(resolve(directory, 'access.json'), 'utf8'))
    : await request('/api/rooms', { name: '验收玩家', title: '港口往返 · 真实主持验收' });
  roomId = room.id ?? room.roomId;
  token = room.token;
  writeFileSync(resolve(directory, 'access.json'), JSON.stringify({ roomId, token, url }));
  const created = continuing
    ? { characterId: game.store.seats(roomId)[0].characters[0] }
    : await request(`/api/rooms/${roomId}/characters`, {
        name: '沈禾',
        concept:
          '港口潜水维修工，回灰区寻找失踪搭档，不带枪、不欠债。通过接触连续金属感知附近机械振动。',
      });
  const pc = created.characterId;
  if (!continuing) {
    const workshop = await request(`/api/rooms/${roomId}/workshop`, {
      characterId: pc,
      text: '请完成可采用档案。沈禾，女，32岁，港口潜水维修工；身手2、体魄1、察觉1、心智0；潜水作业、机械维修、水下寻路三个专长。带有来历的工具、钢丝、绝缘胶带、探灯、绳和饮水，现金100灰币，无枪无债。异能为接触连续金属分辨六米内机械振动，需要结晶，不能读心，长用会耳鸣。开场在围栏镇找机械师锯子（NPC saw），寻找失踪搭档赵平。按这些确定内容写实际角色与物品记录，这次不再追问，供我采用。',
    });
    await settled(workshop.runId);
    await request(`/api/rooms/${roomId}/adopt`, { characterId: pc });
  }
  console.log(`LIVE room=${roomId} character=${pc} directory=${directory}`);
  const actions = [
    '我找到锯子，报出旧工作关系，询问赵平最后一次出现在哪里，观察修理棚的现场。不接受尚未谈好的债务或合同。',
    '我问清楚消息的来源和可信程度，请锯子指出可以核实的痕迹。我想以帮他排查一台机器换这条消息；先商量条件。',
    '按已经谈妥的条件，使用自己的工具检查并修理那台机器；如果条件尚未谈妥就先谈清。遇到需要额外付款或损坏设备的选择先停下。',
    '我查看手边材料，尝试用钢丝和罐片制作一个简单的拉线报警器，用来提醒后方有人接近；现有材料不足时先找替代物，不能凭空增加。',
    '我整理刚得到的消息与赵平留下的线索，请在角色笔记中记下出处、下一步可查对象和哪些事情仍只是猜测。然后补足出行要用的饮水，交易谈妥才付钱。',
    '我沿已知路线去线索指向的码头区域，带走现有装备。保持谨慎，不擅闯明显封锁区域。路程中留意实际交通和水位。',
    '到达后先确认出入口、潮水高度、可用的金属结构与是否有人活动，寻找赵平留下的具体痕迹。',
    '我触摸一段连续金属栏杆，使用约定的振动感知，缩小到近处以区分机械和脚步；如果金属断开就换到有连续连接的位置。只做档案范围内的用途。',
    '我结合刚才获得的信息询问附近能找到的人，讲清寻找搭档的目的；不假装知道尚未查明的秘密。',
    '我尝试把已有拉线报警器设在身后的合适通道，检查固定位置和声音传播。没有报警器则用现有绳和可找到的金属片尝试简化版本。',
    '我核对现有物资和身上的状态，处理需要立即照料的轻伤或疲劳。在安全且不会误过已经知道的期限时短休十分钟，否则先处理期限。',
    '我沿当前最明确的赵平线索调查；先观察可疑装置、门锁和水路，结合工具寻找能够实际通过的办法。重大新选择停下来问我。',
    '我尝试用机械维修技能和现有工具解决当前障碍；需要材料就先说明并寻找，明显需要多人承担的重量不硬拉。',
    '我向愿意合作的人提出互相照应的安排，讲明救人目标、资源限制和撤退条件，听取对方真正的要求。',
    '我回顾与锯子达成的约定，核对是否还欠工作或物资。只把已答应的算作承诺，对方单方面提出的不算。继续调查尚未解决的线索。',
    '我观察当前威胁和退路。遇到敌意时优先用掩体、交流和撤退保住人，不主动开战；局面允许就继续完成既定调查。',
    '我清点这一路找到的物品，区分自己的装备、借来的物资和他人财物；归还已经不需要且能找到所有者的借物，别重复记账。',
    '若当前救援有安全可行的步骤，我按已经确认的条件尝试；若无法靠现有资源做到，带回具体缺口和线索，寻找帮助。',
    '我沿已经查明的退路返回可落脚的地点，带走能合理携带的人和东西，保持对潮水与其他已知期限的注意。',
    '我向能联系到的伙伴复述本次亲眼确认的事实，回报锯子的约定进度，安排必要的治疗和补给。把未解决事项、位置、装备、人物关系和下一步线索保存，结束本次冒险片段。',
  ];
  const completedRounds = game.store.db
    .prepare("SELECT data FROM runs WHERE room=? AND status='completed'")
    .all(roomId)
    .filter((row) => JSON.parse(String(row.data)).kind === 'round').length;
  let firstRound = Number(process.env.LIVE_START ?? (continuing ? completedRounds : 0));
  async function finishQuestions(runId: string) {
    let run = await settled(runId),
      questions = 0;
    while (run.status === 'waiting' && questions++ < 3) {
      for (const characterId of run.question!.characters.filter((c) => !run.question!.answers[c]))
        await request(`/api/rooms/${roomId}/answer`, {
          runId: run.id,
          characterId,
          text: '本次明确选择：完成眼前可安全完成的观察、稳定伤者与求助，不主动进入没顶水域或接受新债务。已知范围内可执行，不需要再确认；如果不能继续就停止该动作并标记 interrupted，结束这一批，新的选择留给我下一次提交。',
        });
      run = await settled(run.id);
    }
    if (run.status !== 'completed') throw new Error('Repeated questions prevented completion');
    return run;
  }
  if (continuing && game.store.active(roomId)) {
    const active = game.store.active(roomId)!;
    if (active.status === 'failed')
      await request(`/api/rooms/${roomId}/resume`, { runId: active.id });
    await finishQuestions(active.id);
    console.log('RECOVERED interrupted round with original dice.');
    if (active.kind === 'round') firstRound++;
  }
  for (let i = firstRound; i < rounds; i++) {
    await request(`/api/rooms/${roomId}/board`, {
      characterId: pc,
      text: actions[i % actions.length],
    });
    const result = await request(`/api/rooms/${roomId}/run`);
    const run = await finishQuestions(result.runId);
    console.log(
      `ROUND ${i + 1}/${rounds} tools=${run.metrics.toolCalls} model=${run.metrics.modelCalls} input=${run.metrics.inputTokens} output=${run.metrics.outputTokens} ms=${run.metrics.elapsedMs}`,
    );
    if (i === 7) {
      game.director.stop(roomId);
      console.log('Stopped idle dsh process; next round must resume persisted session.');
    }
    if (i === 11) {
      console.log('COMPACT', await game.director.compact(roomId));
    }
  }
  const roomState = game.store.room(roomId);
  writeFileSync(resolve(directory, 'final-state.json'), JSON.stringify(roomState, null, 2));
  console.log(
    `COMPLETED ${rounds} rounds; ${roomState.journal.length} published checkpoints. ${directory}`,
  );
} finally {
  await game.app.close();
}
