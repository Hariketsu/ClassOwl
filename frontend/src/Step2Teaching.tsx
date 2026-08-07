/* 步骤 2 — 课时任课：矩阵 + 工具
   DOM 与类名对应 designs/classowl-flow/step2.jsx（原型未随仓库公开） */

import { useEffect, useRef, useState } from 'react'
import { listImportRecords, recordImport, type ImportRecord } from './api'
import { ConfirmModal, Modal, PromptModal } from './ui'
import {
  addBiweeklyRule,
  addCombinedRule,
  addCourses,
  addLayeredRule,
  addLinkedRule,
  addVenueRule,
  bulkSetCourseHours,
  capacityOf,
  classLabel,
  clearGradeMatrix,
  coursesForGrade,
  courseName,
  exportTeachingText,
  findClass,
  gradesOf,
  importTeaching,
  parseTeachingPaste,
  removeBiweeklyRule,
  removeCombinedRule,
  removeLayeredRule,
  removeLinkedRule,
  removeVenueRule,
  replaceTeacherInGrade,
  reorderGradeCourses,
  setHoursOf,
  setMatrixCell,
  teacherWorkload,
  type Workspace,
} from './workspace'

type Tool = 'import' | 'addCourse' | 'workload' | 'linked' | 'biweekly' | 'combined' | 'layered' | 'venues' | null
type Dialog =
  | { kind: 'clearMatrix' }
  | { kind: 'replaceTeacherFrom' }
  | { kind: 'replaceTeacherTo'; from: string }
  | { kind: 'reorderCourses' }
  | { kind: 'bulkHours'; courseId: string }

