import { ClaudeDirector } from '../server/claude-director.js';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import { loadLocalEnv } from '../server/config.js';
import type { Campaign, Intent } from '../shared/types.js';

loadLocalEnv();

/**
 * 剧情紧凑、战斗密集的实机测试
 * 场景：执行暗杀任务，潜入-战斗-撤离
 */
async function runIntenseScenario() {
  console.log('🎮 灰区团桌 - 战斗密集场景测试\n');
  console.log('📖 场景：夜袭货仓，暗杀目标并夺取芯片\n');

  // Use system config (Claude Code's env)
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  if (!apiKey) {
    console.error('❌ 需要设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN');
    process.exit(1);
  }

  console.log(`🔑 API Key: ${apiKey.slice(0, 10)}...`);
  console.log(`🌐 Base URL: ${baseURL || 'default'}\n`);

  // 初始化
  const store = new Store(':memory:');
  const library = new Library();
  const director = new ClaudeDirector(store, library, { apiKey, baseURL }, () => {});

  console.log('✅ Director 初始化成功');
  console.log(`📋 模型: ${(director as any).model}\n`);

  // 创建团桌
  const room: Campaign = {
    format: 3,
    id: 'BATTLE',
    title: '夜袭货仓',
    revision: 0,
    worldVersion: 0,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'intense-test-session',
    sessionReady: false,
  };
  store.saveRoom(room);

  // 添加两名玩家
  const seat1 = store.addSeat('BATTLE', '刀锋', true);
  const seat2 = store.addSeat('BATTLE', '幽灵', false);

  // 创建角色 1：近战刺客
  const char1 = 'pc-blade';
  room.world.records[char1] = {
    id: char1,
    kind: 'character',
    name: '林刃',
    audience: [char1],
    secret: '',
    data: {
      background: '前特种部队，擅长近战暗杀',
      stats: { body: 3, agility: 2, perception: 1, mind: 0 },
      specialties: ['近战', '潜行', '暗杀'],
      abilities: [{ name: '致命一击', description: '背刺优势骰' }],
      resources: { cash: 200, 弹药: 12 },
      conditions: [],
      location: 'fence',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };

  // 创建角色 2：远程狙击手
  const char2 = 'pc-ghost';
  room.world.records[char2] = {
    id: char2,
    kind: 'character',
    name: '陈影',
    audience: [char2],
    secret: '',
    data: {
      background: '雇佣兵，神枪手',
      stats: { body: 1, agility: 3, perception: 2, mind: 0 },
      specialties: ['射击', '观察', '战术'],
      abilities: [{ name: '精准射击', description: '远程攻击+2' }],
      resources: { cash: 150, 弹药: 24 },
      conditions: [],
      location: 'fence',
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

  console.log('👥 角色创建完成：');
  console.log('   🗡️  林刃（近战刺客）- 体魄3 身手2');
  console.log('   🎯 陈影（远程狙击）- 身手3 察觉2\n');

  // 添加目标 NPC
  room.world.records['npc-target'] = {
    id: 'npc-target',
    kind: 'npc',
    name: '王铁',
    audience: ['table'],
    secret: '持有军用芯片',
    data: {
      role: '黑市军火商',
      stats: { body: 2, agility: 1, perception: 1, mind: 1 },
      specialties: ['枪械', '交易'],
      resources: { 护甲: 1 },
      location: 'npc-target',
      status: 'active',
    },
  };

  // 添加守卫
  room.world.records['npc-guards'] = {
    id: 'npc-guards',
    kind: 'npc',
    name: '仓库守卫',
    audience: ['table'],
    secret: '',
    data: {
      role: '4名武装守卫',
      stats: { body: 2, agility: 1, perception: 1, mind: 0 },
      specialties: ['巡逻', '射击'],
      resources: { 弹药: 30 },
      location: 'npc-guards',
      status: 'active',
    },
  };

  // 添加地点
  room.world.records['place-warehouse'] = {
    id: 'place-warehouse',
    kind: 'place',
    name: '废弃货仓',
    audience: ['table'],
    secret: '',
    data: {
      description: '临江废弃仓库，三层建筑，守卫严密',
      region: '灰区东部',
      links: ['fence'],
    },
  };

  room.worldVersion++;
  store.saveRoom(room);

  console.log('🎭 场景设置完成\n');
  console.log('═══════════════════════════════════════════════\n');

  // 定义测试轮次
  const rounds = [
    {
      name: '第一轮：潜入',
      actions: [
        {
          characterId: char1,
          text: '我从侧门潜入，使用潜行靠近仓库，观察守卫巡逻路线。如果被发现就立即躲到掩体后。',
          private: false,
        },
        {
          characterId: char2,
          text: '我在对面楼顶架设狙击位，用望远镜观察仓库内部情况，标记目标位置，随时准备掩护林刃。',
          private: false,
        },
      ],
    },
    {
      name: '第二轮：遭遇战',
      actions: [
        {
          characterId: char1,
          text: '守卫发现了我！我立即冲向最近的守卫，用匕首进行致命一击，尝试快速解决他然后躲到箱子后面。',
          private: false,
        },
        {
          characterId: char2,
          text: '我用狙击枪精准射击，优先打最靠近林刃的守卫的头部，为他争取时间。连续射击两发。',
          private: false,
        },
      ],
    },
    {
      name: '第三轮：激烈交火',
      actions: [
        {
          characterId: char1,
          text: '我利用掩体快速移动，向目标王铁所在的办公室突进。遇到守卫就用近战解决，能躲就躲。',
          private: false,
        },
        {
          characterId: char2,
          text: '我继续狙击支援，打击试图包抄林刃的守卫。如果弹药不足就换位置继续射击。',
          private: false,
        },
      ],
    },
    {
      name: '第四轮：击杀目标',
      actions: [
        {
          characterId: char1,
          text: '我冲进办公室，直接攻击王铁！用匕首刺向他的要害，夺取他身上的军用芯片。',
          private: false,
        },
        {
          characterId: char2,
          text: '我观察局势，如果有守卫追进去就射击掩护。林刃得手后我立即报告撤离路线。',
          private: false,
        },
      ],
    },
    {
      name: '第五轮：撤离',
      actions: [
        {
          characterId: char1,
          text: '拿到芯片！我立即从窗户跳出，利用身手翻滚卸力，向预定撤离点狂奔。',
          private: false,
        },
        {
          characterId: char2,
          text: '我收起狙击枪，从楼顶撤离，边跑边观察是否有追兵，与林刃在撤离点汇合。',
          private: false,
        },
      ],
    },
  ];

  // 执行测试
  const stats = {
    totalRounds: rounds.length,
    totalTime: 0,
    totalToolCalls: 0,
    totalModelCalls: 0,
    totalTokens: 0,
    rounds: [] as any[],
  };

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    console.log(`\n🎬 ${round.name}`);
    console.log('─────────────────────────────────────────────\n');

    // 显示行动
    round.actions.forEach((action, idx) => {
      const charName = room.world.records[action.characterId].name;
      console.log(`${idx + 1}. ${charName}:`);
      console.log(`   ${action.text}\n`);
    });

    // 准备行动板
    const freshRoom = store.room('BATTLE');
    freshRoom.board = round.actions.map((action, idx) => ({
      id: `action-r${i}-${idx}`,
      seatId: action.characterId === char1 ? seat1.seat.id : seat2.seat.id,
      characterId: action.characterId,
      text: action.text,
      audience: action.private ? [action.characterId] : ['table'],
      createdAt: new Date().toISOString(),
    }));
    freshRoom.revision++;
    store.saveRoom(freshRoom);

    // 创建 Run
    const run = {
      id: `run-round-${i}`,
      roomId: 'BATTLE',
      kind: 'round' as const,
      status: 'running' as const,
      baseVersion: freshRoom.worldVersion,
      draft: structuredClone(freshRoom.world),
      actions: freshRoom.board,
      request: '按各玩家提交的意图主持这一批行动。这是战斗场景，注重动作和冲突。',
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
      stats.totalTokens += finalRun.metrics.inputTokens + finalRun.metrics.outputTokens;

      stats.rounds.push({
        round: i + 1,
        name: round.name,
        time: roundTime,
        toolCalls: finalRun.metrics.toolCalls,
        modelCalls: finalRun.metrics.modelCalls,
        inputTokens: finalRun.metrics.inputTokens,
        outputTokens: finalRun.metrics.outputTokens,
        cacheRead: finalRun.metrics.cacheReadTokens ?? 0,
        status: finalRun.status,
      });

      console.log('✅ 裁决完成\n');
      console.log(`⏱️  耗时: ${(roundTime / 1000).toFixed(1)}s`);
      console.log(`🔧 工具调用: ${finalRun.metrics.toolCalls}`);
      console.log(`🤖 模型调用: ${finalRun.metrics.modelCalls}`);
      console.log(
        `💬 Token: ${finalRun.metrics.inputTokens} in / ${finalRun.metrics.outputTokens} out`,
      );
      if (finalRun.metrics.cacheReadTokens) {
        console.log(`📦 缓存命中: ${finalRun.metrics.cacheReadTokens} tokens`);
      }

      // 显示叙述
      const updatedRoom = store.room('BATTLE');
      const entry = updatedRoom.journal[updatedRoom.journal.length - 1];
      if (entry) {
        console.log('\n📜 主持人叙述：');
        console.log('─────────────────────────────────────────────');
        entry.passages.forEach((p) => {
          console.log(p.text);
        });
        console.log('─────────────────────────────────────────────');

        // 显示检定结果
        const rolls = store.rolls(run.id);
        if (rolls.length > 0) {
          console.log('\n🎲 检定结果：');
          rolls.forEach((r) => {
            const result = r.success
              ? '✓ 成功'
              : r.outcome === 'win'
                ? '✓ 胜出'
                : r.outcome === 'loss'
                  ? '✗ 失利'
                  : '✗ 失败';
            console.log(`   ${r.purpose}: ${r.total} ${result}`);
          });
        }

        // 显示变更
        if (entry.changes.length > 0) {
          console.log('\n📊 状态变更：');
          entry.changes.forEach((c) => {
            console.log(`   ${c.name}: ${c.summary}`);
          });
        }
      }

      if (finalRun.status !== 'completed') {
        console.log(`\n⚠️  状态: ${finalRun.status}`);
        if (finalRun.error) console.log(`   ${finalRun.error}`);
      }
    } catch (error) {
      console.error(`\n❌ 第 ${i + 1} 轮失败:`, (error as Error).message);
      stats.rounds.push({
        round: i + 1,
        name: round.name,
        error: (error as Error).message,
      });
      break;
    }

    // 轮次间隔
    if (i < rounds.length - 1) {
      console.log('\n═══════════════════════════════════════════════');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // 最终统计
  console.log('\n\n🏁 测试完成！\n');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 总体统计\n');
  console.log(`总轮数: ${stats.totalRounds}`);
  console.log(`总耗时: ${(stats.totalTime / 1000).toFixed(1)}s`);
  console.log(`平均每轮: ${(stats.totalTime / stats.totalRounds / 1000).toFixed(1)}s`);
  console.log(`总工具调用: ${stats.totalToolCalls}`);
  console.log(`总模型调用: ${stats.totalModelCalls}`);
  console.log(`总 Token: ${stats.totalTokens.toLocaleString()}`);
  console.log(`平均每轮 Token: ${Math.round(stats.totalTokens / stats.totalRounds).toLocaleString()}`);

  console.log('\n📈 分轮统计:\n');
  stats.rounds.forEach((r) => {
    if (r.error) {
      console.log(`${r.round}. ${r.name}: ❌ ${r.error}`);
    } else {
      console.log(
        `${r.round}. ${r.name}: ${(r.time / 1000).toFixed(1)}s | ` +
          `工具${r.toolCalls} 模型${r.modelCalls} | ` +
          `${r.inputTokens}→${r.outputTokens} tokens` +
          (r.cacheRead ? ` | 缓存${r.cacheRead}` : ''),
      );
    }
  });

  console.log('\n═══════════════════════════════════════════════\n');

  // 显示最终世界状态
  const finalRoom = store.room('BATTLE');
  console.log('🌍 最终状态:\n');
  console.log(`团录条目: ${finalRoom.journal.length}`);
  console.log(`世界版本: ${finalRoom.worldVersion}`);

  const char1Final = finalRoom.world.records[char1];
  const char2Final = finalRoom.world.records[char2];
  console.log(`\n角色状态:`);
  console.log(`  林刃: ${char1Final.data.status} - ${(char1Final.data.conditions as any[])?.length || 0} 个状态`);
  console.log(`  陈影: ${char2Final.data.status} - ${(char2Final.data.conditions as any[])?.length || 0} 个状态`);

  await director.close();
  store.close();

  console.log('\n✅ 测试脚本执行完毕\n');
}

runIntenseScenario().catch((error) => {
  console.error('\n💥 测试崩溃:', error);
  process.exit(1);
});
