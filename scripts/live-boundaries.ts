import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadLocalEnv } from '../server/config.js';
import { uid } from '../server/store.js';
loadLocalEnv();
if (!process.env.LIVE_DIRECTORY)
  throw new Error('Set LIVE_DIRECTORY to the completed 20-round verification campaign.');
const directory = resolve(process.env.LIVE_DIRECTORY);
const saved = JSON.parse(readFileSync(resolve(directory, 'access.json'), 'utf8'));
const game = createApp({ directory, serveStatic: false });
game.setUrl(await game.app.listen({ host: '127.0.0.1', port: 0 }));
const before = game.store.room(saved.roomId),
  characterId = game.store.authenticate(saved.roomId, saved.token).characters[0];
const post = async (route: string, payload: Record<string, unknown>) => {
  const r = await game.app.inject({
    method: 'POST',
    url: `/api/rooms/${saved.roomId}/${route}`,
    headers: { authorization: 'Bearer ' + saved.token },
    payload: { requestId: uid(), ...payload },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
try {
  await post('board', {
    characterId,
    text: '本轮暂停在诊所，只核对既有事实：我没有同意新的雇佣、重绕或DC控制器工作，也没有授权现在出发。六点低潮是机会而不是强制行动。请把未接受提议与真正承诺分开保存，修正第19—20轮替我确定出发的措辞。不推进游戏内时间、不新增物资、不代写我的思想或新台词。以现场可见的状况和修改说明结束本批。',
  });
  const { runId } = await post('run', {}),
    started = Date.now();
  for (;;) {
    const r = game.store.run(runId);
    if (r.status !== 'running' && !game.director.stage(saved.roomId)) {
      assert.equal(r.status, 'completed', r.error);
      break;
    }
    if (Date.now() - started > 600000) throw new Error('Boundary test timed out');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const after = game.store.room(saved.roomId);
  assert.equal(after.world.minute, before.world.minute);
  assert.deepEqual(
    after.world.records[characterId].data.resources,
    before.world.records[characterId].data.resources,
  );
  assert.equal(
    after.world.records[characterId].data.location,
    before.world.records[characterId].data.location,
  );
  const passages = after.journal.filter((e) => e.runId === runId);
  writeFileSync(
    resolve(directory, 'boundary-review.json'),
    JSON.stringify(
      { runId, minuteUnchanged: true, resourcesUnchanged: true, locationUnchanged: true, passages },
      null,
      2,
    ),
  );
  console.log('BOUNDARIES PASSED', runId);
} finally {
  await game.app.close();
}