export function Step2Teaching({ workspace, planId, onChange, showToast }: {
  workspace: Workspace
  planId: string
  onChange: (next: Workspace) => void
  showToast: (message: string) => void
}) {
  const grades = gradesOf(workspace)
  const [grade, setGrade] = useState(grades[0] ?? '一年级')
  const [tool, setTool] = useState<Tool>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [courseMenuOpen, setCourseMenuOpen] = useState(false)
  const courseMenuRef = useRef<HTMLDivElement>(null)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  const cap = capacityOf(workspace)
  const courses = coursesForGrade(workspace, grade)
  const classRows = workspace.classes.filter((item) => item.grade === grade)

  useEffect(() => {
    if (!grades.includes(grade) && grades[0]) setGrade(grades[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grades.join('|')])

  useEffect(() => {
    if (!courseMenuOpen) return
    const onDoc = (event: MouseEvent) => {
      if (courseMenuRef.current && !courseMenuRef.current.contains(event.target as Node)) setCourseMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [courseMenuOpen])

  useEffect(() => {
    if (!settingsMenuOpen) return
    const onDoc = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) setSettingsMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [settingsMenuOpen])

  return <div className="stage-pad s2-page" data-screen-label="课时任课">
    <div className="s2-topbar">
      <div className="s2-grades">
        {grades.map((item) => <button
          key={item}
          type="button"
          className={`s2-grade-tab${grade === item ? ' active' : ''}`}
          onClick={() => setGrade(item)}
        >
          {item}
        </button>)}
      </div>
      <div className="s2-tools">
        <div className="s2-tool-row">
          <div
            className={`s2-split${courseMenuOpen ? ' open' : ''}`}
            ref={courseMenuRef}
            onMouseEnter={() => setCourseMenuOpen(true)}
            onMouseLeave={() => setCourseMenuOpen(false)}
          >
            <button type="button" className="btn btn-sm btn-solid s2-split-main" onClick={() => setTool('addCourse')}>新增课程</button>
            <button
              type="button"
              className="btn btn-sm btn-solid s2-split-caret"
              aria-label="更多课程操作"
              onClick={() => setCourseMenuOpen((value) => !value)}
            >
              ▾
            </button>
            <div className="s2-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setDialog({ kind: 'reorderCourses' }); setCourseMenuOpen(false) }}>课程排序</button>
              <button type="button" role="menuitem" onClick={() => { setDialog({ kind: 'clearMatrix' }); setCourseMenuOpen(false) }}>清空数据</button>
              <button type="button" role="menuitem" onClick={() => { setDialog({ kind: 'replaceTeacherFrom' }); setCourseMenuOpen(false) }}>替换教师</button>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTool('import')}>批量导入</button>
          <div className={`s2-drop${settingsMenuOpen ? ' open' : ''}`} ref={settingsMenuRef}>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setSettingsMenuOpen((value) => !value)}>
              设置 ▾
            </button>
            <div className="s2-menu" role="menu">
              {([
                ['workload', '教师周课时明细'],
                ['venues', '场地限制设置'],
                ['combined', '合班设置'],
                ['layered', '分层教学设置'],
                ['biweekly', '单双周设置'],
                ['linked', '连堂设置'],
              ] as const).map(([kind, label]) => <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => { setTool(kind); setSettingsMenuOpen(false) }}
              >
                {label}
              </button>)}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div className="matrix-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="sticky-col" rowSpan={2}>课程</th>
            {classRows.map((schoolClass) => {
              const setH = setHoursOf(workspace, schoolClass.id)
              const capClass = setH === cap ? 'cap-ok' : setH > cap ? 'cap-over' : 'cap-under'
              return <th key={schoolClass.id} colSpan={2} className="class-head">
                <strong>{classLabel(schoolClass)}</strong>
                <span className={`cls-cap ${capClass}`}>{setH}/{cap}</span>
              </th>
            })}
          </tr>
          <tr className="subhead">
            {classRows.map((schoolClass) => <>
              <th className="sub-hours" key={`h-${schoolClass.id}`}>课时</th>
              <th className="sub-teacher" key={`t-${schoolClass.id}`}>教师</th>
            </>)}
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => <tr key={course.id}>
            <td
              className="sticky-col course-col"
              title="点击批量设置该课程课时"
              onClick={() => setDialog({ kind: 'bulkHours', courseId: course.id })}
            >
              <span className="course-name">
                {course.name}
                {course.biweekly ? <span className="bw">单双周</span> : null}
              </span>
              <span className="bulk-hint">批量课时</span>
            </td>
            {classRows.map((schoolClass) => {
              const cell = workspace.matrix[schoolClass.id]?.[course.id] ?? { hours: 0, teacherId: '' }
              return <>
                <td className="cell-hours" key={`h-${schoolClass.id}`}>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    aria-label={`${classLabel(schoolClass)}${course.name}课时`}
                    value={cell.hours || 0}
                    onChange={(event) => onChange(setMatrixCell(workspace, schoolClass.id, course.id, { hours: Number(event.target.value) || 0 }))}
                  />
                </td>
                <td className="cell-teacher" key={`t-${schoolClass.id}`}>
                  <select
                    aria-label={`${classLabel(schoolClass)}${course.name}教师`}
                    value={cell.teacherId || ''}
                    onChange={(event) => onChange(setMatrixCell(workspace, schoolClass.id, course.id, { teacherId: event.target.value }))}
                  >
                    <option value="">输入教师</option>
                    {workspace.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                  </select>
                </td>
              </>
            })}
          </tr>)}
        </tbody>
      </table>
    </div>

    {tool === 'import' && <ImportTeachingModal
      workspace={workspace}
      grade={grade}
      planId={planId}
      onClose={() => setTool(null)}
      onApply={(next, message) => { onChange(next); setTool(null); showToast(message) }}
    />}
    {tool === 'addCourse' && <AddCourseModal
      grade={grade}
      onClose={() => setTool(null)}
      onApply={(names) => { onChange(addCourses(workspace, grade, names)); setTool(null); showToast('已添加课程列') }}
    />}
    {tool === 'workload' && <Modal title="教师周课时明细" drawer onClose={() => setTool(null)}>
      <TeacherWorkloadTable workspace={workspace} />
    </Modal>}
    {tool === 'linked' && <LinkedModal workspace={workspace} grade={grade} onChange={onChange} onClose={() => setTool(null)} showToast={showToast} />}
    {tool === 'biweekly' && <BiweeklyModal workspace={workspace} grade={grade} onChange={onChange} onClose={() => setTool(null)} showToast={showToast} />}
    {tool === 'combined' && <CombinedModal workspace={workspace} onChange={onChange} onClose={() => setTool(null)} showToast={showToast} />}
    {tool === 'layered' && <LayeredModal workspace={workspace} onChange={onChange} onClose={() => setTool(null)} showToast={showToast} />}
    {tool === 'venues' && <VenueModal workspace={workspace} onChange={onChange} onClose={() => setTool(null)} showToast={showToast} />}

    {dialog?.kind === 'clearMatrix' && <ConfirmModal
      title="清空任课数据"
      message={`确定清空「${grade}」全部任课数据？此操作不可撤销。`}
      confirmLabel="清空"
      danger
      onClose={() => setDialog(null)}
      onConfirm={() => { onChange(clearGradeMatrix(workspace, grade)); setDialog(null); showToast(`已清空 ${grade} 任课数据`) }}
    />}

    {dialog?.kind === 'replaceTeacherFrom' && <PromptModal
      title="替换教师"
      label="将哪位教师全部替换？"
      confirmLabel="下一步"
      onClose={() => setDialog(null)}
      onConfirm={(value) => setDialog({ kind: 'replaceTeacherTo', from: value.trim() })}
    />}
    {dialog?.kind === 'replaceTeacherTo' && <PromptModal
      title="替换教师"
      label={`把「${dialog.from}」替换为？`}
      confirmLabel="替换"
      onClose={() => setDialog(null)}
      onConfirm={(value) => {
        const result = replaceTeacherInGrade(workspace, grade, dialog.from, value.trim())
        if (result.error) { showToast(result.error); setDialog(null); return }
        onChange(result.workspace)
        setDialog(null)
        showToast(`已在 ${grade} 将「${dialog.from}」替换为「${value.trim()}」`)
      }}
    />}

    {dialog?.kind === 'reorderCourses' && <ReorderCoursesModal
      workspace={workspace}
      grade={grade}
      onClose={() => setDialog(null)}
      onApply={(names) => {
        if (courses.length < 2) { showToast('当前年级课程不足，无法排序'); setDialog(null); return }
        onChange(reorderGradeCourses(workspace, grade, names))
        setDialog(null)
        showToast('已更新课程顺序')
      }}
    />}

    {dialog?.kind === 'bulkHours' && <PromptModal
      title={`批量设置「${courseName(workspace, dialog.courseId)}」课时`}
      label="课时数"
      defaultValue="2"
      confirmLabel="确定"
      onClose={() => setDialog(null)}
      onConfirm={(value) => {
        const hours = Number(value)
        if (!Number.isNaN(hours)) {
          onChange(bulkSetCourseHours(workspace, grade, dialog.courseId, hours))
          showToast(`已批量填写「${courseName(workspace, dialog.courseId)}」课时`)
        }
        setDialog(null)
      }}
    />}
  </div>
}

