/* 步骤 3 — 设置条件：三栏工作台
   DOM 与类名对应 designs/classowl-flow/step3.jsx（原型未随仓库公开） */

import { useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from './ui'
import {
  addRule,
  classLabel,
  clearAllRules,
  clearRulesByType,
  courseName,
  estimateRuleConflicts,
  findClass,
  gradesOf,
  removeRule,
  RULE_TYPES,
  teacherName,
  toggleRuleEnabled,
  type AlignStrength,
  type Cell,
  type LimitType,
  type Period,
  type RuleType,
  type SchoolClass,
  type ScheduleRule,
  type Teacher,
  type Workspace,
} from './workspace'

function cellKey(dayId: number, periodId: number) {
  return `${dayId}|${periodId}`
}
function cellsFromSet(set: Set<string>): Cell[] {
  return [...set].map((key) => {
    const [dayId, periodId] = key.split('|').map(Number)
    return { dayId, periodId }
  })
}
function setFromCells(cells: Cell[]) {
  return new Set(cells.map((cell) => cellKey(cell.dayId, cell.periodId)))
}

/** 课程 → 年级 → 班级 级联树（禁排/必排/优先排等） */
function CourseGradeClassTree({ workspace, courseIds, setCourseIds, classIds, setClassIds, multiCourse = true }: {
  workspace: Workspace
  courseIds: string[]
  setCourseIds: (ids: string[]) => void
  classIds: string[]
  setClassIds: (ids: string[]) => void
  multiCourse?: boolean
}) {
  const grades = gradesOf(workspace)
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    workspace.courses.forEach((course, index) => {
      initial[course.id] = index < 2
      grades.forEach((grade) => {
        initial[`${course.id}|${grade}`] = index < 1 && grade === grades[0]
      })
    })
    return initial
  })

  const classByGrade = useMemo(() => {
    const map: Record<string, SchoolClass[]> = {}
    grades.forEach((grade) => { map[grade] = workspace.classes.filter((item) => item.grade === grade) })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.classes, grades.join('|')])

  const allClassIds = workspace.classes.map((item) => item.id)
  const allCourseIds = workspace.courses.map((item) => item.id)

  const toggleOpen = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  const setCourseChecked = (courseId: string, checked: boolean) => {
    if (multiCourse) {
      setCourseIds(checked ? [...new Set([...courseIds, courseId])] : courseIds.filter((id) => id !== courseId))
    } else {
      setCourseIds(checked ? [courseId] : [])
    }
  }

  const gradeClassIds = (grade: string) => (classByGrade[grade] ?? []).map((item) => item.id)

  const setGradeChecked = (grade: string, checked: boolean) => {
    const ids = gradeClassIds(grade)
    if (checked) setClassIds([...new Set([...classIds, ...ids])])
    else setClassIds(classIds.filter((id) => !ids.includes(id)))
  }

  const gradeState = (grade: string) => {
    const ids = gradeClassIds(grade)
    const n = ids.filter((id) => classIds.includes(id)).length
    if (n === 0) return 'off'
    if (n === ids.length) return 'on'
    return 'partial'
  }

  const courseState = (courseId: string) => (courseIds.includes(courseId) ? 'on' : 'off')

  const allCoursesOn = allCourseIds.length > 0 && allCourseIds.every((id) => courseIds.includes(id))
  const allClassesOn = allClassIds.length > 0 && allClassIds.every((id) => classIds.includes(id))

  return <div className="s3-tree">
    <label className="s3-tree-row root">
      <input
        type="checkbox"
        checked={Boolean(allCoursesOn && allClassesOn)}
        ref={(el) => {
          if (el) {
            const partial = (courseIds.length > 0 && !allCoursesOn) || (classIds.length > 0 && !allClassesOn)
            el.indeterminate = partial && !(allCoursesOn && allClassesOn)
          }
        }}
        onChange={(event) => {
          if (event.target.checked) {
            setCourseIds([...allCourseIds])
            setClassIds([...allClassIds])
          } else {
            setCourseIds([])
            setClassIds([])
          }
        }}
      />
      <span>全选</span>
    </label>

    {workspace.courses.map((course) => {
      const isOpen = Boolean(open[course.id])
      const state = courseState(course.id)
      return <div key={course.id} className="s3-tree-course">
        <div className="s3-tree-row">
          <button type="button" className={`s3-caret${isOpen ? ' open' : ''}`} onClick={() => toggleOpen(course.id)} aria-label="展开" />
          <label className="s3-tree-label">
            <input type="checkbox" checked={state === 'on'} onChange={(event) => setCourseChecked(course.id, event.target.checked)} />
            <span>{course.name}</span>
          </label>
        </div>
        {isOpen && grades.map((grade) => {
          const gradeKey = `${course.id}|${grade}`
          const gradeOpen = Boolean(open[gradeKey])
          const gState = gradeState(grade)
          const kids = classByGrade[grade] ?? []
          return <div key={gradeKey} className="s3-tree-grade">
            <div className="s3-tree-row">
              <button type="button" className={`s3-caret${gradeOpen ? ' open' : ''}`} onClick={() => toggleOpen(gradeKey)} />
              <label className="s3-tree-label">
                <input
                  type="checkbox"
                  checked={gState === 'on'}
                  ref={(el) => { if (el) el.indeterminate = gState === 'partial' }}
                  onChange={(event) => setGradeChecked(grade, event.target.checked)}
                />
                <span>{grade}</span>
              </label>
            </div>
            {gradeOpen && kids.map((schoolClass) => <label key={schoolClass.id} className="s3-tree-row s3-tree-class">
              <span className="s3-caret spacer" />
              <span className="s3-tree-label">
                <input
                  type="checkbox"
                  checked={classIds.includes(schoolClass.id)}
                  onChange={() => setClassIds(classIds.includes(schoolClass.id) ? classIds.filter((id) => id !== schoolClass.id) : [...classIds, schoolClass.id])}
                />
                <span>{classLabel(schoolClass)}</span>
              </span>
            </label>)}
          </div>
        })}
      </div>
    })}
  </div>
}

