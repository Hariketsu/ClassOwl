/* 步骤 4 — 排课调课工作台
   DOM 与类名对应 designs/classowl-flow/step4.jsx（原型未随仓库公开） */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsClockwise,
  Eraser,
  Lock,
  LockOpen,
  MagicWand,
  Trash,
  X,
  type Icon,
} from '@phosphor-icons/react'
import { cancelSolver, getSolver, startSolver, type SolverJob } from './api'
import { ConfirmModal, LessonCard, MiniSchedule, Modal } from './ui'
import {
  batchParkClass,
  classLabel,
  courseName,
  deleteBySource,
  dropHint,
  findClass,
  gradesOf,
  hardConflicts,
  moveToPark,
  movePlacement,
  placeFromPark,
  teacherName,
  toggleLockPlacement,
  unmetConditions,
  type DragPayload,
  type Workspace,
} from './workspace'

type View = 'class' | 'teacher'
type Tool = { id: string; label: string; icon: Icon; cls: string }
type SolveState = {
  phase: 'running' | 'done' | 'infeasible' | 'cancelled' | 'error'
  startedAt: number
  elapsed: number
  jobId?: string
  cancelling?: boolean
  message?: string
  result?: NonNullable<SolverJob['result']>
}

const TOOLS: Tool[] = [
  { id: 'replan', label: '重新排课', icon: ArrowsClockwise, cls: '' },
  { id: 'fill', label: '自动排入\n剩余课程', icon: MagicWand, cls: 'ok' },
  { id: 'delAuto', label: '一键删除\n自动排课', icon: Eraser, cls: 'danger' },
  { id: 'delManual', label: '一键删除\n手动拖拽', icon: Trash, cls: 'danger' },
  { id: 'undo', label: '撤销', icon: ArrowCounterClockwise, cls: '' },
  { id: 'redo', label: '恢复', icon: ArrowClockwise, cls: '' },
  { id: 'lock', label: '锁定课程', icon: Lock, cls: '' },
  { id: 'unlock', label: '解锁课程', icon: LockOpen, cls: '' },
]

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 400))

export async function runSolverJob({
  planId,
  keepExisting,
  label,
  signal,
  onStarted,
  onStatus,
  onApply,
}: {
  planId: string
  keepExisting: boolean
  label: string
  signal: AbortSignal
  onStarted?: (jobId: string) => void | Promise<void>
  onStatus?: (job: SolverJob) => void
  onApply: (update: (current: Workspace) => Workspace, label: string) => void
}) {
  const { jobId } = await startSolver(planId, { keepExisting })
  await onStarted?.(jobId)
  if (signal.aborted) return
  while (true) {
    if (signal.aborted) return
    const job = await getSolver(jobId)
    if (signal.aborted) return
    onStatus?.(job)
    if (!['queued', 'running'].includes(job.status)) {
      if (job.status === 'done' && !job.result) throw new Error('求解完成但未返回排课结果')
      if (job.status === 'done') {
        onApply((current) => ({
          ...current,
          placements: job.result!.placements,
          park: job.result!.park,
          scheduleStatus: 'ready',
        }), label)
      }
      return job
    }
    await wait()
  }
}

