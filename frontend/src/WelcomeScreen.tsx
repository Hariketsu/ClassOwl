/* 首访欢迎层 — 只在「0 个方案且从未见过欢迎层」时出现一次（localStorage 记忆）。
   三入口：打开完整示例（主）/ 新建空白 / 导入。看完即走，不再出现。 */

import { ChalkboardTeacher, Plus, UploadSimple } from '@phosphor-icons/react'

export const WELCOME_KEY = 'classowl.welcomed'

export function readWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1'
  } catch {
    return false
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOME_KEY, '1')
  } catch { /* 隐私模式等场景下放弃记忆，欢迎层下次还会来 */ }
}

export function WelcomeScreen({ onSample, onBlank, onImport, onSkip }: {
  onSample: () => void
  onBlank: () => void
  onImport: () => void
  onSkip: () => void
}) {
  return <div className="plan-page welcome-page">
    {/* 无边框窗口的拖拽区兼红绿灯让位，与 .plan-header 同高 */}
    <header className="welcome-top" />
    <main className="welcome-main">
      <img className="welcome-mark" src="/brand/mark-128.png" alt="" width="64" height="64" />
      <h1>欢迎使用 ClassOwl</h1>
      <p className="welcome-sub">
        从基础作息到预览导出，五步完成全校排课。第一次来？建议先看看一份排好的完整课表。
      </p>
      <div className="welcome-options">
        <div className="welcome-card featured">
          <span className="welcome-card-avatar tone-coral"><ChalkboardTeacher weight="fill" /></span>
          <h3>看看完整示例</h3>
          <p>打开一份已排好的完整课表，随便点点看。</p>
          <button type="button" className="btn btn-primary welcome-card-btn" onClick={onSample}>打开示例方案</button>
        </div>
        <div className="welcome-card">
          <span className="welcome-card-avatar tone-lavender"><Plus weight="bold" /></span>
          <h3>从空白开始</h3>
          <p>从班级作息开始，五步排出自己学校的课表。</p>
          <button type="button" className="btn btn-secondary welcome-card-btn" onClick={onBlank}>新建空白方案</button>
        </div>
        <div className="welcome-card">
          <span className="welcome-card-avatar tone-peach"><UploadSimple /></span>
          <h3>导入方案</h3>
          <p>导入之前导出的 .zip 方案文件，接着上次的进度继续。</p>
          <button type="button" className="btn btn-secondary welcome-card-btn" onClick={onImport}>选择文件</button>
        </div>
      </div>
      <button type="button" className="welcome-skip" onClick={onSkip}>先随便看看</button>
    </main>
  </div>
}