function TeacherSubjectTree({ workspace, teacherIds, setTeacherIds }: {
  workspace: Workspace
  teacherIds: string[]
  setTeacherIds: (ids: string[]) => void
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Teacher[]>()
    workspace.teachers.forEach((teacher) => {
      let subject = '其他'
      outer: for (const schoolClass of workspace.classes) {
        for (const [courseId, cell] of Object.entries(workspace.matrix[schoolClass.id] ?? {})) {
          if (cell.teacherId === teacher.id) {
            subject = courseName(workspace, courseId)
            break outer
          }
        }
      }
      if (!map.has(subject)) map.set(subject, [])
      map.get(subject)!.push(teacher)
    })
    return [...map.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  const allIds = workspace.teachers.map((teacher) => teacher.id)

  return <div className="s3-tree">
    <label className="s3-tree-row root">
      <input
        type="checkbox"
        checked={allIds.length > 0 && allIds.every((id) => teacherIds.includes(id))}
        ref={(el) => { if (el) el.indeterminate = teacherIds.length > 0 && teacherIds.length < allIds.length }}
        onChange={(event) => setTeacherIds(event.target.checked ? [...allIds] : [])}
      />
      <span>全选</span>
    </label>
    {groups.map(([subject, list]) => <div key={subject} className="s3-tree-course">
      <div className="s3-tree-group-title">{subject}</div>
      {list.map((teacher) => <label key={teacher.id} className="s3-tree-row s3-tree-class" style={{ paddingLeft: 8 }}>
        <span className="s3-tree-label">
          <input
            type="checkbox"
            checked={teacherIds.includes(teacher.id)}
            onChange={() => setTeacherIds(teacherIds.includes(teacher.id) ? teacherIds.filter((id) => id !== teacher.id) : [...teacherIds, teacher.id])}
          />
          <span>{teacher.name}</span>
        </span>
      </label>)}
    </div>)}
  </div>
}

/** 星期×节次网格：支持整列/整行/单格 */
function PeriodGridPicker({ workspace, cells, setCells, mode }: {
  workspace: Workspace
  cells: Cell[]
  setCells: (cells: Cell[]) => void
  mode: '' | 'ban' | 'must'
}) {
  const selected = useMemo(() => setFromCells(cells), [cells])
  const write = (nextSet: Set<string>) => setCells(cellsFromSet(nextSet))

  const toggleOne = (dayId: number, periodId: number) => {
    const key = cellKey(dayId, periodId)
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    write(next)
  }

  const toggleDay = (dayId: number) => {
    const allOn = workspace.periods.every((period) => selected.has(cellKey(dayId, period.id)))
    const next = new Set(selected)
    workspace.periods.forEach((period) => {
      const key = cellKey(dayId, period.id)
      if (allOn) next.delete(key)
      else next.add(key)
    })
    write(next)
  }

  const togglePeriod = (periodId: number) => {
    const allOn = workspace.days.every((day) => selected.has(cellKey(day.id, periodId)))
    const next = new Set(selected)
    workspace.days.forEach((day) => {
      const key = cellKey(day.id, periodId)
      if (allOn) next.delete(key)
      else next.add(key)
    })
    write(next)
  }

  const { bands, map } = useMemo(() => {
    const bandList: string[] = []
    const grouped = new Map<string, Period[]>()
    workspace.periods.forEach((period) => {
      const band = period.band || '其他'
      if (!grouped.has(band)) { grouped.set(band, []); bandList.push(band) }
      grouped.get(band)!.push(period)
    })
    return { bands: bandList, map: grouped }
  }, [workspace.periods])

  return <table className="period-grid">
    <thead>
      <tr>
        <th>时段</th>
        <th>节次</th>
        {workspace.days.map((day) => {
          const allOn = workspace.periods.every((period) => selected.has(cellKey(day.id, period.id)))
          const some = workspace.periods.some((period) => selected.has(cellKey(day.id, period.id)))
          return <th key={day.id}>
            <label className="pg-head-check">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => { if (el) el.indeterminate = some && !allOn }}
                onChange={() => toggleDay(day.id)}
              />
              <span>{day.label.replace('星期', '周')}</span>
            </label>
          </th>
        })}
      </tr>
    </thead>
    <tbody>
      {bands.map((band) => {
        const list = map.get(band) ?? []
        return list.map((period, index) => {
          const rowAll = workspace.days.every((day) => selected.has(cellKey(day.id, period.id)))
          const rowSome = workspace.days.some((day) => selected.has(cellKey(day.id, period.id)))
          return <tr key={period.id}>
            {index === 0 ? <th className="band-cell" rowSpan={list.length}>{band}</th> : null}
            <th className="period-cell">
              <label className="pg-head-check">
                <input
                  type="checkbox"
                  checked={rowAll}
                  ref={(el) => { if (el) el.indeterminate = rowSome && !rowAll }}
                  onChange={() => togglePeriod(period.id)}
                />
                <span>{period.label || `${period.id}节`}</span>
              </label>
            </th>
            {workspace.days.map((day) => {
              const on = selected.has(cellKey(day.id, period.id))
              return <td key={day.id}>
                <button type="button" className={`${mode}${on ? ' on' : ''}`} onClick={() => toggleOne(day.id, period.id)}>
                  {on ? (mode === 'must' ? '必' : mode === 'ban' ? '禁' : '✓') : ''}
                </button>
              </td>
            })}
          </tr>
        })
      })}
    </tbody>
  </table>
}

function RuleListPanel({ type, list, onToggle, onRemove, showNotes }: {
  type: RuleType
  list: ScheduleRule[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  showNotes: boolean
}) {
  return <div className="s3-list-panel">
    <div className="s3-list-head">
      <div className="s3-list-title"><i className="s3-list-bar" />{type}条件列表（共 {list.length} 条）</div>
    </div>
    <div className="s3-list-body">
      {list.length === 0
        ? <div className="s3-list-empty">暂无数据</div>
        : list.map((rule) => <div className={`s3-list-card${rule.enabled ? '' : ' off'}`} key={rule.id}>
          <div className="s3-list-card-top">
            <label className="s3-switch">
              <input type="checkbox" checked={Boolean(rule.enabled)} onChange={() => onToggle(rule.id)} />
              <span>{rule.enabled ? '已启用' : '已停用'}</span>
            </label>
            <div className="row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(rule.id)}>删除</button>
            </div>
          </div>
          {showNotes && rule.note ? <div className="s3-list-note">备注：{rule.note}</div> : null}
          <div className="s3-list-summary">{rule.summary}</div>
        </div>)}
    </div>
  </div>
}

function AlignTable({ workspace, alignMap, setAlignMap }: {
  workspace: Workspace
  alignMap: Record<string, AlignStrength>
  setAlignMap: (updater: (prev: Record<string, AlignStrength>) => Record<string, AlignStrength>) => void
}) {
  const rows: { teacherId: string; courseId: string }[] = []
  workspace.teachers.forEach((teacher) => {
    const subjects = new Set<string>()
    workspace.classes.forEach((schoolClass) => {
      Object.entries(workspace.matrix[schoolClass.id] ?? {}).forEach(([courseId, cell]) => {
        if (cell.teacherId === teacher.id) subjects.add(courseId)
      })
    })
    subjects.forEach((courseId) => rows.push({ teacherId: teacher.id, courseId }))
  })

  return <div className="s3-simple-pane">
    <div className="row" style={{ marginBottom: 8 }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setAlignMap(() => Object.fromEntries(rows.map((row) => [`${row.teacherId}|${row.courseId}`, '优先满足' as AlignStrength])))}
      >
        全部优先满足
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setAlignMap(() => Object.fromEntries(rows.map((row) => [`${row.teacherId}|${row.courseId}`, '尽量满足' as AlignStrength])))}
      >
        全部尽量满足
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAlignMap(() => ({}))}>清空</button>
    </div>
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table className="data">
        <thead><tr><th>教师</th><th>科目</th><th>强度</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.teacherId}|${row.courseId}`
            return <tr key={key}>
              <td>{teacherName(workspace, row.teacherId)}</td>
              <td>{courseName(workspace, row.courseId)}</td>
              <td>
                <select
                  value={alignMap[key] ?? ''}
                  onChange={(event) => setAlignMap((prev) => ({ ...prev, [key]: event.target.value as AlignStrength }))}
                >
                  <option value="">不设置</option>
                  <option>优先满足</option>
                  <option>尽量满足</option>
                </select>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </div>
}

export function Step3Rules({ workspace, onChange, showToast, onGoToStep4 }: {
  workspace: Workspace
  onChange: (next: Workspace) => void
  showToast: (message: string) => void
  onGoToStep4: () => void
}) {
  const [type, setType] = useState<RuleType>('禁排')
  const [keyword, setKeyword] = useState('')
  const meta = RULE_TYPES.find((item) => item.id === type) ?? RULE_TYPES[0]

  const [subjectMode, setSubjectMode] = useState<'course' | 'teacher'>('course')
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [classIds, setClassIds] = useState<string[]>([])
  const [teacherIds, setTeacherIds] = useState<string[]>([])
  const [cells, setCells] = useState<Cell[]>([])
  const [periodIds, setPeriodIds] = useState<number[]>([])
  const [dayIds, setDayIds] = useState<number[]>(workspace.days.map((day) => day.id))
  const [limitType, setLimitType] = useState<LimitType>('最少')
  const [limitCount, setLimitCount] = useState(1)
  const [periodA, setPeriodA] = useState(4)
  const [periodB, setPeriodB] = useState(5)
  const [relFrom, setRelFrom] = useState<string[]>([])
  const [relTo, setRelTo] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [continueNext, setContinueNext] = useState(true)
  const [alignMap, setAlignMap] = useState<Record<string, AlignStrength>>({})
  const [showNotes, setShowNotes] = useState(true)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    RULE_TYPES.forEach((item) => { map[item.id] = workspace.rules.filter((rule) => rule.type === item.id).length })
    return map
  }, [workspace.rules])

  const filteredTypes = RULE_TYPES.filter((item) => !keyword || item.id.includes(keyword))
  const conflictN = estimateRuleConflicts(workspace)
  const list = workspace.rules.filter((rule) => rule.type === type)

  useEffect(() => {
    setCourseIds([])
    setClassIds([])
    setTeacherIds([])
    setCells([])
    setPeriodIds(type === '课程优先排' ? [1, 2, 3, 4] : [])
    setRelFrom([])
    setRelTo([])
    setNote('')
    setSubjectMode('course')
    setDayIds(workspace.days.map((day) => day.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const buildSummary = () => {
    const courseText = courseIds.map((id) => courseName(workspace, id)).join('、') || '未选课程'
    const classText = classIds.length === 0 ? '全部班' : classIds.map((id) => classLabel(findClass(workspace, id))).join('、')
    const teacherText = teacherIds.map((id) => teacherName(workspace, id)).join('、') || '未选教师'
    const cellText = cells.map((cell) => `${workspace.days.find((day) => day.id === cell.dayId)?.label ?? ''}${cell.periodId}节`).join('，')
    switch (type) {
      case '禁排':
        return subjectMode === 'teacher'
          ? `${teacherText}，${cellText || '未选位置'}，不排课`
          : `${classText}${classIds.length ? '，' : ''}${courseText}，${cellText || '未选位置'}，不排课`
      case '必排':
        return `${classText}${classIds.length ? '，' : ''}${courseText}，${cellText || '未选位置'}，必排课`
      case '教师不同时上':
        return `${teacherText} 不同时上课`
      case '课程不排同天':
        return `${courseText} 不排同天`
      case '节次互斥':
        return `${teacherText} 在 ${cellText || '未选区域'} 每人最多一节`
      case '课程不相邻':
        return `上完 ${relFrom.map((id) => courseName(workspace, id)).join('、')} 不紧接 ${relTo.map((id) => courseName(workspace, id)).join('、')}`
      case '课程优先排':
        return `${courseText} 优先第 ${periodIds.join('、')} 节`
      case '课程尽量同时上':
        return `${courseText} · ${classText} 尽量同时上`
      case '教师不连上':
        return `${teacherText || '教师'} 第${periodA}节 与 第${periodB}节 不连续上`
      case '各天限制':
        return `${courseText || teacherText} ${dayIds.map((id) => workspace.days.find((day) => day.id === id)?.short).join('')} ${limitType} ${limitCount} 节`
      case '时段限制':
        return `${courseText || teacherText} 第 ${periodIds.join('、')} 节 ${limitType} ${limitCount} 节`
      case '教案齐头':
        return `教案齐头 ${Object.values(alignMap).filter(Boolean).length} 项`
      default:
        return type
    }
  }

  const saveRule = () => {
    if (type === '教案齐头') {
      const entries = Object.entries(alignMap).filter(([, value]) => value)
      if (!entries.length) { showToast('请至少设置一行齐头强度'); return }
      onChange(addRule(workspace, { type, enabled: true, note, align: { ...alignMap }, summary: `教案齐头 ${entries.length} 项` }))
      showToast('已保存教案齐头')
      setNote('')
      return
    }

    if (type === '禁排' || type === '必排') {
      if (!cells.length) { showToast('请点选课位'); return }
      if (subjectMode === 'course' && !courseIds.length) { showToast('请选择课程'); return }
      if (subjectMode === 'teacher' && !teacherIds.length) { showToast('请选择教师'); return }
    }
    if (type === '教师不同时上' && teacherIds.length < 2) { showToast('请至少选两位教师'); return }
    if (type === '课程不排同天' && courseIds.length < 2) { showToast('请至少选两门课'); return }
    if (type === '节次互斥' && (!teacherIds.length || !cells.length)) { showToast('请选择教师与区域'); return }
    if (type === '课程不相邻' && (!relFrom.length || !relTo.length)) { showToast('请配置课程关系'); return }
    if (type === '课程优先排' && (!courseIds.length || !periodIds.length)) { showToast('请选课程与节次'); return }
    if (type === '课程尽量同时上' && (!courseIds.length || !classIds.length)) { showToast('请选科目与班级'); return }
    if (type === '各天限制') {
      if (subjectMode === 'course' && !courseIds.length) { showToast('请选择课程'); return }
      if (subjectMode === 'teacher' && !teacherIds.length) { showToast('请选择教师'); return }
      if (!dayIds.length) { showToast('请选择星期'); return }
    }
    if (type === '时段限制') {
      if (subjectMode === 'course' && !courseIds.length) { showToast('请选择课程'); return }
      if (subjectMode === 'teacher' && !teacherIds.length) { showToast('请选择教师'); return }
      if (!periodIds.length) { showToast('请选择节次'); return }
    }

    onChange(addRule(workspace, {
      type, enabled: true, note, subjectMode,
      courseIds: [...courseIds], classIds: [...classIds], teacherIds: [...teacherIds],
      cells: [...cells], periodIds: [...periodIds], dayIds: [...dayIds],
      limitType, limitCount, periodA, periodB,
      relFrom: [...relFrom], relTo: [...relTo],
      summary: buildSummary(),
    }))
    showToast('已保存条件')
    setCells([])
    setNote('')
    if (continueNext) {
      const idx = RULE_TYPES.findIndex((item) => item.id === type)
      if (idx >= 0 && idx < RULE_TYPES.length - 1) setType(RULE_TYPES[idx + 1].id)
    }
  }

  const needsTreeGrid = type === '禁排' || type === '必排' || type === '节次互斥'
  const gridMode = type === '禁排' ? 'ban' : type === '必排' ? 'must' : ''

  return <div className="stage-pad step3" data-screen-label="设置条件">
    <div className="s3-page-head">
      <div className="s3-page-title">
        <h1>排课限制条件设置</h1>
        <div className={`s3-conflict ${conflictN ? 'warn' : 'ok'}`}>
          <span className="s3-conflict-ico">{conflictN ? '!' : '✓'}</span>
          <span>
            根据已设条件，预计 <strong>{conflictN}</strong> 节课有条件冲突，详情在「4 排课调课」，点击
            <button type="button" className="s3-inline-link" onClick={onGoToStep4}>查看未满足条件</button>
          </span>
        </div>
      </div>
      <div className="row">
        <input className="s3-search" placeholder="请输入关键字" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={() => setConfirmClearAll(true)}>清除全部条件</button>
      </div>
    </div>

    <div className="s3-workbench">
      <aside className="s3-types card">
        <div className="s3-type-list">
          {filteredTypes.map((item) => <button
            key={item.id}
            type="button"
            className={`s3-type-btn${type === item.id ? ' active' : ''}`}
            onClick={() => setType(item.id)}
          >
            <span>{item.id}</span>
            {counts[item.id] ? <span className="s3-type-count">{counts[item.id]}</span> : null}
          </button>)}
        </div>
      </aside>

      <section className="s3-center card">
        {meta.help ? <div className="s3-help"><span className="s3-help-tag">说明</span>{meta.help}</div> : null}

        <div className="s3-center-toolbar">
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={continueNext} onChange={(event) => setContinueNext(event.target.checked)} />
            保存后继续设置下一项
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveRule}>保存</button>
        </div>

        <div className="s3-center-body">
          {needsTreeGrid && <div className="s3-split">
            <div className={`s3-split-left${type === '节次互斥' ? ' compact' : ''}`}>
              {type !== '节次互斥' ? <>
                <div className="s3-seg">
                  <button type="button" className={subjectMode === 'course' ? 'active' : ''} onClick={() => setSubjectMode('course')}>课程</button>
                  <button type="button" className={subjectMode === 'teacher' ? 'active' : ''} onClick={() => setSubjectMode('teacher')}>教师</button>
                </div>
                {subjectMode === 'course'
                  ? <CourseGradeClassTree workspace={workspace} courseIds={courseIds} setCourseIds={setCourseIds} classIds={classIds} setClassIds={setClassIds} />
                  : <TeacherSubjectTree workspace={workspace} teacherIds={teacherIds} setTeacherIds={setTeacherIds} />}
              </> : <>
                <div className="s3-tree-heading">选择教师</div>
                <TeacherSubjectTree workspace={workspace} teacherIds={teacherIds} setTeacherIds={setTeacherIds} />
              </>}
            </div>
            <div className="s3-split-right">
              {type === '节次互斥' ? <div className="s3-panel-hint">选中的教师在以下选中的课位中最多只排一节课</div> : null}
              <PeriodGridPicker workspace={workspace} cells={cells} setCells={setCells} mode={gridMode} />
            </div>
          </div>}

          {type === '教师不同时上' && <div className="s3-simple-pane">
            <div className="s3-teacher-picker">
              <div className="s3-tree-heading">选择教师</div>
              <div className="s3-panel-hint s3-teacher-picker-hint">选中的教师不同时上课</div>
              <TeacherSubjectTree workspace={workspace} teacherIds={teacherIds} setTeacherIds={setTeacherIds} />
            </div>
          </div>}

          {type === '课程不排同天' && <div className="s3-simple-pane">
            <div className="s3-split-left">
              <div className="s3-tree-heading">多选课程</div>
              <div className="s3-pane-body">
                <div className="chip-list">
                  {workspace.courses.map((course) => <button
                    key={course.id}
                    type="button"
                    className={`chip${courseIds.includes(course.id) ? ' active' : ''}`}
                    onClick={() => setCourseIds(courseIds.includes(course.id) ? courseIds.filter((id) => id !== course.id) : [...courseIds, course.id])}
                  >
                    {course.name}
                  </button>)}
                </div>
              </div>
            </div>
          </div>}

          {/* 与 .s3-split 同构：面板框 + s3-tree-heading 头 + 可滚动列表。
              原来用的 .dual-lists .box 是固定 max-height，在撑满高度的父容器里
              会在下方留出大片空白，且标题是裸 h5，与其他类型的面板头不一致。 */}
          {type === '课程不相邻' && <div className="s3-split even">
            <div className="s3-split-left">
              <div className="s3-tree-heading">上完</div>
              <div className="s3-tree">
                {workspace.courses.map((course) => <label key={course.id} className="tree-item">
                  <input
                    type="checkbox"
                    checked={relFrom.includes(course.id)}
                    onChange={() => setRelFrom(relFrom.includes(course.id) ? relFrom.filter((id) => id !== course.id) : [...relFrom, course.id])}
                  />
                  {course.name}
                </label>)}
              </div>
            </div>
            <div className="s3-split-left">
              <div className="s3-tree-heading">不紧接</div>
              <div className="s3-tree">
                {workspace.courses.map((course) => <label key={course.id} className="tree-item">
                  <input
                    type="checkbox"
                    checked={relTo.includes(course.id)}
                    onChange={() => setRelTo(relTo.includes(course.id) ? relTo.filter((id) => id !== course.id) : [...relTo, course.id])}
                  />
                  {course.name}
                </label>)}
              </div>
            </div>
          </div>}

          {type === '课程优先排' && <div className="s3-split">
            <div className="s3-split-left">
              <CourseGradeClassTree workspace={workspace} courseIds={courseIds} setCourseIds={setCourseIds} classIds={classIds} setClassIds={setClassIds} />
            </div>
            <div className="s3-split-right paneled">
              <div className="s3-tree-heading">优先节次</div>
              <div className="s3-pane-body">
              <div className="chip-list">
                {workspace.periods.map((period) => <button
                  key={period.id}
                  type="button"
                  className={`chip${periodIds.includes(period.id) ? ' active' : ''}`}
                  onClick={() => setPeriodIds(periodIds.includes(period.id) ? periodIds.filter((id) => id !== period.id) : [...periodIds, period.id])}
                >
                  {period.label}
                </button>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPeriodIds([1, 2, 3, 4])}>上午 1–4 节</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPeriodIds(workspace.periods.map((period) => period.id))}>全选</button>
              </div>
              </div>
            </div>
          </div>}

          {type === '课程尽量同时上' && <div className="s3-split">
            <div className="s3-split-left">
              <div className="s3-tree-heading">科目</div>
              <div className="s3-pane-body">
              <div className="chip-list">
                {workspace.courses.map((course) => <button
                  key={course.id}
                  type="button"
                  className={`chip${courseIds.includes(course.id) ? ' active' : ''}`}
                  onClick={() => setCourseIds([course.id])}
                >
                  {course.name}
                </button>)}
              </div>
              </div>
            </div>
            <div className="s3-split-right paneled">
              <div className="s3-tree-heading">班级</div>
              <div className="s3-pane-body">
              <div className="chip-list">
                {workspace.classes.map((schoolClass) => <button
                  key={schoolClass.id}
                  type="button"
                  className={`chip${classIds.includes(schoolClass.id) ? ' active' : ''}`}
                  onClick={() => setClassIds(classIds.includes(schoolClass.id) ? classIds.filter((id) => id !== schoolClass.id) : [...classIds, schoolClass.id])}
                >
                  {classLabel(schoolClass)}
                </button>)}
              </div>
              </div>
            </div>
          </div>}

          {type === '教师不连上' && <div className="s3-simple-pane">
            <div className="s3-teacher-picker">
              <div className="s3-teacher-picker-fields">
                <div className="field">
                  <label>节次 A</label>
                  <select value={periodA} onChange={(event) => setPeriodA(Number(event.target.value))}>
                    {workspace.periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>节次 B</label>
                  <select value={periodB} onChange={(event) => setPeriodB(Number(event.target.value))}>
                    {workspace.periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="s3-panel-hint s3-teacher-picker-hint">请选择节次 A 和 B 不连续上课</div>
              <TeacherSubjectTree workspace={workspace} teacherIds={teacherIds} setTeacherIds={setTeacherIds} />
            </div>
          </div>}

          {(type === '各天限制' || type === '时段限制') && <div className="s3-split">
            <div className="s3-split-left">
              <div className="s3-seg">
                <button type="button" className={subjectMode === 'course' ? 'active' : ''} onClick={() => setSubjectMode('course')}>课程</button>
                <button type="button" className={subjectMode === 'teacher' ? 'active' : ''} onClick={() => setSubjectMode('teacher')}>教师</button>
              </div>
              {subjectMode === 'course'
                ? <CourseGradeClassTree workspace={workspace} courseIds={courseIds} setCourseIds={setCourseIds} classIds={classIds} setClassIds={setClassIds} />
                : <TeacherSubjectTree workspace={workspace} teacherIds={teacherIds} setTeacherIds={setTeacherIds} />}
            </div>
            <div className="s3-split-right">
              {type === '各天限制' ? <div className="field">
                <label>星期</label>
                <div className="chip-list">
                  {workspace.days.map((day) => <button
                    key={day.id}
                    type="button"
                    className={`chip${dayIds.includes(day.id) ? ' active' : ''}`}
                    onClick={() => setDayIds(dayIds.includes(day.id) ? dayIds.filter((id) => id !== day.id) : [...dayIds, day.id])}
                  >
                    {day.label}
                  </button>)}
                </div>
              </div> : <div className="field">
                <label>节次范围</label>
                <div className="chip-list">
                  {workspace.periods.map((period) => <button
                    key={period.id}
                    type="button"
                    className={`chip${periodIds.includes(period.id) ? ' active' : ''}`}
                    onClick={() => setPeriodIds(periodIds.includes(period.id) ? periodIds.filter((id) => id !== period.id) : [...periodIds, period.id])}
                  >
                    {period.label}
                  </button>)}
                </div>
              </div>}
              <div className="row">
                <div className="field">
                  <label>类型</label>
                  <select value={limitType} onChange={(event) => setLimitType(event.target.value as LimitType)}>
                    <option>最多</option>
                    <option>最少</option>
                    <option>固定</option>
                  </select>
                </div>
                <div className="field">
                  <label>节数</label>
                  <input type="number" min={0} max={10} value={limitCount} onChange={(event) => setLimitCount(Number(event.target.value) || 0)} />
                </div>
              </div>
            </div>
          </div>}

          {type === '教案齐头' && <AlignTable workspace={workspace} alignMap={alignMap} setAlignMap={setAlignMap} />}
        </div>

        <div className="s3-note-bar">
          <label className="muted small">备注</label>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选备注" />
        </div>
      </section>

      <aside className="s3-right card">
        <div className="s3-right-tools">
          <label className="s3-switch small">
            <input type="checkbox" checked={showNotes} onChange={(event) => setShowNotes(event.target.checked)} />
            <span>备注</span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(clearRulesByType(workspace, type))}>清除</button>
        </div>
        <RuleListPanel
          type={type}
          list={list}
          onToggle={(id) => onChange(toggleRuleEnabled(workspace, id))}
          onRemove={(id) => onChange(removeRule(workspace, id))}
          showNotes={showNotes}
        />
      </aside>
    </div>

    {confirmClearAll && <ConfirmModal
      title="清除全部条件"
      message="确定清除全部条件？"
      confirmLabel="清除"
      danger
      onClose={() => setConfirmClearAll(false)}
      onConfirm={() => { onChange(clearAllRules(workspace)); setConfirmClearAll(false) }}
    />}
  </div>
}
