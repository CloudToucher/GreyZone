<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchFile, saveFile } from '../lib/api'
import { usePlayerStore } from '../stores/players'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()
const round = useRoundStore()
const ply = usePlayerStore()

type PlaygroundSectionKey = 'public' | 'dm-note' | 'long-term' | 'trigger'

interface PlaygroundSection {
  key: PlaygroundSectionKey
  title: string
  hint: string
  badge: string
  color: string
}

interface ParsedAction {
  id: string
  lineIdx: number
  player: string
  sectionKey: PlaygroundSectionKey
  sectionTitle: string
  content: string
  raw: string
}

const SECTIONS: PlaygroundSection[] = [
  {
    key: 'public',
    title: '本轮公开行动',
    hint: '所有人共享的本轮行动与上下文。',
    badge: '公开',
    color: 'text-forest-700 border-forest-600 bg-forest-50',
  },
  {
    key: 'dm-note',
    title: '本轮仅供DM参考（非强隔离）',
    hint: '只是礼貌分区。本地协作阶段不做真实隐私隔离。',
    badge: 'DM参考',
    color: 'text-navy-700 border-navy-600 bg-navy-50',
  },
  {
    key: 'long-term',
    title: '长期备注 / 待确认',
    hint: '不会立刻执行，但想让 DM 保留在上下文里的事项。',
    badge: '长期',
    color: 'text-ochre-700 border-ochre-600 bg-ochre-50',
  },
  {
    key: 'trigger',
    title: '等待触发的预案',
    hint: '条件触发式的预案、应对方案或保底动作。',
    badge: '预案',
    color: 'text-paper-700 border-paper-500 bg-paper-100',
  },
]

const SECTION_BY_TITLE = new Map(SECTIONS.map((section) => [section.title, section]))
const SECTION_BY_KEY = new Map(SECTIONS.map((section) => [section.key, section]))

const text = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const err = ref<string | null>(null)
const showAddForm = ref(false)
const newContent = ref('')
const newSection = ref<PlaygroundSectionKey>('public')
const activeTab = ref<'actions' | 'raw'>('actions')
const intent = ref('')
const approach = ref('')
const desiredOutcome = ref('')
const riskNotes = ref('')
const secretNotes = ref('')

function buildPlaygroundTemplate(playerName: string) {
  return [
    '# Playground — 共享行动板：《灰区：撤离》',
    '',
    '> 这是共享文本板。网站负责按玩家分区组织输入，不提供真实权限隔离。',
    '',
    '---',
    '',
    `## ${SECTION_BY_KEY.get('public')!.title}`,
    `### ${playerName}`,
    '- ',
    '',
    '---',
    '',
    `## ${SECTION_BY_KEY.get('dm-note')!.title}`,
    `### ${playerName}`,
    '- ',
    '',
    '---',
    '',
    `## ${SECTION_BY_KEY.get('long-term')!.title}`,
    `### ${playerName}`,
    '- ',
    '',
    '---',
    '',
    `## ${SECTION_BY_KEY.get('trigger')!.title}`,
    `### ${playerName}`,
    '- 若 [条件]，则 [行动]',
    '',
  ].join('\n')
}

function ensureBoardShape(raw: string, playerName: string) {
  let normalized = raw.trim() ? raw : buildPlaygroundTemplate(playerName)
  for (const section of SECTIONS) {
    normalized = ensureSectionPlayerBlock(normalized, section.key, playerName)
  }
  return normalized.replace(/\n{3,}/g, '\n\n')
}