function ReorderCoursesModal({ workspace, grade, onClose, onApply }: {
  workspace: Workspace
  grade: string
  onClose: () => void
  onApply: (names: string[]) => void
}) {
  const [text, setText] = useState(coursesForGrade(workspace, grade).map((course) => course.name).join('\n'))
  const submit = () => {
    const order = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (!order.length) return
    onApply(order)
  }
  return <Modal
    title="调整课程顺序"
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button className="btn btn-primary" onClick={submit}>保存顺序</button>
    </>}
  >
    <div className="field">
      <label>每行一门，删掉的行会从本年级移除</label>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} />
    </div>
  </Modal>
}

function TeacherWorkloadTable({ workspace }: { workspace: Workspace }) {
  const rows = teacherWorkload(workspace)
  const [query, setQuery] = useState('')
  const filtered = rows.filter((row) => !query || row.name.includes(query) || row.subjectText.includes(query))

  return <div>
    <div className="row" style={{ marginBottom: 10 }}>
      <input placeholder="筛教师 / 科目" value={query} onChange={(event) => setQuery(event.target.value)} />
      <span className="muted small">{filtered.length} 人</span>
    </div>
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>教师名称</th>
            <th>周课时数</th>
            <th>任教科目</th>
            <th>带班数量</th>
            <th>具体任教班级</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => <tr key={row.teacherId}>
            <td>{row.name}</td>
            <td>{row.hours}</td>
            <td>{row.subjectText}</td>
            <td>{row.classCount}</td>
            <td className="small">{row.detailText}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>
}

