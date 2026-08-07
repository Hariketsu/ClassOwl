import { describe, expect, it } from 'vitest'
import {
  addBiweeklyRule,
  addCourses,
  addGrade,
  addLinkedRule,
  addPeriodInBand,
  addRule,
  batchParkClass,
  biweeklyTag,
  bulkSetCourseHours,
  canPlace,
  capacityOf,
  clearAllRules,
  clearGradeMatrix,
  clearRulesByType,
  coursesForGrade,
  createDemoWorkspace,
  deleteBySource,
  dropHint,
  estimateRuleConflicts,
  fillRemaining,
  fillTimesFromFirst,
  gradesOf,
  hardConflicts,
  importTeaching,
  isBannedCell,
  moveToPark,
  movePlacement,
  parseTeachingPaste,
  periodsByBand,
  placeFromPark,
  removeGrade,
  removePeriodInBand,
  removeRule,
  renameGrade,
  reorderGradeCourses,
  replaceTeacherInGrade,
  replan,
  RULE_TYPES,
  setDayCount,
  setGradeClassCount,
  setMatrixCell,
  toggleLockPlacement,
  teacherWorkload,
  toggleBand,
  toggleRuleEnabled,
  updatePeriod,
} from './workspace'

describe('排课工作区模型', () => {
  it('演示数据保留足够课位余量', () => {
    const workspace = createDemoWorkspace()
    const totalHours = Object.values(workspace.matrix)
      .flatMap((row) => Object.values(row))
      .reduce((sum, cell) => sum + cell.hours, 0)

    expect(totalHours).toBe(125)
    expect(totalHours / (workspace.classes.length * capacityOf(workspace))).toBeCloseTo(5 / 6)
  })

  it('保留原型的 12 类排课条件及各自的中栏表单形态', () => {
    expect(RULE_TYPES).toHaveLength(12)
    expect(RULE_TYPES.every((item) => item.ui)).toBe(true)
    expect(RULE_TYPES.map((item) => item.id)).toContain('禁排')
  })

  it('五项任课附属设置是可多条的规则数组，而不是开关', () => {
    const workspace = createDemoWorkspace()

    expect(Array.isArray(workspace.linked)).toBe(true)
    expect(Array.isArray(workspace.biweekly)).toBe(true)
    expect(Array.isArray(workspace.combined)).toBe(true)
    expect(Array.isArray(workspace.layered)).toBe(true)
    expect(Array.isArray(workspace.venues)).toBe(true)
    expect(workspace.linked[0]).toMatchObject({ timesPerWeek: expect.any(Number), consecutive: expect.any(Number) })
  })

  it('年级课程表以 gradeCourses 为权威，0 班额年级仍可配置', () => {
    const workspace = setGradeClassCount(createDemoWorkspace(), '三年级', 0)

    expect(workspace.classes.some((item) => item.grade === '三年级')).toBe(false)
    expect(gradesOf(workspace)).toContain('三年级')
  })
})

