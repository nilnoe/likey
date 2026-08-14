import { useEffect, useRef } from 'react'
import { SpectrumBarRenderer } from '../../core/visualizer/SpectrumBarRenderer'
import type { PlayerEngine } from '../player/usePlayerEngine'

/**
 * 频谱可视化画布：统一 rAF 循环驱动 core 渲染器。
 * 每帧拉取频谱帧 → 节拍检测（仅播放中）→ renderer.render。
 */
export function VisualizerCanvas({ engine }: { engine: PlayerEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const renderer = new SpectrumBarRenderer()
    renderer.mount(canvas)

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
    }
  }, [engine])

  return <canvas ref={canvasRef} className="visualizer-canvas" />
}