function ImportTeachingModal({ workspace, grade, planId, onClose, onApply }: {
  workspace: Workspace
  grade: string
  planId: string
  onClose: () => void
  onApply: (next: Workspace, message: string) => void
}) {
  const [text, setText] = useState('班级,课程,教师,周课时\n一年级1班,语文,王芳,8\n一年级1班,数学,李强,5\n一年级2班,语文,王芳,8')
  const [scope, setScope] = useState<'grade' | 'all'>('grade')
  const [confirming, setConfirming] = useState(false)
  const [history, setHistory] = useState<ImportRecord[]>([])
  const rows = parseTeachingPaste(text)

  useEffect(() => {
    // 历史拉取失败不阻塞导入功能本身
    listImportRecords(planId).then(setHistory).catch(() => {})
  }, [planId])

  const apply = () => {
    const { workspace: next, count } = importTeaching(workspace, grade, scope, rows)
    const message = `已导入 ${count} 条任课（${scope === 'all' ? '全年级' : '当前年级'}，已替换）`
    recordImport(planId, { kind: 'teaching', source: '粘贴导入', summary: message }).catch(() => {})
    onApply(next, message)
  }

  return <Modal
    title="批量导入任课"
    drawer
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={!rows.length} onClick={() => setConfirming(true)}>导入 {rows.length} 条</button>
    </>}
  >
    <div className="help" style={{ marginBottom: 12 }}>
      1. 下载模板或导出当前任课 → 2. 在 Excel 中完善 → 3. 粘贴到下方导入。
    </div>
    <div className="warn-box">
      导入会<strong>清空并替换</strong>现有任课，相关连堂/单双周设置会一并清除。建议先点「导出当前到文本框」留底。
    </div>
    <div className="row" style={{ marginBottom: 10 }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setText(exportTeachingText(workspace, grade, scope))}>导出当前到文本框</button>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => setText('班级,课程,教师,周课时\n一年级1班,语文,王芳,8\n一年级1班,数学,李强,5\n一年级1班,体育与健康,赵磊,3')}
      >
        填入模板示例
      </button>
    </div>
    <div className="seg" style={{ marginBottom: 10 }}>
      <button className={scope === 'grade' ? 'active' : ''} onClick={() => setScope('grade')}>仅导入当前年级</button>
      <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>导入全年级数据</button>
    </div>
    <textarea value={text} onChange={(event) => setText(event.target.value)} rows={12} />
    <p className="muted small">预览：将写入 {rows.length} 行（表头/空行已忽略）</p>
    {history.length > 0 && <div className="import-history">
      <div className="import-history-title">导入历史</div>
      {history.map((record) => <div className="import-history-row" key={record.id}>
        <span className="muted">{record.createdAt.slice(0, 16).replace('T', ' ')}</span>
        <span>{record.summary}</span>
      </div>)}
    </div>}
    {confirming && <ConfirmModal
      title="确认导入"
      message="导入后现有课时任课将被清空替换，相关连堂/单双周设置会清除。确定继续？"
      confirmLabel="确定导入"
      danger
      onClose={() => setConfirming(false)}
      onConfirm={apply}
    />}
  </Modal>
}

function AddCourseModal({ grade, onClose, onApply }: {
  grade: string
  onClose: () => void
  onApply: (names: string[]) => void
}) {
  const [text, setText] = useState('书法\n心理健康')
  return <Modal
    title="新增课程"
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        className="btn btn-primary"
        onClick={() => {
          const names = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
          if (names.length) onApply(names)
        }}
      >
        添加
      </button>
    </>}
  >
    <div className="field">
      <label>每行一个课程全称</label>
      <textarea value={text} onChange={(event) => setText(event.target.value)} />
    </div>
    <p className="muted small">将加入当前年级「{grade}」的矩阵列；同名课程会复用。</p>
  </Modal>
}

function LinkedModal({ workspace, grade, onChange, onClose, showToast }: {
  workspace: Workspace
  grade: string
  onChange: (next: Workspace) => void
  onClose: () => void
  showToast: (message: string) => void
}) {
  const courses = coursesForGrade(workspace, grade)
  const classRows = workspace.classes.filter((item) => item.grade === grade)
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [times, setTimes] = useState(1)
  const [consecutive, setConsecutive] = useState(2)
  const [picked, setPicked] = useState(classRows.map((item) => item.id))

  return <Modal
    title="连堂设置"
    wide
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>关闭</button>
      <button
        className="btn btn-primary"
        onClick={() => {
          if (!courseId || !picked.length) return
          onChange(addLinkedRule(workspace, { courseId, classIds: picked, timesPerWeek: times, consecutive }))
          showToast('已保存连堂设置（自动排课优先满足）')
          onClose()
        }}
      >
        保存
      </button>
    </>}
  >
    <div className="help" style={{ marginBottom: 12 }}>设置一周连堂 N 次、一次连上 M 节。自动排课时优先满足。</div>
    <div className="row" style={{ marginBottom: 12 }}>
      <div className="field" style={{ margin: 0 }}>
        <label>课程</label>
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>一周连堂次数</label>
        <input type="number" min={1} max={5} value={times} onChange={(event) => setTimes(Number(event.target.value) || 1)} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>一次连上节数</label>
        <input type="number" min={2} max={4} value={consecutive} onChange={(event) => setConsecutive(Number(event.target.value) || 2)} />
      </div>
    </div>
    <div className="field">
      <label>适用班级</label>
      <div className="chip-list">
        {classRows.map((item) => <button
          key={item.id}
          className={`chip${picked.includes(item.id) ? ' active' : ''}`}
          onClick={() => setPicked((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])}
        >
          {classLabel(item)}
        </button>)}
      </div>
    </div>
    <div className="rule-list">
      <div className="card-title">已设置</div>
      {workspace.linked.length === 0 && <p className="muted small">暂无</p>}
      {workspace.linked.map((item) => <div className="rule-row" key={item.id}>
        <div>
          <strong>{courseName(workspace, item.courseId)}</strong>
          <div className="muted small">
            {item.classIds.map((id) => classLabel(findClass(workspace, id))).join('、')} · 一周 {item.timesPerWeek} 次 × 连 {item.consecutive} 节
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(removeLinkedRule(workspace, item.id))}>删除</button>
      </div>)}
    </div>
  </Modal>
}