describe('步骤 1 · 班级作息', () => {
  it('改天数后容量随之变化，并把已有排课标记为需重排', () => {
    const workspace = setDayCount(createDemoWorkspace(), 6)

    expect(workspace.days).toHaveLength(6)
    expect(capacityOf(workspace)).toBe(6 * workspace.periods.length)
    expect(workspace.scheduleStatus).toBe('empty')
  })

  it('增减时段后节次编号仍与时段顺序一致', () => {
    const base = createDemoWorkspace()
    const { workspace, error } = toggleBand(base, '晚上', 40, 10)

    expect(error).toBeUndefined()
    expect(workspace.periods.map((period) => period.id)).toEqual(
      workspace.periods.map((_, index) => index + 1),
    )
    expect(workspace.periods.at(-1)?.band).toBe('晚上')
  })

  it('拒绝把最后一个时段也关掉', () => {
    let workspace = createDemoWorkspace()
    for (const band of ['上午', '下午'] as const) {
      workspace = toggleBand(workspace, band, 40, 10).workspace
    }
    const remaining = new Set(workspace.periods.map((period) => period.band))

    expect(remaining.size).toBe(1)
    expect(toggleBand(workspace, [...remaining][0], 40, 10).error).toBe('至少保留一个时段')
  })

  it('某时段只剩一节时再减等于关掉该时段', () => {
    let workspace = createDemoWorkspace()
    const before = workspace.periods.filter((period) => period.band === '下午').length
    for (let index = 0; index < before; index += 1) {
      workspace = removePeriodInBand(workspace, '下午').workspace
    }

    expect(workspace.periods.some((period) => period.band === '下午')).toBe(false)
  })

  it('快速填充按课堂与休息时长顺推时间', () => {
    const base = updatePeriod(createDemoWorkspace(), 1, { start: '08:00' })
    const { workspace, error } = fillTimesFromFirst(base, 40, 10)

    expect(error).toBeUndefined()
    expect(workspace.periods[0]).toMatchObject({ start: '08:00', end: '08:40' })
    expect(workspace.periods[1]).toMatchObject({ start: '08:50', end: '09:30' })
  })

  it('第 1 节没有开始时间时快速填充给出提示', () => {
    const base = updatePeriod(createDemoWorkspace(), 1, { start: '' })

    expect(fillTimesFromFirst(base, 40, 10).error).toBe('请先填写第 1 节开始时间')
  })

  it('新增节次追加在所属时段末尾', () => {
    const base = createDemoWorkspace()
    const workspace = addPeriodInBand(base, '上午', 40, 10)
    const morning = workspace.periods.filter((period) => period.band === '上午')

    expect(morning).toHaveLength(base.periods.filter((period) => period.band === '上午').length + 1)
  })

  it('删除年级会连带清掉该年级的班级、任课与已排课程', () => {
    const base = createDemoWorkspace()
    const removedIds = base.classes.filter((item) => item.grade === '一年级').map((item) => item.id)
    const workspace = removeGrade(base, '一年级')

    expect(gradesOf(workspace)).not.toContain('一年级')
    expect(workspace.gradeCourses['一年级']).toBeUndefined()
    expect(removedIds.every((id) => !(id in workspace.matrix))).toBe(true)
    expect(workspace.placements.every((item) => !removedIds.includes(item.classId))).toBe(true)
  })

  it('新增与改名都拒绝重复的年级名', () => {
    const base = createDemoWorkspace()

    expect(addGrade(base, '一年级').error).toBe('年级已存在')
    expect(renameGrade(base, '一年级', '二年级').error).toBe('年级已存在')
    expect(renameGrade(base, '一年级', '启智班').workspace.gradeCourses['启智班']).toEqual(base.gradeCourses['一年级'])
  })
})

