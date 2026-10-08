/**
 * 模拟版本 - 演示测试脚本的结构和输出
 * 不需要真实 API key
 */

console.log('🎮 灰区团桌 - 战斗密集场景测试（模拟版）\n');
console.log('📖 场景：夜袭货仓，暗杀目标并夺取芯片\n');
console.log('✅ Director 初始化成功');
console.log('📋 模型: claude-opus-4.8-20250514\n');

console.log('👥 角色创建完成：');
console.log('   🗡️  林刃（近战刺客）- 体魄3 身手2');
console.log('   🎯 陈影（远程狙击）- 身手3 察觉2\n');
console.log('🎭 场景设置完成\n');
console.log('═══════════════════════════════════════════════\n');

const rounds = [
  {
    name: '第一轮：潜入',
    actions: [
      { char: '林刃', text: '从侧门潜入，使用潜行靠近仓库，观察守卫巡逻路线' },
      { char: '陈影', text: '在对面楼顶架设狙击位，用望远镜观察仓库内部情况' },
    ],
    narrative: `夜色如墨。林刃贴着墙角，悄无声息地接近侧门。守卫的脚步声很有规律——每隔三分钟巡逻一圈。

楼顶，陈影通过瞄准镜观察着仓库内部。透过破损的窗户，他看到目标王铁正在二楼办公室里清点货物，身边有两名贴身护卫。

"目标锁定，"陈影在通讯器里低声道，"一楼四名守卫，二楼两名。王铁在二楼东侧办公室。"

林刃做了个手势表示收到。巡逻守卫转过拐角的瞬间，他如同影子般滑进了侧门。`,
    rolls: [
      { purpose: '林刃潜行', result: 15, success: true },
      { purpose: '陈影观察', result: 18, success: true },
    ],
    changes: ['林刃：位置更新为仓库内部', '陈影：获得地形信息'],
    time: 18.3,
    toolCalls: 5,
    modelCalls: 2,
    tokens: { in: 2847, out: 489, cache: 2100 },
  },
  {
    name: '第二轮：遭遇战',
    actions: [
      { char: '林刃', text: '守卫发现了我！立即冲向最近的守卫，用匕首致命一击' },
      { char: '陈影', text: '用狙击枪精准射击，优先打最靠近林刃的守卫头部' },
    ],
    narrative: `"嘿！你是——"

守卫的话还没说完，林刃已经暴起发难。匕首如毒蛇般刺出，准确命中守卫喉咙。鲜血喷溅，那人连叫都没来得及叫。

"砰！"狙击枪的沉闷枪声。另一名试图拔枪的守卫头部开花，重重倒地。

"警报！有入侵者！"其他守卫反应过来了。枪声响起，子弹在林刃身边呼啸而过。他翻身躲到一堆木箱后面。

"两个解决，还有两个一楼守卫正在包抄你，"陈影冷静地报告，"楼上的护卫还没动。"

林刃喘着气，握紧匕首。血腥味弥漫开来。`,
    rolls: [
      { purpose: '林刃近战攻击（优势骰）', result: 22, success: true },
      { purpose: '陈影精准射击', result: 19, success: true },
      { purpose: '守卫反应', result: 11, success: false },
    ],
    changes: [
      '守卫1：状态更新为死亡',
      '守卫2：状态更新为死亡',
      '林刃：消耗 1 点体力',
      '陈影：弹药 24 → 22',
    ],
    time: 21.7,
    toolCalls: 8,
    modelCalls: 3,
    tokens: { in: 3421, out: 612, cache: 2890 },
  },
  {
    name: '第三轮：激烈交火',
    actions: [
      { char: '林刃', text: '利用掩体快速移动，向办公室突进，遇守卫就近战解决' },
      { char: '陈影', text: '继续狙击支援，打击试图包抄林刃的守卫' },
    ],
    narrative: `林刃从掩体后冲出，如猎豹般扑向楼梯。一名守卫从侧面冒出来，林刃不退反进，一个滑铲到对方脚下，匕首自下而上刺入守卫腹部。

"砰！砰！"陈影连开两枪。最后一名一楼守卫应声倒地，右肩中弹。

楼梯上传来脚步声——二楼的两名护卫冲下来了！子弹密集地打在楼梯扶手上，火花四溅。

林刃贴着墙壁快速上楼，在转角处突然发力，一脚踹开第一个护卫。匕首闪电般划过对方颈部。

另一名护卫惊恐地举起枪，但狙击子弹先一步打碎了他的右手。他惨叫着跌倒。

"目标办公室，无防御，"陈影道，"快！"`,
    rolls: [
      { purpose: '林刃战术移动', result: 16, success: true },
      { purpose: '林刃近战（优势）', result: 20, success: true },
      { purpose: '陈影远程支援', result: 17, success: true },
      { purpose: '护卫反击', result: 9, success: false },
    ],
    changes: [
      '守卫3：状态更新为重伤',
      '守卫4（护卫）：状态更新为死亡',
      '守卫5（护卫）：轻伤，右手废',
      '林刃：消耗 2 点体力',
      '陈影：弹药 22 → 18',
    ],
    time: 24.1,
    toolCalls: 9,
    modelCalls: 3,
    tokens: { in: 4102, out: 723, cache: 3650 },
  },
  {
    name: '第四轮：击杀目标',
    actions: [
      { char: '林刃', text: '冲进办公室，直接攻击王铁！用匕首刺向要害，夺取芯片' },
      { char: '陈影', text: '观察局势，如有守卫追进去就射击掩护' },
    ],
    narrative: `林刃踹开办公室的门。

王铁正从桌后抽出一把手枪，但林刃更快。他扑了过去，一把抓住王铁的手腕，用力一拧。"咔嚓"一声，手枪掉落。

"你——"王铁眼中满是惊恐。

匕首深深刺入他的胸口。鲜血染红了他的白衬衫。林刃面无表情地拔出匕首，从王铁身上搜出一个金属盒子——里面是军用芯片。

"目标清除，芯片到手，"林刃在通讯器里说。

楼下传来汽车引擎声——增援快到了。

"撤！"陈影喊道，"现在！"`,
    rolls: [
      { purpose: '林刃突袭攻击', result: 21, success: true },
      { purpose: '王铁防御', result: 8, success: false },
    ],
    changes: [
      '王铁：状态更新为死亡',
      '林刃：获得物品[军用芯片]',
      '林刃：消耗 1 点体力',
    ],
    time: 19.8,
    toolCalls: 6,
    modelCalls: 2,
    tokens: { in: 3987, out: 567, cache: 3720 },
  },
  {
    name: '第五轮：撤离',
    actions: [
      { char: '林刃', text: '拿到芯片！从窗户跳出，利用身手翻滚卸力，向撤离点狂奔' },
      { char: '陈影', text: '收起狙击枪，从楼顶撤离，与林刃在撤离点汇合' },
    ],
    narrative: `林刃冲到窗边，毫不犹豫地跃了出去。二楼高度，他在空中调整身姿，落地时顺势一个翻滚，完美卸掉冲击力。

身后传来密集的脚步声和怒吼。增援到了，至少十个人。

林刃拔腿就跑，穿过巷道，翻过围墙。子弹在他身后打碎了砖块。

另一边，陈影已经收起装备，从楼顶消防梯飞速下撤。他看了眼手表——还有三十秒，林刃应该能到。

夜色中，两个身影在废弃码头汇合。

"走！"

摩托车轰鸣着驶离。身后，警笛声大作，但他们已经消失在黑暗中。

任务完成。

十五分钟后，金属盒子里的军用芯片将被交给委托人。`,
    rolls: [
      { purpose: '林刃跳窗+翻滚', result: 18, success: true },
      { purpose: '陈影撤离', result: 16, success: true },
      { purpose: '守卫追击', result: 10, success: false },
    ],
    changes: [
      '林刃：位置更新为撤离点',
      '陈影：位置更新为撤离点',
      '林刃：轻伤（擦伤）',
      '任务状态：完成',
    ],
    time: 17.4,
    toolCalls: 5,
    modelCalls: 2,
    tokens: { in: 4234, out: 531, cache: 4010 },
  },
];

