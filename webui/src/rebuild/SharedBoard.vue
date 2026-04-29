<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FilePayload, RoomSnapshot, SessionCredentials } from '@/lib/api'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  tree: { name: string; path: string; type: 'dir' | 'file'; children?: any[] } | null
  previewFile: FilePayload | null
}>()

const emit = defineEmits<{
  openFile: [path: string]
}>()

const selectedPath = ref('')

watch(
  () => props.snapshot.sharedBoard?.path,
  (path) => {
    if (!selectedPath.value && path) selectedPath.value = path
  },
  { immediate: true },
)

function flatten(node: any, acc: string[] = []) {
  if (!node) return acc
  if (node.type === 'file') acc.push(node.path)
  for (const child of node.children || []) flatten(child, acc)
  return acc
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">Shared Board</div>
        <pre class="max-h-[26rem] overflow-auto whitespace-pre-wrap text-sm leading-7 text-paper-700">{{ snapshot.sharedBoard?.content || 'No shared board available.' }}</pre>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Archives</div>
        </div>
        <div class="space-y-2 p-4">
          <article v-for="archive in snapshot.archives" :key="archive.id" class="rounded-sm border border-paper-200 bg-paper-100 p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ archive.id }}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">{{ archive.updatedAt }}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button @click="emit('openFile', archive.packetPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700">
                Packet
              </button>
              <button v-if="archive.resultPath" @click="emit('openFile', archive.resultPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700">
                Result
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Visible Files</div>
          <div class="mt-1 text-sm text-white/75">当前视角能直接读取的文档与档案。</div>
        </div>
        <div class="grid gap-4 p-4 lg:grid-cols-[0.7fr_1.3fr]">
          <div class="space-y-2">
            <button
              v-for="file in flatten(tree)"
              :key="file"
              @click="emit('openFile', file)"
              class="block w-full rounded-sm border border-paper-200 bg-paper-100 px-3 py-2 text-left font-mono text-[11px] leading-5 text-paper-700 hover:border-crimson-600 hover:bg-white"
            >
              {{ file }}
            </button>
          </div>
          <div class="rounded-sm border border-paper-200 bg-white p-4">
            <div v-if="previewFile">
              <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">{{ previewFile.path }}</div>
              <pre class="max-h-[34rem] overflow-auto whitespace-pre-wrap text-sm leading-7 text-paper-700">{{ previewFile.content }}</pre>
            </div>
            <div v-else class="text-sm text-paper-500">Select a file on the left to preview it.</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
