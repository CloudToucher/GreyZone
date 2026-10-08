import { ClaudeDirector } from '../server/claude-director.js';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import type { Campaign, Intent } from '../shared/types.js';

/**
 * 15轮完整剧情测试：双面间谍任务
 * 包含：潜入、谈判、背叛、战斗、追逃、反转
 */
async function epicScenario() {
  console.log('🎮 灰区团桌 - 15轮史诗级剧情测试\n');
  console.log('📖 剧情：《双面游戏》');
  console.log('    两名佣兵接到任务：从黑市军火商手中夺取情报芯片');
  console.log('    但真相远比表面复杂...\n');

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  if (!apiKey) {
    console.error('❌ 需要 API Key');
    process.exit(1);
  }

  const store = new Store(':memory:');
  const library = new Library();
  const director = new ClaudeDirector(store, library, { apiKey, baseURL }, () => {});

  console.log(`✅ 使用模型: ${(director as any).model}\n`);

  // 创建团桌
  const room: Campaign = {
    format: 3,
    id: 'EPIC15',
    title: '双面游戏',
    revision: 0,
    worldVersion: 0,
    world: library.seed(),
    board: [],
    messages: [],
    journal: [],
    sessionId: 'epic-15-session',
    sessionReady: false,
  };
  store.saveRoom(room);

  // 两名玩家
  const seat1 = store.addSeat('EPIC15', '狐狸', true);
  const seat2 = store.addSeat('EPIC15', '老鹰', false);

  // 角色1：狡猾的谈判专家
  const char1 = 'pc-fox';
  room.world.records[char1] = {
    id: char1,
    kind: 'character',
    name: '苏菲',
    audience: [char1],
    secret: '',
    data: {
      background: '前情报官，擅长读心和谈判。曾在军情处工作，因某个任务失败被迫离开体制。',
      appearance: '30岁出头，短发，总带着玩世不恭的笑容',
      stats: { body: 1, agility: 2, perception: 3, mind: 2 },
      specialties: ['谈判', '察言观色', '隐匿'],
      abilities: [
        { name: '读心', description: '观察微表情判断对方意图，察觉检定+2' },
        { name: '话术', description: '说服和欺骗时优势骰' },
      ],
      resources: { cash: 300, 联系人: 5 },
      conditions: [],
      location: 'fence',
      status: 'active',
      ready: true,
      delegated: false,
    },
  };

  // 角色2：冷静的战术专家
  const char2 = 'pc-hawk';
  room.world.records[char2] = {
    id: char2,
    kind: 'character',
    name: '维克托',
    audience: [char2],
    secret: '',
    data: {
      background: '雇佣兵出身，经历过边境战争。不多话，但行动果断。对苏菲有复杂的感情。',
      appearance: '35岁，络腮胡，右眉有疤',
      stats: { body: 3, agility: 2, perception: 2, mind: 1 },
      specialties: ['战术', '射击', '近战'],
      abilities: [
        { name: '战场直觉', description: '战斗中察觉检定优势骰' },
        { name: '压制射击', description: '射击可同时影响多个目标' },
      ],
      resources: { cash: 250, 弹药: 36, 手雷: 2 },
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

  // NPC设置
  room.world.records['npc-dealer'] = {
    id: 'npc-dealer',
    kind: 'npc',
    name: '老蛇',
    audience: ['table'],
    secret: '实际上是政府卧底，芯片是诱饵',
    data: {
      role: '黑市军火商',
      background: '在灰区经营十年，看似贪婪实则谨慎',
      stats: { body: 2, agility: 1, perception: 3, mind: 2 },
      specialties: ['交易', '观察', '枪械'],
      resources: { 护甲: 2, 手下: 4 },
      location: 'npc-dealer',
    },
  };

  room.world.records['npc-client'] = {
    id: 'npc-client',
    kind: 'npc',
    name: '艾米丽',
    audience: ['table'],
    secret: '真实身份是反政府组织领袖',
    data: {
      role: '神秘委托人',
      background: '自称商业间谍，实则有更深的目的',
      stats: { body: 1, agility: 2, perception: 2, mind: 3 },
      specialties: ['欺骗', '黑客', '逃脱'],
      location: 'npc-client',
    },
  };

  room.worldVersion++;
  store.saveRoom(room);

  console.log('👥 角色设定：');
  console.log('   🦊 苏菲 - 谈判专家，前情报官');
  console.log('   🦅 维克托 - 战术专家，雇佣兵');
  console.log('   🐍 老蛇 - 黑市商人（政府卧底）');
  console.log('   👩 艾米丽 - 委托人（反政府组织）\n');
  console.log('═══════════════════════════════════════════════\n');

  // 15轮剧情
  const rounds = [
    {
      name: '序幕：接受任务',
      actions: [
        {
          characterId: char1,
          text: '我在咖啡馆见艾米丽，仔细观察她的表情和肢体语言，判断这个任务是否有隐情。同时询问："芯片里到底是什么？你为什么不亲自去拿？"',
        },
        {
          characterId: char2,
          text: '我坐在苏菲旁边，一边喝咖啡一边警戒周围。如果艾米丽回答有破绽，我会用眼神提醒苏菲。',
        },
      ],
    },
    {
      name: '第1轮：情报收集',
      actions: [
        {
          characterId: char1,
          text: '我联系我在黑市的线人，打听老蛇最近的动向。"他最近和谁见过面？有没有什么异常？" 如果线人要钱，我给50灰币。',
        },
        {
          characterId: char2,
          text: '我去老蛇的酒吧踩点，不进去，就在对面楼顶观察。记录守卫数量、换班时间、出入口位置。拍照记录。',
        },
      ],
    },
    {
      name: '第2轮：制定计划',
      actions: [
        {
          characterId: char1,
          text: '我把收集到的信息告诉维克托，然后说："我觉得硬闯不是好主意。我可以假装想买军火接近老蛇，你在外面接应。但如果他识破了，你得马上进来。"',
        },
        {
          characterId: char2,
          text: '我点头："可以。我会在狙击位等着。如果你遇到麻烦，用暗号——咳嗽两声。我会制造混乱让你撤出。" 检查武器和弹药。',
        },
      ],
    },
    {
      name: '第3轮：接触目标',
      actions: [
        {
          characterId: char1,
          text: '我打扮成军火买家，独自走进老蛇的酒吧。"听说老蛇有好货？我需要一批消音器和夜视仪。" 观察他的反应，试探他是否警觉。',
        },
        {
          characterId: char2,
          text: '我在对面楼顶架好狙击枪，通过瞄准镜观察酒吧内部。如果看到苏菲有危险，立即准备射击。',
        },
      ],
    },
    {
      name: '第4轮：交涉与试探',
      actions: [
        {
          characterId: char1,
          text: '老蛇如果同意谈生意，我会边看货边说："对了，听说你手上有个芯片？我的雇主可能感兴趣。" 用察言观色判断他知不知道芯片的价值。',
        },
        {
          characterId: char2,
          text: '我继续观察。如果有其他武装人员靠近酒吧，立即通过耳机警告苏菲："有情况，东侧两个人，武装。"',
        },
      ],
    },
    {
      name: '第5轮：谈判破裂',
      actions: [
        {
          characterId: char1,
          text: '如果老蛇起疑或者拒绝交易，我说："看来你不信任我。那这样，我先付一半定金，你明天给我看货？" 尝试拖延时间，暗中寻找芯片可能的位置。',
        },
        {
          characterId: char2,
          text: '如果苏菲发出危险信号（咳嗽两声），我立即朝酒吧门口的灯牌射击，制造混乱，掩护她撤退。',
        },
      ],
    },
    {
      name: '第6轮：意外发现',
      actions: [
        {
          characterId: char1,
          text: '撤出酒吧后，我和维克托汇合。"事情不对劲。老蛇太警觉了，他肯定知道芯片的价值。而且我发现他的手下有军方装备。" 拿出拍的照片分析。',
        },
        {
          characterId: char2,
          text: '我看着照片说："这不是普通黑市商人。你看这个战术背心，还有通讯器——这是政府的东西。" 皱眉，"我们被坑了？"',
        },
      ],
    },
    {
      name: '第7轮：调查真相',
      actions: [
        {
          characterId: char1,
          text: '我决定反查艾米丽。联系我在情报圈的老熟人："帮我查一个人，艾米丽，30岁左右，自称商业间谍。" 如果要付钱我给100灰币。',
        },
        {
          characterId: char2,
          text: '我提议："与其被动，不如主动。我们回去找艾米丽，问清楚到底怎么回事。如果她撒谎，我们就撤出这个任务。"',
        },
      ],
    },
    {
      name: '第8轮：对峙委托人',
      actions: [
        {
          characterId: char1,
          text: '我直接找到艾米丽，把情况摊开："老蛇不是普通商人，他有政府背景。你到底想让我们偷什么？如果不说实话，我们现在就走。" 用读心能力判断她的反应。',
        },
        {
          characterId: char2,
          text: '我站在门口，一只手放在枪柄上。如果艾米丽叫人或者掏武器，我会第一时间反应。冷冷地看着她。',
        },
      ],
    },
    {
      name: '第9轮：真相揭露',
      actions: [
        {
          characterId: char1,
          text: '听完艾米丽的解释后（如果她坦白了），我和维克托交换眼神。"所以你是想让我们从政府卧底手里偷机密？这会把我们卷进政治旋涡。" 考虑是否继续。',
        },
        {
          characterId: char2,
          text: '我说："钱不是问题。问题是，政府会追杀我们。" 停顿，"除非你有办法保证我们的安全，否则这事没法做。"',
        },
      ],
    },
    {
      name: '第10轮：新的计划',
      actions: [
        {
          characterId: char1,
          text: '如果艾米丽给出足够的报酬或保证，我说："好吧。但这次我们换个方法——既然老蛇是卧底，我们就利用这一点。我伪装成政府联络员去见他。"',
        },
        {
          characterId: char2,
          text: '我补充："我会提前拿到真的政府证件照片和代号。苏菲，你能伪造通行证吗？" 开始规划新方案的细节。',
        },
      ],
    },
    {
      name: '第11轮：伪装渗透',
      actions: [
        {
          characterId: char1,
          text: '我穿上仿制的政府制服，带着伪造的证件，再次去见老蛇。"上级让我来接管芯片。行动代号：暮光。" 用自信的语气说，观察他的反应。',
        },
        {
          characterId: char2,
          text: '我扮成政府护卫，站在苏菲身后。表情严肃，一言不发。如果老蛇核验身份，我会配合演戏。',
        },
      ],
    },
    {
      name: '第12轮：穿帮危机',
      actions: [
        {
          characterId: char1,
          text: '如果老蛇要求验证更多信息（比如联络上级），我镇定地说："现在是静默期，不能联络。你应该知道规矩。" 用强硬态度压制他的怀疑。',
        },
        {
          characterId: char2,
          text: '我注意到老蛇的手下在移动位置。低声对苏菲说："情况不妙，他们在包围。" 做好随时开火的准备。',
        },
      ],
    },
    {
      name: '第13轮：激烈交火',
      actions: [
        {
          characterId: char1,
          text: '穿帮了！我迅速翻过吧台，抓起酒瓶砸向最近的守卫。"维克托，开火！" 同时拔出手枪，躲到掩体后。',
        },
        {
          characterId: char2,
          text: '我朝天花板扔烟雾弹，然后开枪压制。"苏菲，往后门走！" 边射击边后退，掩护她撤离。',
        },
      ],
    },
    {
      name: '第14轮：夺取芯片',
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
      name: '第15轮：惊险逃脱',
      actions: [
        {
          characterId: char1,
          text: '拿到芯片！"走！" 和维克托一起冲出后门，跳上摩托车。如果有人追，我朝他们的轮胎开枪。',
        },
        {
          characterId: char2,
          text: '我启动摩托，漂移转弯冲进小巷。"抓紧了！" 在狭窄的巷子里加速，甩掉追兵。最后停在安全屋，气喘吁吁地说："成了。"',
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
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheHits: 0,
    rounds: [] as any[],
  };

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    console.log(`\n📍 ${round.name} (${i + 1}/15)`);
    console.log('─────────────────────────────────────────────\n');

    round.actions.forEach((action) => {
      const charName = room.world.records[action.characterId].name;
      console.log(`${charName}:`);
      console.log(`  ${action.text}\n`);
    });

    const freshRoom = store.room('EPIC15');
    freshRoom.board = round.actions.map((action, idx) => ({
      id: `act-r${i}-${idx}`,
      seatId: action.characterId === char1 ? seat1.seat.id : seat2.seat.id,
      characterId: action.characterId,
      text: action.text,
      audience: ['table'],
      createdAt: new Date().toISOString(),
    }));
    freshRoom.revision++;
    store.saveRoom(freshRoom);

    const run = {
      id: `run-epic-${i}`,
      roomId: 'EPIC15',
      kind: 'round' as const,
      status: 'running' as const,
      baseVersion: freshRoom.worldVersion,
      draft: structuredClone(freshRoom.world),
      actions: freshRoom.board,
      request: '按各玩家提交的意图主持这一批行动。注重角色对话、心理描写和剧情张力。',
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

    // 清理之前可能存在的运行状态
    try {
      const existingRun = store.db.prepare('SELECT id FROM runs WHERE room=? AND status!=?').get('EPIC15', 'completed') as any;
      if (existingRun) {
        const oldRun = store.run(existingRun.id);
        oldRun.status = 'completed';
        oldRun.error = '被新轮次替代';
        store.saveRun(oldRun);
      }
    } catch (e) {
      // 忽略错误
    }

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
        round: i + 1,
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

      // 显示叙述
      const updatedRoom = store.room('EPIC15');
      const entry = updatedRoom.journal[updatedRoom.journal.length - 1];
      if (entry) {
        console.log('📜 叙述：');
        console.log('─────────────────────────────────────────────');
        entry.passages.forEach((p) => {
          // 截取前500字符避免输出过长
          const text = p.text.length > 500 ? p.text.substring(0, 500) + '...' : p.text;
          console.log(text);
        });
        console.log('─────────────────────────────────────────────');

        if (entry.changes.length > 0) {
          console.log(`\n📊 变更: ${entry.changes.length}项`);
        }
      }

      if (finalRun.status !== 'completed') {
        console.log(`\n⚠️ 状态: ${finalRun.status}`);
        if (finalRun.error) console.log(`   ${finalRun.error}`);
      }
    } catch (error) {
      console.error(`\n❌ 第 ${i + 1} 轮失败:`, (error as Error).message);
      stats.rounds.push({ round: i + 1, name: round.name, error: (error as Error).message });
      break;
    }

    if (i < rounds.length - 1) {
      console.log('\n═══════════════════════════════════════════════');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // 最终统计
  console.log('\n\n🏁 15轮史诗测试完成！\n');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 总体统计\n');
  console.log(`完成轮数: ${stats.rounds.filter((r) => !r.error).length}/${stats.totalRounds}`);
  console.log(`总耗时: ${(stats.totalTime / 1000 / 60).toFixed(1)} 分钟`);
  console.log(`平均每轮: ${(stats.totalTime / stats.rounds.length / 1000).toFixed(1)}秒`);
  console.log(`总工具调用: ${stats.totalToolCalls}`);
  console.log(`总模型调用: ${stats.totalModelCalls}`);
  console.log(`总输入 Token: ${stats.totalInputTokens.toLocaleString()}`);
  console.log(`总输出 Token: ${stats.totalOutputTokens.toLocaleString()}`);
  console.log(`总缓存命中: ${stats.totalCacheHits.toLocaleString()}`);
  console.log(`缓存节省比: ${((stats.totalCacheHits / (stats.totalCacheHits + stats.totalInputTokens)) * 100).toFixed(1)}%`);

  console.log('\n📈 分轮性能:\n');
  stats.rounds.forEach((r) => {
    if (r.error) {
      console.log(`${r.round}. ${r.name}: ❌ ${r.error}`);
    } else {
      console.log(
        `${r.round}. ${r.name}: ${(r.time / 1000).toFixed(1)}s | ` +
          `工具${r.toolCalls} | ${r.inputTokens}→${r.outputTokens}t | 缓存${r.cacheRead}`,
      );
    }
  });

  console.log('\n═══════════════════════════════════════════════\n');

  const finalRoom = store.room('EPIC15');
  console.log('🌍 最终状态:\n');
  console.log(`团录条目: ${finalRoom.journal.length}`);
  console.log(`世界版本: ${finalRoom.worldVersion}`);

  const char1Final = finalRoom.world.records[char1];
  const char2Final = finalRoom.world.records[char2];
  console.log(`\n角色状态:`);
  console.log(`  苏菲: ${char1Final.data.status}`);
  console.log(`  维克托: ${char2Final.data.status}`);

  await director.close();
  store.close();

  console.log('\n✅ 史诗测试完成！\n');
}

epicScenario().catch((error) => {
  console.error('\n💥 测试崩溃:', error);
  process.exit(1);
});
