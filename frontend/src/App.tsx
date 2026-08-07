import { useEffect, useRef, useState } from 'react'
import {
  CaretLeft,
  CaretRight,
  ChalkboardTeacher,
  CheckCircle,
  DotsThree,
  Gear,
  Plus,
  UploadSimple,
} from '@phosphor-icons/react'
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router'
import { SettingsPage, applyDisplayScale, readDisplayScale } from './SettingsPage'
import { WelcomeScreen, markWelcomed, readWelcomed } from './WelcomeScreen'
import { Step1Timetable } from './Step1Timetable'
import { Step2Teaching } from './Step2Teaching'
import { Step3Rules } from './Step3Rules'
import { Step4Adjust } from './Step4Adjust'
import { Step5Preview } from './Step5Preview'
import { ConfirmModal, Modal, PromptModal, Toast, useToast } from './ui'
import { useBeforeUnload } from './useBeforeUnload'
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  exportPlan,
  getDoc,
  importFrom,
  importPlanFile,
  listPlans,
  patchPlan,
  putDoc,
  redo as redoDoc,
  undo as undoDoc,
  type HistoryResult,
  type ImportLevel,
  type SaveResult,
} from './api'
import { FLOW_STEPS, type FlowPlan } from './flow'
import { courseName, type Workspace } from './workspace'

