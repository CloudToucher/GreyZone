<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { extractStats, isCharacterPath, parseCharacterSemanticState, type CharStats } from '../lib/charsheet'

const ws = useWorkspaceStore()

const isCharSheet = computed(
  () => !!ws.current && isCharacterPath(ws.current.path),
)

const stats = computed<CharStats | null>(() => {
  if (!ws.current) return null
  if (!isCharSheet.value) return null
  return extractStats(ws.current.frontmatter)
})

const semantic = computed(() => {
  if (!ws.current || !isCharSheet.value) return null
  return parseCharacterSemanticState(ws.current.frontmatter, ws.current.content)
})

const visible = computed(() => !!stats.value)
const showSheetHint = computed(() => isCharSheet.value && !stats.value)

function pct(b?: { cur?: number; current?: number; max: number }) {
  if (!b || b.max <= 0) return 0
  const cur = b.cur ?? b.current ?? 0
  return Math.max(0, Math.min(100, (cur / b.max) * 100))
}

// Build a 12-segment ammo bar for AP visualization (game-style)
const apSegments = computed<{ filled: boolean }[]>(() => {
  const ap = stats.value?.ap
  if (ap == null) return []
  const n = typeof ap === 'number' ? ap : parseInt(String(ap), 10)
  if (Number.isNaN(n)) return []
  const total = Math.max(n, 6)
  const arr: { filled: boolean }[] = []
  for (let i = 0; i < Math.min(total, 12); i++) arr.push({ filled: i < n })
  return arr
})
</script>

