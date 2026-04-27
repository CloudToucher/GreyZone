<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchFile, fetchTree } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspace'
import { extractStats, type CharStats } from '../lib/charsheet'

const ws = useWorkspaceStore()

interface ActiveCharacter {
  path: string
  name: string
  stats: CharStats | null
}

const activeChars = ref<ActiveCharacter[]>([])
const tip = ref('')

const TIPS = [
  '在灰区，子弹打完就真打完了 — 进门前数好你的弹匣。',
  '亚音速弹 + 消音器 = 不被发现的最佳保险。',
  '安全箱是你死后唯一能保住的东西。值钱的优先放进去。',
  '掩护射击给队友 +10 闪避。多元协作改变战局。',
  '撤离信号一启动，敌人就开始向你靠拢。撑过 2-4 轮。',
  '彻底搜索花时间，但比快速搜索值钱得多 — 看场地决定。',
  'HP ≤ 0 不一定死。每轮投 CON 检定，撑过去就行。',
  'NPC 不是自动售货机。讲故事、分享情报，往往比砸钱有效。',
]

onMounted(async () => {
  tip.value = TIPS[Math.floor(Math.random() * TIPS.length)]
  try {
    const { tree } = await fetchTree('player')
    const paths: { path: string; name: string }[] = []
    function walk(nodes: typeof tree.children) {
      for (const n of nodes || []) {
        if (n.type === 'dir') walk(n.children)
        else if (n.path.startsWith('characters/active/') && n.path.toLowerCase().endsWith('.md'))
          paths.push({ path: n.path, name: n.name.replace(/\.md$/i, '') })
      }
    }
    walk(tree.children)

    // Fetch each character file in parallel to read frontmatter for HUD preview
    const enriched = await Promise.all(
      paths.map(async (p) => {
        try {
          const f = await fetchFile('player', p.path)
          const stats = extractStats(f.frontmatter)
          return {
            path: p.path,
            name: stats?.name || p.name,
            stats,
          } satisfies ActiveCharacter
        } catch {
          return { path: p.path, name: p.name, stats: null } satisfies ActiveCharacter
        }
      }),
    )
    activeChars.value = enriched
  } catch {
    /* ignore */
  }
})

function pct(b?: { cur: number; max: number }) {
  if (!b || b.max <= 0) return 0
  return Math.max(0, Math.min(100, (b.cur / b.max) * 100))
}

function open(p: string) {
  ws.openFile(p)
}

const quickLinks = [
  { label: '快速开始', path: '开始游戏.md', desc: '5 分钟规则速览', tag: 'BRIEF' },
  { label: '行动板', path: 'playground.md', desc: '本轮行动登记', tag: 'PLAYGROUND' },
  { label: '核心规则', path: 'rules/01_核心规则书.md', desc: '完整 8 章规则书', tag: 'RULES' },
  { label: '骰池协议', path: 'rules/03_骰池协议.md', desc: '随机性来源', tag: 'DICE' },
  { label: '物品掉落', path: 'assets/items/物品与掉落表.md', desc: '武器·弹药·消耗品', tag: 'LOOT' },
  { label: '角色生成指南', path: 'characters/templates/角色生成指南.md', desc: '8 步建卡', tag: 'BUILD' },
]