/** 方案卡「更新时间」：相对时间为主，早期日期退化为本地化日期；无法解析时原样返回。 */
export function formatUpdatedAt(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  const diffMs = now.getTime() - then.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${then.getMonth() + 1} 月 ${then.getDate()} 日 ${pad(then.getHours())}:${pad(then.getMinutes())}`
}

/* —— 方案导出/导入的浏览器回退路径（无 Electron 对话框桥时） —— */

function base64ToBlob(data: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type })
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 弹文件选择框读一个 zip，返回 base64；取消则返回空串。 */
function pickZipFileBase64(): Promise<string> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { resolve(''); return }
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

type DocumentWrites = {
  save: typeof putDoc
  undo: typeof undoDoc
  redo: typeof redoDoc
}

type DocumentWriteEvents = {
  onSaving: () => void
  onSaved: (result: SaveResult, latest: boolean) => void
  onHistory: (result: HistoryResult) => void
  onError: (error: unknown) => void
}

export class DocumentWritePipeline {
  private static tail = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private version = 0
  private active = true

  constructor(
    private readonly planId: string,
    private revision: number,
    private readonly events: DocumentWriteEvents,
    private readonly writes: DocumentWrites = { save: putDoc, undo: undoDoc, redo: redoDoc },
  ) {}

  autosave(doc: Workspace) {
    const version = ++this.version
    this.cancelPending()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.enqueueSave(doc, null, version)
    }, 800)
  }

  checkpoint(doc: Workspace, label: string) {
    const version = ++this.version
    this.cancelPending()
    this.enqueueSave(doc, label, version)
  }

  history(action: 'undo' | 'redo') {
    ++this.version
    this.cancelPending()
    return this.enqueue(async () => {
      this.emit('onSaving')
      try {
        const result = await this.writes[action](this.planId)
        this.revision = result.rev
        if (this.active) this.events.onHistory(result)
      } catch (error) {
        this.emit('onError', error)
      }
    })
  }

  cancelPending() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  idle() {
    return DocumentWritePipeline.tail
  }

  setRevision(revision: number) {
    this.revision = revision
  }

  dispose() {
    this.active = false
    this.cancelPending()
  }

  private enqueueSave(doc: Workspace, checkpoint: string | null, version: number) {
    void this.enqueue(async () => {
      this.emit('onSaving')
      try {
        const result = await this.writes.save(this.planId, this.revision, doc, checkpoint)
        this.revision = result.rev
        if (this.active) this.events.onSaved(result, version === this.version)
      } catch (error) {
        this.emit('onError', error)
      }
    })
  }

  private enqueue(task: () => Promise<void>) {
    const next = DocumentWritePipeline.tail.then(task, task)
    DocumentWritePipeline.tail = next.catch(() => undefined)
    return next
  }

  private emit<K extends keyof DocumentWriteEvents>(
    event: K,
    ...args: Parameters<DocumentWriteEvents[K]>
  ) {
    if (this.active) (this.events[event] as (...values: Parameters<DocumentWriteEvents[K]>) => void)(...args)
  }
}

function scheduleChangeLabel(before: Workspace, after: Workspace) {
  const beforePlacements = new Map(before.placements.map((item) => [item.id, item]))
  const afterPlacements = new Map(after.placements.map((item) => [item.id, item]))
  const changedLock = after.placements.find((item) => beforePlacements.get(item.id)?.locked !== item.locked)
  if (changedLock) return `${changedLock.locked ? '锁定' : '解锁'} ${courseName(before, changedLock.courseId)}`

  const moved = after.placements.filter((item) => {
    const previous = beforePlacements.get(item.id)
    return !previous || previous.dayId !== item.dayId || previous.periodId !== item.periodId
  })
  if (moved.length === 1) {
    const day = after.days.find((item) => item.id === moved[0].dayId)?.label.replace('星期', '周') ?? `第${moved[0].dayId}天`
    return `移动 ${courseName(after, moved[0].courseId)} 到 ${day}第${moved[0].periodId}节`
  }

  const removed = before.placements.filter((item) => !afterPlacements.has(item.id))
  if (removed.length && after.park.length > before.park.length) {
    return removed.length === 1
      ? `移入暂放区 ${courseName(before, removed[0].courseId)}`
      : '批量移入暂放区'
  }
  if (removed.length && !after.placements.some((item) => !beforePlacements.has(item.id))) {
    if (removed.every((item) => item.source === 'auto')) return '删除自动排课'
    if (removed.every((item) => item.source === 'manual')) return '删除手动拖拽'
  }
  if (after.placements.length > before.placements.length) return '自动排入剩余课程'
  return '重新排课'
}

export default function App() {
  const [plans, setPlans] = useState<FlowPlan[]>([])
  const [plansError, setPlansError] = useState('')
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [welcomed, setWelcomed] = useState(readWelcomed)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    listPlans()
      .then((loaded) => {
        if (active) setPlans(loaded)
      })
      .catch((error: unknown) => {
        if (active) setPlansError(String(error instanceof Error ? error.message : error))
      })
      .finally(() => {
        if (active) setLoadingPlans(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => window.classowl?.onBackendCrashed?.(() => {
    setPlansError('后端服务已停止，无法继续保存')
  }), [])

  // 启动时恢复用户选的显示比例（设置页里调整，见 SettingsPage）
  useEffect(() => {
    applyDisplayScale(readDisplayScale())
  }, [])

  const handleCreate = async (sourcePlanId?: string, level?: ImportLevel, sample?: boolean) => {
    try {
      const plan = await createPlan(sample ? { source: 'sample' } : {})
      if (sourcePlanId && level) await importFrom(plan.id, sourcePlanId, level)
      setPlans((current) => [plan, ...current])
      navigate(`/flow/${plan.id}/${FLOW_STEPS[0].key}`)
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleRename = async (plan: FlowPlan, name: string) => {
    try {
      const updated = await patchPlan(plan.id, { name })
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleDuplicate = async (plan: FlowPlan) => {
    try {
      const duplicate = await duplicatePlan(plan.id)
      setPlans((current) => [duplicate, ...current])
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleDelete = async (plan: FlowPlan) => {
    try {
      await deletePlan(plan.id)
      setPlans((current) => current.filter((item) => item.id !== plan.id))
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleExport = async (plan: FlowPlan) => {
    try {
      const payload = await exportPlan(plan.id)
      const saveFile = window.classowl?.dialog?.saveFile
      if (saveFile) {
        await saveFile({ fileName: payload.fileName, dataBase64: payload.data })
      } else {
        downloadBlob(base64ToBlob(payload.data, 'application/zip'), payload.fileName)
      }
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleImport = async () => {
    try {
      const openFile = window.classowl?.dialog?.openFile
      const data = openFile
        ? (await openFile())?.dataBase64 ?? ''
        : await pickZipFileBase64()
      if (!data) return
      const plan = await importPlanFile({ data })
      setPlans((current) => [plan, ...current])
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }

  // 首访欢迎层：只在「0 方案且从未见过」时出现一次。三个入口分别走向
  // 完整示例（落在预览导出，直接看到成品）、空白方案（步骤 1）、导入文件。
  const dismissWelcome = () => {
    markWelcomed()
    setWelcomed(true)
  }
  const handleWelcomeSample = async () => {
    try {
      const plan = await createPlan({ source: 'sample' })
      setPlans((current) => [plan, ...current])
      dismissWelcome()
      navigate(`/flow/${plan.id}/preview-export`)
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : String(error))
    }
  }
  const handleWelcomeBlank = () => {
    dismissWelcome()
    void handleCreate()
  }
  const handleWelcomeImport = () => {
    dismissWelcome()
    void handleImport()
  }
  const showWelcome = !loadingPlans && plans.length === 0 && !welcomed

  return <Routes>
    <Route path="/plans" element={showWelcome
      ? <WelcomeScreen
        onSample={() => void handleWelcomeSample()}
        onBlank={handleWelcomeBlank}
        onImport={handleWelcomeImport}
        onSkip={dismissWelcome}
      />
      : <PlanCenter
        plans={plans}
        onCreate={handleCreate}
        onRename={handleRename}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
        onImport={handleImport}
        error={plansError}
        loading={loadingPlans}
      />} />
    <Route path="/flow/:planId/:step" element={<PlanWorkspace
      plans={plans}
      loadingPlans={loadingPlans}
      backendError={plansError}
    />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/plans" replace />} />
  </Routes>
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function PlanWorkspace({ plans, loadingPlans, backendError }: {
  plans: FlowPlan[]
  loadingPlans: boolean
  backendError: string
}) {
  const { planId = '' } = useParams()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const writerRef = useRef<DocumentWritePipeline | null>(null)
  const historyBusy = useRef(false)
  const plan = plans.find((item) => item.id === planId)

  useBeforeUnload(saveState !== 'saved')

  useEffect(() => {
    if (!backendError) return
    setSaveError(backendError)
    setSaveState('error')
  }, [backendError])

  useEffect(() => {
    if (!plan) return
    let active = true
    writerRef.current?.dispose()
    writerRef.current = null
    historyBusy.current = false
    setWorkspace(null)
    setLoadError('')
    getDoc(plan.id)
      .then((loaded) => {
        if (!active) return
        setWorkspace(loaded.doc)
        setUndoDepth(loaded.undoDepth)
        setRedoDepth(loaded.redoDepth)
        setSaveState('saved')
        let writer: DocumentWritePipeline
        writer = new DocumentWritePipeline(plan.id, loaded.rev, {
          onSaving: () => {
            if (writerRef.current === writer) setSaveState('saving')
          },
          onSaved: (saved, latest) => {
            if (writerRef.current !== writer) return
            setUndoDepth(saved.undoDepth)
            setRedoDepth(saved.redoDepth)
            setSaveError('')
            setSaveState(latest ? 'saved' : 'dirty')
          },
          onHistory: (result) => {
            if (writerRef.current !== writer) return
            setWorkspace(result.doc)
            setUndoDepth(result.undoDepth)
            setRedoDepth(result.redoDepth)
            setSaveError('')
            setSaveState('saved')
          },
          onError: (error) => {
            if (writerRef.current !== writer) return
            setSaveError(error instanceof Error ? error.message : String(error))
            setSaveState('error')
          },
        })
        writerRef.current = writer
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
      writerRef.current?.dispose()
    }
  }, [plan?.id])

  if (loadingPlans) return <div className="plan-page"><main className="plan-main">正在加载方案…</main></div>
  if (!plan) return <Navigate to="/plans" replace />
  if (loadError) return <div className="plan-page"><main className="plan-main">加载失败：{loadError}</main></div>
  if (!workspace) return <div className="plan-page"><main className="plan-main">正在加载方案内容…</main></div>

  const change = (next: Workspace) => {
    if (historyBusy.current) return
    setWorkspace(next)
    setSaveState('dirty')
    writerRef.current?.autosave(next)
  }
  const scheduleChange = (next: Workspace, checkpoint?: string) => {
    if (historyBusy.current) return
    setWorkspace(next)
    setSaveState('dirty')
    writerRef.current?.checkpoint(next, checkpoint ?? scheduleChangeLabel(workspace, next))
  }
  const undoSchedule = () => {
    const writer = writerRef.current
    if (!writer || historyBusy.current) return
    historyBusy.current = true
    void writer.history('undo').finally(() => { historyBusy.current = false })
  }
  const redoSchedule = () => {
    const writer = writerRef.current
    if (!writer || historyBusy.current) return
    historyBusy.current = true
    void writer.history('redo').finally(() => { historyBusy.current = false })
  }
  const reload = async () => {
    try {
      writerRef.current?.cancelPending()
      await writerRef.current?.idle()
      const loaded = await getDoc(plan.id)
      setWorkspace(loaded.doc)
      writerRef.current?.setRevision(loaded.rev)
      setUndoDepth(loaded.undoDepth)
      setRedoDepth(loaded.redoDepth)
      setSaveError('')
      setSaveState('saved')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaveState('error')
    }
  }
  return <FlowWorkspace
    plan={plan}
    workspace={workspace}
    saveState={saveState}
    saveError={saveError}
    onChange={change}
    onReset={reload}
    onScheduleChange={scheduleChange}
    onUndo={undoSchedule}
    onRedo={redoSchedule}
    canUndo={undoDepth > 0}
    canRedo={redoDepth > 0}
  />
}

export function PlanCenter({ plans, onCreate, onRename, onDuplicate, onDelete, onExport, onImport, error = '', loading = false }: {
  plans: FlowPlan[]
  onCreate: (sourcePlanId?: string, level?: ImportLevel) => void
  onRename?: (plan: FlowPlan, name: string) => void
  onDuplicate?: (plan: FlowPlan) => void
  onDelete?: (plan: FlowPlan) => void
  onExport?: (plan: FlowPlan) => void
  onImport?: () => void
  error?: string
  loading?: boolean
}) {
  const [creating, setCreating] = useState(false)
  return <div className="plan-page">
    <header className="plan-header">
      <span className="save-state"><CheckCircle weight="fill" />{error ? `连接失败：${error}` : '本地数据已就绪'}</span>
      <NavLink className="icon-button" to="/settings" aria-label="设置" title="设置"><Gear size={18} /></NavLink>
    </header>

    <main className="plan-main">
      <div className="plan-main-inner">
        <section className="plan-hero">
          <div>
            <h1>排课方案</h1>
            <p>从基础作息到预览导出，在一个清晰的五步流程中完成全校排课。</p>
          </div>
          <div className="plan-hero-actions">
            {onImport && <button className="btn btn-secondary" onClick={onImport}><UploadSimple />导入方案</button>}
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />新建方案</button>
          </div>
        </section>

        <section aria-labelledby="recent-plans">
          <div className="section-heading">
            <h2 id="recent-plans">最近方案</h2>
            <span>{loading ? '加载中…' : `${plans.length} 个方案`}</span>
          </div>
          {/* 空态必须给出下一步动作。原来是渲染空的方案列表，
              首次打开应用看到的是一片空白，读起来像页面坏了。 */}
          {!loading && plans.length === 0
            ? <button type="button" className="plan-empty" onClick={() => setCreating(true)}>
              <span className="plan-empty-mark"><Plus /></span>
              <strong>新建第一个排课方案</strong>
              <span>五步走完即可导出全校课表：设置作息、录入教学计划、设定排课条件、自动排课并微调、预览导出。</span>
            </button>
            : <div className="plan-list">
              <div className="plan-list-cols" aria-hidden="true">
                <span>方案</span><span>状态</span><span>配置进度</span><span>更新时间</span><span />
              </div>
              {plans.map((plan, index) => <PlanRow
                key={plan.id}
                plan={plan}
                tone={PLAN_ROW_TONES[index % PLAN_ROW_TONES.length]}
                onRename={onRename}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onExport={onExport}
              />)}
            </div>}
        </section>
      </div>
    </main>
    {creating && <CreatePlanModal
      plans={plans}
      onClose={() => setCreating(false)}
      onCreate={(sourcePlanId, level) => {
        setCreating(false)
        onCreate(sourcePlanId, level)
      }}
    />}
  </div>
}

/* 列表行的饱和色身份块按序轮换，一屏方案有节律而不单调。 */
const PLAN_ROW_TONES = ['coral', 'lavender', 'peach', 'ochre', 'mint'] as const
type PlanRowTone = typeof PLAN_ROW_TONES[number]

function PlanRow({ plan, tone, onRename, onDuplicate, onDelete, onExport }: {
  plan: FlowPlan
  tone: PlanRowTone
  onRename?: (plan: FlowPlan, name: string) => void
  onDuplicate?: (plan: FlowPlan) => void
  onDelete?: (plan: FlowPlan) => void
  onExport?: (plan: FlowPlan) => void
}) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const open = () => navigate(`/flow/${plan.id}/${plan.lastStep}`)

  /* 重命名/删除对话框渲染为行的兄弟节点而不是子节点：Modal 不是 portal，
     放在行内会让对话框里的每次点击都冒泡触发行的跳转。 */
  return <>
    <div
      className="plan-row"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open()
      }}
    >
      <div className="plan-row-id">
        <span className={`plan-row-avatar tone-${tone}`}>
          <ChalkboardTeacher weight="fill" />
        </span>
        <div className="plan-row-name">
          <h3>{plan.name}</h3>
          <span>{plan.academicYear} {plan.term}</span>
        </div>
      </div>
      <div>
        <span className={`status-badge ${plan.status === 'ready' ? 'ready' : ''}`}>
          {plan.status === 'ready' ? '可预览' : '配置中'}
        </span>
      </div>
      <div className="plan-row-progress">
        <span className="progress-segs" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => <span
            key={index}
            className={`seg${index < plan.progress ? ' done' : index === plan.progress ? ' now' : ''}`}
          />)}
        </span>
        <strong>{plan.progress}/5</strong>
      </div>
      <div className="plan-row-time">{formatUpdatedAt(plan.updatedAt)}</div>
      <div className="plan-row-acts" onClick={(event) => event.stopPropagation()}>
        <NavLink className="plan-row-go" to={`/flow/${plan.id}/${plan.lastStep}`} tabIndex={-1}>
          继续编辑<CaretRight weight="bold" />
        </NavLink>
        <div className="plan-card-menu" ref={menuRef}>
          <button
            className="icon-button"
            aria-label={`${plan.name} 的更多操作`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <DotsThree weight="bold" />
          </button>
          {menuOpen && <div className="plan-action-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); setDialog('rename') }}>重命名</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate?.(plan) }}>复制</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); onExport?.(plan) }}>导出</button>
            <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setDialog('delete') }}>删除</button>
          </div>}
        </div>
      </div>
    </div>
    {dialog === 'rename' && <PromptModal
      title="重命名方案"
      label="方案名称"
      defaultValue={plan.name}
      confirmLabel="保存"
      onClose={() => setDialog(null)}
      onConfirm={(name) => {
        setDialog(null)
        onRename?.(plan, name.trim())
      }}
    />}
    {dialog === 'delete' && <ConfirmModal
      title="删除方案"
      message={`确定删除「${plan.name}」？此操作无法撤销。`}
      confirmLabel="删除"
      danger
      onClose={() => setDialog(null)}
      onConfirm={() => {
        setDialog(null)
        onDelete?.(plan)
      }}
    />}
  </>
}

const IMPORT_LEVELS: { value: ImportLevel; label: string; detail: string }[] = [
  { value: 1, label: '班级作息', detail: '上课日、节次和班级' },
  { value: 2, label: '班级作息 + 课时任课', detail: '另含课程、教师、课时矩阵及教学安排' },
  { value: 3, label: '完整排课条件', detail: '另含全部排课条件，不含排课结果' },
]

export function CreatePlanModal({ plans, onCreate, onClose }: {
  plans: FlowPlan[]
  onCreate: (sourcePlanId?: string, level?: ImportLevel, sample?: boolean) => void
  onClose: () => void
}) {
  const [importing, setImporting] = useState(false)
  if (importing) return <ImportPlanModal
    plans={plans}
    title="从已有方案导入"
    onClose={onClose}
    confirmation={(source, level) => `将从「${source.name}」导入${IMPORT_LEVELS[level - 1].label}，新方案不会包含排课结果。`}
    onImport={onCreate}
  />
  return <Modal title="新建方案" onClose={onClose}>
    <div className="create-plan-options">
      <button className="create-plan-option" onClick={() => onCreate()}>
        <strong>从空白开始</strong><span>创建空方案并进入班级作息</span>
      </button>
      <button className="create-plan-option" onClick={() => onCreate(undefined, undefined, true)}>
        <strong>从示例方案开始</strong><span>预置两个年级的课程、教师与排课条件，可直接试排</span>
      </button>
      <button className="create-plan-option" disabled={!plans.length} onClick={() => setImporting(true)}>
        <strong>从已有方案导入</strong><span>{plans.length ? '选择来源与导入范围' : '暂无可导入的方案'}</span>
      </button>
    </div>
  </Modal>
}

function ImportPlanModal({ plans, title, confirmation, onImport, onClose }: {
  plans: FlowPlan[]
  title: string
  confirmation: (source: FlowPlan, level: ImportLevel) => string
  onImport: (sourcePlanId: string, level: ImportLevel) => void | Promise<void>
  onClose: () => void
}) {
  const [sourcePlanId, setSourcePlanId] = useState(plans[0]?.id ?? '')
  const [level, setLevel] = useState<ImportLevel>(1)
  const [confirming, setConfirming] = useState(false)
  const source = plans.find((plan) => plan.id === sourcePlanId)

  if (confirming && source) return <ConfirmModal
    title="确认导入"
    message={confirmation(source, level)}
    confirmLabel="确认导入"
    danger
    onClose={() => setConfirming(false)}
    onConfirm={() => {
      void Promise.resolve(onImport(source.id, level)).then(onClose).catch(() => undefined)
    }}
  />

  return <Modal
    title={title}
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={!source} onClick={() => setConfirming(true)}>下一步</button>
    </>}
  >
    <div className="field">
      <label htmlFor="import-source">来源方案</label>
      <select id="import-source" value={sourcePlanId} onChange={(event) => setSourcePlanId(event.target.value)}>
        {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
      </select>
    </div>
    <fieldset className="import-levels">
      <legend>导入范围</legend>
      {IMPORT_LEVELS.map((item) => <label key={item.value}>
        <input
          type="radio"
          name="import-level"
          checked={level === item.value}
          onChange={() => setLevel(item.value)}
        />
        <span><strong>{item.label}</strong><small>{item.detail}</small></span>
      </label>)}
    </fieldset>
  </Modal>
}

/* shell 结构对应 designs/classowl-flow/app.jsx（原型未随仓库公开），路由换成 React Router */
function FlowWorkspace({ plan, workspace, saveState, saveError, onChange, onReset, onScheduleChange, onUndo, onRedo, canUndo, canRedo }: {
  plan: FlowPlan
  workspace: Workspace
  saveState: SaveState
  saveError: string
  onChange: (next: Workspace) => void
  onReset: () => void
  onScheduleChange: (next: Workspace, checkpoint?: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  const { step = '' } = useParams()
  const navigate = useNavigate()
  const { toast, show } = useToast()
  const [confirmReset, setConfirmReset] = useState(false)
  const activeStep = FLOW_STEPS.find((item) => item.key === step)
  const activeIndex = FLOW_STEPS.findIndex((item) => item.key === step)

  if (!activeStep) return <Navigate to={`/flow/${plan.id}/${FLOW_STEPS[0].key}`} replace />

  return <div className="app">
    <header className="shell-top">
      <div className="shell-top-row">
        <NavLink className="shell-back" to="/plans" aria-label="返回方案中心">
          <CaretLeft weight="bold" />方案中心
        </NavLink>
        <span className="shell-crumb-sep" aria-hidden="true">/</span>
        <span className="shell-plan">{workspace.schemeName}</span>
        <nav className="steps" aria-label="排课步骤">
          {FLOW_STEPS.map((item, index) => <NavLink
            key={item.key}
            to={`/flow/${plan.id}/${item.key}`}
            className={`step-item${item.key === activeStep.key ? ' active' : ''}${index < activeIndex ? ' done' : ''}`}
          >
            <span className="step-num">{index + 1}</span>
            <span className="step-label">{item.label}</span>
          </NavLink>)}
        </nav>
        <div className="shell-side-actions">
          <span className={`save-state${saveState === 'error' ? ' error' : ''}`}>
            {saveState === 'error' ? `保存失败：${saveError}` : saveState === 'saved' ? '已保存' : '正在保存…'}
          </span>
          <button className="ghost-btn" onClick={() => setConfirmReset(true)}>重置数据</button>
        </div>
      </div>
    </header>

    <main className="stage">
      {activeStep.key === 'input-information' && <Step1Timetable workspace={workspace} onChange={onChange} showToast={show} />}
      {activeStep.key === 'arrange-teaching' && <Step2Teaching workspace={workspace} planId={plan.id} onChange={onChange} showToast={show} />}
      {activeStep.key === 'setting-rules' && <Step3Rules
        workspace={workspace}
        onChange={onChange}
        showToast={show}
        onGoToStep4={() => navigate(`/flow/${plan.id}/adjust-schedule`)}
      />}
      {activeStep.key === 'adjust-schedule' && <Step4Adjust
        planId={plan.id}
        workspace={workspace}
        onChange={onScheduleChange}
        showToast={show}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />}
      {activeStep.key === 'preview-export' && <Step5Preview planId={plan.id} workspace={workspace} showToast={show} />}
    </main>

    {confirmReset && <ConfirmModal
      title="重置数据"
      message="放弃未保存修改并重新载入？"
      confirmLabel="重置"
      danger
      onClose={() => setConfirmReset(false)}
      onConfirm={() => {
        onReset()
        setConfirmReset(false)
        show('已重新载入')
      }}
    />}

    <Toast message={toast} />
  </div>
}
