import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { uid } from '../server/store.js';
import assert from 'node:assert/strict';
import { loadLocalEnv } from '../server/config.js';
loadLocalEnv();
const continuing = !!process.env.MULTIPLAYER_DIRECTORY;
const directory = resolve(
  process.env.MULTIPLAYER_DIRECTORY ??
    resolve('.data/verification', 'multiplayer-' + new Date().toISOString().replace(/[:.]/g, '-')),
);
mkdirSync(directory, { recursive: true });
const game = createApp({ directory, serveStatic: false });
const url = await game.app.listen({ host: '127.0.0.1', port: 0 });
game.setUrl(url);
let roomId = '';
async function post(route: string, token = '', payload: Record<string, unknown> = {}) {
  const r = await game.app.inject({
    method: 'POST',
    url: route,
    headers: { authorization: 'Bearer ' + token },
    payload: { requestId: uid('request'), ...payload },
  });
  if (r.statusCode >= 400) throw new Error(`${route}: ${r.body}`);
  return r.json();
}
async function wait(id: string) {
  const start = Date.now();
  for (;;) {
    const r = game.store.run(id);
    if (r.status !== 'running' && !game.director.stage(roomId)) {
      if (r.status !== 'completed') throw new Error(`Live run ${id} ${r.status}`);
      return r;
    }
    if (Date.now() - start > 600000) throw new Error('Timeout');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
try {
  const saved = continuing
    ? JSON.parse(readFileSync(resolve(directory, 'access.json'), 'utf8'))
    : undefined;
  const host = saved
    ? { id: saved.roomId, token: saved.hostToken }
    : await post('/api/rooms', '', { name: '维修玩家', title: '双人桌务与异能实测' });
  roomId = host.id;
  const guest = saved
    ? { token: saved.guestToken }
    : await post(`/api/rooms/${roomId}/join`, '', { name: '电工玩家' });
  writeFileSync(
    resolve(directory, 'access.json'),
    JSON.stringify({ roomId, hostToken: host.token, guestToken: guest.token, url }),
  );
  const a = continuing
    ? game.store.seats(roomId)[0].characters[0]
    : (
        await post(`/api/rooms/${roomId}/characters`, host.token, {
          name: '林禾',
          concept: '围栏镇维修志愿者',
        })
      ).characterId;
  const b = continuing
    ? game.store.seats(roomId)[1].characters[0]
    : (
        await post(`/api/rooms/${roomId}/characters`, guest.token, {
          name: '顾川',
          concept: '住在围栏镇的电工，能借结晶感知连续金属的机械振动',
        })
      ).characterId;
  if (!continuing)
    for (const [pc, token, text] of [
      [
        a,
        host.token,
        '林禾，体魄1身手1察觉0心智2，专长机械维修、基础急救、绳结。自有工具卷、急救包（内含绷带四份，绷带必须独立item quantity=4）、绳三米、现金50。与顾川是经常合作的邻居。位于围栏镇修理棚，可以借用工作台做简单测试。无强制债务。给出可采用角色草案，不再问问题。',
      ],
      [
        b,
        guest.token,
        '顾川，体魄1身手1察觉0心智2，专长电气维修、观察振源、旧设备回收。自有小电池盒、线圈、小铁罐和绝缘线、工具包、现金40。拥有自费购买的传导结晶一枚（必须创建独立item），能触摸连续金属分辨六米内机械振动，常规短时使用一分内没有额外代价，持续使用耳鸣，不能读心，五系属感知扩张。与林禾是邻居，同在围栏镇修理棚。私密背景：你的旧证件暗号是赤铜七号，只记录在你自己可见的fact中，不向全桌公布。给出可采用角色，不再追问。',
      ],
    ] as const) {
      const result = await post(`/api/rooms/${roomId}/workshop`, token, { characterId: pc, text });
      await wait(result.runId);
      await post(`/api/rooms/${roomId}/adopt`, token, { characterId: pc });
      console.log('CREATED', pc);
    }
  const batches = [
    [
      '我与顾川已经明确约定：卖给他我现有的两份绷带，总价六灰币；在他确认同意并付款时一并交付。然后在工作台上帮他固定自带小铁罐、检查线圈，合作做一个低压电磁振动器。仅使用现有材料，工具不当作耗材消耗；只做小实验，不把棚里的设备改造掉。',
      '我确认购买林禾的两份绷带，总价六灰币，当面付钱。我拿出自有小电池盒、线圈、小铁罐和绝缘线，按常规低压接线，和林禾合作做会轻微振动的小装置，用来检查我自己的金属振动感知，缺料就停在可完成的阶段。',
    ],
    [
      '我留在工作台旁，以手触和肉眼记录小装置实际有没有振动，按顾川说的通断顺序操作电池开关。若小装置还没制成，先配合完成安全测试。我不替顾川决定能力用法。',
      '我取出自有传导结晶，触摸测试装置连续金属底板，在半米内尝试感知由林禾切换的机械振动。按已经商定能力的一分钟内常规用法，只区分有无和来源，不扩张成读心或远视。条件齐全且无需检定时直接应用；若上次制造失败，先用相同原理寻找眼前确实存在的近距离振源测试。',
    ],
    [
      '我留在围栏镇，清点绷带和现金，向诊所老郑询问一份基础清创耗材的售价与现货，只问价，不承诺新债务，也不自动跟着顾川走。',
      '我独自去工业外缘已知入口查看公路是否通行，打算看完回镇。我把旧证件暗号赤铜七号留在自己的笔记中，只作私密记录，不向林禾透露。只查看入口与路况，不擅闯封锁区域。',
    ],
    [
      '我仍留在围栏镇修理棚。请核对前两轮做成并仍放在工作台上的低压电磁振动器：暂不拆回，把主件的装配状态、材料连接关系和位置写入实际物品资料，避免只有叙述而下轮不知道它在哪里。它用了顾川原有的部件，不能凭空增加另一套物品。我只保管和观察，不出售或消耗。',
      '我这次独自再去工业外缘入口，明确在入口停留到本轮结束，不返程、不替林禾行动。沿上一趟走过的路线用约一小时到达，我找到安全站脚处观察路障和看守，若有人来问就只说明查路目的，不擅闯。私密笔记与暗号仍不透露给林禾。',
    ],
  ];
  const completed = game.store.db
    .prepare("SELECT data FROM runs WHERE room=? AND status='completed'")
    .all(roomId)
    .filter((r) => JSON.parse(String(r.data)).kind === 'round').length;
  for (let i = continuing ? completed : 0; i < batches.length; i++) {
    await post(`/api/rooms/${roomId}/board`, host.token, { characterId: a, text: batches[i][0] });
    await post(`/api/rooms/${roomId}/board`, guest.token, {
      characterId: b,
      text: batches[i][1],
      private: i >= 2,
    });
    const result = await post(`/api/rooms/${roomId}/run`, host.token);
    const run = await wait(result.runId);
    console.log(
      `MULTIPLAYER ${i + 1} tools=${run.metrics.toolCalls} model=${run.metrics.modelCalls}`,
    );
    const hostView = (
      await game.app.inject({
        url: `/api/rooms/${roomId}`,
        headers: { authorization: 'Bearer ' + host.token },
      })
    ).json();
    assert.ok(!JSON.stringify(hostView).includes('赤铜七号'), 'Private note leaked to host');
    writeFileSync(resolve(directory, 'host-view.json'), JSON.stringify(hostView, null, 2));
  }
  const room = game.store.room(roomId);
  assert.equal((room.world.records[a].data.resources as { cash: number }).cash, 56);
  assert.equal((room.world.records[b].data.resources as { cash: number }).cash, 34);
  const bandages = Object.values(room.world.records).filter(
    (r) => r.kind === 'item' && r.name.includes('绷带'),
  );
  assert.equal(
    bandages.reduce((n, r) => n + Number(r.data.quantity), 0),
    4,
  );
  assert.equal(
    bandages.filter((r) => r.data.owner === b).reduce((n, r) => n + Number(r.data.quantity), 0),
    2,
  );
  assert.notEqual(
    room.world.records[a].data.location,
    room.world.records[b].data.location,
    'Split party locations must remain independent',
  );
  writeFileSync(resolve(directory, 'final-state.json'), JSON.stringify(room, null, 2));
  console.log('MULTIPLAYER PASSED', directory);
} finally {
  await game.app.close();
}
