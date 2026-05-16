import { create } from 'zustand'
import type { BrainGraphData, BrainFileContent, BrainNode } from '../../shared/types'

interface BrainState {
  graphData: BrainGraphData
  selectedNode: BrainNode | null
  selectedFile: BrainFileContent | null
  loading: boolean

  scan: () => Promise<void>
  selectNode: (node: BrainNode | null) => Promise<void>
}

export const useBrainStore = create<BrainState>((set) => ({
  graphData: { nodes: [], links: [] },
  selectedNode: null,
  selectedFile: null,
  loading: false,

  scan: async () => {
    set({ loading: true })
    try {
      const data = await (window as any).claude.brainScan()
      set({ graphData: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  selectNode: async (node) => {
    if (!node) {
      console.log('[Brain] selectNode: null, clearing')
      set({ selectedNode: null, selectedFile: null })
      return
    }
    console.log('[Brain] selectNode:', node.id, node.path)
    set({ selectedNode: node })
    try {
      const file = await (window as any).claude.brainReadFile(node.path)
      console.log('[Brain] file read result:', file ? 'ok' : 'null', node.path)
      set({ selectedFile: file })
    } catch (err) {
      console.error('[Brain] file read error:', err)
      set({ selectedFile: null })
    }
  },
}))
