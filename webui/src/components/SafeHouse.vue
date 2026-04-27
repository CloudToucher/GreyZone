<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchFile, type FilePayload } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()

interface Facility { name: string; level: number; maxLevel: number; icon: string; desc: string }
interface SafeBoxSlot { label: string; item: string; empty: boolean }
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
  { name: '老高', relation: '债主', note: '骡子胡同军火商，欠他2000信用点' },
  { name: '锯子', relation: '前队友', note: '前线工兵，现在基地附近活动，愿意组队' },
])

const hasChar = ref(false)

async function load() {
  loading.value = true
  err.value = null
  try {
    // Look for active character file to parse base/facility data
    const chars = ['characters/active/示例_铁鼠.md']
    for (const cp of chars) {
      try {
        charData.value = await fetchFile('player', cp)
        hasChar.value = true
        parseCharSheet(charData.value.content)
        break
      } catch {
        continue
      }
    }
    if (!charData.value) hasChar.value = false
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

function parseCharSheet(content: string) {
  // Parse base facilities
  const facMatches = content.match(/\|\s*(医疗室|工坊|军械库|情报中心|生活区)\s*\|\s*(\d+)\s*\|/g)
  if (facMatches) {
    const newF: Facility[] = []
    for (const m of facMatches) {
      const parts = m.split('|').map((s) => s.trim())
      const name = parts[1]
      const level = parseInt(parts[2], 10)
      const existing = facilities.value.find((f) => f.name === name)
      newF.push(existing
        ? { ...existing, level: Number.isNaN(level) ? 0 : level }
        : { name, level: 0, maxLevel: 3, icon: '?', desc: '' })
    }
    if (newF.length) facilities.value = newF
  }

  // Parse safe box
  safeBox.value = []
  const sbSection = content.match(/###\s*安全箱[\s\S]*?(?=\n##|\n---|$)/)
  if (sbSection) {
    const lines = sbSection[0].split('\n')
    for (const l of lines) {
      const m = l.match(/\|\s*(?:格\d+|(\d+))\s*\|\s*(.+?)\s*\|/)
      if (m) {
        const item = m[2]?.trim() || ''
        safeBox.value.push({ label: m[1] || String(safeBox.value.length + 1), item, empty: !item || item === '空' || item === '—' })
      }
    }
  }
  if (safeBox.value.length === 0) {
    safeBox.value = [
      { label: '格1', item: '弟弟的照片（任务物品）', empty: false },
      { label: '格2', item: '空', empty: true },
    ]
  }

  // Parse base inventory
  baseInventory.value = []
  const invSection = content.match(/###\s*基地库存[\s\S]*?(?=\n##|\n---|$)/)
  if (invSection) {
    const lines = invSection[0].split('\n')
    for (const l of lines) {
      const m = l.match(/\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|/)
      if (m && m[1].trim() && m[1].trim() !== '物品' && !m[1].match(/（空）|^\s*$/)) {
        baseInventory.value.push(`${m[1].trim()} ×${m[2].trim()}`)
      }
    }
  }
}

const levelPct = (f: Facility) => `${(f.level / f.maxLevel) * 100}%`
const levelDots = (f: Facility) => Array.from({ length: f.maxLevel }, (_, i) => i < f.level)

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col bg-paper-50">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3 border-b-2 border-paper-950 bg-white px-4 py-2">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-sm bg-ochre-600 font-mono text-xs font-bold text-white">⌂</div>
        <div>
          <div class="font-serif text-sm font-bold text-paper-950">围栏基地</div>
          <div class="font-mono text-[9px] uppercase tracking-[0.2em] text-paper-500">FENCE OUTPOST</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="live-dot" v-if="!loading && !err"></span>
        <span class="font-mono text-[10px] text-paper-500">藏身处</span>
      </div>
    </div>

    <div v-if="loading" class="p-4 font-mono text-xs text-paper-500">读取角色数据...</div>
    <div v-else-if="err" class="m-3 rounded border-l-4 border-crimson-600 bg-crimson-50 px-3 py-2 font-mono text-xs text-crimson-700">{{ err }}</div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
      <!-- Facilities -->
      <div class="hud-frame">
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
      <div class="hud-frame">
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
        <div class="hud-frame">
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

        <div class="hud-frame">
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
      <div class="hud-frame">
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
