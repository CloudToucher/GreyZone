import { ClaudeDirector } from '../server/claude-director.js';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import type { Campaign, Intent } from '../shared/types.js';

async function quickTest() {
  console.log('🧪 快速测试 - 单轮战斗\n');

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  console.log(`🔑 API Key: ${apiKey?.slice(0, 10)}...`);
  console.log(`🌐 Base URL: ${baseURL}\n`);

  const store = new Store(':memory:');
  const library = new Library();
  const director = new ClaudeDirector(store, library, { apiKey: apiKey!, baseURL }, () => {});

  console.log(`✅ 使用模型: ${(director as any).model}\n`);

  // 创建团桌
  const room: Campaign = {
    format: 3,
    id: 'QUICK',
    title: '快速测试',
    revision: 0,
    worldVersion: 0,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'quick-test',
    sessionReady: false,
  };
  store.saveRoom(room);

  const seat = store.addSeat('QUICK', '测试者', true);

  // 创建角色
  const charId = 'pc-test';
  room.world.records[charId] = {
    id: charId,
    kind: 'character',
    name: '李华',
    audience: [charId],
    secret: '',
    data: {
      background: '调查员',
      stats: { body: 2, agility: 2, perception: 1, mind: 1 },
      specialties: ['观察', '搏斗'],
      abilities: [],
      resources: { cash: 100 },
      conditions: [],
      location: 'fence',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };
  seat.seat.characters.push(charId);
  store.saveSeat(seat.seat);
  room.worldVersion++;
  store.saveRoom(room);

  console.log('👤 角色：李华（调查员）\n');

  // 单个行动
  const intent: Intent = {
    id: 'action-1',
    seatId: seat.seat.id,
    characterId: charId,
    text: '我在废弃仓库里搜索线索，仔细观察墙上的涂鸦和地上的脚印。',
    audience: ['table'],
    createdAt: new Date().toISOString(),
  };

  const freshRoom = store.room('QUICK');
  freshRoom.board = [intent];
  freshRoom.revision++;
  store.saveRoom(freshRoom);

  console.log('📝 行动：在废弃仓库搜索线索\n');
  console.log('⚡ 正在裁决...\n');

  const run = {
    id: 'run-quick',
    roomId: 'QUICK',
    kind: 'round' as const,
    status: 'running' as const,
    baseVersion: freshRoom.worldVersion,
    draft: structuredClone(freshRoom.world),
    actions: [intent],
    request: '按玩家提交的意图主持这一批行动。',
    responseAudience: ['table'],
    changes: [],
    decisions: [],
    checkpoint: 0,
    createdAt: new Date().toISOString(),
    metrics: {
      elapsedMs: 0,
      toolCalls: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      compactions: 0,
      resumptions: 0,
    },
  };
  store.saveRun(run);

  const start = Date.now();

  try {
    await director.launch(run.id);
    const elapsed = Date.now() - start;
    const finalRun = store.run(run.id);

    console.log('✅ 裁决完成！\n');
    console.log(`⏱️  耗时: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`🔧 工具调用: ${finalRun.metrics.toolCalls}`);
    console.log(`🤖 模型调用: ${finalRun.metrics.modelCalls}`);
    console.log(`💬 输入 Token: ${finalRun.metrics.inputTokens}`);
    console.log(`💬 输出 Token: ${finalRun.metrics.outputTokens}`);
    if (finalRun.metrics.cacheReadTokens) {
      console.log(`📦 缓存命中: ${finalRun.metrics.cacheReadTokens}`);
    }
    console.log(`📊 状态: ${finalRun.status}\n`);

    const updatedRoom = store.room('QUICK');
    if (updatedRoom.journal.length > 0) {
      const entry = updatedRoom.journal[0];
      console.log('📜 主持人叙述:');
      console.log('─────────────────────────────────────');
      entry.passages.forEach((p) => console.log(p.text));
      console.log('─────────────────────────────────────\n');

      if (entry.changes.length > 0) {
        console.log('📊 变更:');
        entry.changes.forEach((c) => console.log(`  - ${c.name}: ${c.summary}`));
      }
    }

    if (finalRun.status === 'completed') {
      console.log('\n✅ 测试成功！');
    } else {
      console.log(`\n⚠️  状态: ${finalRun.status}`);
      if (finalRun.error) console.log(`错误: ${finalRun.error}`);
    }
  } catch (error) {
    console.error('\n❌ 测试失败:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  } finally {
    await director.close();
    store.close();
  }
}

quickTest().catch(console.error);
