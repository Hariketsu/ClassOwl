/* 步骤 5 — 预览导出
   DOM 与类名对应 designs/classowl-flow/step56.jsx（原型未随仓库公开） */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarBlank } from '@phosphor-icons/react'
import { capturePng, getExportJob, saveExport, startExport } from './api'
import { Modal } from './ui'
import {
  biweeklyTag,
  classLabel,
  courseName,
  findClass,
  gradesOf,
  periodsByBand,
  teacherName,
  type Placement,
  type Workspace,
} from './workspace'

type Tab = 'class' | 'teacher' | 'classAll' | 'teacherAll'
type Mode = 'class' | 'teacher'

const TABS: [Tab, string][] = [
  ['class', '班级课表'],
  ['teacher', '教师课表'],
  ['classAll', '班级总课表'],
  ['teacherAll', '教师总课表'],
]

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 400))

/**
 * 等浏览器完成一次重绘。
 *
 * 两个 rAF 才能保证上一次状态更新已经绘制到屏幕上：第一个回调运行在本帧的
 * 绘制前，第二个才在绘制后。vitest 里没有 rAF，退回宏任务。
 */
function waitForRepaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export async function runExportJob(
  planId: string,
  config: ExportConfig,
  onStarted?: () => void,
): Promise<{ targetPath: string; currentPreviewOnly: boolean } | null> {
  const format = config.format === 'Excel' ? 'excel' : config.format === 'PDF' ? 'pdf' : 'png'
  const selection = await saveExport({ fileName: config.fileName, format })
  if (!selection) return null
  onStarted?.()

  if (format === 'png') {
    // capturePage 截整个可视区域，而导出抽屉此刻还在 DOM 里——onStarted 只是
    // 触发了状态更新，React 还没重绘。不等抽屉真正消失就截图，用户会得到一张
    // 右半边是抽屉、课表被遮住的废图。
    await waitForRepaint()
    const scale = Number.parseInt(config.imageScale, 10) as 1 | 2 | 3
    const result = await capturePng({ targetPath: selection.targetPath, scale })
    if (!result.ok) throw new Error(result.message)
    return {
      targetPath: selection.targetPath,
      currentPreviewOnly: config.imageRange !== '当前预览',
    }
  }

  const { jobId } = await startExport(planId, {
    format,
    options: config,
    targetPath: selection.targetPath,
  })
  while (true) {
    const job = await getExportJob(jobId)
    if (job.status === 'done') {
      return { targetPath: job.path ?? selection.targetPath, currentPreviewOnly: false }
    }
    if (job.status === 'error') throw new Error(job.message || '导出任务失败')
    await wait()
  }
}

function placementAt(workspace: Workspace, filter: (item: Placement) => boolean, dayId: number, periodId: number) {
  return workspace.placements.find((item) => item.dayId === dayId && item.periodId === periodId && filter(item))
}

function PreviewCell({ workspace, item, mode }: { workspace: Workspace; item: Placement | undefined; mode: Mode }) {
  if (!item) return <div className="pv-cell empty" />
  const cname = courseName(workspace, item.courseId)
  const tag = biweeklyTag(workspace, item.courseId)
  const line1 = mode === 'teacher' ? classLabel(findClass(workspace, item.classId)) : cname
  const line2 = mode === 'teacher' ? cname : (teacherName(workspace, item.teacherId) || '—')
  return <div className="pv-cell">
    {tag ? <span className={`pv-tag ${tag === '单' ? 'odd' : 'even'}`}>{tag}</span> : null}
    <div className="pv-line1">{line1}</div>
    <div className="pv-line2">{line2}</div>
  </div>
}

