/* 步骤 1 — 班级作息：左天数/班级 · 右节次主工作台
   DOM 与类名对应 designs/classowl-flow/step1.jsx（原型未随仓库公开） */

import { useMemo, useState } from 'react'
import { ConfirmModal, PromptModal } from './ui'
import {
  addGrade,
  addPeriodInBand,
  capacityOf,
  fillTimesFromFirst,
  gradesOf,
  removeGrade,
  removePeriodInBand,
  renameClass,
  renameGrade,
  resetPeriodNames,
  setDayCount,
  setGradeClassCount,
  S1_BANDS,
  toggleBand,
  updateDay,
  updatePeriod,
  type Band,
  type Workspace,
} from './workspace'

type Dialog =
  | { kind: 'removeGrade'; grade: string }
  | { kind: 'addGrade' }
  | { kind: 'addPublicBand' }

export function Step1Timetable({ workspace, onChange, showToast }: {
  workspace: Workspace
  onChange: (next: Workspace) => void
  showToast: (message: string) => void
}) {
  const capacity = capacityOf(workspace)
  const grades = gradesOf(workspace)
  const [editDays, setEditDays] = useState(false)
  const [renamingGrade, setRenamingGrade] = useState<string | null>(null)
  const [lessonMin, setLessonMin] = useState(40)
  const [breakMin, setBreakMin] = useState(10)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const activeBands = useMemo(() => {
    const bands = new Set(workspace.periods.map((period) => period.band))
    return S1_BANDS.filter((band) => bands.has(band))
  }, [workspace.periods])

  const bandGroups = useMemo(() => {
    const map = new Map<Band, typeof workspace.periods>(S1_BANDS.map((band) => [band, []]))
    workspace.periods.forEach((period) => map.get(period.band)?.push(period))
    return S1_BANDS
      .map((band) => ({ band, list: map.get(band) ?? [] }))
      .filter((group) => group.list.length > 0)
  }, [workspace.periods])

  /** 统一处理返回 {workspace, error} 的操作 */
  const apply = (result: { workspace: Workspace; error?: string }) => {
    if (result.error) {
      showToast(result.error)
      return
    }
    onChange(result.workspace)
  }

  const handleRenameGrade = (oldName: string, newName: string) => {
    const result = renameGrade(workspace, oldName, newName)
    if (result.error) {
      showToast(result.error)
      return
    }
    setRenamingGrade(null)
    if (result.workspace !== workspace) {
      onChange(result.workspace)
      showToast('已修改年级名称')
    }
  }

  return <div className="stage-pad s1-page" data-screen-label="班级作息">
    <div className="s1-layout">
      {/* 左栏 */}
      <div className="s1-left">
        <div className="card s1-card">
          <div className="s1-card-head">
            <span className="s1-card-title">
              <i className="s1-bar" />
              选择排课天数
              <em className="req">*</em>
            </span>
            <span className="s1-card-hint">（选择几天，后面排课就只排几天）</span>
          </div>
          <div className="s1-card-body">
            <div className="s1-day-row">
              <label htmlFor="s1-day-count">课表循环天数：</label>
              <select
                id="s1-day-count"
                value={workspace.days.length}
                onChange={(event) => onChange(setDayCount(workspace, Number(event.target.value)))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
              <button type="button" className="s1-link" onClick={() => setEditDays((value) => !value)}>
                {editDays ? '收起各天名称' : '编辑各天名称'}
              </button>
            </div>
            {editDays && <div className="s1-day-names">
              {workspace.days.map((day) => <div className="s1-day-name-row" key={day.id}>
                <span className="badge">第 {day.id} 天</span>
                <input
                  aria-label={`第 ${day.id} 天名称`}
                  value={day.label}
                  onChange={(event) => onChange(updateDay(workspace, day.id, event.target.value))}
                />
              </div>)}
            </div>}
          </div>
        </div>

        <div className="card s1-card">
          <div className="s1-card-head">
            <span className="s1-card-title">
              <i className="s1-bar" />
              班级数量
              <em className="req">*</em>
            </span>
          </div>
          <div className="s1-card-body">
            <div className="s1-grade-grid">
              {grades.map((grade) => {
                const list = workspace.classes.filter((item) => item.grade === grade)
                const open = renamingGrade === grade
                return <div className={`s1-grade-card${open ? ' open' : ''}`} key={grade}>
                  <div className="s1-grade-main">
                    <span className="s1-grade-name">{grade}：</span>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      aria-label={`${grade}班级数量`}
                      value={list.length}
                      onChange={(event) => onChange(setGradeClassCount(workspace, grade, Number(event.target.value)))}
                    />
                    <button
                      type="button"
                      className="s1-icon-btn"
                      title="删除年级"
                      aria-label={`删除${grade}`}
                      onClick={() => setDialog({ kind: 'removeGrade', grade })}
                    >
                      🗑
                    </button>
                  </div>
                  <button type="button" className="s1-link" onClick={() => setRenamingGrade(open ? null : grade)}>
                    修改年级/班级名称
                  </button>
                  {open && <div className="s1-grade-edit">
                    <div className="s1-grade-edit-row">
                      <label>年级</label>
                      <input
                        aria-label={`${grade}名称`}
                        defaultValue={grade}
                        onBlur={(event) => handleRenameGrade(grade, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleRenameGrade(grade, event.currentTarget.value)
                        }}
                      />
                    </div>
                    {list.map((schoolClass) => <div className="s1-grade-edit-row" key={schoolClass.id}>
                      <label>班名</label>
                      <input
                        aria-label={`${grade}${schoolClass.name}班名`}
                        value={schoolClass.name}
                        onChange={(event) => onChange(renameClass(workspace, schoolClass.id, { name: event.target.value }))}
                      />
                      <input
                        className="s1-room"
                        placeholder="教室"
                        aria-label={`${grade}${schoolClass.name}教室`}
                        value={schoolClass.room}
                        onChange={(event) => onChange(renameClass(workspace, schoolClass.id, { room: event.target.value }))}
                      />
                    </div>)}
                  </div>}
                </div>
              })}
              {/* 空态引导：没有年级时光剩一个虚线按钮，新用户不知道从何下手。 */}
              {grades.length === 0 && <p className="s1-grade-hint">
                还没有任何班级。点下方「添加年级」，再设置每个年级的班级数量即可开始。
              </p>}
              <button type="button" className="s1-add-grade" onClick={() => setDialog({ kind: 'addGrade' })}>
                + 添加年级
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 右栏：节次 */}
      <div className="card s1-card s1-right">
        <div className="s1-card-head s1-right-head">
          <span className="s1-card-title">
            <i className="s1-bar" />
            排课节次设置
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => showToast('作息改动已即时生效')}
          >
            保存
          </button>
        </div>
        <div className="s1-card-body s1-right-body">
          <div className="s1-section">
            <div className="s1-section-title">
              <span className="s1-num">1</span>
              时段选择：
            </div>
            <div className="s1-band-checks">
              {S1_BANDS.map((band) => <label key={band} className="s1-check">
                <input
                  type="checkbox"
                  checked={activeBands.includes(band)}
                  onChange={() => apply(toggleBand(workspace, band, lessonMin, breakMin))}
                />
                <span>{band}</span>
              </label>)}
            </div>
          </div>

          <div className="s1-section">
            <div className="s1-section-title">
              <span className="s1-num">2</span>
              节次时间设置
              <span className="s1-section-hint">
                注：设置一个节次时间后点击
                <button
                  type="button"
                  className="s1-fill-ico"
                  title="快速填充"
                  aria-label="按课堂与休息时间快速填充"
                  onClick={() => {
                    const result = fillTimesFromFirst(workspace, lessonMin, breakMin)
                    if (result.error) {
                      showToast(result.error)
                      return
                    }
                    onChange(result.workspace)
                    showToast('已按课堂/休息时间填充')
                  }}
                >
                  ↻
                </button>
                图标，系统将根据课堂时间及休息时间快速设置时间。
              </span>
            </div>
            <div className="s1-time-tools">
              <label>
                课堂时间：
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={lessonMin}
                  onChange={(event) => setLessonMin(Number(event.target.value) || 40)}
                />
                分钟
              </label>
              <label>
                休息时间：
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={breakMin}
                  onChange={(event) => setBreakMin(Number(event.target.value) || 0)}
                />
                分钟
              </label>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onChange(resetPeriodNames(workspace))
                  showToast('已重置节次名称')
                }}
              >
                重置节次名称
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDialog({ kind: 'addPublicBand' })}
              >
                添加公共时段
              </button>
            </div>
          </div>

          <div className="s1-period-table-wrap">
            <table className="s1-period-table">
              <thead>
                <tr>
                  <th style={{ width: 88 }}>时段</th>
                  <th style={{ width: 160 }}>排课节次</th>
                  <th>开始时间</th>
                  <th>结束时间</th>
                </tr>
              </thead>
              <tbody>
                {bandGroups.map(({ band, list }) => list.map((period, index) => <tr key={period.id}>
                  {index === 0 && <td className="s1-band-cell" rowSpan={list.length}>
                    <div className="s1-band-label">{band}</div>
                    <div className="s1-band-count">（{list.length}节）</div>
                  </td>}
                  <td>
                    <div className="s1-period-ctrl">
                      <button
                        type="button"
                        className="s1-pm"
                        title="减少一节"
                        aria-label={`${band}减少一节`}
                        onClick={() => apply(removePeriodInBand(workspace, band))}
                      >
                        −
                      </button>
                      <input
                        className="s1-period-name"
                        aria-label={`第${period.id}节名称`}
                        value={period.label || `${period.id}节`}
                        onChange={(event) => onChange(updatePeriod(workspace, period.id, { label: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="s1-pm"
                        title="增加一节"
                        aria-label={`${band}增加一节`}
                        onClick={() => onChange(addPeriodInBand(workspace, band, lessonMin, breakMin))}
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td>
                    <input
                      className="s1-time"
                      aria-label={`第${period.id}节开始时间`}
                      value={period.start}
                      placeholder="请选择开始时间"
                      onChange={(event) => onChange(updatePeriod(workspace, period.id, { start: event.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      className="s1-time"
                      aria-label={`第${period.id}节结束时间`}
                      value={period.end}
                      placeholder="请选择结束时间"
                      onChange={(event) => onChange(updatePeriod(workspace, period.id, { end: event.target.value }))}
                    />
                  </td>
                </tr>))}
              </tbody>
            </table>
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>
            当前骨架：{workspace.days.length} 天 × {workspace.periods.length} 节 = <strong>{capacity}</strong> 节/班·周
          </p>
        </div>
      </div>
    </div>

    {dialog?.kind === 'removeGrade' && <ConfirmModal
      title="删除年级"
      message={`删除「${dialog.grade}」及其全部班级？该年级的任课与已排课程会一并移除。`}
      confirmLabel="删除"
      danger
      onClose={() => setDialog(null)}
      onConfirm={() => {
        onChange(removeGrade(workspace, dialog.grade))
        setDialog(null)
        showToast(`已删除 ${dialog.grade}`)
      }}
    />}

    {dialog?.kind === 'addGrade' && <PromptModal
      title="添加年级"
      label="新的年级名称"
      defaultValue="三年级"
      confirmLabel="添加"
      onClose={() => setDialog(null)}
      onConfirm={(value) => {
        const result = addGrade(workspace, value)
        if (result.error) {
          showToast(result.error)
          return
        }
        onChange(result.workspace)
        setDialog(null)
        showToast(`已添加 ${value.trim()}`)
      }}
    />}

    {dialog?.kind === 'addPublicBand' && <PromptModal
      title="添加公共时段"
      label="公共时段名称"
      defaultValue="大课间"
      confirmLabel="添加"
      onClose={() => setDialog(null)}
      onConfirm={(value) => {
        setDialog(null)
        showToast(`公共时段「${value.trim()}」仅作展示，不参与排课`)
      }}
    />}
  </div>
}
