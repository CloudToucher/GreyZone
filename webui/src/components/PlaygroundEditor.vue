<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchFile, saveFile } from '../lib/api'
import { usePlayerStore, type Visibility } from '../stores/players'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()
const round = useRoundStore()
const ply = usePlayerStore()

// ---- State ----
const text = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const err = ref<string | null>(null)
const showAddForm = ref(false)
const newContent = ref('')
const newVisibility = ref<Visibility>('public')
const activeTab = ref<'actions' | 'raw'>('actions')

// ---- Parsed actions from raw markdown ----
interface ParsedAction {
  id: string
  raw: string        // original line
  content: string    // cleaned content
  section: string    // which ## section it belongs to
  lineIdx: number
}

const parsedActions = computed<ParsedAction[]>(() => {
  const lines = text.value.split('\n')
  const result: ParsedAction[] = []
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.match(/^##\s/)) { section = l.replace(/^##\s+/, '').trim(); continue }
    if (l.match(/^###\s/)) { section = l.replace(/^###\s+/, '').trim(); continue }
    const m = l.match(/^[-*]\s+(.+)/)
    if (!m || !m[1].trim()) continue
    result.push({
      id: `a${i}`,
      raw: l,
      content: m[1].trim(),
      section,
      lineIdx: i,
    })
  }
  return result
})

// Group actions by visibility tags embedded in content
// Format: [@player] [public/dm-only/private] 实际内容
// or:     - 实际内容  (defaults to public, current player)
function classify(a: ParsedAction): { player: string; visibility: Visibility; body: string } {
  let body = a.content
  let visibility: Visibility = 'public'
  let player = ply.currentName

  // Match visibility tag
  const vMatch = body.match(/^\s*\[(公开|仅DM|私密)\]\s*/)
  if (vMatch) {
    visibility = vMatch[1] === '仅DM' ? 'dm-only' : vMatch[1] === '私密' ? 'private' : 'public'
    body = body.slice(vMatch[0].length)
  }
  // Match @player tag
  const pMatch = body.match(/^\s*@(\S+)\s*/)
  if (pMatch) {
    player = pMatch[1]
    body = body.slice(pMatch[0].length)
  }
  // Section-based default: 仅DM可见 section = dm-only
  if (a.section.includes('DM可见') || a.section.includes('仅DM')) visibility = 'dm-only'

  return { player, visibility, body }
}

const visibleActions = computed(() =>
  parsedActions.value
    .map((a) => ({ ...a, ...classify(a) }))
    .filter((a) => ply.canSee({ id: a.id, player: a.player, visibility: a.visibility, content: a.body, ts: 0 })),
)

const groupBy = computed(() => {
  const groups: Record<string, typeof visibleActions.value> = { '当前行动': [] }
  for (const a of visibleActions.value) {
    const key = a.section || '当前行动'
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
})

const groupKeys = computed(() => Object.keys(groupBy.value).filter((k) => groupBy.value[k].length > 0))

// ---- IO ----
async function load() {
  loading.value = true
  err.value = null
  try {
    const f = await fetchFile('player', 'playground.md')
    text.value = f.content
    original.value = f.content
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
    await saveFile('player', 'playground.md', text.value)
    original.value = text.value
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    saving.value = false
  }
}

async function submit() {
  await save()
  if (err.value) return
  await round.startRound({ action: text.value })
}

function addAction() {
  if (!newContent.value.trim()) return
  const visTag = newVisibility.value === 'dm-only' ? '[仅DM] ' : newVisibility.value === 'private' ? '[私密] ' : ''
  const playerTag = ply.currentName !== '铁鼠' ? `@${ply.currentName} ` : ''
  const line = `- ${visTag}${playerTag}${newContent.value.trim()}`

  // Insert under ## 待执行行动
  const idx = text.value.indexOf('## 待执行行动')
  if (idx >= 0) {
    const nl = text.value.indexOf('\n', idx)
    text.value = text.value.slice(0, nl + 1) + line + '\n' + text.value.slice(nl + 1)
  } else {
    text.value += '\n' + line
  }
  newContent.value = ''
  showAddForm.value = false
}

function removeAction(lineIdx: number, oldText: string) {
  const lines = text.value.split('\n')
  const target = lines[lineIdx]
  if (target && target.trim() === oldText.trim()) {
    // Remove the line or empty it
    lines[lineIdx] = ''
    text.value = lines.join('\n')
  }
}

function quickInsert(template: string) {
  newContent.value = template
  showAddForm.value = true
}

function onPlayerChange(e: Event) {
  ply.setPlayer((e.target as HTMLSelectElement).value)
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

const VIS_LABELS: Record<Visibility, string> = {
  public: '公开',
  'dm-only': '仅DM',
  private: '私密',
}
const VIS_COLORS: Record<Visibility, string> = {
  public: 'text-forest-700 border-forest-600 bg-forest-50',
  'dm-only': 'text-navy-700 border-navy-600 bg-navy-50',
  private: 'text-ochre-700 border-ochre-600 bg-ochre-50',
}

onMounted(load)
watch(() => round.status, (s) => { if (s === 'done') load() })
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="stamp text-crimson-700">行动板</span>
        <span v-if="dirty" class="rounded-sm bg-ochre-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">未保存</span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Player switcher -->
        <div class="flex items-center gap-1 rounded-sm border border-paper-300 bg-paper-50 px-1.5 py-0.5">
          <span class="font-mono text-[10px] uppercase tracking-widest text-paper-500">AS</span>
          <select :value="ply.currentName" @change="onPlayerChange"
            class="bg-transparent font-mono text-[11px] font-bold text-paper-900 focus:outline-none">
            <option v-for="p in ply.roster" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <button @click="save" :disabled="!dirty || saving"
          class="rounded-sm border-2 border-paper-950 bg-white px-2.5 py-0.5 font-mono text-[10px] font-bold text-paper-950 hover:bg-paper-100 disabled:opacity-40">
          {{ saving ? '...' : '保存' }}
        </button>
        <button @click="submit" :disabled="submitting"
          class="rounded-sm border-2 border-crimson-600 bg-crimson-600 px-3 py-0.5 font-mono text-[10px] font-bold text-white hover:bg-crimson-700 disabled:opacity-40">
          {{ submitting ? '⏳ 本轮中' : '提交本轮 →' }}
        </button>
      </div>
    </div>

    <!-- Tab bar (actions | raw) -->
    <div class="flex items-center gap-1 border-b border-paper-200 bg-paper-50 px-3 py-1">
      <button @click="activeTab = 'actions'"
        class="rounded-sm px-2.5 py-1 font-mono text-[11px] transition"
        :class="activeTab === 'actions' ? 'bg-white border border-paper-300 font-bold text-paper-950' : 'text-paper-500 hover:text-paper-800'">
        卡片视图
      </button>
      <button @click="activeTab = 'raw'"
        class="rounded-sm px-2.5 py-1 font-mono text-[11px] transition"
        :class="activeTab === 'raw' ? 'bg-white border border-paper-300 font-bold text-paper-950' : 'text-paper-500 hover:text-paper-800'">
        原文编辑
      </button>
      <span class="mx-2 h-4 w-px bg-paper-300"></span>
      <button @click="showAddForm = !showAddForm"
        class="rounded-sm border border-crimson-300 bg-crimson-50 px-2.5 py-0.5 font-mono text-[10px] font-bold text-crimson-700 hover:bg-crimson-100 transition">
        + 新行动
      </button>
      <div class="relative ml-auto" v-if="showAddForm === false">
        <!-- Quick templates always visible -->
      </div>
    </div>

    <!-- Quick templates row -->
    <div v-if="activeTab === 'actions'" class="flex flex-wrap items-center gap-1 border-b border-paper-200 bg-paper-50 px-3 py-1">
      <span class="font-mono text-[9px] uppercase tracking-widest text-paper-400">模板</span>
      <button v-for="t in TEMPLATES" :key="t.label" @click="quickInsert(t.t)"
        class="rounded-sm border border-paper-200 bg-white px-1.5 py-0.5 font-mono text-[9px] text-paper-600 hover:border-crimson-400 hover:text-crimson-700 transition">
        {{ t.label }}
      </button>
    </div>

    <!-- Add action form -->
    <div v-if="showAddForm" class="border-b border-crimson-200 bg-crimson-50/50 px-3 py-2">
      <div class="flex gap-2">
        <textarea v-model="newContent" rows="2"
          class="flex-1 resize-none rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[12px] text-paper-900 placeholder-paper-400 focus:border-crimson-600 focus:outline-none"
          placeholder="写下你的行动..."
          @keydown.ctrl.enter="addAction()" />
        <div class="flex flex-col gap-1.5">
          <select v-model="newVisibility"
            class="rounded-sm border border-paper-300 bg-white px-1.5 py-1 font-mono text-[10px] text-paper-800 focus:border-crimson-600">
            <option value="public">公开</option>
            <option value="dm-only">仅DM</option>
            <option value="private">私密</option>
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

    <!-- Main body -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="p-4 font-mono text-xs text-paper-500">载入中...</div>
      <div v-else-if="err" class="m-3 rounded border-l-4 border-crimson-600 bg-crimson-50 px-3 py-2 font-mono text-xs text-crimson-700">{{ err }}</div>

      <!-- Card view -->
      <div v-else-if="activeTab === 'actions'" class="p-3 space-y-4">
        <div v-for="key in groupKeys" :key="key" class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="h-4 w-1 rounded-sm bg-crimson-600"></span>
            <span class="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-paper-700">{{ key }}</span>
            <span class="text-paper-300 text-[10px]">{{ groupBy[key].length }}</span>
          </div>

          <div class="grid gap-2">
            <div v-for="a in groupBy[key]" :key="a.id"
              class="group relative flex items-start gap-3 rounded-sm border bg-white p-2.5 transition"
              :class="{
                'border-paper-300': a.visibility === 'public',
                'border-navy-300 bg-navy-50/40': a.visibility === 'dm-only',
                'border-ochre-300 bg-ochre-50/40': a.visibility === 'private',
              }">
              <!-- Player dot -->
              <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[10px] font-bold text-white"
                :style="{ background: ply.roster.find(p => p.name === a.player)?.color || '#64748b' }">
                {{ a.player.slice(0, 1) }}
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="font-mono text-[11px] font-bold text-paper-900">{{ a.player }}</span>
                  <span class="rounded-sm px-1 py-px font-mono text-[8px] font-bold uppercase border"
                    :class="VIS_COLORS[a.visibility]">
                    {{ VIS_LABELS[a.visibility] }}
                  </span>
                  <span v-if="a.player !== ply.currentName && a.visibility === 'private' && !ply.isDM"
                    class="font-mono text-[10px] text-paper-400">
                    (对方私密)
                  </span>
                </div>
                <div class="font-sans text-[12px] leading-relaxed text-paper-800">{{ a.body }}</div>
              </div>

              <button @click="removeAction(a.lineIdx, a.raw)"
                v-if="a.player === ply.currentName || ply.isDM"
                class="shrink-0 font-mono text-[10px] text-paper-400 opacity-0 group-hover:opacity-100 hover:text-crimson-600 transition"
                title="移除此行动">
                ✕
              </button>
            </div>
          </div>
        </div>

        <div v-if="parsedActions.length === 0 && !loading"
          class="flex flex-col items-center justify-center py-8 text-center">
          <div class="mb-2 text-3xl text-paper-300">◆</div>
          <div class="font-mono text-xs text-paper-500">无行动 — 点「+ 新行动」或选一个模板开始</div>
          <div class="mt-1 font-mono text-[10px] text-paper-400">Ctrl+Enter 快速添加</div>
        </div>
      </div>

      <!-- Raw edit view -->
      <textarea v-else-if="activeTab === 'raw'" v-model="text" spellcheck="false"
        class="h-full w-full resize-none border-0 bg-paper-50 px-4 py-3 font-mono text-[12px] leading-relaxed text-paper-900 focus:outline-none"
        placeholder="直接编辑 playground.md ..." />
    </div>
  </div>
</template>