/** 单对象课表：行=时段/节次，列=星期 */
function SingleTimetable({ workspace, title, filter, mode }: {
  workspace: Workspace
  title: string
  filter: (item: Placement) => boolean
  mode: Mode
}) {
  const { bands, map } = periodsByBand(workspace)
  return <div className="pv-table-wrap">
    <table className="pv-table single">
      <thead>
        <tr>
          <th className="corner" colSpan={2}>{title}</th>
          {workspace.days.map((day) => <th key={day.id}>{day.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {bands.map((band) => {
          const list = map.get(band) ?? []
          return list.map((period, index) => <tr key={period.id}>
            {index === 0 ? <th className="band-cell" rowSpan={list.length}>{band}</th> : null}
            <th className="period-cell">{period.label || `${period.id}节`}</th>
            {workspace.days.map((day) => <td key={day.id}>
              <PreviewCell workspace={workspace} item={placementAt(workspace, filter, day.id, period.id)} mode={mode} />
            </td>)}
          </tr>)
        })}
      </tbody>
    </table>
  </div>
}

/** 总课表：行=对象，列=星期 → 时段 → 节次 */
function MasterTimetable({ workspace, rows, rowLabel, filterForRow, mode }: {
  workspace: Workspace
  rows: { id: string; name: string }[]
  rowLabel: string
  filterForRow: (row: { id: string; name: string }) => (item: Placement) => boolean
  mode: Mode
}) {
  const { bands, map } = periodsByBand(workspace)
  const periodList = workspace.periods

  return <div className="pv-table-wrap master">
    <table className="pv-table master">
      <thead>
        <tr>
          <th className="corner sticky-head" rowSpan={3}>{rowLabel}</th>
          {workspace.days.map((day) => <th key={day.id} colSpan={periodList.length} className="day-head">{day.label}</th>)}
        </tr>
        <tr>
          {workspace.days.map((day) => bands.map((band) => {
            const list = map.get(band) ?? []
            return <th key={`${day.id}-${band}`} colSpan={list.length} className="band-head">{band}</th>
          }))}
        </tr>
        <tr>
          {workspace.days.map((day) => periodList.map((period) => <th key={`${day.id}-${period.id}`} className="period-head">{period.label || `${period.id}节`}</th>))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.id}>
          <th className="row-head sticky-col">{row.name}</th>
          {workspace.days.map((day) => periodList.map((period) => <td key={`${day.id}-${period.id}`}>
            <PreviewCell workspace={workspace} item={placementAt(workspace, filterForRow(row), day.id, period.id)} mode={mode} />
          </td>))}
        </tr>)}
      </tbody>
    </table>
  </div>
}

function FilterChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={`filter-chip${active ? ' active' : ''}`} onClick={onClick}>{children}</button>
}