export function Step4Adjust({ planId, workspace, onChange, showToast, onUndo, onRedo, canUndo, canRedo }: {
  planId: string
  workspace: Workspace
  onChange: (next: Workspace, checkpoint?: string) => void
  showToast: (message: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  const [view, setView] = useState<View>('class')
  const [classId, setClassId] = useState(workspace.classes[0]?.id ?? '')
  const [teacherId, setTeacherId] = useState(workspace.teachers[0]?.id ?? '')
  const [teacherQ, setTeacherQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewTeacherId, setPreviewTeacherId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragPayload | null>(null)
  const [hover, setHover] = useState<{ dayId: number; periodId: number } | null>(null)
  const [confirmReplan, setConfirmReplan] = useState(false)
  const [showUnmet, setShowUnmet] = useState(false)
  const [solve, setSolve] = useState<SolveState | null>(null)
  const workspaceRef = useRef(workspace)
  const solveController = useRef<AbortController | null>(null)
  const solverJobId = useRef<string | undefined>(undefined)
  workspaceRef.current = workspace

  const unmet = useMemo(() => unmetConditions(workspace), [workspace])
  const conflicts = useMemo(() => hardConflicts(workspace), [workspace])
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((item) => [item.a?.id, item.b?.id]).filter(Boolean) as string[]), [conflicts])

  useEffect(() => {
    if (!workspace.classes.find((item) => item.id === classId) && workspace.classes[0]) setClassId(workspace.classes[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.classes])

  useEffect(() => {
    if (solve?.phase !== 'running') return
    const timer = setInterval(() => {
      setSolve((current) => current?.phase === 'running'
        ? { ...current, elapsed: Math.floor((Date.now() - current.startedAt) / 1000) }
        : current)
    }, 250)
    return () => clearInterval(timer)
  }, [solve?.phase])

  useEffect(() => () => {
    solveController.current?.abort()
    if (solverJobId.current) void cancelSolver(solverJobId.current).catch(() => undefined)
  }, [])

  const grades = gradesOf(workspace)
  const teachersBySubject = useMemo(() => {
    const map = new Map<string, typeof workspace.teachers>()
    workspace.teachers.forEach((teacher) => {
      if (teacherQ && !teacher.name.includes(teacherQ)) return
      let subject = '其他'
      outer: for (const schoolClass of workspace.classes) {
        for (const [courseId, cell] of Object.entries(workspace.matrix[schoolClass.id] ?? {})) {
          if (cell.teacherId === teacher.id) { subject = courseName(workspace, courseId); break outer }
        }
      }
      if (!map.has(subject)) map.set(subject, [])
      map.get(subject)!.push(teacher)
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, teacherQ])

  const visiblePlacements = workspace.placements.filter((item) => view === 'class' ? item.classId === classId : item.teacherId === teacherId)
  const parkForView = workspace.park.filter((item) => view === 'class' ? item.classId === classId : true)

  const onDragStartPlacement = (item: typeof workspace.placements[number]) => (event: React.DragEvent) => {
    const payload: DragPayload = { kind: 'placement', id: item.id, classId: item.classId, courseId: item.courseId, teacherId: item.teacherId, locked: item.locked }
    setDrag(payload)
    event.dataTransfer.setData('text/plain', JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragStartPark = (item: typeof workspace.park[number]) => (event: React.DragEvent) => {
    const payload: DragPayload = { kind: 'park', id: item.id, classId: item.classId, courseId: item.courseId, teacherId: item.teacherId, locked: false }
    setDrag(payload)
    event.dataTransfer.setData('text/plain', JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  const readDrag = (event: React.DragEvent): DragPayload | null => {
    try {
      const raw = event.dataTransfer.getData('text/plain')
      if (raw) return JSON.parse(raw)
    } catch { /* fall through to in-memory drag state */ }
    return drag
  }

  const onDropCell = (dayId: number, periodId: number) => (event: React.DragEvent) => {
    event.preventDefault()
    const payload = readDrag(event)
    setHover(null)
    setDrag(null)
    if (!payload) return
    if (view === 'class' && payload.classId && payload.classId !== classId) {
      showToast('班级视角下不能把其他班的课拖入')
      return
    }
    if (payload.kind === 'park') {
      const result = placeFromPark(workspace, payload.id, dayId, periodId)
      if (result.error) showToast(result.error)
      else onChange(result.workspace)
      return
    }
    const result = movePlacement(workspace, payload.id, dayId, periodId)
    if (result.error) showToast(result.error)
    else onChange(result.workspace)
  }

  const onDropPark = (event: React.DragEvent) => {
    event.preventDefault()
    const payload = readDrag(event)
    setDrag(null)
    if (!payload || payload.kind !== 'placement') return
    onChange(moveToPark(workspace, payload.id))
    showToast('已移入暂放区')
  }

  const cellHint = (dayId: number, periodId: number) => {
    if (!drag || !hover || hover.dayId !== dayId || hover.periodId !== periodId) return null
    return dropHint(workspace, drag, dayId, periodId, view === 'class' ? classId : null)
  }

  const runTool = (id: string) => {
    if (id === 'replan') { setConfirmReplan(true); return }
    if (id === 'fill') { void beginSolve(true); return }
    if (id === 'delAuto') { onChange(deleteBySource(workspace, 'auto')); showToast('已删除自动排课（锁定除外）'); return }
    if (id === 'delManual') { onChange(deleteBySource(workspace, 'manual')); showToast('已删除手动拖拽（锁定除外）'); return }
    if (id === 'undo') { if (!canUndo) { showToast('没有可撤销的操作'); return } onUndo(); return }
    if (id === 'redo') { if (!canRedo) { showToast('没有可恢复的操作'); return } onRedo(); return }
    if (id === 'lock' || id === 'unlock') {
      if (!selectedId) { showToast('请先点选一节课'); return }
      onChange(toggleLockPlacement(workspace, selectedId, id === 'lock'))
      showToast(id === 'lock' ? '已锁定' : '已解锁')
    }
  }

  const beginSolve = async (keepExisting: boolean) => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const label = keepExisting ? '补排剩余课程' : '自动排课'
    solveController.current = controller
    solverJobId.current = undefined
    setSolve({ phase: 'running', startedAt, elapsed: 0 })
    try {
      const terminal = await runSolverJob({
        planId,
        keepExisting,
        label,
        signal: controller.signal,
        onStarted: async (jobId) => {
          solverJobId.current = jobId
          if (controller.signal.aborted) {
            await cancelSolver(jobId).catch(() => undefined)
            return
          }
          setSolve((current) => current?.phase === 'running' ? { ...current, jobId } : current)
        },
        onStatus: (job) => {
          setSolve((current) => current?.phase === 'running'
            ? { ...current, message: job.message, elapsed: Math.floor((Date.now() - startedAt) / 1000) }
            : current)
        },
        onApply: (update, checkpoint) => {
          if (!controller.signal.aborted) onChange(update(workspaceRef.current), checkpoint)
        },
      })
      if (!terminal || controller.signal.aborted) return
      setSolve({
        phase: terminal.status === 'queued' || terminal.status === 'running' ? 'error' : terminal.status,
        startedAt,
        elapsed: Math.floor((Date.now() - startedAt) / 1000),
        message: terminal.message,
        result: terminal.result,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setSolve({
        phase: 'error',
        startedAt,
        elapsed: Math.floor((Date.now() - startedAt) / 1000),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (solveController.current === controller) {
        solveController.current = null
        solverJobId.current = undefined
      }
    }
  }

  const cancelCurrentSolve = async () => {
    if (solve?.phase !== 'running' || solve.cancelling) return
    const jobId = solverJobId.current
    solveController.current?.abort()
    setSolve({ ...solve, cancelling: true })
    if (!jobId) {
      setSolve({ ...solve, phase: 'cancelled', message: undefined })
      return
    }
    try {
      await cancelSolver(jobId)
      setSolve({ ...solve, phase: 'cancelled', message: undefined })
    } catch (error) {
      setSolve({
        ...solve,
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return <div className="s4-page" data-screen-label="排课调课">
    <div className="s4-root">
      <aside className="s4-tools">
        <div className="s4-tools-pin">悬浮</div>
        <div className="s4-tools-body">
          {TOOLS.map((tool) => <button key={tool.id} className={`tool-btn ${tool.cls}`} onClick={() => runTool(tool.id)}>
            <span className="ico"><tool.icon size={16} weight="bold" /></span>
            {tool.label.split('\n').map((line) => <span key={line}>{line}</span>)}
          </button>)}
        </div>
      </aside>

      <div className="s4-main">
        <div className="s4-topbar">
          <div className="seg">
            <button className={view === 'class' ? 'active' : ''} onClick={() => setView('class')}>班级课表</button>
            <button className={view === 'teacher' ? 'active' : ''} onClick={() => setView('teacher')}>教师课表</button>
          </div>
          <span className="muted small">温馨提示：点选课程可在右侧预览任课教师课表；点击老师名或班级名可切换相关课表</span>
          <span className="spacer" />
          <span className="badge badge-blue">已排 {workspace.placements.length}</span>
          <span className="badge badge-orange">暂放 {workspace.park.length}</span>
          {unmet.filter((item) => !item.soft).length > 0 && <span className="badge badge-red">未满足 {unmet.filter((item) => !item.soft).length}</span>}
        </div>

        <div className="park-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDropPark}>
          <h4>
            <span>课程暂放区</span>
            <span className="faint">与课表区可相互拖动调整</span>
          </h4>
          <div className="park-row">
            {parkForView.length === 0
              ? <div className="park-empty">暂无课程。可从课表拖入，或使用「批量拖到暂放区」。</div>
              : parkForView.map((item) => <div key={item.id} style={{ width: 96, flex: '0 0 auto' }}>
                <LessonCard workspace={workspace} item={item} onDragStart={onDragStartPark(item)} />
              </div>)}
          </div>
        </div>

        <div className="s4-work">
          <section className="s4-board">
            <div className="s4-board-head">
              <strong>课表区</strong>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowUnmet(true)}>
                查看未满足的条件{unmet.length ? ` (${unmet.length})` : ''}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (view !== 'class') { showToast('请在班级课表下使用'); return }
                  onChange(batchParkClass(workspace, classId))
                  showToast('已将本班未锁定课程批量暂放')
                }}
              >
                批量拖到暂放区
              </button>
              <div className="legend">
                <span><i className="dot dot-ok" /> 可调</span>
                <span><i className="dot dot-same" /> 同课程</span>
                <span><i className="dot dot-bad" /> 不可调</span>
                <span><i className="dot dot-rule" /> 条件冲突</span>
              </div>
            </div>
            <div className="s4-board-body">
              <div className="class-tree">
                {view === 'class' ? grades.map((grade) => <div key={grade}>
                  <div className="tree-grade">{grade}</div>
                  {workspace.classes.filter((item) => item.grade === grade).map((schoolClass) => <button
                    key={schoolClass.id}
                    className={`tree-link${classId === schoolClass.id ? ' active' : ''}`}
                    onClick={() => setClassId(schoolClass.id)}
                  >
                    {classLabel(schoolClass)}
                  </button>)}
                </div>) : <>
                  <input placeholder="请输入教师姓名" value={teacherQ} onChange={(event) => setTeacherQ(event.target.value)} />
                  {[...teachersBySubject.entries()].map(([subject, list]) => <div key={subject}>
                    <div className="tree-grade">{subject}</div>
                    {list.map((teacher) => <button
                      key={teacher.id}
                      className={`tree-link${teacherId === teacher.id ? ' active' : ''}`}
                      onClick={() => setTeacherId(teacher.id)}
                    >
                      {teacher.name}
                    </button>)}
                  </div>)}
                </>}
              </div>

              <div className="grid-wrap">
                <table className="sched">
                  <thead>
                    <tr>
                      <th className="period-label">节</th>
                      {workspace.days.map((day) => <th key={day.id}>{day.label.replace('星期', '周')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.periods.map((period) => <tr key={period.id}>
                      <td className="period-label">{period.id}</td>
                      {workspace.days.map((day) => {
                        const items = visiblePlacements.filter((item) => item.dayId === day.id && item.periodId === period.id)
                        const hint = cellHint(day.id, period.id)
                        const dropCls = hint
                          ? hint.cls === 'hint-ok' ? 'drop-ok' : hint.cls === 'hint-same' ? 'drop-same' : hint.cls === 'hint-rule' ? 'drop-rule' : 'drop-bad'
                          : ''
                        return <td
                          key={day.id}
                          className={dropCls}
                          onDragOver={(event) => { event.preventDefault(); setHover({ dayId: day.id, periodId: period.id }) }}
                          onDragLeave={() => setHover(null)}
                          onDrop={onDropCell(day.id, period.id)}
                        >
                          {items.map((item) => <LessonCard
                            key={item.id}
                            workspace={workspace}
                            item={item}
                            selected={selectedId === item.id}
                            dim={conflictIds.has(item.id)}
                            onDragStart={onDragStartPlacement(item)}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedId(item.id)
                              setPreviewTeacherId(item.teacherId || null)
                              if ((event.metaKey || event.ctrlKey) && item.teacherId) {
                                setView('teacher')
                                setTeacherId(item.teacherId)
                              }
                            }}
                          />)}
                          {hint && !items.length ? <div className="small faint" style={{ padding: 4, textAlign: 'center' }}>{hint.label}</div> : null}
                        </td>
                      })}
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {previewTeacherId && <aside className={`preview-panel${hover ? ' peek' : ''}`}>
            <header>
              <h3>课表预览</h3>
              <div className="muted small">任课教师课表 · {teacherName(workspace, previewTeacherId)}</div>
              <button className="preview-close" onClick={() => setPreviewTeacherId(null)} aria-label="关闭预览"><X size={14} weight="bold" /></button>
            </header>
            <div className="preview-body">
              <MiniSchedule
                workspace={workspace}
                filterFn={(item) => item.teacherId === previewTeacherId}
                cellText={(item) => classLabel(findClass(workspace, item.classId))}
              />
            </div>
          </aside>}
        </div>
      </div>
    </div>

    {confirmReplan && <ConfirmModal
      title="重新排课"
      message="【重新排课】将清除已排课程（已锁定课程除外）并重新排课，确定重新排课吗？"
      confirmLabel="打乱现在的排课结果重新排课"
      danger
      countdown={2}
      onClose={() => setConfirmReplan(false)}
      onConfirm={() => {
        setConfirmReplan(false)
        void beginSolve(false)
      }}
    />}

    {solve && <Modal
      title="自动排课"
      closable={solve.phase !== 'running'}
      onClose={() => setSolve(null)}
      footer={solve.phase === 'running'
        ? <button disabled={solve.cancelling} onClick={() => void cancelCurrentSolve()}>
          {solve.cancelling ? '正在取消…' : '取消排课'}
        </button>
        : <button onClick={() => setSolve(null)}>
          {solve.phase === 'done' ? '去手动微调' : '返回'}
        </button>}
    >
      {solve.phase === 'running' && <>
        <p>正在排课…</p>
        <p>已用 {solve.elapsed} 秒{solve.message ? ` · ${solve.message}` : ''}</p>
      </>}
      {solve.phase === 'done' && solve.result && <>
        <p>
          排入 {solve.result.placements.length} 节 / 暂放 {solve.result.park.length} 节 / 未满足 {solve.result.unmet.length} 条
        </p>
        <div>
          {solve.result.unmet.length === 0
            ? <p>没有未满足项。</p>
            : solve.result.unmet.map((item, index) => <div key={index}>{item.text}</div>)}
        </div>
      </>}
      {solve.phase === 'infeasible' && <>
        <p>{solve.message || '当前排课条件无解，请调整条件后重试。'}</p>
        {solve.result?.unmet.map((item, index) => <p key={index}>{item.text}</p>)}
      </>}
      {solve.phase === 'error' && <p>排课失败：{solve.message || '未知错误'}</p>}
      {solve.phase === 'cancelled' && <p>{solve.message || '排课已取消，原有课表未改变。'}</p>}
    </Modal>}

    {showUnmet && <div className="unmet-panel">
      <header>
        <h3>未满足的条件</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowUnmet(false)}>关闭</button>
      </header>
      <div className="unmet-list">
        {unmet.length === 0
          ? <p className="muted small">当前没有未满足项。可先「重新排课」或调整条件后再看。</p>
          : unmet.map((item, index) => <div className="unmet-item" key={index}>
            <span className={`badge ${item.soft ? 'badge-orange' : 'badge-red'}`}>{item.type}</span>
            <div style={{ marginTop: 4 }}>{item.text}</div>
            {item.classId ? <button
              className="linkish"
              onClick={() => { setView('class'); setClassId(item.classId!); setShowUnmet(false) }}
            >
              跳到相关班级
            </button> : null}
          </div>)}
      </div>
    </div>}
  </div>
}