const stats = computed(() => [
  { label: '活跃角色', value: activeChars.value.length, foot: 'OPERATOR' },
  { label: '面板模式', value: '突袭', foot: 'EXTRACTION' },
  { label: '版本', value: 'v0.0.1', foot: 'CLIENT' },
  { label: '状态', value: 'ON', foot: 'GAME ZONE LIVE' },
])
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-8">
    <!-- Briefing header -->
    <div class="hud-frame mb-6">
      <span class="corner-bl"></span><span class="corner-br"></span>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="mb-2 flex items-center gap-2">
            <span class="live-dot"></span>
            <span class="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-crimson-700">
              MISSION BRIEFING
            </span>
            <span class="text-paper-300">·</span>
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-500">
              FENCE OUTPOST · 2037
            </span>
          </div>
          <h1 class="font-serif text-3xl font-black leading-tight text-paper-950">
            欢迎回到<span class="text-crimson-600">围栏</span>，回收者。
          </h1>
          <p class="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-paper-700">
            灰区的裂隙仍在扩张。雇主名单上又多了几个名字，安全箱里还能塞下你下一次突袭的回报。
            选好你的装备，写下你的行动 — 然后活着回来。
          </p>
        </div>
        <div class="flex items-center gap-2 self-start">
          <span class="stamp text-crimson-700">CLEARANCE</span>
          <span class="stamp text-navy-800">OPERATOR</span>
        </div>
      </div>
    </div>

    <!-- Stats row -->
    <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div v-for="s in stats" :key="s.label" class="data-card">
        <div class="data-card-label">
          <span class="h-1 w-3 bg-crimson-600"></span>
          {{ s.label }}
        </div>
        <div class="data-card-value">{{ s.value }}</div>
        <div class="data-card-foot">{{ s.foot }}</div>
      </div>
    </div>

    <!-- Active characters -->
    <div class="mb-6">
      <div class="brief-heading">
        <span>活跃角色</span>
        <span class="ml-2 rounded-sm bg-crimson-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          {{ activeChars.length }}
        </span>
      </div>

      <div v-if="activeChars.length === 0" class="hud-frame hatch-warn">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex items-center gap-3">
          <div class="font-mono text-2xl text-ochre-600">⚠</div>
          <div>
            <div class="font-bold text-paper-950">尚未部署任何角色</div>
            <div class="mt-1 text-sm text-paper-600">
              打开
              <button
                @click="open('characters/templates/角色生成指南.md')"
                class="font-bold text-crimson-700 underline-offset-2 hover:underline"
              >
                角色生成指南
              </button>
              创建你的第一个回收者，然后将角色卡保存到
              <code class="rounded bg-paper-200 px-1 font-mono text-xs">characters/active/</code>。
            </div>
          </div>
        </div>
      </div>

      <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          v-for="c in activeChars"
          :key="c.path"
          @click="open(c.path)"
          class="group relative flex flex-col gap-3 overflow-hidden rounded border border-paper-300 bg-white p-4 text-left transition hover:border-crimson-600 hover:shadow-pop"
        >
          <!-- Status badge top-right -->
          <div
            class="absolute right-0 top-0 flex items-center gap-1 bg-crimson-600 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white"
          >
            <span class="h-1 w-1 rounded-full bg-white"></span>
            ACTIVE
          </div>

          <div class="flex items-center gap-4">
            <div class="op-portrait shrink-0">{{ c.name.slice(0, 1) }}</div>
            <div class="min-w-0 flex-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.15em] text-paper-500">
                ACTIVE OPERATOR
              </div>
              <div class="flex items-center gap-2">
                <span class="truncate font-serif text-lg font-bold text-paper-950">
                  {{ c.name }}
                </span>
                <span
                  v-if="c.stats?.level != null"
                  class="rounded-sm bg-paper-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ochre-400"
                >
                  Lv {{ c.stats.level }}
                </span>
              </div>
              <div class="mt-0.5 truncate font-mono text-[10px] text-paper-500">{{ c.path }}</div>
            </div>
            <div
              class="shrink-0 font-mono text-[11px] font-bold text-paper-400 transition group-hover:text-crimson-600"
            >
              ENTER →
            </div>
          </div>

          <!-- HP / SP / AP preview -->
          <div v-if="c.stats" class="grid grid-cols-3 gap-2 pt-2">
            <div v-if="c.stats.hp">
              <div class="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-widest">
                <span class="font-bold text-crimson-700">HP</span>
                <span class="text-paper-700">{{ c.stats.hp.cur }}/{{ c.stats.hp.max }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-sm bg-paper-200">
                <div
                  class="h-full bg-gradient-to-r from-crimson-700 to-crimson-500"
                  :style="{ width: pct(c.stats.hp) + '%' }"
                ></div>
              </div>
            </div>
            <div v-if="c.stats.sp">
              <div class="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-widest">
                <span class="font-bold text-forest-700">SP</span>
                <span class="text-paper-700">{{ c.stats.sp.cur }}/{{ c.stats.sp.max }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-sm bg-paper-200">
                <div
                  class="h-full bg-gradient-to-r from-forest-700 to-forest-400"
                  :style="{ width: pct(c.stats.sp) + '%' }"
                ></div>
              </div>
            </div>
            <div v-if="c.stats.ap != null">
              <div class="mb-0.5 flex items-center justify-between font-mono text-[9px] tracking-widest">
                <span class="font-bold text-navy-800">AP</span>
                <span class="text-paper-700">{{ c.stats.ap }}</span>
              </div>
              <div class="rounded-sm bg-navy-800 py-0.5 text-center font-mono text-xs font-bold text-white">
                {{ c.stats.ap }}
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- Quick links -->
    <div class="mb-6">
      <div class="brief-heading">快速通道</div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="q in quickLinks"
          :key="q.path"
          @click="open(q.path)"
          class="group relative overflow-hidden rounded border border-paper-300 bg-white p-4 text-left transition hover:border-crimson-600 hover:shadow-pop"
        >
          <div
            class="absolute right-0 top-0 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white"
            :class="q.tag === 'PLAYGROUND' ? 'bg-crimson-600' : q.tag === 'RULES' ? 'bg-navy-800' : 'bg-paper-700'"
          >
            {{ q.tag }}
          </div>
          <div class="mt-3 font-serif text-base font-bold text-paper-950 group-hover:text-crimson-700">
            {{ q.label }}
          </div>
          <div class="mt-1 text-xs text-paper-600">{{ q.desc }}</div>
          <div class="mt-3 font-mono text-[10px] text-paper-400">{{ q.path }}</div>
        </button>
      </div>
    </div>

    <!-- Tip -->
    <div class="hud-frame hatch-warn flex items-start gap-3">
      <span class="corner-bl"></span><span class="corner-br"></span>
      <div class="font-mono text-lg font-bold text-ochre-700">FIELD TIP</div>
      <div class="flex-1 text-sm leading-relaxed text-paper-800">{{ tip }}</div>
    </div>

    <!-- Footer mark -->
    <div class="mt-8 flex items-center justify-center gap-3">
      <span class="hud-stripe block w-24"></span>
      <span class="font-mono text-[10px] uppercase tracking-[0.3em] text-paper-500">
        Gray Zone · Extraction
      </span>
      <span class="hud-stripe block w-24"></span>
    </div>
  </div>
</template>
