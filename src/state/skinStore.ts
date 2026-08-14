import { create } from 'zustand'
import { BUILTIN_SKINS, parseSkin, type Skin, type SkinParseResult } from '../core/skins/skin'

/** 皮肤 UI 状态（zustand）：内置皮肤 + 用户皮肤，激活即全应用生效。 */
interface SkinStoreState {
  readonly skins: readonly Skin[]
  readonly activeId: string
  activate(id: string): void
  /** 加载用户皮肤 JSON；校验失败返回错误（不崩溃）。 */
  loadUserSkin(json: string): SkinParseResult
}

export const useSkinStore = create<SkinStoreState>((set, get) => ({
  skins: BUILTIN_SKINS,
  activeId: BUILTIN_SKINS[0]?.id ?? 'classic',

  activate: (id) => {
    if (get().skins.some((skin) => skin.id === id)) {
      set({ activeId: id })
    }
  },

  loadUserSkin: (json) => {
    const result = parseSkin(json)
    if (result.ok && !get().skins.some((skin) => skin.id === result.skin.id)) {
      set({ skins: [...get().skins, result.skin] })
    }
    return result
  },
}))
