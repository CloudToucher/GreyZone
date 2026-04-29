<script setup lang="ts">
import { computed, defineComponent, h, ref, watch, type PropType } from 'vue'
import type { TreeNode } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()

const expanded = ref<Set<string>>(new Set())

watch(
  () => ws.tree,
  (t) => {
    if (!t) return
    expanded.value = new Set([''])
    for (const c of t.children || []) {
      if (c.type === 'dir') expanded.value.add(c.path)
    }
  },
  { immediate: true },
)

watch(
  () => ws.currentPath,
  (p) => {
    if (!p) return
    const parts = p.split('/')
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
function openFile(node: TreeNode) {
  if (node.type === 'file') ws.openFile(node.path)
}

const rootChildren = computed(() => ws.tree?.children || [])

// Two label sets — DM sees neutral docs, player sees mission-flavored labels
const FOLDER_LABELS_DM: Record<string, string> = {
  rules: '规则',
  dm_guide: 'DM 指南',
  characters: '角色',
  scenes: '场景',
  story: '剧情',
  assets: '资源',
  logs: '日志',
  tools: '工具',
  templates: '模板',
  active: '活跃',
  deceased: '已故',
  main_plot: '主线',
  side_quests: '支线',
  events: '事件',
  enemies: '敌人',
  items: '物品',
  npcs: 'NPC',
  urban: '城区',
  industrial: '工业区',
  underground: '地下',
  wilderness: '荒野',
  special: '特殊',
  combat: '战斗',
  exploration: '探索',
  session: '会话',
  system: '系统',
}
const FOLDER_LABELS_PLAYER: Record<string, string> = {
  rules: '规则手册',
  characters: '回收者档案',
  templates: '模板',
  active: '在编',
  deceased: '阵亡',
  assets: '装备数据',
  items: '物资清单',
  logs: '突袭日志',
  combat: '交火',
  exploration: '搜索',
  session: '会话',
  system: '系统',
}

// Top-level folders get an accent stripe color
const FOLDER_ACCENT: Record<string, string> = {
  rules: 'bg-navy-800',
  dm_guide: 'bg-crimson-600',
  characters: 'bg-ochre-600',
  scenes: 'bg-navy-600',
  story: 'bg-crimson-700',
  assets: 'bg-forest-700',
  logs: 'bg-paper-600',
  tools: 'bg-paper-500',
}

function label(node: TreeNode): string {
  if (node.type === 'dir') {
    const dict = ws.panel === 'player' ? FOLDER_LABELS_PLAYER : FOLDER_LABELS_DM
    return dict[node.name] || FOLDER_LABELS_DM[node.name] || node.name
  }
  return node.name.replace(/\.md$/i, '')
}

function topLevelAccent(path: string): string {
  const top = path.split('/')[0]
  return FOLDER_ACCENT[top] || 'bg-paper-300'
}

const TreeItem = defineComponent({
  name: 'TreeItem',
  props: {
    node: { type: Object as PropType<TreeNode>, required: true },
    depth: { type: Number, required: true },
  },
  setup(props) {
    return () => {
      const node = props.node
      const indent = `${0.5 + props.depth * 0.85}rem`

      if (node.type === 'dir') {
        const open = isOpen(node)
        const isTop = props.depth === 0
        const accent = topLevelAccent(node.path)
        const rows = [
          h(
            'button',
            {
              class:
                'group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-paper-200',
              style: { paddingLeft: indent },
              onClick: () => toggle(node),
            },
            [
              isTop
                ? h('span', { class: `inline-block h-3.5 w-1 shrink-0 rounded-sm ${accent}` })
                : h('span', { class: 'inline-block w-1 shrink-0' }),
              h(
                'span',
                { class: 'inline-block w-3 font-mono text-[11px] text-paper-500' },
                open ? '▾' : '▸',
              ),
              h(
                'span',
                {
                  class:
                    (isTop
                      ? 'font-serif text-[14px] font-bold text-paper-950'
                      : 'text-[13px] font-medium text-paper-800') + ' truncate',
                },
                label(node),
              ),
              h(
                'span',
                {
                  class:
                    'ml-auto rounded-sm bg-paper-200 px-1.5 py-px font-mono text-[10px] font-medium text-paper-600 group-hover:bg-paper-300',
                },
                node.children ? String(node.children.length) : '',
              ),
            ],
          ),
        ]
        if (open && node.children) {
          rows.push(
            h(
              'ul',
              { class: 'border-l border-dashed border-paper-300 ml-3' },
              node.children.map((c) =>
                h(TreeItem, { key: c.path, node: c, depth: props.depth + 1 }),
              ),
            ),
          )
        }
        return h('li', { class: 'select-none' }, rows)
      }

      const isCur = ws.currentPath === node.path
      return h(
        'li',
        { class: 'select-none' },
        h(
          'button',
          {
            class:
              'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[13px] transition-colors ' +
              (isCur
                ? 'bg-crimson-50 text-crimson-700 font-semibold ring-1 ring-crimson-200'
                : 'text-paper-700 hover:bg-paper-200'),
            style: { paddingLeft: indent },
            onClick: () => openFile(node),
          },
          [
            h('span', { class: 'inline-block w-1 shrink-0' }),
            h(
              'span',
              { class: 'inline-block w-3 font-mono text-[10px]' },
              isCur ? '▶' : '·',
            ),
            h('span', { class: 'truncate' }, label(node)),
          ],
        ),
      )
    }
  },
})
</script>

<template>
  <aside class="flex h-full flex-col bg-white">
    <div
      class="flex items-center justify-between border-b-2 border-paper-950 px-3 py-2.5"
    >
      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 rounded-full"
          :class="ws.panel === 'dm' ? 'bg-navy-800' : 'bg-crimson-600'"
        />
        <span
          class="stamp"
          :class="ws.panel === 'dm' ? 'text-navy-800' : 'text-crimson-700'"
        >
          {{ ws.panel === 'dm' ? 'DM 工作区' : '角色工作区' }}
        </span>
      </div>
      <button
        @click="ws.loadTree()"
        class="rounded-sm border border-paper-300 px-1.5 py-0.5 font-mono text-[11px] text-paper-600 transition hover:border-crimson-600 hover:text-crimson-600"
        :disabled="ws.treeLoading"
        title="刷新"
      >
        ↻
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div v-if="ws.treeLoading" class="px-3 py-2 font-mono text-xs text-paper-500">
        载入中...
      </div>
      <div v-else-if="ws.treeError" class="px-3 py-2 font-mono text-xs text-crimson-600">
        {{ ws.treeError }}
      </div>
      <ul v-else class="px-1.5 text-sm">
        <TreeItem v-for="node in rootChildren" :key="node.path" :node="node" :depth="0" />
      </ul>
    </div>
  </aside>
</template>
