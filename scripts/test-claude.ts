import { ClaudeDirector } from '../server/claude-director.js';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import { loadLocalEnv } from '../server/config.js';
import type { Intent, Campaign } from '../shared/types.js';

loadLocalEnv();

async function testClaudeDirector() {
  console.log('🧪 测试 Claude Director...\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ 需要设置 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  // 使用内存数据库测试
  const store = new Store(':memory:');
  const library = new Library();
  const director = new ClaudeDirector(store, library, { apiKey }, () => {});

  console.log('✅ Director 初始化成功');
  console.log(`📋 模型: ${(director as any).model}`);
  console.log(`🔧 工具数量: ${Object.keys(await import('../server/tools.js')).length}\n`);

  // 创建团桌
  console.log('📝 创建测试团桌...');
  const room: Campaign = {
    format: 3,
    id: 'TEST01',
    title: '测试团桌',
    revision: 0,
    worldVersion: 0,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'test-session-001',
    sessionReady: false,
  };
  store.saveRoom(room);

  // 添加玩家
  const seatResult = store.addSeat('TEST01', '测试玩家', true);
  const seat = seatResult.seat;
  console.log(`✅ 创建团桌 ${room.id}，玩家令牌: ${seatResult.token.slice(0, 8)}...\n`);

  // 创建角色
  console.log('👤 创建测试角色...');
  const characterId = 'pc-test-001';
  room.world.records[characterId] = {
    id: characterId,
    kind: 'character',
    name: '测试侠',
    audience: [characterId],
    secret: '',
    data: {
      background: '一个用来测试的角色',
      stats: { body: 2, agility: 1, perception: 1, mind: 1 },
      specialties: ['潜行', '观察'],
      abilities: [],
      resources: { cash: 100 },
      conditions: [],
      location: 'fence',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };
  seat.characters.push(characterId);
  store.saveSeat(seat);
  room.worldVersion++;
  store.saveRoom(room);
  console.log(`✅ 角色 ${characterId} 创建完成\n`);

  // 创建测试行动
  console.log('🎬 创建测试行动...');
  const intent: Intent = {
    id: 'action-001',
    seatId: seat.id,
    characterId,
    text: '我想仔细观察周围的环境，看看有没有什么不对劲的地方。',
    audience: ['table'],
    createdAt: new Date().toISOString(),
  };
  room.board = [intent];
  room.revision++;
  store.saveRoom(room);
  console.log(`✅ 行动已添加: "${intent.text}"\n`);

  // 发起裁决
  console.log('⚡ 发起测试裁决...');
  const run = {
    id: 'run-test-001',
    roomId: room.id,
    kind: 'round' as const,
    status: 'running' as const,
    baseVersion: room.worldVersion,
    draft: structuredClone(room.world),
    actions: [intent],
    request: '按各玩家提交的意图主持这一批行动。',
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
  room.board = [];
  room.revision++;
  store.saveRoom(room);
  store.saveRun(run);
  console.log(`✅ Run ${run.id} 已创建\n`);

  console.log('🚀 启动主持进程...');
  const startTime = Date.now();

  try {
    await director.launch(run.id);
    const elapsed = Date.now() - startTime;
    const finalRun = store.run(run.id);

    console.log('\n✅ 裁决完成!\n');
    console.log('📊 性能指标:');
    console.log(`  总耗时: ${elapsed}ms`);
    console.log(`  工具调用: ${finalRun.metrics.toolCalls}`);
    console.log(`  模型调用: ${finalRun.metrics.modelCalls}`);
    console.log(`  输入 Token: ${finalRun.metrics.inputTokens}`);
    console.log(`  输出 Token: ${finalRun.metrics.outputTokens}`);
    if (finalRun.metrics.cacheReadTokens) {
      console.log(`  缓存命中: ${finalRun.metrics.cacheReadTokens} tokens`);
    }
    if (finalRun.metrics.cacheWriteTokens) {
      console.log(`  写入缓存: ${finalRun.metrics.cacheWriteTokens} tokens`);
    }
    console.log(`  最终状态: ${finalRun.status}\n`);

    // 显示结果
    const updatedRoom = store.room(room.id);
    if (updatedRoom.journal.length > 0) {
      const entry = updatedRoom.journal[updatedRoom.journal.length - 1];
      console.log('📜 主持人叙述:');
      entry.passages.forEach((p) => {
        console.log(`\n${p.text}\n`);
      });
    }

    if (finalRun.status === 'completed') {
      console.log('✅ 测试通过！Claude Director 工作正常。');
      process.exit(0);
    } else {
      console.log(`⚠️  裁决未完成，状态: ${finalRun.status}`);
      if (finalRun.error) console.log(`错误: ${finalRun.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ 测试失败:');
    console.error(error);
    process.exit(1);
  } finally {
    await director.close();
    store.close();
  }
}

testClaudeDirector().catch(console.error);