function BiweeklyModal({ workspace, grade, onChange, onClose, showToast }: {
  workspace: Workspace
  grade: string
  onChange: (next: Workspace) => void
  onClose: () => void
  showToast: (message: string) => void
}) {
  const courses = coursesForGrade(workspace, grade)
  const classRows = workspace.classes.filter((item) => item.grade === grade)
  const [a, setA] = useState(courses.find((item) => item.name === '音乐')?.id ?? courses[0]?.id ?? '')
  const [b, setB] = useState(courses.find((item) => item.name === '美术')?.id ?? courses[1]?.id ?? '')
  const [picked, setPicked] = useState(classRows.map((item) => item.id))

  return <Modal
    title="单双周设置"
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>关闭</button>
      <button
        className="btn btn-primary"
        onClick={() => {
          if (!a || !b || a === b) { showToast('请选择两门不同课程'); return }
          onChange(addBiweeklyRule(workspace, { courseA: a, courseB: b, classIds: picked, oddCourseId: a }))
          showToast('已保存单双周配对')
          onClose()
        }}
      >
        保存
      </button>
    </>}
  >
    <div className="help" style={{ marginBottom: 12 }}>将两门课配对为单周 A / 双周 B。同课若既有单双周又有常规，请拆成两个课程名。</div>
    <div className="row">
      <div className="field">
        <label>单周课程</label>
        <select value={a} onChange={(event) => setA(event.target.value)}>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>双周课程</label>
        <select value={b} onChange={(event) => setB(event.target.value)}>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </div>
    </div>
    <div className="field">
      <label>适用班级</label>
      <div className="chip-list">
        {classRows.map((item) => <button
          key={item.id}
          className={`chip${picked.includes(item.id) ? ' active' : ''}`}
          onClick={() => setPicked((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])}
        >
          {classLabel(item)}
        </button>)}
      </div>
    </div>
    <div className="rule-list">
      {workspace.biweekly.map((item) => <div className="rule-row" key={item.id}>
        <div className="small">
          单周 {courseName(workspace, item.courseA)} / 双周 {courseName(workspace, item.courseB)} ·{' '}
          {item.classIds.map((id) => classLabel(findClass(workspace, id))).join('、')}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(removeBiweeklyRule(workspace, item.id))}>删除</button>
      </div>)}
    </div>
  </Modal>
}

function CombinedModal({ workspace, onChange, onClose, showToast }: {
  workspace: Workspace
  onChange: (next: Workspace) => void
  onClose: () => void
  showToast: (message: string) => void
}) {
  const [courseId, setCourseId] = useState(workspace.courses[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])

  return <Modal
    title="合班设置"
    onClose={onClose}
    footer={<>
      <button className="btn btn-secondary" onClick={onClose}>关闭</button>
      <button
        className="btn btn-primary"
        onClick={() => {
          if (picked.length < 2) { showToast('请至少选择两个班'); return }
          onChange(addCombinedRule(workspace, { courseId, classIds: picked }))
          showToast('已添加合班')
          setPicked([])
        }}
      >
        合班
      </button>
    </>}
  >
    <div className="field">
      <label>课程</label>
      <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
        {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select>
    </div>
    <div className="field">
      <label>选择班级（可跨年级）</label>
      <div className="chip-list">
        {workspace.classes.map((item) => <button
          key={item.id}
          className={`chip${picked.includes(item.id) ? ' active' : ''}`}
          onClick={() => setPicked((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])}
        >
          {classLabel(item)}
        </button>)}
      </div>
    </div>
    <div className="rule-list">
      <div className="card-title">合班列表</div>
      {workspace.combined.length === 0 && <p className="muted small">暂无合班</p>}
      {workspace.combined.map((item) => <div className="rule-row" key={item.id}>
        <div className="small">
          {courseName(workspace, item.courseId)} · {item.classIds.map((id) => classLabel(findClass(workspace, id))).join(' + ')}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(removeCombinedRule(workspace, item.id))}>删除</button>
      </div>)}
    </div>
  </Modal>
}

