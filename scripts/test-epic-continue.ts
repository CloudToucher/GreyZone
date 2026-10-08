import { ClaudeDirector } from '../server/claude-director.js';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import type { Campaign, Intent } from '../shared/types.js';

/**
 * 继续15轮测试 - 从第5轮开始
 */
async function continueEpicScenario() {
  console.log('🎮 继续15轮史诗测试（从第5轮）\n');

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  const store = new Store(':memory:');
  const library = new Library();
  const director = new ClaudeDirector(store, library, { apiKey: apiKey!, baseURL }, () => {});

  console.log(`✅ 使用模型: ${(director as any).model}\n`);

  // 简化设置 - 直接从第5轮开始
  const room: Campaign = {
    format: 3,
    id: 'EPIC15',
    title: '双面游戏',
    revision: 10,
    worldVersion: 10,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'epic-15-continue',
    sessionReady: false,
  };
  store.saveRoom(room);

  const seat1 = store.addSeat('EPIC15', '狐狸', true);
  const seat2 = store.addSeat('EPIC15', '老鹰', false);

  const char1 = 'pc-fox';
  const char2 = 'pc-hawk';

  room.world.records[char1] = {
    id: char1,
    kind: 'character',
    name: '苏菲',
    audience: [char1],
    secret: '',
    data: {
      background: '前情报官，擅长读心和谈判',
      stats: { body: 1, agility: 2, perception: 3, mind: 2 },
      specialties: ['谈判', '察言观色', '隐匿'],
      abilities: [{ name: '读心', description: '观察微表情判断对方意图' }],
      resources: { cash: 300 },
      conditions: [],
      location: 'place-bar',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };

  room.world.records[char2] = {
    id: char2,
    kind: 'character',
    name: '维克托',
    audience: [char2],
    secret: '',
    data: {
      background: '雇佣兵出身，战术专家',
      stats: { body: 3, agility: 2, perception: 2, mind: 1 },
      specialties: ['战术', '射击', '近战'],
      abilities: [{ name: '战场直觉', description: '战斗中察觉检定优势骰' }],
      resources: { cash: 250, 弹药: 36, 手雷: 2 },
      conditions: [],
      location: 'place-sniper',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };

  seat1.seat.characters.push(char1);
  seat2.seat.characters.push(char2);
  store.saveSeat(seat1.seat);
  store.saveSeat(seat2.seat);

  room.worldVersion++;
  store.saveRoom(room);

  console.log('👥 角色已设置，从第5轮开始\n');
  console.log('═══════════════════════════════════════════════\n');

  // 从第5轮开始的剧情
  const rounds = [
    {
      name: '第5轮：激烈交火',
      actions: [
        {
          characterId: char1,
          text: '我翻过吧台躲避子弹，抓起酒瓶砸向最近的守卫。"维克托，开火！" 同时拔出手枪，朝老蛇射击。',
        },
        {
          characterId: char2,
          text: '我朝天花板扔烟雾弹，然后开枪压制。"苏菲，往后门走！" 边射击边后退，掩护她撤离。',
        },
      ],
    },
    {
      name: '第6轮：夺取芯片',
      actions: [
        {
          characterId: char1,
          text: '撤退时我看到老蛇的保险柜！"维克托，掩护我三十秒！" 冲过去用撬棍撬保险柜，不管身后的枪声。',
        },
        {
          characterId: char2,
          text: '我切换到自动模式，疯狂扫射压制所有人。"快点！我弹药不多了！" 拔出手雷准备扔出去拖延时间。',
        },
      ],
    },
    {
      name: '第7轮：惊险逃脱',
      actions: [
        {
          characterId: char1,
          text: '拿到芯片！"走！" 和维克托一起冲出后门，跳上摩托车。如果有人追，我朝他们的轮胎开枪。',
        },
        {
          characterId: char2,
          text: '我启动摩托，漂移转弯冲进小巷。"抓紧了！" 在狭窄的巷子里加速，甩掉追兵。',
        },
      ],
    },
  ];

  const stats = {
    totalRounds: rounds.length,
    totalTime: 0,
    totalToolCalls: 0,
    totalModelCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheHits: 0,
    rounds: [] as any[],
  };

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    console.log(`\n📍 ${round.name} (${i + 5}/15)`);
    console.log('─────────────────────────────────────────────\n');

    round.actions.forEach((action) => {
      const charName = room.world.records[action.characterId].name;
      console.log(`${charName}: ${action.text}\n`);
    });

    const freshRoom = store.room('EPIC15');
    freshRoom.board = round.actions.map((action, idx) => ({
      id: `act-r${i + 5}-${idx}`,
      seatId: action.characterId === char1 ? seat1.seat.id : seat2.seat.id,
      characterId: action.characterId,
      text: action.text,
      audience: ['table'],
      createdAt: new Date().toISOString(),
    }));
    freshRoom.revision++;
    store.saveRoom(freshRoom);

    const run = {
      id: `run-continue-${i + 5}`,
      roomId: 'EPIC15',
      kind: 'round' as const,
      status: 'running' as const,
      baseVersion: freshRoom.worldVersion,
      draft: structuredClone(freshRoom.world),
      actions: freshRoom.board,
      request: '按各玩家提交的意图主持这一批行动。这是战斗场景，注重动作和紧张感。',
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

    console.log('⚡ 主持人裁决中...\n');
    const roundStart = Date.now();

    try {
      await director.launch(run.id);
      const roundTime = Date.now() - roundStart;
      const finalRun = store.run(run.id);

      stats.totalTime += roundTime;
      stats.totalToolCalls += finalRun.metrics.toolCalls;
      stats.totalModelCalls += finalRun.metrics.modelCalls;
      stats.totalInputTokens += finalRun.metrics.inputTokens;
      stats.totalOutputTokens += finalRun.metrics.outputTokens;
      stats.totalCacheHits += finalRun.metrics.cacheReadTokens || 0;

      stats.rounds.push({
        round: i + 5,
        name: round.name,
        time: roundTime,
        toolCalls: finalRun.metrics.toolCalls,
        modelCalls: finalRun.metrics.modelCalls,
        inputTokens: finalRun.metrics.inputTokens,
        outputTokens: finalRun.metrics.outputTokens,
        cacheRead: finalRun.metrics.cacheReadTokens || 0,
        status: finalRun.status,
      });

      console.log(`✅ 完成 | ⏱️ ${(roundTime / 1000).toFixed(1)}s | 🔧 工具${finalRun.metrics.toolCalls} | 🤖 模型${finalRun.metrics.modelCalls}`);
      console.log(`   💬 ${finalRun.metrics.inputTokens}→${finalRun.metrics.outputTokens} tokens | 📦 缓存${finalRun.metrics.cacheReadTokens || 0}\n`);

      const updatedRoom = store.room('EPIC15');
      const entry = updatedRoom.journal[updatedRoom.journal.length - 1];
      if (entry) {
        console.log('📜 叙述（前500字）：');
        console.log('─────────────────────────────────────────────');
        entry.passages.forEach((p) => {
          const text = p.text.length > 500 ? p.text.substring(0, 500) + '...' : p.text;
          console.log(text);
        });
        console.log('─────────────────────────────────────────────\n');
      }

      if (finalRun.status !== 'completed') {
        console.log(`⚠️ 状态: ${finalRun.status}`);
        if (finalRun.error) console.log(`   ${finalRun.error}`);
        break;
      }
    } catch (error) {
      console.error(`\n❌ 第 ${i + 5} 轮失败:`, (error as Error).message);
      break;
    }

    if (i < rounds.length - 1) {
      console.log('═══════════════════════════════════════════════');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log('\n\n🏁 测试完成\n');
  console.log(`完成轮数: ${stats.rounds.filter((r) => !r.error).length}/${stats.totalRounds}`);
  console.log(`总耗时: ${(stats.totalTime / 1000).toFixed(1)}秒`);
  console.log(`总工具调用: ${stats.totalToolCalls}`);
  console.log(`总Token: ${stats.totalInputTokens + stats.totalOutputTokens}`);
  console.log(`缓存命中: ${stats.totalCacheHits}`);

  await director.close();
  store.close();
}

continueEpicScenario().catch(console.error);