describe('步骤 2 · 课时任课', () => {
  it('批量设置某课程课时只影响所在年级的班级', () => {
    const workspace = bulkSetCourseHours(createDemoWorkspace(), '一年级', 'k3', 6)

    expect(workspace.matrix.c1.k3.hours).toBe(6)
    expect(workspace.matrix.c2.k3.hours).toBe(6)
    expect(workspace.matrix.c4.k3?.hours).toBe(8)
  })

  it('清空年级任课不影响其它年级', () => {
    const workspace = clearGradeMatrix(createDemoWorkspace(), '一年级')

    expect(workspace.matrix.c1).toEqual({})
    expect(Object.keys(workspace.matrix.c4).length).toBeGreaterThan(0)
  })

  it('替换教师只在指定年级生效，且找不到原教师时报错', () => {
    const base = createDemoWorkspace()
    const { workspace, error } = replaceTeacherInGrade(base, '一年级', '王芳', '新教师')

    expect(error).toBeUndefined()
    expect(workspace.matrix.c1.k1.teacherId).toBe(workspace.teachers.find((t) => t.name === '新教师')?.id)
    expect(workspace.matrix.c4.k1.teacherId).toBe('t8')
    expect(replaceTeacherInGrade(base, '一年级', '不存在的老师', 'x').error).toBe('未找到教师「不存在的老师」')
  })

  it('课程排序保留未列出的既有课程在末尾', () => {
    const base = createDemoWorkspace()
    const names = coursesForGrade(base, '一年级').map((c) => c.name).filter((name) => name !== '语文')
    const workspace = reorderGradeCourses(base, '一年级', ['数学', ...names])

    expect(workspace.gradeCourses['一年级'][0]).toBe('k4')
    expect(workspace.gradeCourses['一年级']).toContain('k3')
  })

  it('新增课程同名复用，不会重复创建', () => {
    const base = createDemoWorkspace()
    const workspace = addCourses(base, '一年级', ['语文', '书法'])

    expect(workspace.courses.filter((c) => c.name === '语文')).toHaveLength(1)
    expect(workspace.gradeCourses['一年级']).toContain(workspace.courses.find((c) => c.name === '书法')?.id)
  })

  it('教师周课时汇总按课时降序，且不含零课时教师', () => {
    const rows = teacherWorkload(createDemoWorkspace())

    expect(rows[0].hours).toBeGreaterThanOrEqual(rows.at(-1)!.hours)
    expect(rows.every((row) => row.hours > 0)).toBe(true)
  })

  it('解析粘贴文本会跳过表头与空行', () => {
    const rows = parseTeachingPaste('班级,课程,教师,周课时\n一年级1班,语文,王芳,8\n\n一年级2班,数学,李强,5')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ className: '一年级1班', courseName: '语文', teacherName: '王芳', hours: 8 })
  })

  it('批量导入会清空目标范围矩阵并清除涉及班级的连堂/单双周', () => {
    const base = createDemoWorkspace()
    const rows = parseTeachingPaste('一年级1班,语文,新老师,9')
    const { workspace, count } = importTeaching(base, '一年级', 'grade', rows)

    expect(count).toBe(1)
    expect(workspace.matrix.c1.k4).toBeUndefined()
    expect(workspace.matrix.c1.k3).toMatchObject({ hours: 9 })
    expect(workspace.linked).toHaveLength(0)
    expect(workspace.biweekly).toHaveLength(0)
  })

  it('连堂设置对同课程同班级去重后追加', () => {
    const base = createDemoWorkspace()
    const workspace = addLinkedRule(base, { courseId: 'k3', classIds: ['c1'], timesPerWeek: 2, consecutive: 2 })

    expect(workspace.linked.filter((item) => item.courseId === 'k3' && item.classIds.includes('c1'))).toHaveLength(1)
  })

  it('保存单双周会把两门课都标记为 biweekly', () => {
    const base = createDemoWorkspace()
    const workspace = addBiweeklyRule(base, { courseA: 'k9', courseB: 'k10', classIds: ['c1'], oddCourseId: 'k9' })

    expect(workspace.courses.find((c) => c.id === 'k9')?.biweekly).toBe(true)
    expect(workspace.courses.find((c) => c.id === 'k10')?.biweekly).toBe(true)
  })

  it('矩阵单元变更后已有排课标记为需重排', () => {
    const scheduled = { ...createDemoWorkspace(), placements: [{ id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 1, source: 'auto' as const, locked: false }] }
    const workspace = setMatrixCell(scheduled, 'c1', 'k3', { hours: 9 })

    expect(workspace.scheduleStatus).toBe('stale')
  })
})

