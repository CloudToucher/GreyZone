import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/** Built-in players — extend by adding to active character sheets */
const KNOWN: { name: string; color: string }[] = [
  { name: '铁鼠', color: '#dc2626' },
  { name: '锯子', color: '#0f172a' },
  { name: '老高', color: '#ca8a04' },
  { name: 'DM', color: '#6366f1' },
]

const STORAGE_KEY = 'gz.player'

export type Visibility = 'public' | 'dm-only' | 'private'

export interface ActionEntry {
  id: string
  player: string
  visibility: Visibility
  content: string
  ts: number
}

export const usePlayerStore = defineStore('players', () => {
  const currentName = ref(localStorage.getItem(STORAGE_KEY) || '铁鼠')
  const roster = ref(KNOWN)

  const isDM = computed(() => currentName.value === 'DM')

  const currentPlayer = computed(() =>
    roster.value.find((p) => p.name === currentName.value) || roster.value[0],
  )

  function setPlayer(name: string) {
    currentName.value = name
    localStorage.setItem(STORAGE_KEY, name)
  }

  function canSee(entry: ActionEntry): boolean {
    if (isDM.value) return true
    if (entry.visibility === 'dm-only') return false
    if (entry.visibility === 'private' && entry.player !== currentName.value) return false
    return true
  }

  /** Scan active character files for player names */
  async function syncFromCharacters(paths: string[]) {
    const names = new Set(roster.value.map((p) => p.name))
    for (const p of paths) {
      const name = p.split('/').pop()?.replace(/\.md$/i, '') || ''
      if (name && name !== '示例_铁鼠') names.add(name)
    }
    roster.value = [...names].map((name) => {
      const existing = roster.value.find((p) => p.name === name)
      return existing || { name, color: '#64748b' }
    })
  }

  return {
    currentName,
    currentPlayer,
    roster,
    isDM,
    setPlayer,
    canSee,
    syncFromCharacters,
  }
})
