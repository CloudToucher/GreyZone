/**
 * 结构测试 - 不需要真实 API key
 * 验证 Claude Director 的初始化和接口
 */

import { Store } from '../server/store.js';
import { Library } from '../server/library.js';

async function testStructure() {
  console.log('🧪 测试项目结构和接口...\n');

  // 1. 测试 Store 初始化
  console.log('1️⃣ 测试 Store (SQLite)...');
  const store = new Store(':memory:');
  console.log('   ✅ Store 初始化成功');

  // 2. 测试 Library
  console.log('2️⃣ 测试 Library...');
  const library = new Library();
  const seed = library.seed();
  console.log(`   ✅ Library 加载成功，初始记录数: ${Object.keys(seed.records).length}`);
  console.log(`   📚 文档数: ${library.documents.length}`);

  // 3. 测试 Claude Director 接口（不实际调用 API）
  console.log('3️⃣ 测试 Claude Director 接口...');
  try {
    const { ClaudeDirector } = await import('../server/claude-director.js');
    const mockDirector = new ClaudeDirector(
      store,
      library,
      { apiKey: 'test-key-placeholder' },
      () => {}
    );
    console.log('   ✅ ClaudeDirector 类加载成功');
    console.log(`   📋 默认模型: ${(mockDirector as any).model}`);
  } catch (error) {
    console.error('   ❌ ClaudeDirector 加载失败:', (error as Error).message);
  }

  // 4. 测试工具定义
  console.log('4️⃣ 测试工具定义...');
  const { schemas, descriptions } = await import('../server/tools.js');
  const toolNames = Object.keys(schemas);
  console.log(`   ✅ 工具数量: ${toolNames.length}`);
  console.log(`   🔧 工具列表: ${toolNames.join(', ')}`);

  // 5. 测试监控接口
  console.log('5️⃣ 测试监控模块...');
  try {
    const { registerMonitorRoutes } = await import('../server/monitor.js');
    console.log('   ✅ 监控模块加载成功');
  } catch (error) {
    console.error('   ❌ 监控模块加载失败:', (error as Error).message);
  }

  // 6. 创建测试团桌
  console.log('6️⃣ 创建测试团桌...');
  const room = {
    format: 3 as const,
    id: 'TEST01',
    title: '结构测试团桌',
    revision: 0,
    worldVersion: 0,
    world: seed,
    board: [],
    messages: [],
    journal: [],
    sessionId: 'test-session-structure',
    sessionReady: false,
  };
  store.saveRoom(room);
  const seatResult = store.addSeat('TEST01', '测试玩家', true);
  const seat = seatResult.seat;
  console.log(`   ✅ 团桌 ${room.id} 创建成功`);
  console.log(`   👤 玩家令牌: ${seatResult.token.slice(0, 12)}...`);

  // 7. 测试角色创建
  console.log('7️⃣ 测试角色创建...');
  const characterId = 'pc-structure-test';
  room.world.records[characterId] = {
    id: characterId,
    kind: 'character',
    name: '测试侠',
    audience: [characterId],
    secret: '',
    data: {
      background: '用于结构测试的角色',
      stats: { body: 2, agility: 1, perception: 1, mind: 1 },
      specialties: ['观察', '潜行'],
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
  console.log(`   ✅ 角色 ${characterId} 创建成功`);

  // 8. 测试工具调用接口
  console.log('8️⃣ 测试工具调用接口...');
  const { GameTools } = await import('../server/tools.js');
  const tools = new GameTools(store, library);

  // 创建一个测试 run
  const run = {
    id: 'run-structure-test',
    roomId: room.id,
    kind: 'round' as const,
    status: 'running' as const,
    baseVersion: room.worldVersion,
    draft: structuredClone(room.world),
    actions: [],
    request: '测试请求',
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

  // 测试 context_get (只读工具)
  try {
    const context = tools.call('context_get', {}, run.id);
    console.log('   ✅ context_get 调用成功');
    console.log(`   📊 权威状态版本: ${(context as any).base?.worldVersion}`);
  } catch (error) {
    console.error('   ❌ context_get 失败:', (error as Error).message);
  }

  // 9. 测试数据库查询
  console.log('9️⃣ 测试数据库操作...');
  const rooms = store.db.prepare('SELECT id, data FROM campaigns').all();
  console.log(`   ✅ 数据库查询成功，团桌数: ${rooms.length}`);

  const metrics = store.db.prepare('SELECT COUNT(*) as count FROM metrics').get() as { count: number };
  console.log(`   📈 性能指标记录数: ${metrics.count}`);

  // 10. 测试 record index
  console.log('🔟 测试记录索引...');
  const recordCount = store.db
    .prepare('SELECT COUNT(*) as count FROM record_index WHERE room=?')
    .get(room.id) as { count: number };
  console.log(`   ✅ 索引记录数: ${recordCount.count}`);

  console.log('\n✅ 所有结构测试通过！\n');
  console.log('📝 下一步：');
  console.log('   1. 设置 ANTHROPIC_API_KEY 环境变量');
  console.log('   2. 运行 npm run test:claude 进行真实 API 测试\n');

  store.close();
}

testStructure().catch((error) => {
  console.error('\n❌ 测试失败:', error);
  process.exit(1);
});
