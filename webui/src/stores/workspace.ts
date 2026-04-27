import { defineStore } from 'pinia'
import { fetchFile, fetchTree, type FilePayload, type TreeNode } from '../lib/api'

export type Panel = 'dm' | 'player'

interface State {
  panel: Panel
  tree: TreeNode | null
  treeLoading: boolean
  treeError: string | null

  currentPath: string | null
  current: FilePayload | null
  fileLoading: boolean
  fileError: string | null
}

const DEFAULT_FILES: Record<Panel, string | null> = {
  dm: 'dm_guide/DM核心手册.md',
  // Player panel boots into the game-style Hub instead of a doc
  player: null,
}

export const useWorkspaceStore = defineStore('workspace', {
  state: (): State => ({
    panel: (localStorage.getItem('gz.panel') as Panel) || 'dm',
    tree: null,
    treeLoading: false,
    treeError: null,
    currentPath: null,
    current: null,
    fileLoading: false,
    fileError: null,
  }),
  actions: {
    async setPanel(p: Panel) {
      if (this.panel === p) return
      this.panel = p
      localStorage.setItem('gz.panel', p)
      this.tree = null
      this.current = null
      this.currentPath = null
      await this.loadTree()
      const def = DEFAULT_FILES[p]
      if (def) {
        this.openFile(def).catch(() => {
          /* ok if it doesn't exist */
        })
      }
    },
    async loadTree() {
      this.treeLoading = true
      this.treeError = null
      try {
        const { tree } = await fetchTree(this.panel)
        this.tree = tree
      } catch (e: any) {
        this.treeError = e?.message || String(e)
      } finally {
        this.treeLoading = false
      }
    },
    async openFile(relPath: string) {
      if (!relPath) return
      this.fileLoading = true
      this.fileError = null
      this.currentPath = relPath
      try {
        this.current = await fetchFile(this.panel, relPath)
      } catch (e: any) {
        this.fileError = e?.message || String(e)
        this.current = null
      } finally {
        this.fileLoading = false
      }
    },
    goHome() {
      this.currentPath = null
      this.current = null
      this.fileError = null
    },
    async bootstrap() {
      await this.loadTree()
      const def = DEFAULT_FILES[this.panel]
      if (def) {
        this.openFile(def).catch(() => {
          /* ignore */
        })
      }
    },
  },
})
