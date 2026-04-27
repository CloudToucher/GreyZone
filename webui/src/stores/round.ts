import { defineStore } from 'pinia'
import { startRound as apiStart, streamRound, type RoundEvent } from '../lib/api'

export type RoundStatus = 'idle' | 'starting' | 'running' | 'done' | 'error'

interface State {
  roundId: string | null
  status: RoundStatus
  events: RoundEvent[]
  output: string // concatenated stdout for easy reading
  errorMsg: string | null
  startedAt: number | null
  endedAt: number | null
  exitCode: number | null
  closer: (() => void) | null
}

export const useRoundStore = defineStore('round', {
  state: (): State => ({
    roundId: null,
    status: 'idle',
    events: [],
    output: '',
    errorMsg: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    closer: null,
  }),
  actions: {
    reset() {
      this.closer?.()
      this.roundId = null
      this.status = 'idle'
      this.events = []
      this.output = ''
      this.errorMsg = null
      this.startedAt = null
      this.endedAt = null
      this.exitCode = null
      this.closer = null
    },
    async startRound(payload: { action: string; character?: string; prompt?: string }) {
      // Replace any previous round
      this.reset()
      this.status = 'starting'
      this.startedAt = Date.now()
      try {
        const { roundId } = await apiStart(payload)
        this.roundId = roundId
        this.status = 'running'
        this.closer = streamRound(roundId, (ev) => this.handleEvent(ev))
      } catch (e: any) {
        this.status = 'error'
        this.errorMsg = e?.message || String(e)
      }
    },
    handleEvent(ev: RoundEvent) {
      this.events.push(ev)
      if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000)
      if (ev.type === 'stdout' && ev.data) this.output += ev.data
      if (ev.type === 'error' && ev.data) this.errorMsg = ev.data
      if (ev.type === 'end') {
        this.status = ev.code === 0 ? 'done' : this.errorMsg ? 'error' : 'done'
        this.exitCode = ev.code ?? null
        this.endedAt = Date.now()
        this.closer?.()
        this.closer = null
      }
    },
  },
})
