/* 共享 UI 组件 — 对应 designs/classowl-flow/ui.jsx（原型未随仓库公开），沿用同一批类名 */

import { useCallback, useEffect, useRef, useState, type DragEventHandler, type MouseEventHandler, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { colorFor, courseName, teacherName, type Placement, type Workspace } from './workspace'

export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((message: string) => {
    setToast(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { toast, show }
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="toast" role="status" aria-live="polite">{message}</div>
}

export function Modal({ title, children, onClose, footer, wide, drawer, closable = true }: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
  drawer?: boolean
  closable?: boolean
}) {
  useEffect(() => {
    if (!closable) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closable, onClose])

  return <div
    className={`overlay${drawer ? ' drawer-right' : ''}`}
    onMouseDown={(event) => {
      if (closable && event.target === event.currentTarget) onClose()
    }}
  >
    <div
      className={`modal${drawer ? ' drawer' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={wide ? { width: 'min(760px, 100%)' } : undefined}
    >
      <div className="modal-head">
        <h3>{title}</h3>
        {closable && <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={14} weight="bold" /></button>}
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  </div>
}

export function ConfirmModal({ title, message, confirmLabel, danger, countdown = 0, onConfirm, onClose }: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  countdown?: number
  onConfirm: () => void
  onClose: () => void
}) {
  const [left, setLeft] = useState(countdown)

  useEffect(() => {
    if (countdown <= 0) return
    setLeft(countdown)
    const tick = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          clearInterval(tick)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [countdown])

  return <Modal
    title={title}
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        className={`btn ${danger ? 'btn-danger' : 'btn-primary'} countdown-btn`}
        disabled={left > 0}
        onClick={onConfirm}
      >
        {left > 0 ? `${confirmLabel} (${left}s)` : confirmLabel}
      </button>
    </>}
  >
    <p style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>
  </Modal>
}

/** 替代原型里的 prompt()，保持可访问与可测试 */
export function PromptModal({ title, label, defaultValue = '', confirmLabel = '确定', onConfirm, onClose }: {
  title: string
  label: string
  defaultValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(defaultValue)
  const submit = () => onConfirm(value)

  return <Modal
    title={title}
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>{confirmLabel}</button>
    </>}
  >
    <div className="field">
      <label htmlFor="prompt-modal-input">{label}</label>
      <input
        id="prompt-modal-input"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) submit()
        }}
      />
    </div>
  </Modal>
}

type LessonItem = { courseId: string; teacherId: string; locked?: boolean }

export function LessonCard({ workspace, item, selected, onClick, draggable = true, onDragStart, dim }: {
  workspace: Workspace
  item: LessonItem
  selected?: boolean
  onClick?: MouseEventHandler<HTMLDivElement>
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLDivElement>
  dim?: boolean
}) {
  const cname = courseName(workspace, item.courseId)
  const tname = teacherName(workspace, item.teacherId)
  const color = colorFor(cname)
  return <div
    className={`lesson${item.locked ? ' locked' : ''}${selected ? ' selected' : ''}${dim ? ' conflict' : ''}`}
    style={{ background: color.bg, color: color.fg, borderColor: color.border, opacity: dim ? 0.95 : 1 }}
    draggable={draggable && !item.locked}
    onDragStart={(event) => {
      if (!draggable || item.locked) return
      onDragStart?.(event)
    }}
    onClick={onClick}
    title={`${cname} · ${tname}${item.locked ? '（已锁定）' : ''}`}
  >
    <div className="cn">{cname}</div>
    <div className="tn">{tname || '未指定教师'}</div>
  </div>
}

export function MiniSchedule({ workspace, filterFn, cellText }: {
  workspace: Workspace
  filterFn: (item: Placement) => boolean
  cellText?: (item: Placement) => string
}) {
  const { days, periods } = workspace
  return <table className="sched">
    <thead>
      <tr>
        <th className="period-label">节</th>
        {days.map((day) => <th key={day.id}>{day.short}</th>)}
      </tr>
    </thead>
    <tbody>
      {periods.map((period) => <tr key={period.id}>
        <td className="period-label">{period.id}</td>
        {days.map((day) => {
          const list = workspace.placements.filter((item) => item.dayId === day.id && item.periodId === period.id && filterFn(item))
          return <td key={day.id} style={{ height: 54 }}>
            {list.map((item) => {
              const color = colorFor(courseName(workspace, item.courseId))
              return <div
                key={item.id}
                className="lesson"
                style={{ background: color.bg, color: color.fg, borderColor: color.border, cursor: 'default', fontSize: 10 }}
              >
                <div className="cn">{courseName(workspace, item.courseId)}</div>
                <div className="tn">{cellText ? cellText(item) : teacherName(workspace, item.teacherId)}</div>
              </div>
            })}
          </td>
        })}
      </tr>)}
    </tbody>
  </table>
}
