<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { fetchFile, type FilePayload } from '../lib/api'
import { isCharacterPath, parseCharacterSemanticState, type SafeBoxSlot } from '../lib/charsheet'
import { useWorkspaceStore } from '../stores/workspace'
import { usePlayerStore } from '../stores/players'

const ws = useWorkspaceStore()
const ply = usePlayerStore()

interface Facility { name: string; level: number; maxLevel: number; icon: string; desc: string }
interface NPC { name: string; relation: string; note: string }

const loading = ref(false)
const err = ref<string | null>(null)
const charData = ref<FilePayload | null>(null)

const facilities = ref<Facility[]>([
  { name: '医疗室', level: 0, maxLevel: 3, icon: '⚕', desc: '缩短恢复时间 / 解锁高级治疗' },
  { name: '工坊', level: 0, maxLevel: 3, icon: '⚒', desc: '维修装备 / 制作弹药 / 改装武器' },
  { name: '军械库', level: 0, maxLevel: 3, icon: '♜', desc: '扩充安全箱 / 存储武器弹药' },
  { name: '情报中心', level: 0, maxLevel: 3, icon: '◉', desc: '解锁区域地图 / 敌人情报 / 任务线索' },
  { name: '生活区', level: 0, maxLevel: 3, icon: '⌂', desc: '更快恢复SP / NPC可留宿 / 士气加成' },
])

const safeBox = ref<SafeBoxSlot[]>([])
const baseInventory = ref<string[]>([])
const npcs = ref<NPC[]>([
  { name: '老高', relation: '债主', note: '铆钉巷军火商，欠他2000信用点' },
  { name: '锯子', relation: '前队友', note: '前线工兵，现在基地附近活动，愿意组队' },
])

const hasChar = ref(false)

