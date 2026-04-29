<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ForgePayload, IntentSections, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  busy: boolean
  round: VisibleRoundState | null
}>()

const emit = defineEmits<{
  saveIntent: [sections: IntentSections, status?: 'idle' | 'ready' | 'submitted']
  respondTransfer: [characterPath: string, accept: boolean]
  runForge: [payload: ForgePayload]
}>()

const intent = reactive<IntentSections>({
  public: '',
  privateToDm: '',
  longTerm: '',
  triggers: '',
})

const forge = reactive<ForgePayload>({
  concept: '',
  identity: '',
  motivation: '',
  strength: '',
  storyTone: '',
  signatureWish: '',
  weaknesses: '',
  boundaries: '',
  extraNotes: '',
  fileHint: '',
})

const forgeOpen = ref(false)

watch(
  () => props.snapshot.myIntent,
  (next) => {
    intent.public = next.sections.public
    intent.privateToDm = next.sections.privateToDm
    intent.longTerm = next.sections.longTerm
    intent.triggers = next.sections.triggers
  },
  { immediate: true },
)

const controlledCharacters = computed(() =>
  props.snapshot.visibleCharacters.filter((character) =>
    props.snapshot.control.some((binding) => binding.characterPath === character.path),
  ),
)

const pendingTransfers = computed(() =>
  props.snapshot.control.filter((binding) => binding.pendingTransfer?.toSeat === props.session.seatName),
)

function save(status?: 'idle' | 'ready' | 'submitted') {
  emit('saveIntent', { ...intent }, status)
}

function submitForge() {
  emit('runForge', { ...forge })
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-crimson-700">My Characters</div>
            <div class="mt-1 font-serif text-2xl font-bold text-paper-950">
              {{ controlledCharacters.length ? controlledCharacters.length + ' controllable dossiers' : 'No bound character yet' }}
            </div>
          </div>
          <button
            @click="forgeOpen = !forgeOpen"
            class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:border-crimson-600 hover:text-crimson-700"
          >
            {{ forgeOpen ? 'Hide Forge' : 'Open Forge' }}
          </button>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <article v-for="character in controlledCharacters" :key="character.path" class="clash-card p-4">
            <div class="flex items-start gap-3">
              <div class="op-portrait !h-14 !w-14 !text-2xl">{{ character.name.slice(0, 1) }}</div>
              <div class="min-w-0">
                <div class="font-serif text-lg font-bold text-paper-950">{{ character.name }}</div>
                <div class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">{{ character.path }}</div>
              </div>
            </div>
            <div class="mt-3 whitespace-pre-wrap text-sm leading-6 text-paper-700">{{ character.concept || 'No concept extracted yet.' }}</div>
            <div v-if="character.currentSituation" class="mt-3 rounded-sm bg-paper-100 px-3 py-2 text-xs leading-6 text-paper-700">
              {{ character.currentSituation }}
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span v-if="character.stats.hp" class="stamp text-crimson-700">HP {{ character.stats.hp }}</span>
              <span v-if="character.stats.sp" class="stamp text-forest-700">SP {{ character.stats.sp }}</span>
              <span v-if="character.stats.ap != null" class="stamp text-navy-800">AP {{ character.stats.ap }}</span>
            </div>
          </article>
        </div>
      </div>

      <div v-if="pendingTransfers.length" class="hud-frame hatch-warn">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">Pending Transfers</div>
        <div class="space-y-3">
          <div v-for="binding in pendingTransfers" :key="binding.characterPath" class="clash-card p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ binding.label }}</div>
            <div class="mt-1 text-sm text-paper-700">DM wants to hand this character to your seat.</div>
            <div class="mt-3 flex gap-2">
              <button @click="emit('respondTransfer', binding.characterPath, true)" class="rounded-sm bg-forest-600 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                Accept
              </button>
              <button @click="emit('respondTransfer', binding.characterPath, false)" class="rounded-sm border border-paper-300 bg-white px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700">
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">My Intent Workspace</div>
          <div class="mt-1 text-sm text-white/75">每个席位独立提交；DM 再编排成回合包。</div>
        </div>
        <div class="space-y-4 p-4">
          <div class="grid gap-4 lg:grid-cols-2">
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Public</div>
              <textarea v-model="intent.public" rows="6" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Private For DM</div>
              <textarea v-model="intent.privateToDm" rows="6" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Long Term</div>
              <textarea v-model="intent.longTerm" rows="4" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Triggers</div>
              <textarea v-model="intent.triggers" rows="4" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button @click="save()" :disabled="busy" class="rounded-sm border border-paper-300 bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:border-crimson-600 hover:text-crimson-700 disabled:opacity-40">
              Save Draft
            </button>
            <button @click="save('ready')" :disabled="busy" class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white disabled:opacity-40">
              Mark Ready
            </button>
            <button @click="save('submitted')" :disabled="busy" class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-950 disabled:opacity-40">
              Submit To DM
            </button>
            <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">
              Current seat status: {{ snapshot.seats.find((seat) => seat.name === session.seatName)?.status || 'idle' }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div v-if="round" class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">Round Status</div>
        <div class="space-y-2 text-sm leading-6 text-paper-700">
          <div><span class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">Kind</span> {{ round.kind }}</div>
          <div><span class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">Status</span> {{ round.status }}</div>
          <div><span class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">Participants</span> {{ round.participantSeats.join(', ') || 'none' }}</div>
        </div>
      </div>

      <div v-if="forgeOpen" class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">AI Character Forge</div>
        </div>
        <div class="space-y-3 p-4">
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Concept</div>
            <textarea v-model="forge.concept" rows="5" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Identity / Background</div>
            <textarea v-model="forge.identity" rows="3" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Motivation</div>
            <textarea v-model="forge.motivation" rows="3" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Strength</div>
              <input v-model="forge.strength" class="clash-input w-full px-3 py-2 text-sm" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Tone</div>
              <input v-model="forge.storyTone" class="clash-input w-full px-3 py-2 text-sm" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Signature Wish</div>
              <input v-model="forge.signatureWish" class="clash-input w-full px-3 py-2 text-sm" />
            </label>
            <label class="space-y-1">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">File Hint</div>
              <input v-model="forge.fileHint" class="clash-input w-full px-3 py-2 text-sm" />
            </label>
          </div>
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Weaknesses / Costs</div>
            <textarea v-model="forge.weaknesses" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Boundaries</div>
            <textarea v-model="forge.boundaries" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>
          <label class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Extra Notes</div>
            <textarea v-model="forge.extraNotes" rows="2" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
          </label>

          <button @click="submitForge" :disabled="busy" class="w-full rounded-sm border border-ochre-300 bg-ochre-500 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-paper-950 disabled:opacity-40">
            Run Forge
          </button>
        </div>
      </div>

      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">Visible Shared Board</div>
        <pre class="max-h-[28rem] overflow-auto whitespace-pre-wrap text-sm leading-7 text-paper-700">{{ snapshot.sharedBoard?.content || 'No shared board yet.' }}</pre>
      </div>
    </section>
  </div>
</template>
