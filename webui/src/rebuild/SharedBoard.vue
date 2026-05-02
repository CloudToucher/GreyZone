<script setup lang="ts">
import type { FilePayload, RoomSnapshot, SessionCredentials, TreeNode } from '@/lib/api'
import RenderedMarkdown from './RenderedMarkdown.vue'

defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  tree: TreeNode | null
  previewFile: FilePayload | null
}>()

const emit = defineEmits<{
  openFile: [path: string]
}>()

function flatten(node: TreeNode | null, acc: string[] = []) {
  if (!node) return acc
  if (node.type === 'file') acc.push(node.path)
  for (const child of node.children || []) flatten(child, acc)
  return acc
}

function fileLabel(path: string) {
  return path.split('/').pop()?.replace(/\.(md|ya?ml|json)$/i, '') || path
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">共享看板</div>
        <RenderedMarkdown :content="snapshot.sharedBoard?.content" compact max-height="32rem" empty="暂无共享看板。" />
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">最近 DM 回复</div>
          <div class="mt-1 text-sm text-white/80">完整文学性描写与裁定在 DM 回复里；共享看板只保留公开摘要。</div>
        </div>
        <div class="space-y-2 p-4">
          <article v-for="result in snapshot.latestResults" :key="result.id" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <button @click="emit('openFile', result.path)" class="block w-full text-left">
              <div class="font-serif text-base font-bold text-paper-950">{{ result.title }}</div>
              <div class="mt-1 font-mono text-[10px] tracking-[0.16em] text-paper-700">{{ new Date(result.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</div>
              <div class="mt-2 text-sm leading-6 text-paper-800">{{ result.excerpt || '打开查看完整回复。' }}</div>
            </button>
          </article>
          <div v-if="!snapshot.latestResults.length" class="text-sm leading-7 text-paper-800">暂无 DM 回复。</div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">回合归档</div>
        </div>
        <div class="space-y-2 p-4">
          <article v-for="archive in snapshot.archives" :key="archive.id" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ archive.id }}</div>
            <div class="mt-1 font-mono text-[10px] tracking-[0.16em] text-paper-700">{{ archive.updatedAt }}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button @click="emit('openFile', archive.packetPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700">
                回合包
              </button>
              <button v-if="archive.resultPath" @click="emit('openFile', archive.resultPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800 hover:border-crimson-600 hover:text-crimson-700">
                DM 回复
              </button>
            </div>
          </article>
          <div v-if="!snapshot.archives.length" class="text-sm leading-7 text-paper-800">暂无回合归档。</div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">可见文件</div>
          <div class="mt-1 text-sm text-white/80">当前席位允许直接阅读的公开文件、角色档案和结果记录。</div>
        </div>
        <div class="grid gap-4 p-4 lg:grid-cols-[0.7fr_1.3fr]">
          <div class="max-h-[38rem] space-y-2 overflow-auto pr-1">
            <button
              v-for="file in flatten(tree)"
              :key="file"
              @click="emit('openFile', file)"
              class="block w-full rounded-sm border border-paper-300 bg-paper-100 px-3 py-2 text-left text-[12px] leading-5 text-paper-800 hover:border-crimson-600 hover:bg-white"
            >
              <div class="font-serif font-bold text-paper-950">{{ fileLabel(file) }}</div>
              <div class="mt-1 truncate font-mono text-[10px] text-paper-700">{{ file }}</div>
            </button>
          </div>
          <div class="rounded-sm border border-paper-300 bg-white p-4">
            <div v-if="previewFile">
              <div class="mb-2 font-mono text-[10px] tracking-[0.18em] text-paper-800">{{ previewFile.path }}</div>
              <RenderedMarkdown :content="previewFile.content" compact max-height="38rem" />
            </div>
            <div v-else class="text-sm text-paper-800">从左侧选择文件后，会在这里渲染阅读。</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