describe('步骤 3 · 设置条件', () => {
  it('新增/删除/启停/按类型清除/清空全部条件', () => {
    let workspace = addRule(createDemoWorkspace(), { type: '教师不同时上', enabled: true, note: '', teacherIds: ['t1', 't2'], summary: 't1、t2 不同时上课' })
    const added = workspace.rules.at(-1)!

    workspace = toggleRuleEnabled(workspace, added.id)
    expect(workspace.rules.find((item) => item.id === added.id)?.enabled).toBe(false)

    workspace = removeRule(workspace, added.id)
    expect(workspace.rules.some((item) => item.id === added.id)).toBe(false)

    const base = createDemoWorkspace()
    expect(clearRulesByType(base, '禁排').rules.some((item) => item.type === '禁排')).toBe(false)
    expect(clearAllRules(base).rules).toHaveLength(0)
  })

  it('种子数据里的禁排规则命中对应课位，其它课程不受影响', () => {
    const workspace = createDemoWorkspace()

    expect(isBannedCell(workspace, 'c1', 'k6', 't4', 1, 1)).toBe(true)
    expect(isBannedCell(workspace, 'c1', 'k3', 't1', 1, 1)).toBe(false)
    expect(isBannedCell(workspace, 'c1', 'k6', 't4', 1, 2)).toBe(false)
  })

  it('禁用规则不参与禁排判定', () => {
    const base = createDemoWorkspace()
    const workspace = toggleRuleEnabled(base, 'r1')

    expect(isBannedCell(workspace, 'c1', 'k6', 't4', 1, 1)).toBe(false)
  })

  it('同一课位排两个班或两个教师会被识别为硬冲突', () => {
    const base = createDemoWorkspace()
    const workspace = {
      ...base,
      placements: [
        { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
        { id: 'p2', classId: 'c1', courseId: 'k4', teacherId: 't2', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
      ],
    }

    const conflicts = hardConflicts(workspace)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].kind).toBe('class')
  })

  it('禁排与必排在同一课位重叠会计入条件冲突预告', () => {
    let workspace = createDemoWorkspace()
    expect(estimateRuleConflicts(workspace)).toBe(0)

    workspace = addRule(workspace, {
      type: '禁排', enabled: true, note: '', subjectMode: 'course',
      courseIds: ['k1'], classIds: [], teacherIds: [],
      cells: [{ dayId: 1, periodId: 6 }],
      summary: '班会周一第6节不排课',
    })

    expect(estimateRuleConflicts(workspace)).toBe(1)
  })
})

