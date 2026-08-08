/* 设置页 — 通用（显示比例）/ 数据（存储位置）/ 关于（版本与链接）。
   缩放用 CSS zoom 作用于 #root，等价于 Electron 的 webFrame.setZoomFactor，
   但在 vite dev / 浏览器里没有 Electron 桥时也同样生效。 */

import { useEffect, useState } from 'react'
import {
  ArrowSquareOut,
  CaretLeft,
  FolderOpen,
  Gear,
  HardDrive,
  Info,
  Monitor,
} from '@phosphor-icons/react'
import { NavLink } from 'react-router'
import type { SystemInfo } from './api'

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

const REPO = 'https://github.com/Hariketsu/ClassOwl'

const SECTIONS = [
  { key: 'general', name: '通用', icon: Gear },
  { key: 'data', name: '数据', icon: HardDrive },
  { key: 'about', name: '关于', icon: Info },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

function useSystemInfo(): SystemInfo | null {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    let alive = true
    window.classowl?.system?.info?.()
      .then((value) => { if (alive) setInfo(value) })
      .catch(() => { /* 桥不可用时保持 null，界面按开发模式降级 */ })
    return () => { alive = false }
  }, [])
  return info
}

function GeneralSection() {
  const [scale, setScale] = useState(readDisplayScale)
  const choose = (value: number) => {
    setScale(value)
    try {
      localStorage.setItem(ZOOM_KEY, String(value))
    } catch { /* 隐私模式等场景下放弃持久化，缩放仍然生效 */ }
    applyDisplayScale(value)
  }

  return <section className="settings-body" aria-labelledby="display-scale-title">
    <h2 id="display-scale-title"><Monitor />显示比例</h2>
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
}

function DataSection() {
  const info = useSystemInfo()
  const openLabel = info?.platform === 'win32' ? '在资源管理器中打开' : '在 Finder 中打开'

  return <section className="settings-body" aria-labelledby="data-title">
    <h2 id="data-title"><HardDrive />数据存储</h2>
    <p className="settings-hint">
      所有课表数据都保存在本机这个目录里（SQLite 数据库、撤销历史、后端日志）。卸载应用不会删除该目录。
    </p>
    {info
      ? <div className="data-location">
          <code className="data-path">{info.dataDir}</code>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void window.classowl?.system?.openDataDir?.()}
          >
            <FolderOpen />{openLabel}
          </button>
        </div>
      : <p className="settings-hint">数据目录信息仅在桌面应用中可用。</p>}
  </section>
}

function AboutSection() {
  const info = useSystemInfo()
  const links = [
    { name: 'Release notes', href: `${REPO}/releases` },
    { name: '问题反馈', href: `${REPO}/issues` },
    { name: '开源许可', href: `${REPO}/blob/main/LICENSE` },
    { name: '致谢', href: `${REPO}/blob/main/NOTICE` },
  ]

  return <section className="settings-body settings-about" aria-labelledby="about-title">
    <img className="about-icon" src="/brand/app-icon-256.png" alt="" width="96" height="96" />
    <h2 id="about-title" className="about-name">ClassOwl</h2>
    <p className="about-version">版本 {info ? info.version : '开发模式'}</p>
    <p className="settings-hint about-desc">
      中小学教务排课应用，从班级作息到课表导出，五步走完整个排课流程。<br />
      完全离线：数据不出本机，应用只与本机后端通信。
    </p>
    <div className="about-actions">
      <a className="about-btn" href={`${REPO}/releases`} target="_blank" rel="noreferrer">
        检查更新
      </a>
    </div>
    <nav className="about-links" aria-label="相关链接">
      {links.map((link) => <a key={link.name} href={link.href} target="_blank" rel="noreferrer">
        {link.name}<ArrowSquareOut />
      </a>)}
    </nav>
  </section>
}

export function SettingsPage() {
  const [section, setSection] = useState<SectionKey>('general')

  return <div className="plan-page">
    <header className="plan-header settings-header">
      <NavLink className="shell-back" to="/plans"><CaretLeft />方案中心</NavLink>
    </header>
    <main className="plan-main">
      <div className="settings-inner">
        <nav className="settings-nav" aria-label="设置分类">
          <h1>设置</h1>
          {SECTIONS.map(({ key, name, icon: Icon }) => <button
            key={key}
            type="button"
            className={`settings-nav-item${section === key ? ' on' : ''}`}
            aria-current={section === key ? 'page' : undefined}
            onClick={() => setSection(key)}
          >
            <Icon />{name}
          </button>)}
        </nav>
        {section === 'general' && <GeneralSection />}
        {section === 'data' && <DataSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </main>
  </div>
}
