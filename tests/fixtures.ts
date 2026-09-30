import { characterDraftSchema, type CharacterDraft } from '../shared/types.js';
import type { Director } from '../server/ai/dsh.js';
import { emptyPlan } from '../server/engine.js';

export function diverDraft(name = '沈沅'): CharacterDraft {
  return characterDraftSchema.parse({
    name,
    background: '在港区长大，做过水下检修和沉船打捞。回来寻找失踪的搭档，不属于任何公司的雇员。',
    personal: {
      identity: '港口潜水员',
      appearance: '旧潜水服，手指有长期泡水留下的裂口。',
      motives: '查明搭档失踪的原因。',
      relationships: '叶遥是搭档的姐姐。',
      preferences: '调查、救援、当地人的生活；接受真实危险。',
      boundaries: '不强制恋爱，不强加欠债。',
      advantages: '熟悉船坞与水下工具。',
      complications: '不善于欺骗；呼吸设备需要定期维护。',
      notes: '',
    },
    stats: { STR: 5, AGI: 6, CON: 6, PER: 7, INT: 6, WIL: 6, RSN: 3 },
    training: { technical: 15, observe: 15, resonance: 20 },
    expertise: [
      {
        name: '水下切割',
        attribute: 'INT',
        training: 30,
        scope: '有适当工具时切割水下薄金属结构，不替代爆破或医学。',
      },
    ],
    abilities: [
      {
        id: 'metal-touch',
        name: '金属传振',
        school: 'sense',
        description: '触摸连续金属时分辨传来的振动。',
        applications: '分辨机械运转方向与不同节奏，为调查提供线索。',
        limits: '接触连续金属、八米、十秒；不能读心、不能识别人名，断裂处中断。',
        cost: 2,
        strain: 1,
        consequences: '连续使用累积负荷；失控可能造成反噬。',
      },
    ],
    inventory: [
      {
        id: 'breather',
        name: '修过的呼吸设备',
        kind: 'gear',
        quantity: 1,
        weight: 4,
        value: 350,
        description: '轻型回收装置，密封圈老化，深水前需检查。',
      },
      {
        id: 'diving-knife',
        name: '潜水刀',
        kind: 'gear',
        quantity: 1,
        weight: 0.3,
        value: 45,
        description: '用于割断缠绕物和撬动薄板。',
      },
      {
        id: 'conductor',
        name: '包铜结晶',
        kind: 'crystal',
        quantity: 1,
        weight: 0.1,
        value: 150,
        description: '可接触导能，不能充当无限电池。',
      },
      {
        id: 'flask',
        name: '自带水囊',
        kind: 'water',
        quantity: 2,
        weight: 0.5,
        value: 10,
        description: '每份半升饮水。',
      },
      {
        id: 'dressing',
        name: '密封创伤敷料',
        kind: 'medical',
        medical: 'surgical',
        quantity: 2,
        weight: 0.1,
        value: 25,
        description: '可用于清创包扎。',
      },
    ],
    cash: 160,
    debt: 0,
    debtTo: '',
    location: 'dock',
    rationale: '个人积攒的装备和现金，无借贷。技术专业强，交涉和战斗没有额外训练。',
    opening: {
      title: '码头，抽水棚外',
      text: '叶遥把一只旧手套放在棚边的铁栏上。“这是从他值班的船上找到的。那天的记录还在，你要先看吗？”水管仍在震动。她等着你的回答。',
      facts: ['搭档失踪前去过抽水棚，具体原因未知。'],
      contacts: [
        {
          id: `yao-${name}`,
          name: '叶遥',
          kind: 'person',
          location: 'dock',
          description: '搭档的姐姐，拿着值班记录等你。',
          faction: '独立',
        },
      ],
    },
  });
}
// A deterministic director only for protocol/UI tests. Real dsh coverage is scripts/smoke-creation.ts.
export const fixtureDirector: Director = {
  async plan() {
    return emptyPlan('测试动作');
  },
  async create(s, id, message) {
    const draft = structuredClone(
      s.workshops[id].draft ?? diverDraft(message.includes('同伴') ? '同伴' : '沈沅'),
    );
    if (message.includes('六米')) {
      draft.abilities[0].limits = '接触连续金属、六米、十秒，不能穿过断裂、不能识别人名。';
      draft.abilities[0].cost = 3;
    }
    return {
      text: message.includes('六米')
        ? '改为六米、基础能耗三点。其他装备、身份和无欠款的约定都保留。'
        : '这个角色可以成立。你在水下有专业经验，振动感知能提供线索，但仍要自己判断。装备来自你的积蓄，无债务，也没有步枪。请看草案，继续改或以此开局。',
      draft,
      questions: [],
    };
  },
  async respond(s, id, intent) {
    const c = s.characters.find((c) => c.id === id)!;
    if (intent.includes('新增专长'))
      return {
        tool: 'amend',
        text: '将已掌握的专业单独记下，避免混用一般维修训练。',
        reason: '玩家补充过去的工作经历，未改变已发生的结果。',
        changes: {
          expertise: [
            ...c.expertise,
            {
              name: '船舶焊接',
              attribute: 'INT',
              training: 20,
              scope: '有焊机时处理船用金属结构。',
            },
          ],
        },
      };
    if (intent.includes('为什么') || intent.includes('场外'))
      return {
        tool: 'reply',
        text: '金属传振需要接触连续金属，范围以角色档案为准。水下切割是你的专业，无法代替没有工具的工作。',
      };
    if (intent.includes('打招呼')) {
      const p = emptyPlan('和叶遥说话', 1);
      p.success.text = '叶遥点头，把值班记录朝你转过来。“先从你最熟悉的部分看吧。”';
      p.success.effects = [{ type: 'fact', text: '叶遥愿意一起核对值班记录。', private: false }];
      return p;
    }
    const p = emptyPlan('接触铁栏，分辨机械震动', 0.2);
    p.skill = 'resonance';
    p.power = 'sense';
    p.abilityId = c.abilities[0].id;
    p.method = '握住结晶，接触完整栏杆，听辨附近的机械节奏。';
    p.risks = ['能耗与负荷照档案结算，震动不等于看见来源。'];
    p.success = {
      text: '较慢的周期来自棚内，水管上的震动更急。你分清了两种节奏，尚不知道是哪台机器。',
      effects: [{ type: 'fact', text: '抽水棚有两种不同的机械振动。', private: false }],
    };
    p.failure.text = '水管噪声盖住了其他节奏，你没有分辨出稳定方向。';
    return p;
  },
};