describe('步骤 4 · 排课调课', () => {
  it('canPlace 依次拒绝班级双占、教师双占与禁排课位', () => {
    const base = createDemoWorkspace()
    const occupied = { ...base, placements: [{ id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false }] }

    expect(canPlace(occupied, occupied.placements, { classId: 'c1', courseId: 'k4', teacherId: 't2' }, 1, 2).reason).toBe('class')
    expect(canPlace(occupied, occupied.placements, { classId: 'c2', courseId: 'k4', teacherId: 't1' }, 1, 2).reason).toBe('teacher')
    expect(canPlace(base, [], { classId: 'c1', courseId: 'k6', teacherId: 't4' }, 1, 1).reason).toBe('rule')
    expect(canPlace(base, [], { classId: 'c1', courseId: 'k3', teacherId: 't1' }, 1, 2).ok).toBe(true)
  })

  it('移入暂放区：未锁定课程可移，锁定课程原地不动', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
      { id: 'p2', classId: 'c1', courseId: 'k4', teacherId: 't2', dayId: 1, periodId: 3, source: 'auto' as const, locked: true },
    ] }

    const afterUnlocked = moveToPark(base, 'p1')
    expect(afterUnlocked.placements.some((item) => item.id === 'p1')).toBe(false)
    expect(afterUnlocked.park[0]).toMatchObject({ classId: 'c1', courseId: 'k3', source: 'manual' })

    const afterLocked = moveToPark(base, 'p2')
    expect(afterLocked).toBe(base)
  })

  it('批量暂放只影响本班未锁定课程', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
      { id: 'p2', classId: 'c1', courseId: 'k4', teacherId: 't2', dayId: 1, periodId: 3, source: 'auto' as const, locked: true },
      { id: 'p3', classId: 'c4', courseId: 'k3', teacherId: 't8', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
    ] }

    const workspace = batchParkClass(base, 'c1')
    expect(workspace.placements.map((item) => item.id)).toEqual(['p2', 'p3'])
    expect(workspace.park).toHaveLength(1)
  })

  it('从暂放区落位：占用课位报错，空课位成功且来源标记为 manual', () => {
    const base = {
      ...createDemoWorkspace(),
      placements: [{ id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false }],
      park: [{ id: 'pk1', classId: 'c1', courseId: 'k4', teacherId: 't2', source: 'manual' as const, locked: false }],
    }

    expect(placeFromPark(base, 'pk1', 1, 2).error).toBe('落点已被占用')

    const result = placeFromPark(base, 'pk1', 1, 3)
    expect(result.error).toBeUndefined()
    expect(result.workspace.park).toHaveLength(0)
    expect(result.workspace.placements.find((item) => item.courseId === 'k4')).toMatchObject({ dayId: 1, periodId: 3, source: 'manual' })
  })

  it('移动课程：锁定课程拒绝移动，未锁定课程移动后来源变为 manual', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: true },
      { id: 'p2', classId: 'c1', courseId: 'k4', teacherId: 't2', dayId: 1, periodId: 3, source: 'auto' as const, locked: false },
    ] }

    expect(movePlacement(base, 'p1', 1, 4).error).toBe('已锁定，无法移动')

    const moved = movePlacement(base, 'p2', 2, 3)
    expect(moved.error).toBeUndefined()
    expect(moved.workspace.placements.find((item) => item.id === 'p2')).toMatchObject({ dayId: 2, periodId: 3, source: 'manual' })
  })

  it('按来源批量删除只清未锁定的那部分，其余进暂放区', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false },
      { id: 'p2', classId: 'c1', courseId: 'k4', teacherId: 't2', dayId: 1, periodId: 3, source: 'auto' as const, locked: true },
      { id: 'p3', classId: 'c1', courseId: 'k5', teacherId: 't3', dayId: 1, periodId: 4, source: 'manual' as const, locked: false },
    ] }

    const workspace = deleteBySource(base, 'auto')
    expect(workspace.placements.map((item) => item.id)).toEqual(['p2', 'p3'])
    expect(workspace.park).toHaveLength(1)
  })

  it('锁定/解锁只切换目标课程的 locked 字段', () => {
    const base = { ...createDemoWorkspace(), placements: [{ id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false }] }

    expect(toggleLockPlacement(base, 'p1', true).placements[0].locked).toBe(true)
  })

  it('拖拽提示：锁定课程与跨班拖拽都提示不可调，空课位提示可调，占用课位提示不可调', () => {
    const base = { ...createDemoWorkspace(), placements: [{ id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'auto' as const, locked: false }] }
    const drag = { kind: 'placement' as const, id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', locked: false }

    expect(dropHint(base, { ...drag, locked: true }, 1, 3, 'c1')?.cls).toBe('hint-bad')
    expect(dropHint(base, drag, 1, 3, 'c2')?.cls).toBe('hint-bad')
    expect(dropHint(base, drag, 1, 3, 'c1')?.cls).toBe('hint-ok')

    const parkItem = { kind: 'park' as const, id: 'pk1', classId: 'c1', courseId: 'k4', teacherId: 't2', locked: false }
    expect(dropHint(base, parkItem, 1, 2, 'c1')?.cls).toBe('hint-bad')
  })

  it('重新排课会满足必排规则，且只清除未锁定的已排课程', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'locked1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 2, periodId: 2, source: 'auto' as const, locked: true },
    ] }

    const workspace = replan(base)
    expect(workspace.scheduleStatus).toBe('ready')
    expect(workspace.placements.some((item) => item.id === 'locked1')).toBe(true)
    // r2：各班班会必排在周一第 6 节
    expect(workspace.placements.some((item) => item.classId === 'c1' && item.courseId === 'k1' && item.dayId === 1 && item.periodId === 6)).toBe(true)
  })

  it('补排剩余课程不会清空已有的排课结果', () => {
    const base = { ...createDemoWorkspace(), placements: [
      { id: 'p1', classId: 'c1', courseId: 'k3', teacherId: 't1', dayId: 1, periodId: 2, source: 'manual' as const, locked: false },
    ] }

    const workspace = fillRemaining(base)
    expect(workspace.placements.some((item) => item.id === 'p1')).toBe(true)
    expect(workspace.scheduleStatus).toBe('ready')
  })
})

describe('步骤 5 · 预览导出', () => {
  it('按时段分组节次，且分组顺序与 S1_BANDS 一致', () => {
    const { bands, map } = periodsByBand(createDemoWorkspace())

    expect(bands).toEqual(['上午', '下午'])
    expect(map.get('上午')).toHaveLength(4)
    expect(map.get('下午')).toHaveLength(2)
  })

  it('单双周配对课程标记单/双，未配对课程返回 null', () => {
    const workspace = createDemoWorkspace()

    expect(biweeklyTag(workspace, 'k7')).toBe('单')
    expect(biweeklyTag(workspace, 'k8')).toBe('双')
    expect(biweeklyTag(workspace, 'k3')).toBeNull()
  })
})
