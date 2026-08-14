import { useEffect, useRef } from 'react'
import { SpectrumBarRenderer } from '../../core/visualizer/SpectrumBarRenderer'
import { useSkinStore } from '../../state/skinStore'
import { useVisualizerModeStore } from '../../state/visualizerModeStore'
import type { PlayerEngine } from '../player/usePlayerEngine'

/**
 * 频谱可视化画布：统一 rAF 循环驱动 core 渲染器。
 * 每帧拉取频谱帧 → 节拍检测（仅播放中）→ renderer.render。
 * 皮肤切换时同步 extractor 柱数与 renderer 样式参数。
 */
export function VisualizerCanvas({ engine }: { engine: PlayerEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SpectrumBarRenderer | null>(null)
  const spectrumStyle = useSkinStore(
    (s) => s.skins.find((skin) => skin.id === s.activeId)?.spectrumStyle,
  )
  const mode = useVisualizerModeStore((s) => s.mode)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const renderer = new SpectrumBarRenderer()
    renderer.mount(canvas)
    rendererRef.current = renderer

    let raf = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const frame = engine.extractor.nextFrame()
      const status = engine.player.getStatus()
      const beatStrength =
        status.kind === 'playing'
          ? (engine.detector.update(frame.lowEnergy, engine.player.getPosition() * 1000)
              ?.strength ?? 0)
          : 0
      renderer.render(frame, beatStrength)
    }
    raf = requestAnimationFrame(loop)

    const handleResize = (): void => {
      renderer.resize()
    }
    window.addEventListener('resize', handleResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', handleResize)
      rendererRef.current = null
    }
  }, [engine])

  // 皮肤/形态切换 → 柱数同步提取器，样式参数注入渲染器
  useEffect(() => {
    if (spectrumStyle === undefined) return
    engine.extractor.setBarCount(spectrumStyle.barCount)
    rendererRef.current?.setStyle({ ...spectrumStyle, mode })
  }, [spectrumStyle, mode, engine])

  return <canvas ref={canvasRef} className="visualizer-canvas" />
}
