<script setup lang="ts">
import { computed, defineComponent, h, ref, watch, type PropType } from 'vue'
import type { RoomSnapshot, TreeNode } from '@/lib/api'

const props = defineProps<{
  snapshot: RoomSnapshot
  tree: TreeNode | null
  currentPath: string | null
  activeTab: 'player' | 'dm' | 'shared'
}>()

const emit = defineEmits<{
  openFile: [path: string]
  returnHome: []
}>()

const expanded = ref<Set<string>>(new Set())

const folderLabels: Record<string, string> = {
  rules: '规则库',
  characters: '角色档案',
  templates: '模板',
  active: '当前角色',
  dm_guide: 'DM 指南',
  scenes: '场景',
  story: '剧情',
  assets: '资源',
  table: '桌面状态',
  intents: '意图板',
  rounds: '回合包',
  logs: '执行记录',
  tools: '工具',
  items: '物品',
  enemies: '敌人',
  npcs: 'NPC',
  urban: '城区',
  industrial: '工业区',
  underground: '地下',
  wilderness: '荒野',
  main_plot: '主线',
  side_quests: '支线',
  events: '事件',
  combat: '战斗',
  exploration: '探索',
}

watch(
  () => props.tree,
  (tree) => {
    const next = new Set<string>([''])
    for (const child of tree?.children || []) {
      if (child.type === 'dir') next.add(child.path)
    }
    expanded.value = next
  },
  { immediate: true },
)

watch(
  () => props.currentPath,
  (path) => {
    if (!path) return
    const parts = path.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      expanded.value.add(acc)
    }
  },
)

function toggle(node: TreeNode) {
  if (expanded.value.has(node.path)) expanded.value.delete(node.path)
  else expanded.value.add(node.path)
}

function isOpen(node: TreeNode) {
  return expanded.value.has(node.path)
}

function fileLabel(path: string) {
  return path.split('/').pop()?.replace(/\.(md|ya?ml|json)$/i, '') || path
}

const rootChildren = computed(() => props.tree?.children || [])
const shortcuts = computed(() => props.snapshot.documentShortcuts || [])
const currentSeat = computed(() => props.snapshot.viewer.seatName)
const currentPhase = computed(() => props.snapshot.room.phase)
const workspaceLabel = computed(() => {
  if (props.activeTab === 'dm') return 'DM 控制台'
  if (props.activeTab === 'shared') return '共享看板'
  return '玩家工作台'
})
const workspaceTone = computed(() => props.activeTab === 'dm' ? 'text-navy-800' : 'text-crimson-700')
const workspaceDot = computed(() => props.activeTab === 'dm' ? 'bg-navy-800' : 'bg-crimson-600')

const TreeItem: any = defineComponent({
  name: 'TreeItem',
  props: {
    node: { type: Object as PropType<TreeNode>, required: true },
    depth: { type: Number, required: true },
  },
  setup(nodeProps): () => any {
    return () => {
      const node = nodeProps.node
      const indent = `${0.5 + nodeProps.depth * 0.82}rem`

      if (node.type === 'dir') {
        const open = isOpen(node)
        return h('li', { class: 'select-none' }, [
          h(
            'button',
            {
              class:
                'group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-paper-200',
              style: { paddingLeft: indent },
              onClick: () => toggle(node),
            },
            [
              h('span', { class: 'inline-block w-3 font-mono text-[11px] text-paper-700' }, open ? '▾' : '▸'),
              h('span', {
                class: 'inline-block w-1 shrink-0 rounded-sm bg-crimson-600',
                style: { height: nodeProps.depth === 0 ? '12px' : '8px' },
              }),
              h(
                'span',
                {
                  class:
                    (nodeProps.depth === 0
                      ? 'font-serif text-[14px] font-bold text-paper-950'
                      : 'text-[13px] font-semibold text-paper-800') + ' truncate',
                },
                folderLabels[node.name] || node.name,
              ),
              h(
                'span',
                {
                  class:
                    'ml-auto rounded-sm bg-paper-200 px-1.5 py-px font-mono text-[10px] font-semibold text-paper-700 group-hover:bg-paper-300',
                },
                node.children ? String(node.children.length) : '',
              ),
            ],
          ),
          open && node.children
            ? h(
                'ul',
                { class: 'ml-3 border-l border-dashed border-paper-300' },
                node.children.map((child) =>
                  h(TreeItem, { key: child.path, node: child, depth: nodeProps.depth + 1 }),
                ),
              )
            : null,
        ])
      }

      const current = props.currentPath === node.path
      return h(
        'li',
        { class: 'select-none' },
        h(
          'button',
          {
            class:
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors ' +
              (current
                ? 'bg-crimson-50 font-semibold text-crimson-700 ring-1 ring-crimson-200'
                : 'text-paper-800 hover:bg-paper-200 hover:text-paper-950'),
            style: { paddingLeft: indent },
            onClick: () => emit('openFile', node.path),
          },
          [
            h('span', { class: 'inline-block w-3 font-mono text-[10px] text-paper-700' }, current ? '◆' : '·'),
            h('span', { class: 'truncate' }, fileLabel(node.name)),
          ],
        ),
      )
    }
  },
})
</script>

<template>
  <aside class="flex h-full flex-col bg-white">
    <div class="flex items-center justify-between border-b-2 border-paper-950 px-3 py-2.5">
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full" :class="workspaceDot" />
        <span class="stamp" :class="workspaceTone">
          {{ snapshot.viewer.role === 'dm' ? 'DM 工作区' : '玩家工作区' }}
        </span>
      </div>
      <div class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-700">
        {{ currentSeat }} · {{ currentPhase }}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div v-if="activeTab !== 'shared'" class="px-3 pb-3">
        <button
          @click="emit('returnHome')"
          class="w-full rounded-sm border-2 border-paper-950 bg-paper-950 px-3 py-2 text-left font-mono text-[10px] font-bold tracking-[0.14em] text-white transition hover:bg-paper-800"
        >
          回主界面
        </button>
      </div>

      <div class="px-3 pb-3">
        <div class="brief-heading !mb-2 !text-sm">快速入口</div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="item in shortcuts"
            :key="item.path"
            @click="emit('openFile', item.path)"
            class="rounded-sm border border-paper-300 bg-white p-2 text-left transition hover:border-crimson-600 hover:bg-crimson-50"
          >
            <div class="font-serif text-[12px] font-bold text-paper-950">{{ item.title }}</div>
            <div class="mt-1 truncate font-mono text-[10px] text-paper-700">{{ item.path }}</div>
          </button>
        </div>
      </div>

      <ul v-if="tree?.children?.length" class="px-1.5 text-sm">
        <TreeItem v-for="node in rootChildren" :key="node.path" :node="node" :depth="0" />
      </ul>
      <div v-else class="px-3 py-2 font-mono text-xs text-paper-700">
        正在读取可见文件...
      </div>
    </div>
  </aside>
</template>