export function Step5Preview({ planId, workspace, showToast }: { planId: string; workspace: Workspace; showToast: (message: string) => void }) {
  const navigate = useNavigate()
  const grades = gradesOf(workspace)
  const [tab, setTab] = useState<Tab>('class')
  const [grade, setGrade] = useState(grades[0] ?? '')
  const [gradeAll, setGradeAll] = useState(true)
  const [classId, setClassId] = useState(workspace.classes.find((item) => item.grade === (grades[0] ?? ''))?.id ?? workspace.classes[0]?.id ?? '')
  const [teacherId, setTeacherId] = useState(workspace.teachers[0]?.id ?? '')
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [vertical, setVertical] = useState(false)

  const classList = workspace.classes.filter((item) => !grade || item.grade === grade)

  const teacherList = useMemo(() => {
    const ids = new Set<string>()
    const classes = tab === 'teacherAll' && gradeAll ? workspace.classes : workspace.classes.filter((item) => item.grade === grade)
    classes.forEach((schoolClass) => {
      Object.values(workspace.matrix[schoolClass.id] ?? {}).forEach((cell) => { if (cell.teacherId) ids.add(cell.teacherId) })
    })
    workspace.placements.forEach((placement) => {
      const schoolClass = findClass(workspace, placement.classId)
      if (!schoolClass) return
      if (tab === 'teacherAll' && gradeAll) {
        if (placement.teacherId) ids.add(placement.teacherId)
      } else if (schoolClass.grade === grade && placement.teacherId) {
        ids.add(placement.teacherId)
      }
    })
    const list = workspace.teachers.filter((teacher) => ids.has(teacher.id))
    return list.length ? list : workspace.teachers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, grade, gradeAll, tab])

  useEffect(() => {
    if (!classList.find((item) => item.id === classId) && classList[0]) setClassId(classList[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, tab])

  useEffect(() => {
    if (!teacherList.find((item) => item.id === teacherId) && teacherList[0]) setTeacherId(teacherList[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherList, tab])

  const classRows = classList.map((item) => ({ id: item.id, name: classLabel(item) }))
  const teacherRows = teacherList.map((item) => ({ id: item.id, name: item.name }))

  return <div className="stage-pad step5" data-screen-label="预览导出">
    <div className="pv-shell card">
      <div className="pv-top">
        <div className="pv-tabs">
          {TABS.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div className="pv-top-actions">
          {tab === 'classAll' ? <button className="btn btn-secondary btn-sm" onClick={() => setVertical((value) => !value)}>{vertical ? '切换横排' : '切换竖排'}</button> : null}
          <button className="btn btn-primary btn-sm" disabled={exporting} onClick={() => setExportOpen(true)}>{exporting ? '正在导出…' : '导出课表'}</button>
        </div>
      </div>

      <div className="pv-filters">
        {(tab === 'class' || tab === 'classAll' || tab === 'teacher') && <div className="filter-row">
          <span className="filter-label">年级：</span>
          <div className="filter-chips">
            {grades.map((item) => <FilterChip key={item} active={grade === item} onClick={() => { setGrade(item); setGradeAll(false) }}>{item}</FilterChip>)}
          </div>
        </div>}

        {tab === 'teacherAll' && <div className="filter-row">
          <span className="filter-label">年级：</span>
          <div className="filter-chips">
            <FilterChip active={gradeAll} onClick={() => setGradeAll(true)}>全部年级</FilterChip>
            {grades.map((item) => <FilterChip key={item} active={!gradeAll && grade === item} onClick={() => { setGradeAll(false); setGrade(item) }}>{item}</FilterChip>)}
          </div>
        </div>}

        {tab === 'class' && <div className="filter-row">
          <span className="filter-label">班级：</span>
          <div className="filter-chips">
            {classList.map((item) => <FilterChip key={item.id} active={classId === item.id} onClick={() => setClassId(item.id)}>{classLabel(item)}</FilterChip>)}
          </div>
        </div>}

        {tab === 'teacher' && <div className="filter-row align-start">
          <span className="filter-label">教师：</span>
          <div className="teacher-radios">
            {teacherList.map((item) => <label key={item.id} className={`teacher-radio${teacherId === item.id ? ' active' : ''}`}>
              <input type="radio" name="preview-teacher" checked={teacherId === item.id} onChange={() => setTeacherId(item.id)} />
              <span>{item.name}</span>
            </label>)}
          </div>
        </div>}
      </div>

      <div className="pv-body">
        {workspace.placements.length === 0 ? <div className="pv-empty">
          <CalendarBlank size={44} weight="duotone" />
          <div className="pv-empty-title">还没有排课结果</div>
          <div className="pv-empty-desc">到「4 排课调课」点「重新排课」生成课表后，这里就能预览和导出了。</div>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/flow/${planId}/adjust-schedule`)}>
            去排课调课
          </button>
        </div> : <>

        {tab === 'class' && <SingleTimetable
          workspace={workspace}
          title={classLabel(findClass(workspace, classId)) || '班级'}
          filter={(item) => item.classId === classId}
          mode="class"
        />}

        {tab === 'teacher' && <SingleTimetable
          workspace={workspace}
          title={teacherName(workspace, teacherId) || '教师'}
          filter={(item) => item.teacherId === teacherId}
          mode="teacher"
        />}

        {tab === 'classAll' && (vertical
          ? <div className="pv-stack">
            {classList.map((item) => <SingleTimetable key={item.id} workspace={workspace} title={classLabel(item)} filter={(placement) => placement.classId === item.id} mode="class" />)}
          </div>
          : <MasterTimetable workspace={workspace} rows={classRows} rowLabel="班级" filterForRow={(row) => (item) => item.classId === row.id} mode="class" />)}

        {tab === 'teacherAll' && <MasterTimetable workspace={workspace} rows={teacherRows} rowLabel="教师" filterForRow={(row) => (item) => item.teacherId === row.id} mode="teacher" />}

        </>}
      </div>
    </div>

    {exportOpen && <ExportDrawer
      workspace={workspace}
      exporting={exporting}
      onClose={() => setExportOpen(false)}
      onExport={(config) => {
        setExporting(true)
        void runExportJob(planId, config, () => setExportOpen(false))
          .then((result) => {
            if (!result) return
            const rangeNotice = result.currentPreviewOnly ? '；本版本仅导出当前预览' : ''
            showToast(`导出完成，已保存到 ${result.targetPath}${rangeNotice}`)
          })
          .catch((error: unknown) => showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`))
          .finally(() => setExporting(false))
      }}
    />}
  </div>
}

type ExportFormat = 'Excel' | 'PDF' | 'PNG 图片'
type ExportConfig = {
  format: ExportFormat
  classes: string[]
  fileName: string
  title: string
  showTeacher: boolean
  showNotes: boolean
  showBiweekly: boolean
  sheetLayout: string
  includeStats: boolean
  paper: string
  orientation: string
  pagination: string
  imageRange: string
  imageScale: string
  showTitleLegend: boolean
}

function ExportDrawer({ workspace, exporting, onClose, onExport }: {
  workspace: Workspace
  exporting: boolean
  onClose: () => void
  onExport: (config: ExportConfig) => void
}) {
  const [format, setFormat] = useState<ExportFormat>('Excel')
  const [picked, setPicked] = useState(workspace.classes.map((item) => item.id))
  const [fileName, setFileName] = useState(`${workspace.schemeName}-课表`)
  const [title, setTitle] = useState(workspace.schemeName)
  const [showTeacher, setShowTeacher] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [showBiweekly, setShowBiweekly] = useState(true)
  const [sheetLayout, setSheetLayout] = useState('每班一个工作表')
  const [includeStats, setIncludeStats] = useState(true)
  const [paper, setPaper] = useState('A4')
  const [orientation, setOrientation] = useState('横向')
  const [pagination, setPagination] = useState('每班一页')
  const [imageRange, setImageRange] = useState('当前预览')
  const [imageScale, setImageScale] = useState('2× 高清')
  const [showTitleLegend, setShowTitleLegend] = useState(true)

  const formatSummary = format === 'Excel' ? sheetLayout : format === 'PDF' ? `${paper} · ${orientation} · ${pagination}` : `${imageRange} · ${imageScale}`

  return <Modal
    title="导出课表"
    drawer
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        className="btn btn-primary"
        disabled={exporting || !picked.length}
        onClick={() => onExport({
          format, classes: picked, fileName, title, showTeacher, showNotes, showBiweekly,
          sheetLayout, includeStats, paper, orientation, pagination, imageRange, imageScale, showTitleLegend,
        })}
      >
        {exporting ? '正在导出…' : `导出 ${format}`}
      </button>
    </>}
  >
    <div className="field">
      <label>文件格式</label>
      <div className="export-formats">
        {(['Excel', 'PDF', 'PNG 图片'] as ExportFormat[]).map((item) => <button key={item} type="button" className={format === item ? 'active' : ''} onClick={() => setFormat(item)}>{item}</button>)}
      </div>
    </div>

    <div className="export-section">
      <div className="export-section-title">导出内容</div>
      <div className="field">
        <label>选择班级</label>
        <div className="row" style={{ marginBottom: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked(workspace.classes.map((item) => item.id))}>全选</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>清空</button>
        </div>
        <div className="export-grid">
          {workspace.classes.map((item) => <label key={item.id} className="check-row">
            <input
              type="checkbox"
              checked={picked.includes(item.id)}
              onChange={() => setPicked((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])}
            />
            {classLabel(item)}
          </label>)}
        </div>
      </div>
    </div>

    <div className="export-section">
      <div className="export-section-title">{format} 设置</div>
      {format === 'Excel' ? <>
        <div className="field">
          <label>工作表组织</label>
          <select value={sheetLayout} onChange={(event) => setSheetLayout(event.target.value)}>
            <option>每班一个工作表</option>
            <option>每年级一个工作表</option>
            <option>班级总表</option>
          </select>
        </div>
        <label className="check-row export-check">
          <input type="checkbox" checked={includeStats} onChange={(event) => setIncludeStats(event.target.checked)} />
          包含统计信息
        </label>
      </> : null}

      {format === 'PDF' ? <div className="export-field-grid">
        <div className="field">
          <label>纸张大小</label>
          <select value={paper} onChange={(event) => setPaper(event.target.value)}>
            <option>A4</option>
            <option>A3</option>
          </select>
        </div>
        <div className="field">
          <label>页面方向</label>
          <select value={orientation} onChange={(event) => setOrientation(event.target.value)}>
            <option>横向</option>
            <option>纵向</option>
          </select>
        </div>
        <div className="field export-field-span">
          <label>分页方式</label>
          <select value={pagination} onChange={(event) => setPagination(event.target.value)}>
            <option>每班一页</option>
            <option>每年级一页</option>
            <option>连续排版</option>
          </select>
        </div>
      </div> : null}

      {format === 'PNG 图片' ? <>
        <div className="export-field-grid">
          <div className="field">
            <label>导出范围</label>
            <select value={imageRange} onChange={(event) => setImageRange(event.target.value)}>
              <option>当前预览</option>
              <option>所选班级</option>
              <option>全部班级</option>
            </select>
          </div>
          <div className="field">
            <label>图片清晰度</label>
            <select value={imageScale} onChange={(event) => setImageScale(event.target.value)}>
              <option>1× 标准</option>
              <option>2× 高清</option>
              <option>3× 超清</option>
            </select>
          </div>
        </div>
        <label className="check-row export-check">
          <input type="checkbox" checked={showTitleLegend} onChange={(event) => setShowTitleLegend(event.target.checked)} />
          显示标题和图例
        </label>
      </> : null}
    </div>

    <div className="export-section">
      <div className="export-section-title">通用设置</div>
      <div className="field">
        <label>文件名</label>
        <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
      </div>
      <div className="field">
        <label>课表标题</label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="export-options">
        <label className="check-row export-check">
          <input type="checkbox" checked={showTeacher} onChange={(event) => setShowTeacher(event.target.checked)} />
          显示教师
        </label>
        <label className="check-row export-check">
          <input type="checkbox" checked={showBiweekly} onChange={(event) => setShowBiweekly(event.target.checked)} />
          显示单双周
        </label>
        <label className="check-row export-check">
          <input type="checkbox" checked={showNotes} onChange={(event) => setShowNotes(event.target.checked)} />
          显示备注
        </label>
      </div>
    </div>

    <div className="export-summary">
      将导出 <strong>{picked.length}</strong> 个班级 · <strong>{format}</strong> · {formatSummary}
    </div>
    <div className="help">PNG 的「所选班级」和「全部班级」本版本暂按当前预览导出。</div>
  </Modal>
}
