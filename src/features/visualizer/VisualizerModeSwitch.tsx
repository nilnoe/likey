import { useVisualizerModeStore, type VisualizerMode } from '../../state/visualizerModeStore'

const OPTIONS: ReadonlyArray<{ value: VisualizerMode; label: string }> = [
  { value: 'liquid', label: '液体音浪' },
  { value: 'chunky', label: '加宽柱' },
  { value: 'bars', label: '频谱柱' },
]

/** 律动形态切换器：液体剪影 ↔ 经典频谱柱，随时对比。 */
export function VisualizerModeSwitch() {
  const mode = useVisualizerModeStore((s) => s.mode)
  const setMode = useVisualizerModeStore((s) => s.setMode)

  return (
    <div className="skin-switcher">
      <label htmlFor="visualizer-mode-select">律动</label>
      <select
        id="visualizer-mode-select"
        value={mode}
        onChange={(event) => {
          const next = OPTIONS.find((option) => option.value === event.target.value)
          if (next !== undefined) setMode(next.value)
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
