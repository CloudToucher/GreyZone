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
const CHARACTER_STORAGE_KEY = 'gz.player.character'

export type Visibility = 'public' | 'dm-only' | 'private'

export interface ActionEntry {
  id: string
  player: string
  visibility: Visibility
  content: string
  ts: number
}

export interface PlayerCharacterBinding {
  playerName: string
  characterPath: string
  characterTitle: string
}

export interface CharacterBindingSeed {
  path: string
  title: string
  controller?: string | null
}

export const usePlayerStore = defineStore('players', () => {
  const currentName = ref(localStorage.getItem(STORAGE_KEY) || '铁鼠')
  const currentCharacterPath = ref(localStorage.getItem(CHARACTER_STORAGE_KEY) || '')
  const roster = ref(KNOWN)
  const bindings = ref<PlayerCharacterBinding[]>([])

  const isDM = computed(() => currentName.value === 'DM')

  const currentPlayer = computed(() =>
    roster.value.find((p) => p.name === currentName.value) || roster.value[0],
  )

  const currentBinding = computed(() =>
    bindings.value.find((b) => b.playerName === currentName.value) || null,
  )

  function setPlayer(name: string) {
    currentName.value = name
    localStorage.setItem(STORAGE_KEY, name)
    const binding = bindings.value.find((b) => b.playerName === name)
    currentCharacterPath.value = binding?.characterPath || ''
    localStorage.setItem(CHARACTER_STORAGE_KEY, currentCharacterPath.value)
  }

  function bindCharacter(playerName: string, characterPath: string, characterTitle: string) {
    if (!playerName) return
    const idx = bindings.value.findIndex((b) => b.playerName === playerName)
    const next = { playerName, characterPath, characterTitle }
    if (idx >= 0) bindings.value.splice(idx, 1, next)
    else bindings.value.push(next)
    if (!roster.value.some((p) => p.name === playerName)) {
      roster.value.push({ name: playerName, color: '#64748b' })
    }
    if (playerName === currentName.value) {
      currentCharacterPath.value = characterPath
      localStorage.setItem(CHARACTER_STORAGE_KEY, characterPath)
    }
  }

  function canSee(entry: ActionEntry): boolean {
    if (isDM.value) return true
    if (entry.visibility === 'dm-only') return false
    if (entry.visibility === 'private' && entry.player !== currentName.value) return false
    return true
  }

  function syncFromCharacters(records: CharacterBindingSeed[]) {
    const names = new Set(roster.value.map((p) => p.name))
    for (const record of records) {
      const title = record.title || record.path.split('/').pop()?.replace(/\.md$/i, '') || record.path
      if (record.controller) {
        names.add(record.controller)
        bindCharacter(record.controller, record.path, title)
      }
    }
    roster.value = [...names].map((name) => {
      const existing = roster.value.find((p) => p.name === name)
      return existing || { name, color: '#64748b' }
    })

    const binding = bindings.value.find((b) => b.playerName === currentName.value)
    currentCharacterPath.value = binding?.characterPath || currentCharacterPath.value || ''
    localStorage.setItem(CHARACTER_STORAGE_KEY, currentCharacterPath.value)
  }

  return {
    currentName,
    currentCharacterPath,
    currentPlayer,
    currentBinding,
    roster,
    bindings,
    isDM,
    setPlayer,
    bindCharacter,
    canSee,
    syncFromCharacters,
  }
})
