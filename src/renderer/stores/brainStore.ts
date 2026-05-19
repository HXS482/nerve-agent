import { create } from 'zustand'
import type { MemoryBrowserData, MemoryAtom, SceneBlock, PersonaCard, ConvEntry } from '../../shared/types'

interface BrainState {
  data: MemoryBrowserData
  activeLayer: 'L0' | 'L1' | 'L2' | 'L3'
  selectedItem: MemoryAtom | SceneBlock | PersonaCard | ConvEntry | null
  selectedItemType: 'L0' | 'L1' | 'L2' | 'L3' | null
  itemContent: string | null
  loading: boolean

  scan: () => Promise<void>
  setLayer: (layer: 'L0' | 'L1' | 'L2' | 'L3') => void
  selectItem: (item: MemoryAtom | SceneBlock | PersonaCard | ConvEntry | null, type: 'L0' | 'L1' | 'L2' | 'L3') => Promise<void>
}

export const useBrainStore = create<BrainState>((set) => ({
  data: { L0: [], L1: [], L2: [], L3: { content: '', updated: '' } },
  activeLayer: 'L1',
  selectedItem: null,
  selectedItemType: null,
  itemContent: null,
  loading: false,

  scan: async () => {
    set({ loading: true })
    try {
      const data = await (window as any).claude.brainScan()
      set({ data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setLayer: (layer) => {
    set({ activeLayer: layer, selectedItem: null, selectedItemType: null, itemContent: null })
  },

  selectItem: async (item, type) => {
    if (!item) {
      set({ selectedItem: null, selectedItemType: null, itemContent: null })
      return
    }
    set({ selectedItem: item, selectedItemType: type })

    // For L1/L0 items, fetch full content
    if (type === 'L1' || type === 'L0') {
      try {
        const id = (item as any).id
        const content = await (window as any).claude.brainReadFile(type, id)
        set({ itemContent: content })
      } catch {
        set({ itemContent: null })
      }
    } else if (type === 'L2') {
      set({ itemContent: (item as SceneBlock).summary || '' })
    } else if (type === 'L3') {
      set({ itemContent: (item as PersonaCard).content || '' })
    }
  },
}))