async function simulateRounds() {
  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];

    console.log(`\n🎬 ${round.name}`);
    console.log('─────────────────────────────────────────────\n');

    // 显示行动
    round.actions.forEach((action, idx) => {
      console.log(`${idx + 1}. ${action.char}:`);
      console.log(`   ${action.text}\n`);
    });

    console.log('⚡ 主持人裁决中...\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('✅ 裁决完成\n');
    console.log(`⏱️  耗时: ${round.time}s`);
    console.log(`🔧 工具调用: ${round.toolCalls}`);
    console.log(`🤖 模型调用: ${round.modelCalls}`);
    console.log(`💬 Token: ${round.tokens.in} in / ${round.tokens.out} out`);
    console.log(`📦 缓存命中: ${round.tokens.cache} tokens`);

    console.log('\n📜 主持人叙述：');
    console.log('─────────────────────────────────────────────');
    console.log(round.narrative);
    console.log('─────────────────────────────────────────────');

    if (round.rolls.length > 0) {
      console.log('\n🎲 检定结果：');
      round.rolls.forEach((r) => {
        const result = r.success ? '✓ 成功' : '✗ 失败';
        console.log(`   ${r.purpose}: ${r.result} ${result}`);
      });
    }

    if (round.changes.length > 0) {
      console.log('\n📊 状态变更：');
      round.changes.forEach((c) => console.log(`   ${c}`));
    }

    if (i < rounds.length - 1) {
      console.log('\n═══════════════════════════════════════════════');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // 统计
  const totalTime = rounds.reduce((sum, r) => sum + r.time, 0);
  const totalToolCalls = rounds.reduce((sum, r) => sum + r.toolCalls, 0);
  const totalModelCalls = rounds.reduce((sum, r) => sum + r.modelCalls, 0);
  const totalTokens = rounds.reduce((sum, r) => sum + r.tokens.in + r.tokens.out, 0);

  console.log('\n\n🏁 测试完成！\n');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 总体统计\n');
  console.log(`总轮数: ${rounds.length}`);
  console.log(`总耗时: ${totalTime.toFixed(1)}s`);
  console.log(`平均每轮: ${(totalTime / rounds.length).toFixed(1)}s`);
  console.log(`总工具调用: ${totalToolCalls}`);
  console.log(`总模型调用: ${totalModelCalls}`);
  console.log(`总 Token: ${totalTokens.toLocaleString()}`);
  console.log(`平均每轮 Token: ${Math.round(totalTokens / rounds.length).toLocaleString()}`);

  console.log('\n📈 分轮统计:\n');
  rounds.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.name}: ${r.time}s | ` +
        `工具${r.toolCalls} 模型${r.modelCalls} | ` +
        `${r.tokens.in}→${r.tokens.out} tokens | ` +
        `缓存${r.tokens.cache}`,
    );
  });

  console.log('\n═══════════════════════════════════════════════\n');
  console.log('🌍 最终状态:\n');
  console.log('团录条目: 5');
  console.log('世界版本: 7');
  console.log('\n角色状态:');
  console.log('  林刃: active - 1 个状态（轻伤：擦伤）');
  console.log('  陈影: active - 0 个状态');
  console.log('  王铁: dead');
  console.log('  守卫: 4人死亡，1人重伤');
  console.log('\n任务物品:');
  console.log('  ✅ 军用芯片（已获得）');
  console.log('\n✅ 任务完成！芯片安全到手，人员撤离成功\n');
}

simulateRounds().catch(console.error);
