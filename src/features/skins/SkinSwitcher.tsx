import { useRef, useState } from 'react'
import { useSkinStore } from '../../state/skinStore'

/** 皮肤切换器：内置主题下拉 + 用户皮肤 JSON 导入。 */
export function SkinSwitcher() {
  const skins = useSkinStore((s) => s.skins)
  const activeId = useSkinStore((s) => s.activeId)
  const activate = useSkinStore((s) => s.activate)
  const loadUserSkin = useSkinStore((s) => s.loadUserSkin)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (file === undefined) return
    const result = loadUserSkin(await file.text())
    if (result.ok) {
      setError(null)
      activate(result.skin.id)
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="skin-switcher">
      <label htmlFor="skin-select">皮肤</label>
      <select id="skin-select" value={activeId} onChange={(event) => activate(event.target.value)}>
        {skins.map((skin) => (
          <option key={skin.id} value={skin.id}>
            {skin.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        导入
      </button>
      {error !== null && (
        <span className="skin-error" title={error}>
          {error}
        </span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden-input"
        onChange={(event) => void handleFile(event.target.files)}
      />
    </div>
  )
}