async function load() {
  loading.value = true
  err.value = null
  try {
    const targetPath = ws.current && isCharacterPath(ws.current.path)
      ? ws.current.path
      : ply.currentCharacterPath

    if (!targetPath) {
      hasChar.value = false
      charData.value = null
      safeBox.value = []
      baseInventory.value = []
      return
    }

    charData.value = await fetchFile('player', targetPath, { player: ply.currentName })
    hasChar.value = true
    applyCharacterState(charData.value)
  } catch (e: any) {
    hasChar.value = false
    err.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function applyCharacterState(payload: FilePayload) {
  const parsed = parseCharacterSemanticState(payload.frontmatter, payload.content)

  if (parsed.facilities.length) {
    facilities.value = parsed.facilities.map((f) => {
      const existing = facilities.value.find((it) => it.name === f.name)
      return existing
        ? { ...existing, level: f.level }
        : { name: f.name, level: f.level, maxLevel: 3, icon: '?', desc: '' }
    })
  }

  safeBox.value = parsed.safeBox.length
    ? parsed.safeBox
    : [
        { label: '格1', item: '弟弟的照片（任务物品）', empty: false },
        { label: '格2', item: '空', empty: true },
      ]

  baseInventory.value = parsed.baseInventory.map((entry) =>
    entry.qty != null ? `${entry.item} ×${entry.qty}` : entry.item,
  )
}

const levelPct = (f: Facility) => `${(f.level / f.maxLevel) * 100}%`
const levelDots = (f: Facility) => Array.from({ length: f.maxLevel }, (_, i) => i < f.level)

onMounted(load)
watch(() => ws.currentPath, () => {
  load()
})
watch(() => ply.currentCharacterPath, () => {
  load()
})
</script>

<template>
  <div class="clash-grid-accent flex h-full flex-col bg-paper-100">
    <!-- Header -->
    <div class="clash-toolbar flex items-center justify-between gap-3 px-4 py-2">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-sm bg-ochre-600 font-mono text-xs font-bold text-white">⌂</div>
        <div>
          <div class="font-serif text-sm font-bold text-white">围栏基地</div>
          <div class="font-mono text-[9px] uppercase tracking-[0.2em] text-white/60">FENCE OUTPOST</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="live-dot" v-if="!loading && !err"></span>
        <span class="font-mono text-[10px] text-white/75">藏身处</span>
      </div>
    </div>

    <div v-if="loading" class="p-4 font-mono text-xs text-paper-500">读取角色数据...</div>
    <div v-else-if="err" class="m-3 rounded border-l-4 border-crimson-600 bg-crimson-50 px-3 py-2 font-mono text-xs text-crimson-700">{{ err }}</div>
    <div v-else-if="!hasChar" class="m-3 rounded border border-dashed border-paper-300 bg-white px-4 py-3 text-sm text-paper-500">
      当前玩家还没有绑定角色档案，先去「创建角色」生成一份正式档案。
    </div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
      <!-- Facilities -->
      <div class="hud-frame clash-panel ochre p-4">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">设施升级</div>
        <div class="space-y-2">
          <div v-for="f in facilities" :key="f.name" class="data-card !p-2">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-base">{{ f.icon }}</span>
                <span class="font-serif text-[13px] font-bold text-paper-950">{{ f.name }}</span>
                <span class="font-mono text-[9px] font-bold text-paper-500">Lv{{ f.level }}/{{ f.maxLevel }}</span>
              </div>
              <div class="flex gap-0.5">
                <span v-for="(filled, i) in levelDots(f)" :key="i"
                  class="inline-block h-2 w-2 rounded-sm"
                  :class="filled ? 'bg-ochre-600' : 'bg-paper-200'" />
              </div>
            </div>
            <div class="h-1 w-full overflow-hidden rounded-sm bg-paper-200">
              <div class="h-full bg-gradient-to-r from-ochre-600 to-ochre-400 transition-all"
                :style="{ width: levelPct(f) }" />
            </div>
            <div class="mt-1 font-sans text-[11px] text-paper-600">{{ f.desc }}</div>
          </div>
        </div>
      </div>

      <!-- Safe box -->
      <div class="hud-frame clash-panel navy p-4">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex items-center justify-between mb-2">
          <div class="brief-heading !mb-0 !text-sm">安全箱</div>
          <span class="stamp text-ochre-700">{{ safeBox.length }} 格</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div v-for="s in safeBox" :key="s.label"
            class="flex items-center gap-2 rounded-sm border p-2"
            :class="s.empty ? 'border-dashed border-paper-300 bg-paper-50' : 'border-paper-300 bg-white'">
            <span class="font-mono text-[10px] font-bold text-paper-400">{{ s.label }}</span>
            <span class="truncate font-sans text-[12px]" :class="s.empty ? 'text-paper-400 italic' : 'text-paper-800'">
              {{ s.empty ? '(空)' : s.item }}
            </span>
          </div>
        </div>
      </div>

      <!-- Inventory + NPCs row -->
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div class="hud-frame clash-panel p-4">
          <span class="corner-bl"></span><span class="corner-br"></span>
          <div class="brief-heading !mb-2 !text-sm">基地库存</div>
          <div v-if="baseInventory.length === 0" class="font-mono text-[11px] text-paper-500 italic">无库存物品</div>
          <ul v-else class="space-y-1">
            <li v-for="(item, i) in baseInventory" :key="i"
              class="flex items-center gap-2 rounded-sm bg-paper-50 px-2 py-1 font-sans text-[12px] text-paper-800">
              <span class="font-mono text-[9px] text-forest-600">◆</span>
              {{ item }}
            </li>
          </ul>
        </div>

        <div class="hud-frame clash-panel forest p-4">
          <span class="corner-bl"></span><span class="corner-br"></span>
          <div class="brief-heading !mb-2 !text-sm">围栏联系人</div>
          <div class="space-y-2">
            <div v-for="n in npcs" :key="n.name" class="flex items-start gap-2 rounded-sm border border-paper-200 bg-white p-2">
              <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-navy-800 font-mono text-[10px] font-bold text-white">
                {{ n.name.slice(0, 1) }}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-serif text-[12px] font-bold text-paper-950">{{ n.name }}</span>
                  <span class="rounded-sm bg-ochre-100 px-1 py-px font-mono text-[8px] font-bold text-ochre-700">
                    {{ n.relation }}
                  </span>
                </div>
                <div class="mt-0.5 font-sans text-[11px] leading-relaxed text-paper-600">{{ n.note }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Base quick actions -->
      <div class="hud-frame clash-panel navy p-4">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-2 !text-sm">基地行动</div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            v-for="act in [
              { label: '休息恢复', icon: '☽', desc: '恢复HP+SP，推进时间', disabled: false },
              { label: '修理装备', icon: '⚒', desc: '需要工坊Lv1+', disabled: facilities[1].level < 1 },
              { label: '交易', icon: '◈', desc: '与围栏商人交易', disabled: false },
              { label: '收集情报', icon: '◉', desc: '需要情报中心Lv1+', disabled: facilities[3].level < 1 },
            ]"
            :key="act.label"
            :disabled="act.disabled"
            class="flex flex-col items-center gap-1 rounded-sm border border-paper-300 bg-white p-2.5 text-center transition enabled:hover:border-crimson-600 enabled:hover:bg-crimson-50 disabled:opacity-40 disabled:bg-paper-100"
            :class="act.disabled ? '' : 'cursor-pointer'">
            <span class="font-mono text-lg">{{ act.icon }}</span>
            <span class="font-serif text-[12px] font-bold text-paper-950">{{ act.label }}</span>
            <span class="font-sans text-[10px] leading-tight text-paper-500">{{ act.desc }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