const parsedActions = computed<ParsedAction[]>(() => {
  const lines = text.value.split('\n')
  const result: ParsedAction[] = []
  let section: PlaygroundSection | null = null
  let player = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      section = SECTION_BY_TITLE.get(line.replace(/^##\s+/, '').trim()) || null
      player = ''
      continue
    }
    if (line.startsWith('### ')) {
      player = line.replace(/^###\s+/, '').trim()
      continue
    }
    const bullet = line.match(/^[-*]\s+(.+)/)
    if (!section || !player || !bullet || !bullet[1].trim()) continue
    result.push({
      id: `${section.key}-${player}-${i}`,
      lineIdx: i,
      player,
      sectionKey: section.key,
      sectionTitle: section.title,
      content: bullet[1].trim(),
      raw: line,
    })
  }
  return result
})

const groupedActions = computed(() =>
  SECTIONS.map((section) => ({
    section,
    actions: parsedActions.value.filter((entry) => entry.sectionKey === section.key),
  })).filter((group) => group.actions.length > 0),
)

async function load() {
  loading.value = true
  err.value = null
  try {
    const f = await fetchFile('player', 'playground.md', { player: ply.currentName })
    const normalized = ensureBoardShape(f.content, ply.currentName)
    text.value = normalized
    original.value = normalized
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (text.value === original.value) return
  saving.value = true
  err.value = null
  try {
    await saveFile('player', 'playground.md', text.value, { player: ply.currentName })
    original.value = text.value
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    saving.value = false
  }
}

function buildIntentPayload() {
  const parts = [
    '## 当前玩家',
    ply.currentName,
    '',
    '## 玩家本轮意图',
    intent.value.trim() || '（未填写，按共享行动板内容理解）',
    '',
    '## 行动方式',
    approach.value.trim() || '（未指定）',
    '',
    '## 期望结果',
    desiredOutcome.value.trim() || '（未指定）',
    '',
    '## 风险接受与补充说明',
    riskNotes.value.trim() || '（无）',
  ]

  if (secretNotes.value.trim()) {
    parts.push('', '## 仅供DM参考的补充说明', secretNotes.value.trim())
  }

  parts.push('', '## 共享行动板快照', text.value.trim() || '（空）')

  return parts.join('\n')
}

async function submit() {
  await save()
  if (err.value) return
  await round.startRound({
    action: buildIntentPayload(),
    character: ply.currentCharacterPath || undefined,
    kind: 'action',
  })
}

function ensureSectionPlayerBlock(source: string, sectionKey: PlaygroundSectionKey, playerName: string) {
  const section = SECTION_BY_KEY.get(sectionKey)!
  const sectionHeading = `## ${section.title}`
  const playerHeading = `### ${playerName}`

  if (!source.includes(sectionHeading)) {
    return `${source.trimEnd()}\n\n---\n\n${sectionHeading}\n${playerHeading}\n`
  }

  const sectionStart = source.indexOf(sectionHeading)
  const nextSection = source.indexOf('\n## ', sectionStart + sectionHeading.length)
  const sectionEnd = nextSection === -1 ? source.length : nextSection
  const sectionBlock = source.slice(sectionStart, sectionEnd)
  if (sectionBlock.includes(playerHeading)) return source

  const insertion = `${sectionBlock.trimEnd()}\n${playerHeading}\n`
  return `${source.slice(0, sectionStart)}${insertion}${source.slice(sectionEnd)}`
}

function insertIntoPlayerSection(
  source: string,
  sectionKey: PlaygroundSectionKey,
  playerName: string,
  content: string,
) {
  const prepared = ensureSectionPlayerBlock(source, sectionKey, playerName)
  const section = SECTION_BY_KEY.get(sectionKey)!
  const sectionHeading = `## ${section.title}`
  const playerHeading = `### ${playerName}`
  const sectionStart = prepared.indexOf(sectionHeading)
  const nextSection = prepared.indexOf('\n## ', sectionStart + sectionHeading.length)
  const sectionEnd = nextSection === -1 ? prepared.length : nextSection
  const sectionBlock = prepared.slice(sectionStart, sectionEnd)
  const playerStart = sectionBlock.indexOf(playerHeading)
  const playerAbsolute = sectionStart + playerStart
  const afterPlayer = prepared.indexOf('\n', playerAbsolute) + 1
  const nextPlayer = prepared.indexOf('\n### ', afterPlayer)
  const insertAt =
    nextPlayer !== -1 && nextPlayer < sectionEnd
      ? nextPlayer
      : sectionEnd
  const prefix = prepared.slice(0, insertAt).replace(/\s*$/, '\n')
  const suffix = prepared.slice(insertAt).replace(/^\n*/, '\n')
  return `${prefix}- ${content.trim()}\n${suffix}`.replace(/\n{3,}/g, '\n\n')
}

function addAction() {
  if (!newContent.value.trim()) return
  text.value = insertIntoPlayerSection(text.value, newSection.value, ply.currentName, newContent.value)
  newContent.value = ''
  showAddForm.value = false
}

function removeAction(lineIdx: number, oldText: string) {
  const lines = text.value.split('\n')
  if (lines[lineIdx]?.trim() === oldText.trim()) {
    lines.splice(lineIdx, 1)
    text.value = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  }
}

function quickInsert(template: string) {
  newContent.value = template
  showAddForm.value = true
}

async function onPlayerChange(e: Event) {
  ply.setPlayer((e.target as HTMLSelectElement).value)
  await ws.loadTree()
  if (ply.currentCharacterPath) {
    ws.openFile(ply.currentCharacterPath).catch(() => {})
  } else {
    ws.goHome()
  }
  await load()
}

const submitting = computed(() => round.status === 'running' || round.status === 'starting')
const dirty = computed(() => text.value !== original.value)

const TEMPLATES = [
  { label: '射击', t: '用 [武器] 射击 [目标]，瞄准 [部位]（在[掩体]后）' },
  { label: '移动', t: '移动到 [位置]，采取 [半掩体/全掩体] 姿态' },
  { label: '搜索', t: '[快速/标准/彻底] 搜索 [区域/尸体/箱子]' },
  { label: '对话', t: '对 [NPC] 说："[内容]"' },
  { label: '撤离', t: '前往 [撤离点]，激活撤离信号' },
  { label: '检定', t: '投 [技能/属性] 检定：[目标]' },
  { label: '使用物品', t: '使用 [物品] 于 [目标/自己]' },
  { label: '观察', t: '[聆听/侦察] [方向/目标]，获取情报' },
]

const playerSectionOptions = computed(() =>
  SECTIONS.map((section) => ({
    value: section.key,
    label: section.badge,
  })),
)

onMounted(load)
watch(() => round.status, (s) => {
  if (s === 'done') load()
})
watch(() => ply.currentName, () => {
  load()
})
</script>

<template>
  <div class="clash-grid-accent flex h-full flex-col bg-paper-100">
    <div class="clash-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="stamp border-white/60 text-white">共享行动板</span>
        <span v-if="dirty" class="rounded-sm bg-ochre-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">未保存</span>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 rounded-sm border border-white/20 bg-white/10 px-1.5 py-0.5">
          <span class="font-mono text-[10px] uppercase tracking-widest text-white/70">AS</span>
          <select :value="ply.currentName" @change="onPlayerChange"
            class="bg-transparent font-mono text-[11px] font-bold text-white focus:outline-none">
            <option v-for="p in ply.roster" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <button @click="save" :disabled="!dirty || saving"
          class="rounded-sm border border-white/30 bg-white px-2.5 py-0.5 font-mono text-[10px] font-bold text-paper-950 hover:bg-paper-200 disabled:opacity-40">
          {{ saving ? '...' : '保存' }}
        </button>
        <button @click="submit" :disabled="submitting"
          class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-0.5 font-mono text-[10px] font-bold text-paper-950 hover:bg-ochre-400 disabled:opacity-40">
          {{ submitting ? '⏳ DM处理中' : '提交给 DM →' }}
        </button>
      </div>
    </div>

    <div class="clash-subbar flex items-center gap-1 px-3 py-1">
      <button @click="activeTab = 'actions'"
        class="clash-tab px-2.5 py-1 font-mono text-[11px] transition"
        :class="activeTab === 'actions' ? 'active' : 'idle'">
        语义卡片
      </button>
      <button @click="activeTab = 'raw'"
        class="clash-tab px-2.5 py-1 font-mono text-[11px] transition"
        :class="activeTab === 'raw' ? 'active' : 'idle'">
        原文编辑
      </button>
      <span class="mx-2 h-4 w-px bg-paper-300"></span>
      <button @click="showAddForm = !showAddForm"
        class="rounded-sm border border-crimson-300 bg-white px-2.5 py-0.5 font-mono text-[10px] font-bold text-crimson-700 hover:bg-crimson-50 transition">
        + 新语义条目
      </button>
    </div>

    <div v-if="activeTab === 'actions'" class="clash-subbar flex flex-wrap items-center gap-1 px-3 py-1.5">
      <span class="font-mono text-[9px] uppercase tracking-widest text-paper-500">引导语</span>
      <button v-for="t in TEMPLATES" :key="t.label" @click="quickInsert(t.t)"
        class="rounded-sm border border-paper-300 bg-white px-1.5 py-0.5 font-mono text-[9px] font-bold text-paper-700 hover:border-crimson-400 hover:text-crimson-700 transition">
        {{ t.label }}
      </button>
    </div>

    <div v-if="showAddForm" class="border-b border-crimson-200 bg-gradient-to-r from-crimson-50 to-white px-3 py-2">
      <div class="flex gap-2">
        <textarea v-model="newContent" rows="2"
          class="clash-textarea flex-1 resize-none px-2 py-1 font-mono text-[12px] placeholder-paper-400"
          placeholder="写下你要追加到共享板里的语义..."
          @keydown.ctrl.enter="addAction()" />
        <div class="flex flex-col gap-1.5">
          <select v-model="newSection"
            class="clash-select px-1.5 py-1 font-mono text-[10px] text-paper-800">
            <option v-for="section in playerSectionOptions" :key="section.value" :value="section.value">{{ section.label }}</option>
          </select>
          <button @click="addAction()"
            class="rounded-sm bg-crimson-600 px-2 py-1 font-mono text-[10px] font-bold text-white hover:bg-crimson-700">
            添加
          </button>
          <button @click="showAddForm = false"
            class="rounded-sm border border-paper-300 bg-white px-2 py-0.5 font-mono text-[10px] text-paper-500 hover:text-paper-800">
            取消
          </button>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="p-4 font-mono text-xs text-paper-500">载入中...</div>
      <div v-else-if="err" class="m-3 rounded border-l-4 border-crimson-600 bg-crimson-50 px-3 py-2 font-mono text-xs text-crimson-700">{{ err }}</div>

      <div v-else-if="activeTab === 'actions'" class="p-3 space-y-4">
        <div class="clash-panel space-y-3 p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-crimson-700">意图优先提交</div>
              <div class="font-sans text-[12px] text-paper-700">网站只是在组织共享文本，不是在限制你能做什么。</div>
            </div>
          </div>
          <div class="grid gap-3 lg:grid-cols-2">
            <label class="space-y-1">
              <div class="font-mono text-[10px] text-paper-700">我想做什么</div>
              <textarea v-model="intent" rows="3"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：我想借着交谈拖住对方，同时观察他是否有同伙埋伏。" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] text-paper-700">我打算怎么做</div>
              <textarea v-model="approach" rows="3"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：先试探，再逐步施压，尽量不立刻开火。" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] text-paper-700">我希望达成什么结果</div>
              <textarea v-model="desiredOutcome" rows="2"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：确认货物位置，并保留撤退余地。" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] text-paper-700">风险接受与补充说明</div>
              <textarea v-model="riskNotes" rows="2"
                class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
                placeholder="例：可以受轻伤，但不要暴露长期据点。" />
            </label>
          </div>
          <label class="block space-y-1">
            <div class="font-mono text-[10px] text-paper-700">仅供DM参考的补充说明</div>
            <textarea v-model="secretNotes" rows="2"
              class="clash-textarea w-full resize-y px-2 py-1 font-sans text-[12px]"
              placeholder="这里只是礼貌分区，不提供真实强隐私。" />
          </label>
        </div>

        <div class="clash-note rounded-sm px-3 py-2 text-[12px] leading-relaxed">
          共享板按玩家分区写入。<span class="font-semibold">“仅供DM参考”</span> 只是文本礼貌区，不代表真实权限隔离。
        </div>

        <div v-for="group in groupedActions" :key="group.section.key" class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="h-4 w-1 rounded-sm bg-crimson-600"></span>
            <span class="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-paper-700">{{ group.section.title }}</span>
            <span class="rounded-sm px-1 py-px font-mono text-[8px] font-bold uppercase border" :class="group.section.color">
              {{ group.section.badge }}
            </span>
          </div>
          <div class="text-[11px] text-paper-500">{{ group.section.hint }}</div>

          <div class="grid gap-2">
            <div v-for="a in group.actions" :key="a.id"
              class="clash-card group relative flex items-start gap-3 p-2.5 transition hover:border-crimson-300">
              <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[10px] font-bold text-white"
                :style="{ background: ply.roster.find((p) => p.name === a.player)?.color || '#64748b' }">
                {{ a.player.slice(0, 1) }}
              </div>

              <div class="min-w-0 flex-1">
                <div class="mb-0.5 flex items-center gap-2">
                  <span class="font-mono text-[11px] font-bold text-paper-900">{{ a.player }}</span>
                  <span class="rounded-sm px-1 py-px font-mono text-[8px] font-bold uppercase border" :class="group.section.color">
                    {{ group.section.badge }}
                  </span>
                </div>
                <div class="font-sans text-[12px] leading-relaxed text-paper-800">{{ a.content }}</div>
              </div>

              <button @click="removeAction(a.lineIdx, a.raw)"
                v-if="a.player === ply.currentName || ply.isDM"
                class="shrink-0 font-mono text-[10px] text-paper-400 opacity-0 transition group-hover:opacity-100 hover:text-crimson-600"
                title="移除此条目">
                ✕
              </button>
            </div>
          </div>
        </div>

        <div class="clash-card p-3">
          <div class="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-700">提交预览</div>
          <pre class="max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-sm bg-paper-100 p-3 font-sans text-[12px] leading-relaxed text-paper-700">{{ buildIntentPayload() }}</pre>
        </div>

        <div v-if="parsedActions.length === 0 && !loading"
          class="flex flex-col items-center justify-center py-8 text-center">
          <div class="mb-2 text-3xl text-paper-300">◆</div>
          <div class="font-mono text-xs text-paper-500">暂无条目，点「+ 新语义条目」把你的行动或上下文写进共享板。</div>
          <div class="mt-1 font-mono text-[10px] text-paper-400">Ctrl+Enter 快速添加</div>
        </div>
      </div>

      <textarea v-else-if="activeTab === 'raw'" v-model="text" spellcheck="false"
        class="clash-grid-accent h-full w-full resize-none border-0 bg-paper-100 px-4 py-3 font-mono text-[12px] leading-relaxed text-paper-900 focus:outline-none"
        placeholder="直接编辑 playground.md ..." />
    </div>
  </div>
</template>
