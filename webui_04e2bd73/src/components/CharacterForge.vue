<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoundStore } from '../stores/round'
import { usePlayerStore } from '../stores/players'

const round = useRoundStore()
const ply = usePlayerStore()

const concept = ref('')
const identity = ref('')
const motivation = ref('')
const strength = ref('')
const storyTone = ref('')
const signatureWish = ref('')
const weaknesses = ref('')
const boundaries = ref('')
const extraNotes = ref('')
const fileHint = ref('')

const STRENGTH_OPTIONS = [
  '低强度开局',
  '标准开局',
  '中高强度开局',
  '高风险高回报开局',
]

const TONE_OPTIONS = [
  '压抑写实',
  '黑色行动',
  '肮脏求生',
  '诡异调查',
  '偏战术军事',
  '偏人际博弈',
]

const promptPreview = computed(() => buildForgePrompt())
const submitting = computed(() => round.status === 'running' || round.status === 'starting')

function togglePreset(field: 'strength' | 'storyTone', value: string) {
  const target = field === 'strength' ? strength : storyTone
  target.value = target.value === value ? '' : value
}

function insertExample(field: 'concept', text: string) {
  if (field === 'concept') {
    concept.value = concept.value ? `${concept.value}\n${text}` : text
  }
}

function buildForgePrompt() {
  const outputFile = (fileHint.value.trim() || '新角色').replace(/[\\/:*?"<>|]+/g, '_')

  return [
    '# 灰区：撤离 — 创角请求',
    '',
    '你是 AI DM。你的任务不是让玩家去套职业模板，而是根据玩家想扮演的人设、强度要求、风格要求和世界约束，生成一个可直接投入游戏的初始角色。',
    '',
    '## 创角原则',
    '1. 玩家输入优先，允许模糊、留白和不完整。',
    '2. 你负责给出合理的开局强度、初始资源、标志性装备、代价与隐患。',
    '3. 不要机械套用旧职业模板；可以参考世界风格，但不要把玩家锁进固定职业。',
    '4. 所有内容保持纯文本、可叙事、可让后续 DM 继续接管。',
    `5. 生成结果写入 characters/active/${outputFile}.md。`,
    '6. 结果必须同时适合玩家阅读、适合 UI 提取 frontmatter、适合后续回合继续更新。',
    '',
    '## 输出与落档要求',
    '1. 创建或覆盖目标角色卡文件。',
    '2. 文件顶部必须包含 YAML frontmatter，至少提供：name, level, hp, sp, ap, attributes。',
    '3. 正文使用完整角色卡形式，至少包含：基本信息、装备、安全箱、背包、状态、基地状态、角色笔记。',
    '4. 初始装备、资源、负债、关系、隐患由你根据玩家设定裁定。',
    '5. 可以给出不完美但强叙事性的开局，不要求数值绝对平衡，但要与玩家要求强度匹配。',
    '',
    '## 面向玩家的回应协议（严格遵守以下标题）',
    '## 角色概念',
    '## 初始状态',
    '## 起始装备',
    '## 优势',
    '## 代价与隐患',
    '## 当前处境',
    '## 已写入文件',
    '',
    '## 绑定玩家',
    ply.currentName,
    '',
    '## 玩家自由设想',
    concept.value.trim() || '（未填写）',
    '',
    '## 身份 / 背景倾向',
    identity.value.trim() || '（未指定）',
    '',
    '## 动机 / 想玩的方向',
    motivation.value.trim() || '（未指定）',
    '',
    '## 希望的开局强度',
    strength.value.trim() || '（未指定，按概念合理裁定）',
    '',
    '## 希望的故事风格',
    storyTone.value.trim() || '（未指定）',
    '',
    '## 想要的标志性装备 / 资源感',
    signatureWish.value.trim() || '（未指定）',
    '',
    '## 可以接受的缺陷 / 代价',
    weaknesses.value.trim() || '（未指定，由你酌情加入）',
    '',
    '## 边界 / 不想出现的内容',
    boundaries.value.trim() || '（无特别说明）',
    '',
    '## 补充备注',
    extraNotes.value.trim() || '（无）',
  ].join('\n')
}

async function submitForge() {
  await round.startRound({
    action: concept.value.trim() || '创角请求',
    kind: 'forge',
    forge: {
      concept: concept.value,
      identity: identity.value,
      motivation: motivation.value,
      strength: strength.value,
      storyTone: storyTone.value,
      signatureWish: signatureWish.value,
      weaknesses: weaknesses.value,
      boundaries: boundaries.value,
      extraNotes: extraNotes.value,
      fileHint: fileHint.value,
    },
  })
}
</script>

<template>
  <div class="clash-grid-accent flex h-full flex-col bg-paper-100">
    <div class="clash-toolbar px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ochre-300">CHARACTER FORGE</div>
          <h2 class="mt-1 font-serif text-xl font-black text-white">自由创角</h2>
          <p class="mt-1 max-w-3xl font-sans text-sm leading-relaxed text-white/80">
            这里不是职业表单。你只需要尽可能表达你想扮演什么人、想体验什么强度与气质，AI DM 会据此生成可直接游玩的初始角色与装备。
          </p>
        </div>
        <button @click="submitForge" :disabled="submitting"
          class="rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-2 font-mono text-[11px] font-bold text-paper-950 hover:bg-ochre-400 disabled:opacity-40">
          {{ submitting ? '生成中...' : '交给 DM 生成角色 →' }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div class="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-4">
          <div class="clash-panel p-4">
            <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-crimson-700">核心设想</div>
            <label class="block space-y-1">
              <div class="font-mono text-[11px] text-paper-700">你想演什么人</div>
              <textarea v-model="concept" rows="6"
                class="clash-textarea w-full resize-y px-3 py-2 font-sans text-[13px] leading-relaxed"
                placeholder="例：一个逃亡中的前帝国军官，擅长指挥和火器，身上还带着旧时代的战术习惯。我不想演纯粹的英雄，更像是一个为了活下去而不断做选择的人。" />
            </label>
            <div class="mt-3 flex flex-wrap gap-2">
              <button @click="insertExample('concept', '一个熟悉前线、厌恶命令体系的撤离老兵。')"
                class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold text-paper-700 hover:border-crimson-500 hover:text-crimson-700">
                老兵范例
              </button>
              <button @click="insertExample('concept', '一个靠危险知识换生路的怪异学者，身体很弱但知道禁忌。')"
                class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold text-paper-700 hover:border-crimson-500 hover:text-crimson-700">
                学者范例
              </button>
              <button @click="insertExample('concept', '一个看似圆滑的灰区掮客，实际背着一笔快要爆的旧债。')"
                class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold text-paper-700 hover:border-crimson-500 hover:text-crimson-700">
                掮客范例
              </button>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">身份 / 背景倾向</div>
              <textarea v-model="identity" rows="4"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：灾前做过什么、来自哪里、最擅长什么、有什么旧关系。" />
            </label>

            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">动机 / 想玩的方向</div>
              <textarea v-model="motivation" rows="4"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：找人、还债、求生、复仇、调查真相、证明自己。" />
            </label>
          </div>

          <div class="clash-panel navy p-4 space-y-3">
            <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-500">强度与风格</div>
            <div>
              <div class="mb-2 font-mono text-[11px] text-paper-700">开局强度</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in STRENGTH_OPTIONS" :key="opt" @click="togglePreset('strength', opt)"
                  class="rounded-sm border px-2.5 py-1 font-mono text-[10px] transition"
                  :class="strength === opt ? 'border-crimson-600 bg-crimson-600 text-white' : 'border-paper-300 bg-white text-paper-600 hover:border-crimson-500 hover:text-crimson-700'">
                  {{ opt }}
                </button>
              </div>
              <textarea v-model="strength" rows="2"
                class="clash-textarea mt-2 w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="你也可以直接自由描述强度要求。" />
            </div>
            <div>
              <div class="mb-2 font-mono text-[11px] text-paper-700">故事风格</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in TONE_OPTIONS" :key="opt" @click="togglePreset('storyTone', opt)"
                  class="rounded-sm border px-2.5 py-1 font-mono text-[10px] transition"
                  :class="storyTone === opt ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-600 hover:border-navy-600 hover:text-navy-800'">
                  {{ opt }}
                </button>
              </div>
              <textarea v-model="storyTone" rows="2"
                class="clash-textarea mt-2 w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="也可以混合描述，比如：压抑写实，但允许偶尔出现诡异感。" />
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">想要的标志性装备 / 资源感</div>
              <textarea v-model="signatureWish" rows="4"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：我想有一件标志性装备，但不要无敌；或者资源很紧，但有一件特别值钱的东西。" />
            </label>

            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">可接受的缺陷 / 代价</div>
              <textarea v-model="weaknesses" rows="4"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：可以负债、旧伤、被追踪、缺乏补给、有人情债，但不要一开局就残废。" />
            </label>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">边界 / 不想出现的内容</div>
              <textarea v-model="boundaries" rows="3"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：不要过度羞辱，不要强制恋爱，不要一开局失去行动能力。" />
            </label>

            <label class="clash-card p-3 space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">文件名提示（可空）</div>
              <input v-model="fileHint"
                class="clash-input w-full px-2 py-1 font-mono text-[12px]"
                placeholder="例如：灰犬 / 交涉官_试验版 / YAN_01" />
              <div class="font-sans text-[11px] text-paper-500">用于建议 AI 把角色写入哪个角色卡文件，可留空。</div>
            </label>
          </div>

          <label class="clash-card block p-3 space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">补充备注</div>
            <textarea v-model="extraNotes" rows="4"
              class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
              placeholder="任何你觉得重要但上面没覆盖到的内容，都可以写在这里。" />
          </label>
        </div>

        <div class="space-y-4">
          <div class="clash-card overflow-hidden">
            <div class="clash-card-header flex items-center justify-between gap-2 px-4 py-3">
              <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">提交给 DM 的组织结果</div>
              <span class="stamp border-white/50 text-white">PROMPT PREVIEW</span>
            </div>
            <pre class="max-h-[70vh] overflow-auto whitespace-pre-wrap bg-paper-100 p-4 font-sans text-[12px] leading-relaxed text-paper-800">{{ promptPreview }}</pre>
          </div>

          <div class="clash-panel navy p-4">
            <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-navy-800">设计说明</div>
            <ul class="mt-2 list-disc space-y-1 pl-5 font-sans text-[12px] leading-relaxed text-paper-700">
              <li>交互项只是帮助你表达，不是职业模板。</li>
              <li>你可以只写一段核心设想，其余全部留空。</li>
              <li>也可以尽量详细描述，DM 会按强度和世界感帮你补全初始装备与代价。</li>
              <li>生成完成后，角色会被写入 <code class="rounded bg-white px-1 font-mono text-[11px]">characters/active/</code>。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
