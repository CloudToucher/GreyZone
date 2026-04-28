import { defineStore } from 'pinia'
import { startRound as apiStart, streamRound, type ForgePayload, type RoundEvent } from '../lib/api'
import { usePlayerStore } from './players'
import { useWorkspaceStore } from './workspace'

function extractCreatedCharacterPath(output: string): string | null {
  const section = output.match(/##\s*已写入文件\s*([\s\S]*?)(?=\n##\s|$)/)
  const body = section?.[1] || output
  const m = body.match(/characters\/active\/[\w\-\u4e00-\u9fa5\.]+\.md/)
  return m?.[0] || null
}

export type RoundStatus = 'idle' | 'starting' | 'running' | 'done' | 'error'
export type RoundKind = 'action' | 'forge'

interface State {
  roundId: string | null
  status: RoundStatus
  kind: RoundKind
  events: RoundEvent[]
  output: string // concatenated stdout for easy reading
  errorMsg: string | null
  startedAt: number | null
  endedAt: number | null
  exitCode: number | null
  createdCharacterPath: string | null
  closer: (() => void) | null
}

export const useRoundStore = defineStore('round', {
  state: (): State => ({
    roundId: null,
    status: 'idle',
    kind: 'action',
    events: [],
    output: '',
    errorMsg: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    createdCharacterPath: null,
    closer: null,
  }),
  actions: {
    reset() {
      this.closer?.()
      this.roundId = null
      this.status = 'idle'
      this.kind = 'action'
      this.events = []
      this.output = ''
      this.errorMsg = null
      this.startedAt = null
      this.endedAt = null
      this.exitCode = null
      this.createdCharacterPath = null
      this.closer = null
    },
    async startRound(payload: {
      action: string
      character?: string
      prompt?: string
      forge?: ForgePayload
      kind?: RoundKind
    }) {
      // Replace any previous round
      this.reset()
      this.kind = payload.kind || 'action'
      this.status = 'starting'
      this.startedAt = Date.now()
      try {
        const ws = useWorkspaceStore()
        const ply = usePlayerStore()
        const { roundId } = await apiStart({
          panel: ws.panel,
          player: ws.panel === 'player' ? ply.currentName : undefined,
          action: payload.action,
          character: payload.character,
          prompt: payload.prompt,
          forge: payload.forge,
          kind: payload.kind,
        })
        this.roundId = roundId
        this.status = 'running'
        this.handleEvent({
          type: 'meta',
          data: JSON.stringify({ phase: 'round_created', roundId }),
          ts: Date.now(),
        })
        this.closer = streamRound(
          roundId,
          (ev) => this.handleEvent(ev),
          () =>
            this.handleEvent({
              type: 'meta',
              data: JSON.stringify({ phase: 'stream_open', roundId }),
              ts: Date.now(),
            }),
        )
      } catch (e: any) {
        this.status = 'error'
        this.errorMsg = e?.message || String(e)
      }
    },
    handleEvent(ev: RoundEvent) {
      this.events.push(ev)
      if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000)
      if (ev.type === 'stdout' && ev.data) {
        this.output += ev.data
        if (this.kind === 'forge' && !this.createdCharacterPath) {
          this.createdCharacterPath = extractCreatedCharacterPath(this.output)
        }
      }
      if (ev.type === 'error' && ev.data) this.errorMsg = ev.data
      if (ev.type === 'end') {
        this.status = ev.code === 0 ? 'done' : this.errorMsg ? 'error' : 'done'
        this.exitCode = ev.code ?? null
        this.endedAt = Date.now()
        if (this.kind === 'forge' && !this.createdCharacterPath) {
          this.createdCharacterPath = extractCreatedCharacterPath(this.output)
        }
        this.closer?.()
        this.closer = null
      }
    },
  },
})
