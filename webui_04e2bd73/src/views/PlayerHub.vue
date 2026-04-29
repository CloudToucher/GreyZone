<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchFile, fetchTree } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspace'
import { usePlayerStore } from '../stores/players'
import { extractStats, parseCharacterSemanticState, type CharStats } from '../lib/charsheet'

const ws = useWorkspaceStore()
const ply = usePlayerStore()

interface ActiveCharacter {
  path: string
  title: string
  name: string
  stats: CharStats | null
  concept: string
  situation: string
  relations: string[]
  risks: string[]
}

const activeChars = ref<ActiveCharacter[]>([])
const tip = ref('')

const TIPS = [
  '在灰区，子弹打完就真打完了——真正重要的是你让 DM 理解了什么局势。',
  '安全箱不只是物资区，也是角色执念和代价最适合落档的地方。',
  '与其想“我能点哪个动作”，不如先想“我到底想让局面变成什么样”。',
  'NPC 不是自动售货机。讲故事、示弱、施压、交换情报都可能比开枪更值钱。',
  '未确认风险最好持续挂在角色首页上，它们才是后续戏剧张力的种子。',
]

const quickLinks = [
  { label: '创角', action: 'forge', desc: '提出你想扮演的人', tag: 'FORGE' },
  { label: '行动语义板', path: 'playground.md', desc: '组织本轮意图与上下文', tag: 'INTENT' },
  { label: '核心规则', path: 'rules/01_核心规则书.md', desc: '完整规则与世界约束', tag: 'RULES' },
  { label: '物资清单', path: 'assets/items/物品与掉落表.md', desc: '武器·弹药·消耗品参考', tag: 'LOOT' },
]

async function loadCharacters() {
  try {
    const { tree } = await fetchTree('player', { player: ply.currentName })
    const paths: { path: string; title: string }[] = []
    function walk(nodes: typeof tree.children) {
      for (const n of nodes || []) {
        if (n.type === 'dir') walk(n.children)
        else if (n.path.startsWith('characters/active/') && n.path.toLowerCase().endsWith('.md')) {
          paths.push({ path: n.path, title: n.name.replace(/\.md$/i, '') })
        }
      }
    }
    walk(tree.children)

    const enriched = await Promise.all(
      paths.map(async (p) => {
        try {
          const f = await fetchFile('player', p.path, { player: ply.currentName })
          const stats = extractStats(f.frontmatter)
          const semantic = parseCharacterSemanticState(f.frontmatter, f.content)
          return {
            path: p.path,
            title: p.title,
            name: stats?.name || p.title,
            stats,
            concept: semantic.concept,
            situation: semantic.currentSituation,
            relations: semantic.keyRelations,
            risks: semantic.unconfirmedRisks,
          } satisfies ActiveCharacter
        } catch {
          return {
            path: p.path,
            title: p.title,
            name: p.title,
            stats: null,
            concept: '',
            situation: '',
            relations: [],
            risks: [],
          } satisfies ActiveCharacter
        }
      }),
    )
    activeChars.value = enriched
  } catch {
    activeChars.value = []
  }
}

onMounted(async () => {
  tip.value = TIPS[Math.floor(Math.random() * TIPS.length)]
  await loadCharacters()
})

function pct(b?: { cur: number; max: number }) {
  if (!b || b.max <= 0) return 0
  return Math.max(0, Math.min(100, (b.cur / b.max) * 100))
}

function open(path: string) {
  ws.openFile(path)
}

const currentCharacter = computed(() =>
  activeChars.value.find((c) => c.path === ply.currentCharacterPath) || null,
)

const dashboardStats = computed(() => [
  { label: '当前身份', value: ply.currentName, foot: 'PLAYER' },
  { label: '活跃档案', value: activeChars.value.length, foot: 'DOSSIERS' },
  { label: '当前模式', value: currentCharacter.value ? '角色视角' : '共享视角', foot: 'VIEW' },
  { label: '状态', value: currentCharacter.value ? 'LOCKED' : 'UNBOUND', foot: 'CONTEXT' },
])

