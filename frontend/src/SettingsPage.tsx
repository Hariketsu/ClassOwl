/* 设置页 — 目前只有「显示」一节：显示比例。
   缩放用 CSS zoom 作用于 #root，等价于 Electron 的 webFrame.setZoomFactor，
   但在 vite dev / 浏览器里没有 Electron 桥时也同样生效。 */

import { useState } from 'react'
import { CaretLeft, Monitor } from '@phosphor-icons/react'
import { NavLink } from 'react-router'

const ZOOM_KEY = 'classowl.zoom'

export const DISPLAY_SCALES = [
  { value: 0.9, name: '紧凑', detail: '90% · 一屏放下更多课表' },
  { value: 1, name: '标准', detail: '100% · 默认' },
  { value: 1.1, name: '舒适', detail: '110% · 长时间操作更轻松' },
  { value: 1.25, name: '特大', detail: '125% · 投影 / 远距观看' },
] as const

export function readDisplayScale(): number {
  try {
    const raw = Number(localStorage.getItem(ZOOM_KEY))
    return DISPLAY_SCALES.some((item) => item.value === raw) ? raw : 1
  } catch {
    return 1
  }
}

export function applyDisplayScale(scale: number): void {
  document.getElementById('root')?.style.setProperty('zoom', String(scale))
}

export function SettingsPage() {
  const [scale, setScale] = useState(readDisplayScale)
  const choose = (value: number) => {
    setScale(value)
    try {
      localStorage.setItem(ZOOM_KEY, String(value))
    } catch { /* 隐私模式等场景下放弃持久化，缩放仍然生效 */ }
    applyDisplayScale(value)
  }

  return <div className="plan-page">
    <header className="plan-header settings-header">
      <NavLink className="shell-back" to="/plans"><CaretLeft />方案中心</NavLink>
    </header>
    <main className="plan-main">
      <div className="settings-inner">
        <nav className="settings-nav" aria-label="设置分类">
          <h1>设置</h1>
          <span className="settings-nav-item on" aria-current="page"><Monitor />显示</span>
        </nav>
        <section className="settings-body" aria-labelledby="display-scale-title">
          <h2 id="display-scale-title">显示比例</h2>
          <p className="settings-hint">
            调整整个应用的界面缩放，立即生效并自动保存。外接显示器或投影到教室大屏时，可以调大一档。
          </p>
          <div className="scale-opts" role="radiogroup" aria-label="显示比例">
            {DISPLAY_SCALES.map((item) => <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={scale === item.value}
              className={`scale-opt${scale === item.value ? ' on' : ''}`}
              onClick={() => choose(item.value)}
            >
              <span className="scale-opt-name">{item.name}</span>
              <span className="scale-opt-detail">{item.detail}</span>
            </button>)}
          </div>
        </section>
      </div>
    </main>
  </div>
}