function LayeredModal({ workspace, onChange, onClose, showToast }: {
  workspace: Workspace
  onChange: (next: Workspace) => void
  onClose: () => void
  showToast: (message: string) => void
}) {
  const [courseId, setCourseId] = useState(workspace.courses[0]?.id ?? '')
  const [classId, setClassId] = useState(workspace.classes[0]?.id ?? '')
  const [name, setName] = useState('A 层')
  const [teacherId, setTeacherId] = useState(workspace.teachers[0]?.id ?? '')

  return <Modal
    title="分层教学设置"
    onClose={onClose}
    footer={<button className="btn btn-secondary" onClick={onClose}>关闭</button>}
  >
    <div className="row">
      <div className="field">
        <label>课程</label>
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          {workspace.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>班级</label>
        <select value={classId} onChange={(event) => setClassId(event.target.value)}>
          {workspace.classes.map((item) => <option key={item.id} value={item.id}>{classLabel(item)}</option>)}
        </select>
      </div>
    </div>
    <div className="row">
      <div className="field grow">
        <label>分层名称</label>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>教师</label>
        <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
          {workspace.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
        </select>
      </div>
    </div>
    <button
      className="btn btn-primary"
      onClick={() => {
        onChange(addLayeredRule(workspace, { courseId, classId, name, teacherId }))
        showToast('已添加分层组')
      }}
    >
      添加分层组
    </button>
    <div className="rule-list" style={{ marginTop: 12 }}>
      {workspace.layered.length === 0 && <p className="muted small">暂无分层</p>}
      {workspace.layered.map((item) => <div className="rule-row" key={item.id}>
        <div className="small">
          {courseName(workspace, item.courseId)} / {classLabel(findClass(workspace, item.classId))} · {item.name} · {workspace.teachers.find((teacher) => teacher.id === item.teacherId)?.name ?? ''}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(removeLayeredRule(workspace, item.id))}>删除</button>
      </div>)}
    </div>
  </Modal>
}

function VenueModal({ workspace, onChange, onClose, showToast }: {
  workspace: Workspace
  onChange: (next: Workspace) => void
  onClose: () => void
  showToast: (message: string) => void
}) {
  const [name, setName] = useState('音乐室')
  const [capacity, setCapacity] = useState(1)
  const [courseIds, setCourseIds] = useState<string[]>([])

  return <Modal
    title="场地限制设置"
    onClose={onClose}
    footer={<button className="btn btn-secondary" onClick={onClose}>关闭</button>}
  >
    <div className="help" style={{ marginBottom: 12 }}>同一节次占用班级数不超过场地容量。</div>
    <div className="row">
      <div className="field grow">
        <label>场地名称</label>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>可容纳班级数</label>
        <input type="number" min={1} value={capacity} onChange={(event) => setCapacity(Number(event.target.value) || 1)} />
      </div>
    </div>
    <div className="field">
      <label>可用课程</label>
      <div className="chip-list">
        {workspace.courses.map((course) => <button
          key={course.id}
          className={`chip${courseIds.includes(course.id) ? ' active' : ''}`}
          onClick={() => setCourseIds((prev) => prev.includes(course.id) ? prev.filter((id) => id !== course.id) : [...prev, course.id])}
        >
          {course.name}
        </button>)}
      </div>
    </div>
    <button
      className="btn btn-primary"
      onClick={() => {
        onChange(addVenueRule(workspace, { name, capacity, courseIds }))
        showToast('已新建场地限制')
        setName('')
        setCourseIds([])
      }}
    >
      新建场地限制
    </button>
    <div className="rule-list" style={{ marginTop: 12 }}>
      {workspace.venues.length === 0 && <p className="muted small">暂无场地限制</p>}
      {workspace.venues.map((item) => <div className="rule-row" key={item.id}>
        <div className="small">
          {item.name} · 容量 {item.capacity} · {(item.courseIds ?? []).map((id) => courseName(workspace, id)).join('、') || '未选课程'}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(removeVenueRule(workspace, item.id))}>删除</button>
      </div>)}
    </div>
  </Modal>
}