<template>
  <!-- Hint: opened a char sheet without stat frontmatter -->
  <div
    v-if="showSheetHint"
    class="mx-6 mt-3 flex items-start gap-3 rounded-sm border border-dashed border-ochre-600 bg-ochre-50 px-4 py-2.5 text-xs text-paper-800"
  >
    <span class="font-mono text-base font-bold text-ochre-700">⚠</span>
    <div class="flex-1">
      <span class="font-semibold">未检测到角色 HUD 数据</span> ·
      在角色卡顶部添加 YAML frontmatter（hp / sp / ap / attributes）即可点亮顶部状态条。
      <button
        @click="ws.openFile('characters/active/示例_铁鼠.md')"
        class="font-bold text-crimson-700 underline-offset-2 hover:underline"
      >
        查看示例
      </button>
    </div>
  </div>

  <div
    v-if="visible && stats"
    class="hud-frame mx-6 mt-4 flex flex-wrap items-stretch gap-x-6 gap-y-3 !p-3"
  >
    <span class="corner-bl"></span><span class="corner-br"></span>

    <!-- Identity -->
    <div class="flex items-center gap-3 border-r-2 border-paper-200 pr-5">
      <div class="op-portrait !h-14 !w-14 !text-2xl">
        {{ (stats.name || '?').slice(0, 1) }}
      </div>
      <div class="leading-tight">
        <div
          class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500"
        >
          <span class="live-dot !h-1.5 !w-1.5"></span>
          OPERATOR
        </div>
        <div class="font-serif text-base font-bold text-paper-950">
          {{ stats.name || '(未命名)' }}
        </div>
        <div v-if="stats.level != null" class="mt-0.5">
          <span
            class="rounded-sm bg-paper-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ochre-400"
          >
            Lv {{ stats.level }}
          </span>
        </div>
      </div>
    </div>

    <!-- Blood / Energy -->
    <div class="flex flex-1 flex-wrap gap-5">
      <template v-if="stats.blood || stats.energy">
        <div v-if="stats.blood" class="min-w-[220px] flex-1">
          <div class="mb-1 flex items-center justify-between">
            <span class="stamp text-crimson-700">BLOOD · 血槽</span>
            <span class="font-mono text-xs font-bold text-paper-800">
              {{ stats.blood.total }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-sm border border-paper-300 bg-white px-2 py-1 text-center">
              <div class="font-mono text-[9px] uppercase tracking-[0.15em] text-paper-500">总量</div>
              <div class="font-mono text-sm font-bold text-paper-950">{{ stats.blood.total }}</div>
            </div>
            <div class="rounded-sm border border-paper-300 bg-white px-2 py-1 text-center">
              <div class="font-mono text-[9px] uppercase tracking-[0.15em] text-paper-500">轻伤</div>
              <div class="font-mono text-sm font-bold text-ochre-700">{{ stats.blood.light }}</div>
            </div>
            <div class="rounded-sm border border-paper-300 bg-white px-2 py-1 text-center">
              <div class="font-mono text-[9px] uppercase tracking-[0.15em] text-paper-500">重伤</div>
              <div class="font-mono text-sm font-bold text-crimson-700">{{ stats.blood.severe }}</div>
            </div>
          </div>
          <div v-if="stats.blood.narrative" class="mt-1 text-[11px] leading-relaxed text-paper-600">
            {{ stats.blood.narrative }}
          </div>
        </div>

        <div v-if="stats.energy" class="min-w-[200px] flex-1">
          <div class="mb-1 flex items-center justify-between">
            <span class="stamp text-forest-700">ENERGY · 能量</span>
            <span class="font-mono text-xs font-bold text-paper-800">
              {{ stats.energy.current }} <span class="text-paper-400">/</span> {{ stats.energy.max }}
            </span>
          </div>
          <div class="h-2.5 w-full overflow-hidden rounded-sm border border-paper-300 bg-paper-100">
            <div
              class="h-full bg-gradient-to-r from-forest-700 to-forest-400 transition-all"
              :style="{ width: pct(stats.energy) + '%' }"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="stats.hp" class="min-w-[200px] flex-1">
          <div class="mb-1 flex items-center justify-between">
            <span class="stamp text-crimson-700">HP · 生命值</span>
            <span class="font-mono text-xs font-bold text-paper-800">
              {{ stats.hp.cur }} <span class="text-paper-400">/</span> {{ stats.hp.max }}
            </span>
          </div>
          <div class="h-2.5 w-full overflow-hidden rounded-sm border border-paper-300 bg-paper-100">
            <div
              class="h-full bg-gradient-to-r from-crimson-700 to-crimson-500 transition-all"
              :style="{ width: pct(stats.hp) + '%' }"
            />
          </div>
        </div>

        <div v-if="stats.sp" class="min-w-[200px] flex-1">
          <div class="mb-1 flex items-center justify-between">
            <span class="stamp text-forest-700">SP · 体力值</span>
            <span class="font-mono text-xs font-bold text-paper-800">
              {{ stats.sp.cur }} <span class="text-paper-400">/</span> {{ stats.sp.max }}
            </span>
          </div>
          <div class="h-2.5 w-full overflow-hidden rounded-sm border border-paper-300 bg-paper-100">
            <div
              class="h-full bg-gradient-to-r from-forest-700 to-forest-400 transition-all"
              :style="{ width: pct(stats.sp) + '%' }"
            />
          </div>
        </div>

        <div v-if="stats.ap != null" class="min-w-[120px]">
          <div class="mb-1 flex items-center justify-between">
            <span class="stamp text-navy-800">AP · 行动</span>
            <span class="font-mono text-xs font-bold text-navy-800">{{ stats.ap }}</span>
          </div>
          <div class="ammo-bar">
            <span v-for="(s, i) in apSegments" :key="i" :class="{ filled: s.filled }"></span>
          </div>
        </div>
      </template>
    </div>

    <div v-if="semantic && (semantic.currentSituation || semantic.unconfirmedRisks.length)" class="min-w-[260px] max-w-[420px] border-l-2 border-paper-200 pl-5">
      <div v-if="semantic.currentSituation" class="mb-2">
        <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-500">当前处境</div>
        <pre class="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-paper-700">{{ semantic.currentSituation }}</pre>
      </div>
      <div v-if="semantic.unconfirmedRisks.length">
        <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-500">未确认风险</div>
        <ul class="space-y-1 text-[11px] leading-relaxed text-paper-700">
          <li v-for="(risk, idx) in semantic.unconfirmedRisks.slice(0, 2)" :key="idx">• {{ risk }}</li>
        </ul>
      </div>
    </div>

    <!-- Attributes -->
    <div
      v-if="stats.attributes"
      class="flex flex-wrap items-start gap-1.5 border-l-2 border-paper-200 pl-5"
    >
      <div
        v-for="(v, k) in stats.attributes"
        :key="k"
        class="flex items-center overflow-hidden rounded-sm border border-paper-950 font-mono text-[11px]"
      >
        <span class="bg-paper-950 px-1.5 py-0.5 font-bold tracking-wider text-ochre-400">
          {{ k }}
        </span>
        <span class="bg-white px-1.5 py-0.5 font-bold text-paper-950">{{ v }}</span>
      </div>
    </div>
  </div>
</template>