watch(() => ply.currentName, () => {
  loadCharacters()
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-8">
    <div class="hud-frame mb-6">
      <span class="corner-bl"></span><span class="corner-br"></span>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="mb-2 flex items-center gap-2">
            <span class="live-dot"></span>
            <span class="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-crimson-700">
              PLAYER DOSSIER HOME
            </span>
            <span class="text-paper-300">·</span>
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-500">
              {{ ply.currentName }}
            </span>
          </div>
          <h1 class="font-serif text-3xl font-black leading-tight text-paper-950">
            先看<span class="text-crimson-600">你是谁</span>，再看这个世界要你付出什么。
          </h1>
          <p class="mt-2 max-w-3xl font-sans text-sm leading-relaxed text-paper-700">
            这里不再是共享角色大厅的第一视角。当前玩家会优先看到自己的角色档案摘要、关系、风险、处境与资源入口；其他角色与公共文档退居次级位置。
          </p>
        </div>
        <div class="flex items-center gap-2 self-start">
          <span class="stamp text-crimson-700">CURRENT PLAYER</span>
          <span class="stamp text-navy-800">{{ ply.currentName }}</span>
        </div>
      </div>
    </div>

    <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div v-for="s in dashboardStats" :key="s.label" class="data-card">
        <div class="data-card-label">
          <span class="h-1 w-3 bg-crimson-600"></span>
          {{ s.label }}
        </div>
        <div class="data-card-value">{{ s.value }}</div>
        <div class="data-card-foot">{{ s.foot }}</div>
      </div>
    </div>

    <div v-if="currentCharacter" class="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-4">
            <div class="op-portrait !h-20 !w-20 !text-3xl">{{ currentCharacter.name.slice(0, 1) }}</div>
            <div class="min-w-0">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">MY DOSSIER</div>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <span class="font-serif text-2xl font-bold text-paper-950">{{ currentCharacter.name }}</span>
                <span v-if="currentCharacter.stats?.level != null"
                  class="rounded-sm bg-paper-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ochre-400">
                  Lv {{ currentCharacter.stats.level }}
                </span>
              </div>
              <div class="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-paper-700">{{ currentCharacter.concept || '暂无角色概念摘要。' }}</div>
            </div>
          </div>
          <button @click="open(currentCharacter.path)"
            class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold text-paper-700 hover:border-crimson-600 hover:text-crimson-700">
            打开完整档案
          </button>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div class="rounded-sm border border-paper-200 bg-white p-3">
            <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-500">当前处境</div>
            <pre class="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-paper-700">{{ currentCharacter.situation || '暂无处境摘要。' }}</pre>
          </div>
          <div class="rounded-sm border border-paper-200 bg-white p-3">
            <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-500">关键关系</div>
            <ul v-if="currentCharacter.relations.length" class="space-y-1 text-[12px] leading-relaxed text-paper-700">
              <li v-for="(rel, idx) in currentCharacter.relations.slice(0, 5)" :key="idx">• {{ rel }}</li>
            </ul>
            <div v-else class="text-[12px] text-paper-500">暂无关键关系摘要。</div>
          </div>
          <div class="rounded-sm border border-paper-200 bg-white p-3">
            <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-500">未确认风险</div>
            <ul v-if="currentCharacter.risks.length" class="space-y-1 text-[12px] leading-relaxed text-paper-700">
              <li v-for="(risk, idx) in currentCharacter.risks.slice(0, 5)" :key="idx">• {{ risk }}</li>
            </ul>
            <div v-else class="text-[12px] text-paper-500">暂无未确认风险。</div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <div class="hud-frame">
          <span class="corner-bl"></span><span class="corner-br"></span>
          <div class="brief-heading !mb-3 !text-sm">我的即时状态</div>
          <div v-if="currentCharacter.stats" class="space-y-3">
            <div v-if="currentCharacter.stats.hp">
              <div class="mb-1 flex items-center justify-between font-mono text-[10px]">
                <span class="font-bold text-crimson-700">HP</span>
                <span>{{ currentCharacter.stats.hp.cur }}/{{ currentCharacter.stats.hp.max }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-sm bg-paper-200">
                <div class="h-full bg-gradient-to-r from-crimson-700 to-crimson-500" :style="{ width: pct(currentCharacter.stats.hp) + '%' }"></div>
              </div>
            </div>
            <div v-if="currentCharacter.stats.sp">
              <div class="mb-1 flex items-center justify-between font-mono text-[10px]">
                <span class="font-bold text-forest-700">SP</span>
                <span>{{ currentCharacter.stats.sp.cur }}/{{ currentCharacter.stats.sp.max }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-sm bg-paper-200">
                <div class="h-full bg-gradient-to-r from-forest-700 to-forest-400" :style="{ width: pct(currentCharacter.stats.sp) + '%' }"></div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-sm bg-paper-100 px-2 py-2 text-center">
                <div class="font-mono text-[9px] uppercase tracking-[0.15em] text-paper-500">AP</div>
                <div class="font-mono text-lg font-bold text-navy-800">{{ currentCharacter.stats.ap ?? '—' }}</div>
              </div>
              <div class="rounded-sm bg-paper-100 px-2 py-2 text-center">
                <div class="font-mono text-[9px] uppercase tracking-[0.15em] text-paper-500">档案</div>
                <div class="font-mono text-[11px] font-bold text-paper-700">{{ currentCharacter.title }}</div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-paper-500">当前角色缺少 frontmatter 数值摘要。</div>
        </div>

        <div class="hud-frame">
          <span class="corner-bl"></span><span class="corner-br"></span>
          <div class="brief-heading !mb-3 !text-sm">我的快捷入口</div>
          <div class="grid grid-cols-2 gap-2">
            <button @click="open(currentCharacter.path)" class="rounded-sm border border-paper-300 bg-white p-2 text-left hover:border-crimson-600 hover:bg-crimson-50">
              <div class="font-serif text-[12px] font-bold text-paper-950">角色档案</div>
              <div class="mt-1 text-[10px] text-paper-500">查看完整角色语义与状态</div>
            </button>
            <button @click="open('playground.md')" class="rounded-sm border border-paper-300 bg-white p-2 text-left hover:border-crimson-600 hover:bg-crimson-50">
              <div class="font-serif text-[12px] font-bold text-paper-950">行动语义</div>
              <div class="mt-1 text-[10px] text-paper-500">组织本轮意图与补充说明</div>
            </button>
            <button @click="open('assets/items/物品与掉落表.md')" class="rounded-sm border border-paper-300 bg-white p-2 text-left hover:border-crimson-600 hover:bg-crimson-50">
              <div class="font-serif text-[12px] font-bold text-paper-950">物资参考</div>
              <div class="mt-1 text-[10px] text-paper-500">查看装备与资源语义参考</div>
            </button>
            <button @click="open('rules/01_核心规则书.md')" class="rounded-sm border border-paper-300 bg-white p-2 text-left hover:border-crimson-600 hover:bg-crimson-50">
              <div class="font-serif text-[12px] font-bold text-paper-950">规则约束</div>
              <div class="mt-1 text-[10px] text-paper-500">查看世界和规则边界</div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="mb-6 hud-frame hatch-warn">
      <span class="corner-bl"></span><span class="corner-br"></span>
      <div class="flex items-center gap-3">
        <div class="font-mono text-2xl text-ochre-600">⚠</div>
        <div>
          <div class="font-bold text-paper-950">当前玩家尚未绑定独立角色档案</div>
          <div class="mt-1 text-sm leading-relaxed text-paper-600">
            当前身份是 <span class="font-bold text-crimson-700">{{ ply.currentName }}</span>。
            你可以先进入「创角」生成一个属于这个身份的角色档案，随后工作台会自动把它绑定到当前玩家身份。
          </div>
        </div>
      </div>
    </div>

    <div class="mb-6">
      <div class="brief-heading">共享入口</div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <template v-for="q in quickLinks" :key="q.label">
          <button
            v-if="q.path"
            @click="open(q.path)"
            class="group relative overflow-hidden rounded border border-paper-300 bg-white p-4 text-left transition hover:border-crimson-600 hover:shadow-pop"
          >
            <div class="absolute right-0 top-0 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white" :class="q.tag === 'INTENT' ? 'bg-crimson-600' : q.tag === 'RULES' ? 'bg-navy-800' : 'bg-paper-700'">
              {{ q.tag }}
            </div>
            <div class="mt-3 font-serif text-base font-bold text-paper-950 group-hover:text-crimson-700">{{ q.label }}</div>
            <div class="mt-1 text-xs text-paper-600">{{ q.desc }}</div>
            <div class="mt-3 font-mono text-[10px] text-paper-400">{{ q.path }}</div>
          </button>
          <div v-else class="group relative overflow-hidden rounded border border-paper-300 bg-white p-4 text-left">
            <div class="absolute right-0 top-0 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white bg-paper-700">{{ q.tag }}</div>
            <div class="mt-3 font-serif text-base font-bold text-paper-950">{{ q.label }}</div>
            <div class="mt-1 text-xs text-paper-600">{{ q.desc }}</div>
            <div class="mt-3 font-mono text-[10px] text-paper-400">在创角页使用</div>
          </div>
        </template>
      </div>
    </div>

    <div class="hud-frame hatch-warn flex items-start gap-3">
      <span class="corner-bl"></span><span class="corner-br"></span>
      <div class="font-mono text-lg font-bold text-ochre-700">FIELD TIP</div>
      <div class="flex-1 text-sm leading-relaxed text-paper-800">{{ tip }}</div>
    </div>

    <div class="mt-8 flex items-center justify-center gap-3">
      <span class="hud-stripe block w-24"></span>
      <span class="font-mono text-[10px] uppercase tracking-[0.3em] text-paper-500">
        Gray Zone · Player Dossier View
      </span>
      <span class="hud-stripe block w-24"></span>
    </div>
  </div>
</template>
