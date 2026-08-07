/* 领域模型 — 与 designs/classowl-flow/data.jsx（原型未随仓库公开）的 createSeedState() 逐字段对齐 */

export const S1_BANDS = ['早晨', '上午', '下午', '晚上'] as const
export type Band = (typeof S1_BANDS)[number]

export const BAND_DEFAULT_START: Record<Band, string> = {
  早晨: '07:20',
  上午: '08:00',
  下午: '14:00',
  晚上: '18:30',
}

export type Day = { id: number; label: string; short: string }
export type Period = { id: number; label: string; band: Band; start: string; end: string }
export type SchoolClass = { id: string; grade: string; name: string; room: string }
export type Course = { id: string; name: string; biweekly: boolean }
export type Teacher = { id: string; name: string }

/** 任课矩阵单元：classId → courseId → cell */
export type MatrixCell = { hours: number; teacherId: string }
export type Matrix = Record<string, Record<string, MatrixCell>>

/* —— 任课附属设置：原型每项都是规则数组，不是开关 —— */
export type LinkedRule = { id: string; courseId: string; classIds: string[]; timesPerWeek: number; consecutive: number }
export type BiweeklyRule = { id: string; courseA: string; courseB: string; classIds: string[]; oddCourseId: string }
export type CombinedRule = { id: string; courseId: string; classIds: string[] }
export type LayeredRule = { id: string; courseId: string; classId: string; name: string; teacherId: string }
export type VenueRule = { id: string; name: string; capacity: number; courseIds: string[] }

/* —— 排课条件 —— */
export type RuleType =
  | '禁排' | '必排' | '教师不同时上' | '课程不排同天' | '节次互斥' | '课程不相邻'
  | '课程优先排' | '课程尽量同时上' | '教师不连上' | '各天限制' | '时段限制' | '教案齐头'

/** 决定中栏配置表单形态，与原型 RULE_TYPES[].ui 一致 */
export type RuleUi =
  | 'gridCourseTeacher' | 'multiTeachers' | 'multiCourses' | 'teachersRegionGrid'
  | 'courseRelation' | 'coursePeriods' | 'subjectClasses' | 'periodPair'
  | 'dayLimit' | 'periodLimit' | 'alignTable'

export const RULE_TYPES: { id: RuleType; help: string | null; ui: RuleUi }[] = [
  { id: '禁排', help: '某课程或某老师在指定位置不排课。先选择左侧的课程班级或老师，再选择右侧不排课位置，保存即可。', ui: 'gridCourseTeacher' },
  { id: '必排', help: '某课程或某老师在指定位置一定排课。先选择左侧对象，再选择右侧必排位置，保存即可。', ui: 'gridCourseTeacher' },
  { id: '教师不同时上', help: '指定老师不同时上课，一般用于师徒跟随或夫妻教师等。左侧多选教师保存即可。', ui: 'multiTeachers' },
  { id: '课程不排同天', help: '不同课程不要排在同一天，多用于音乐美术等副课。左侧多选课程保存即可。', ui: 'multiCourses' },
  { id: '节次互斥', help: '指定若干教师在选定区域内每人最多排一节，多用于早晚自习或上下午衔接节。', ui: 'teachersRegionGrid' },
  { id: '课程不相邻', help: '设置上完某课后不要紧接另一类课，例如体育后不紧接主课。', ui: 'courseRelation' },
  { id: '课程优先排', help: '指定课程优先排在指定节次（如主科优先上午）。左侧选课程，右侧勾选节次。', ui: 'coursePeriods' },
  { id: '课程尽量同时上', help: '多班同一时间上相同课程。先选科目再选班级。', ui: 'subjectClasses' },
  { id: '教师不连上', help: '指定老师在两节之间不连续上课（如上午末节与下午首节）。', ui: 'periodPair' },
  { id: '各天限制', help: '某课程或老师在某天最多 / 最少 / 固定几节。', ui: 'dayLimit' },
  { id: '时段限制', help: '某课程或老师在指定节次范围内最多 / 最少 / 固定几节。', ui: 'periodLimit' },
  { id: '教案齐头', help: null, ui: 'alignTable' },
]

export type Cell = { dayId: number; periodId: number }
export type LimitType = '最多' | '最少' | '固定'
export type AlignStrength = '优先满足' | '尽量满足' | ''

export type ScheduleRule = {
  id: string
  type: RuleType
  enabled: boolean
  note: string
  summary: string
  /** 该条件作用于课程还是教师 */
  subjectMode?: 'course' | 'teacher'
  courseIds?: string[]
  /** 空数组表示全部班级 */
  classIds?: string[]
  teacherIds?: string[]
  /** 课位集合，供禁排/必排/节次互斥使用 */
  cells?: Cell[]
  periodIds?: number[]
  dayIds?: number[]
  limitType?: LimitType
  limitCount?: number
  /** 教师不连上的两个节次 */
  periodA?: number
  periodB?: number
  /** 课程不相邻：上完 relFrom 不紧接 relTo */
  relFrom?: string[]
  relTo?: string[]
  /** 教案齐头：`${teacherId}|${courseId}` → 强度 */
  align?: Record<string, AlignStrength>
}

/* —— 课表 —— */
export type PlacementSource = 'auto' | 'manual'
export type Placement = {
  id: string
  classId: string
  courseId: string
  teacherId: string
  dayId: number
  periodId: number
  source: PlacementSource
  locked: boolean
}
/** 暂放区条目：已知班级课程教师，尚未落位 */
export type ParkItem = { id: string; classId: string; courseId: string; teacherId: string; source: PlacementSource; locked?: boolean }

export type Workspace = {
  schemeName: string
  days: Day[]
  periods: Period[]
  teachers: Teacher[]
  classes: SchoolClass[]
  courses: Course[]
  /** 年级 → 课程 id 列，跨年级共享 course id */
  gradeCourses: Record<string, string[]>
  matrix: Matrix
  linked: LinkedRule[]
  biweekly: BiweeklyRule[]
  combined: CombinedRule[]
  layered: LayeredRule[]
  venues: VenueRule[]
  rules: ScheduleRule[]
  placements: Placement[]
  park: ParkItem[]
  scheduleStatus: 'empty' | 'ready' | 'stale'
}

/* —— 课程配色：colorFor() 返回三色（底/字/边）。
   色板从 DESIGN.md signature 暖调族（coral/forest/cream/peach/mint/yellow/mustard）
   派生的低饱和 muted 组：彩色只做课程分类这一种语义，fg 对 bg 对比度 ≥ 4.5。 —— */
export type CourseColor = { bg: string; fg: string; border: string }

export const COURSE_COLORS: Record<string, CourseColor> = {
  班会: { bg: '#F0EEE9', fg: '#4A4A42', border: '#D8D4C8' },
  写字: { bg: '#EFE6F0', fg: '#6A3575', border: '#D5C2DA' },
  语文: { bg: '#F7E3DA', fg: '#8A3208', border: '#E4BFA9' },
  数学: { bg: '#DFF0E4', fg: '#1E5631', border: '#B5DCC0' },
  英语: { bg: '#FCE9DC', fg: '#9A4A12', border: '#F2C9AE' },
  科学: { bg: '#DEEEEA', fg: '#0F5B52', border: '#B7D8D1' },
  道德与法治: { bg: '#EBE7E0', fg: '#55504A', border: '#CFC8BB' },
  体育与健康: { bg: '#E3F0DC', fg: '#3F6B1F', border: '#C3DDAE' },
  音乐: { bg: '#F9E4E4', fg: '#93333A', border: '#ECC2C4' },
  美术: { bg: '#FAF0D2', fg: '#7A5B08', border: '#EBD896' },
  少先队活动: { bg: '#F3E4E8', fg: '#7A2E44', border: '#E2BEC9' },
  劳动教育: { bg: '#DDF0E8', fg: '#136049', border: '#B2DCC9' },
  红色文化: { bg: '#F5DCD2', fg: '#8A2B12', border: '#E0B3A1' },
  数学测试: { bg: '#F1EAD3', fg: '#6B5410', border: '#DDD0A0' },
}

const FALLBACK_COLOR: CourseColor = { bg: '#F0EEE9', fg: '#4A4A42', border: '#D8D4C8' }

export function colorFor(courseName: string): CourseColor {
  return COURSE_COLORS[courseName] ?? FALLBACK_COLOR
}

export const DEFAULT_DAYS: Day[] = [
  { id: 1, label: '星期一', short: '一' },
  { id: 2, label: '星期二', short: '二' },
  { id: 3, label: '星期三', short: '三' },
  { id: 4, label: '星期四', short: '四' },
  { id: 5, label: '星期五', short: '五' },
]

export const DEFAULT_PERIODS: Period[] = [
  { id: 1, label: '1节', band: '上午', start: '08:00', end: '08:40' },
  { id: 2, label: '2节', band: '上午', start: '08:50', end: '09:30' },
  { id: 3, label: '3节', band: '上午', start: '10:00', end: '10:40' },
  { id: 4, label: '4节', band: '上午', start: '10:50', end: '11:30' },
  { id: 5, label: '5节', band: '下午', start: '14:00', end: '14:40' },
  { id: 6, label: '6节', band: '下午', start: '14:50', end: '15:30' },
]

let uidCounter = 0
export function uid(prefix = 'id') {
  uidCounter += 1
  return `${prefix}_${uidCounter.toString(36)}`
}

/* —— 派生查询 —— */
export function capacityOf(workspace: Workspace) {
  return workspace.days.length * workspace.periods.length
}

export function setHoursOf(workspace: Workspace, classId: string) {
  const row = workspace.matrix[classId] ?? {}
  return Object.values(row).reduce((sum, cell) => sum + (Number(cell.hours) || 0), 0)
}

export function classLabel(schoolClass: SchoolClass | undefined) {
  return schoolClass ? `${schoolClass.grade}${schoolClass.name}` : ''
}

export function teacherName(workspace: Workspace, id: string) {
  return workspace.teachers.find((item) => item.id === id)?.name ?? ''
}

export function courseName(workspace: Workspace, id: string) {
  return workspace.courses.find((item) => item.id === id)?.name ?? id
}

export function findClass(workspace: Workspace, id: string) {
  return workspace.classes.find((item) => item.id === id)
}

/** 以 gradeCourses 键为权威顺序，0 班额年级仍然出现 */
export function gradesOf(workspace: Workspace) {
  const grades: string[] = []
  Object.keys(workspace.gradeCourses).forEach((grade) => {
    if (!grades.includes(grade)) grades.push(grade)
  })
  workspace.classes.forEach((schoolClass) => {
    if (!grades.includes(schoolClass.grade)) grades.push(schoolClass.grade)
  })
  return grades
}

export function coursesForGrade(workspace: Workspace, grade: string) {
  return (workspace.gradeCourses[grade] ?? [])
    .map((id) => workspace.courses.find((course) => course.id === id))
    .filter((course): course is Course => Boolean(course))
}

/* —— 时间工具 —— */
export function parseTimeToMin(value: string): number | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function minToTime(min: number) {
  const wrapped = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour = Math.floor(wrapped / 60)
  const minute = wrapped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 配置变更后课表需要重排 */
function markStale(workspace: Workspace): Workspace['scheduleStatus'] {
  return workspace.placements.length ? 'stale' : workspace.scheduleStatus
}

export function createDemoWorkspace(): Workspace {
  const teachers: Teacher[] = ['王芳', '李强', '陈静', '赵磊', '周敏', '孙悦', '马超', '林雪', '何平', '郑凯']
    .map((name, index) => ({ id: `t${index + 1}`, name }))

  const classes: SchoolClass[] = [
    { id: 'c1', grade: '一年级', name: '1班', room: '101' },
    { id: 'c2', grade: '一年级', name: '2班', room: '102' },
    { id: 'c3', grade: '一年级', name: '3班', room: '103' },
    { id: 'c4', grade: '二年级', name: '1班', room: '201' },
    { id: 'c5', grade: '二年级', name: '2班', room: '202' },
  ]

  const coursesG1: Course[] = [
    { id: 'k1', name: '班会', biweekly: false },
    { id: 'k2', name: '写字', biweekly: false },
    { id: 'k3', name: '语文', biweekly: false },
    { id: 'k4', name: '数学', biweekly: false },
    { id: 'k5', name: '道德与法治', biweekly: false },
    { id: 'k6', name: '体育与健康', biweekly: false },
    { id: 'k7', name: '音乐', biweekly: true },
    { id: 'k8', name: '美术', biweekly: true },
    { id: 'k9', name: '少先队活动', biweekly: false },
    { id: 'k10', name: '劳动教育', biweekly: false },
    { id: 'k11', name: '红色文化', biweekly: false },
    { id: 'k12', name: '数学测试', biweekly: false },
  ]
  const coursesG2: Course[] = [
    { id: 'k1', name: '班会', biweekly: false },
    { id: 'k2', name: '写字', biweekly: false },
    { id: 'k3', name: '语文', biweekly: false },
    { id: 'k4', name: '数学', biweekly: false },
    { id: 'k13', name: '科学', biweekly: false },
    { id: 'k5', name: '道德与法治', biweekly: false },
    { id: 'k6', name: '体育与健康', biweekly: false },
    { id: 'k7', name: '音乐', biweekly: false },
    { id: 'k8', name: '美术', biweekly: false },
    { id: 'k9', name: '少先队活动', biweekly: false },
    { id: 'k10', name: '劳动教育', biweekly: false },
    { id: 'k11', name: '红色文化', biweekly: false },
  ]

  const gradeCourses: Record<string, string[]> = {
    一年级: coursesG1.map((course) => course.id),
    二年级: coursesG2.map((course) => course.id),
    三年级: coursesG2.map((course) => course.id),
    四年级: coursesG2.map((course) => course.id),
    五年级: coursesG2.map((course) => course.id),
    六年级: coursesG2.map((course) => course.id),
  }

  const courseMap = new Map<string, Course>()
  ;[...coursesG1, ...coursesG2].forEach((course) => courseMap.set(course.id, course))
  const courses = [...courseMap.values()]

  const g1Hours: Record<string, number> = { k1: 0, k2: 1, k3: 8, k4: 4, k5: 2, k6: 2, k7: 1, k8: 1, k9: 1, k10: 1, k11: 1, k12: 3 }
  const g1Teachers: Record<string, string> = { k1: 't1', k2: 't1', k3: 't1', k4: 't2', k5: 't3', k6: 't4', k7: 't5', k8: 't6', k9: 't1', k10: 't7', k11: 't7', k12: 't2' }
  const g2Hours: Record<string, number> = { k1: 0, k2: 1, k3: 8, k4: 4, k13: 1, k5: 1, k6: 2, k7: 2, k8: 2, k9: 1, k10: 1, k11: 1 }
  const g2Teachers: Record<string, string> = { k1: 't8', k2: 't8', k3: 't8', k4: 't9', k13: 't10', k5: 't3', k6: 't4', k7: 't5', k8: 't6', k9: 't8', k10: 't7', k11: 't7' }

  const matrix: Matrix = {}
  classes.forEach((schoolClass) => {
    const isG1 = schoolClass.grade === '一年级'
    const hours = isG1 ? g1Hours : g2Hours
    const teacherMap = isG1 ? g1Teachers : g2Teachers
    matrix[schoolClass.id] = Object.fromEntries(
      Object.keys(hours).map((courseId) => [courseId, { hours: hours[courseId], teacherId: teacherMap[courseId] ?? '' }]),
    )
  })
  matrix.c1.k1.hours = 1
  matrix.c4.k1.hours = 1

  const allClassIds = classes.map((schoolClass) => schoolClass.id)
  const rules: ScheduleRule[] = [
    {
      id: 'r1', type: '禁排', enabled: true, note: '体育不排早上第一节',
      subjectMode: 'course', courseIds: ['k6'], classIds: allClassIds, teacherIds: [],
      cells: DEFAULT_DAYS.map((day) => ({ dayId: day.id, periodId: 1 })),
      summary: '各班体育与健康，星期一至五第1节，不排课',
    },
    {
      id: 'r2', type: '必排', enabled: true, note: '班会固定周一最后一节',
      subjectMode: 'course', courseIds: ['k1'], classIds: allClassIds, teacherIds: [],
      cells: [{ dayId: 1, periodId: 6 }],
      summary: '各班班会，星期一第6节，必排课',
    },
    {
      id: 'r3', type: '课程优先排', enabled: true, note: '语文优先上午',
      subjectMode: 'course', courseIds: ['k3'], classIds: allClassIds, teacherIds: [],
      periodIds: [1, 2, 3, 4],
      summary: '语文优先第1–4节',
    },
    {
      id: 'r4', type: '各天限制', enabled: true, note: '语文每天至少一节',
      subjectMode: 'course', courseIds: ['k3'], classIds: allClassIds, teacherIds: [],
      dayIds: [1, 2, 3, 4, 5], limitType: '最少', limitCount: 1,
      summary: '语文周一至周五最少 1 节',
    },
  ]

  return {
    schemeName: '全海小学 · 示例方案',
    days: DEFAULT_DAYS.map((day) => ({ ...day })),
    periods: DEFAULT_PERIODS.map((period) => ({ ...period })),
    teachers,
    classes,
    courses,
    gradeCourses,
    matrix,
    linked: [{ id: 'lk1', courseId: 'k3', classIds: ['c1', 'c2', 'c3'], timesPerWeek: 1, consecutive: 2 }],
    biweekly: [{ id: 'bw1', courseA: 'k7', courseB: 'k8', classIds: ['c1', 'c2', 'c3'], oddCourseId: 'k7' }],
    combined: [],
    layered: [],
    venues: [],
    rules,
    placements: [],
    park: [],
    scheduleStatus: 'empty',
  }
}

/* —— 步骤 1：作息操作 —— */

export function updateDay(workspace: Workspace, id: number, label: string): Workspace {
  return {
    ...workspace,
    days: workspace.days.map((day) => day.id === id
      ? { ...day, label, short: label.replace('星期', '') || day.short }
      : day),
  }
}

export function setDayCount(workspace: Workspace, count: number): Workspace {
  const total = Math.max(1, Math.min(7, Number(count) || 5))
  const days: Day[] = []
  for (let index = 0; index < total; index += 1) {
    const source = workspace.days[index] ?? DEFAULT_DAYS[index] ?? { id: index + 1, label: `第${index + 1}天`, short: `${index + 1}` }
    days.push({ ...source, id: index + 1 })
  }
  return { ...workspace, days, scheduleStatus: markStale(workspace) }
}

export function updatePeriod(workspace: Workspace, id: number, patch: Partial<Period>): Workspace {
  return {
    ...workspace,
    periods: workspace.periods.map((period) => period.id === id ? { ...period, ...patch } : period),
    scheduleStatus: markStale(workspace),
  }
}

function renumberPeriods(periods: Period[]): Period[] {
  return periods.map((period, index) => ({ ...period, id: index + 1, label: `${index + 1}节` }))
}

/** 按 S1_BANDS 顺序把各时段重新拼接，保证节次编号与时段顺序一致 */
function mergeByBand(periods: Period[], override?: { band: Band; list: Period[] }): Period[] {
  const buckets = new Map<Band, Period[]>(S1_BANDS.map((band) => [band, []]))
  periods.forEach((period) => buckets.get(period.band)?.push(period))
  if (override) buckets.set(override.band, override.list)
  return renumberPeriods(S1_BANDS.flatMap((band) => buckets.get(band) ?? []))
}

export function toggleBand(
  workspace: Workspace,
  band: Band,
  lessonMin: number,
  breakMin: number,
): { workspace: Workspace; error?: string } {
  const has = workspace.periods.some((period) => period.band === band)
  if (has) {
    const rest = workspace.periods.filter((period) => period.band !== band)
    if (!rest.length) return { workspace, error: '至少保留一个时段' }
    return { workspace: { ...workspace, periods: renumberPeriods(rest), scheduleStatus: markStale(workspace) } }
  }
  const startMin = parseTimeToMin(BAND_DEFAULT_START[band]) ?? 8 * 60
  const added: Period[] = [
    { id: 0, label: '', band, start: minToTime(startMin), end: minToTime(startMin + lessonMin) },
    {
      id: 0, label: '', band,
      start: minToTime(startMin + lessonMin + breakMin),
      end: minToTime(startMin + lessonMin * 2 + breakMin),
    },
  ]
  return { workspace: { ...workspace, periods: mergeByBand(workspace.periods, { band, list: added }), scheduleStatus: markStale(workspace) } }
}

export function addPeriodInBand(workspace: Workspace, band: Band, lessonMin: number, breakMin: number): Workspace {
  const inBand = workspace.periods.filter((period) => period.band === band)
  const last = inBand.at(-1)
  const lastEnd = last?.end ? parseTimeToMin(last.end) : null
  const start = lastEnd == null
    ? parseTimeToMin(BAND_DEFAULT_START[band]) ?? 8 * 60
    : lastEnd + breakMin
  const created: Period = { id: 0, label: '', band, start: minToTime(start), end: minToTime(start + lessonMin) }
  return {
    ...workspace,
    periods: mergeByBand(workspace.periods, { band, list: [...inBand, created] }),
    scheduleStatus: markStale(workspace),
  }
}

export function removePeriodInBand(workspace: Workspace, band: Band): { workspace: Workspace; error?: string } {
  const inBand = workspace.periods.filter((period) => period.band === band)
  if (inBand.length <= 1) {
    // 只剩 1 节时等同于关掉该时段
    const rest = workspace.periods.filter((period) => period.band !== band)
    if (!rest.length) return { workspace, error: '至少保留一节' }
    return { workspace: { ...workspace, periods: renumberPeriods(rest), scheduleStatus: markStale(workspace) } }
  }
  const dropId = inBand.at(-1)!.id
  return {
    workspace: {
      ...workspace,
      periods: renumberPeriods(workspace.periods.filter((period) => period.id !== dropId)),
      scheduleStatus: markStale(workspace),
    },
  }
}

export function fillTimesFromFirst(
  workspace: Workspace,
  lessonMin: number,
  breakMin: number,
): { workspace: Workspace; error?: string } {
  if (!workspace.periods.length) return { workspace }
  const firstStart = parseTimeToMin(workspace.periods[0].start)
  if (firstStart == null) return { workspace, error: '请先填写第 1 节开始时间' }

  let cursor = firstStart
  const periods = workspace.periods.map((period, index) => {
    if (index > 0) {
      // 跨时段且该节已有更晚的开始时间时，尊重原值
      const own = parseTimeToMin(period.start)
      if (period.band !== workspace.periods[index - 1].band && own != null && own > cursor) cursor = own
    }
    const start = cursor
    const end = start + lessonMin
    cursor = end + breakMin
    return { ...period, start: minToTime(start), end: minToTime(end) }
  })
  return { workspace: { ...workspace, periods, scheduleStatus: markStale(workspace) } }
}

export function resetPeriodNames(workspace: Workspace): Workspace {
  return {
    ...workspace,
    periods: workspace.periods.map((period, index) => ({ ...period, label: `${index + 1}节` })),
  }
}

export function setGradeClassCount(workspace: Workspace, grade: string, count: number): Workspace {
  const total = Math.max(0, Math.min(12, Number(count) || 0))
  const existing = workspace.classes.filter((item) => item.grade === grade)
  const others = workspace.classes.filter((item) => item.grade !== grade)
  const next: SchoolClass[] = []
  for (let index = 0; index < total; index += 1) {
    next.push(existing[index] ?? { id: uid('c'), grade, name: `${index + 1}班`, room: '' })
  }

  const keepIds = new Set([...others, ...next].map((item) => item.id))
  const matrix: Matrix = {}
  Object.entries(workspace.matrix).forEach(([classId, row]) => {
    if (keepIds.has(classId)) matrix[classId] = row
  })
  next.forEach((item) => {
    if (!matrix[item.id]) matrix[item.id] = {}
  })

  return { ...workspace, classes: [...others, ...next], matrix, scheduleStatus: markStale(workspace) }
}

export function removeGrade(workspace: Workspace, grade: string): Workspace {
  const removeIds = new Set(workspace.classes.filter((item) => item.grade === grade).map((item) => item.id))
  const matrix: Matrix = {}
  Object.entries(workspace.matrix).forEach(([classId, row]) => {
    if (!removeIds.has(classId)) matrix[classId] = row
  })
  const gradeCourses = { ...workspace.gradeCourses }
  delete gradeCourses[grade]
  return {
    ...workspace,
    classes: workspace.classes.filter((item) => item.grade !== grade),
    matrix,
    gradeCourses,
    placements: workspace.placements.filter((item) => !removeIds.has(item.classId)),
    park: workspace.park.filter((item) => !removeIds.has(item.classId)),
    scheduleStatus: markStale(workspace),
  }
}

export function addGrade(workspace: Workspace, grade: string): { workspace: Workspace; error?: string } {
  const name = grade.trim()
  if (!name) return { workspace }
  if (gradesOf(workspace).includes(name)) return { workspace, error: '年级已存在' }
  return {
    workspace: {
      ...workspace,
      gradeCourses: {
        ...workspace.gradeCourses,
        [name]: workspace.gradeCourses['二年级'] ?? workspace.courses.map((course) => course.id),
      },
      classes: [...workspace.classes, { id: uid('c'), grade: name, name: '1班', room: '' }],
    },
  }
}

export function renameClass(workspace: Workspace, id: string, patch: Partial<Pick<SchoolClass, 'name' | 'room'>>): Workspace {
  return {
    ...workspace,
    classes: workspace.classes.map((item) => item.id === id ? { ...item, ...patch } : item),
  }
}

export function renameGrade(workspace: Workspace, oldName: string, newName: string): { workspace: Workspace; error?: string } {
  const name = newName.trim()
  if (!name || name === oldName) return { workspace }
  if (gradesOf(workspace).includes(name)) return { workspace, error: '年级已存在' }

  const gradeCourses = { ...workspace.gradeCourses }
  gradeCourses[name] = gradeCourses[oldName] ?? workspace.courses.map((course) => course.id)
  delete gradeCourses[oldName]

  return {
    workspace: {
      ...workspace,
      classes: workspace.classes.map((item) => item.grade === oldName ? { ...item, grade: name } : item),
      gradeCourses,
    },
  }
}

/* —— 步骤 2 · 课时任课 —— */

export function setMatrixCell(workspace: Workspace, classId: string, courseId: string, patch: Partial<MatrixCell>): Workspace {
  const row = { ...(workspace.matrix[classId] ?? {}) }
  const prev = row[courseId] ?? { hours: 0, teacherId: '' }
  row[courseId] = { ...prev, ...patch }
  return { ...workspace, matrix: { ...workspace.matrix, [classId]: row }, scheduleStatus: markStale(workspace) }
}

export function bulkSetCourseHours(workspace: Workspace, grade: string, courseId: string, hours: number): Workspace {
  const matrix = { ...workspace.matrix }
  workspace.classes.filter((item) => item.grade === grade).forEach((item) => {
    const row = { ...(matrix[item.id] ?? {}) }
    const prev = row[courseId] ?? { hours: 0, teacherId: '' }
    row[courseId] = { ...prev, hours }
    matrix[item.id] = row
  })
  return { ...workspace, matrix, scheduleStatus: markStale(workspace) }
}

export function clearGradeMatrix(workspace: Workspace, grade: string): Workspace {
  const matrix = { ...workspace.matrix }
  workspace.classes.filter((item) => item.grade === grade).forEach((item) => { matrix[item.id] = {} })
  return { ...workspace, matrix, scheduleStatus: markStale(workspace) }
}

export function replaceTeacherInGrade(workspace: Workspace, grade: string, fromName: string, toName: string): { workspace: Workspace; error?: string } {
  const fromTeacher = workspace.teachers.find((item) => item.name === fromName)
  if (!fromTeacher) return { workspace, error: `未找到教师「${fromName}」` }

  let teachers = workspace.teachers
  let toTeacher = workspace.teachers.find((item) => item.name === toName)
  if (!toTeacher) {
    toTeacher = { id: uid('t'), name: toName }
    teachers = [...teachers, toTeacher]
  }
  const toId = toTeacher.id

  const matrix = { ...workspace.matrix }
  workspace.classes.filter((item) => item.grade === grade).forEach((item) => {
    const row = { ...(matrix[item.id] ?? {}) }
    Object.keys(row).forEach((courseId) => {
      if (row[courseId]?.teacherId === fromTeacher.id) row[courseId] = { ...row[courseId], teacherId: toId }
    })
    matrix[item.id] = row
  })

  return { workspace: { ...workspace, teachers, matrix, scheduleStatus: markStale(workspace) } }
}

/** 按名称重排年级课程顺序；未出现在列表中的名称被忽略，未列出的既有课程保留在末尾 */
export function reorderGradeCourses(workspace: Workspace, grade: string, orderedNames: string[]): Workspace {
  const byName = new Map(workspace.courses.map((course) => [course.name, course]))
  const ids: string[] = []
  orderedNames.forEach((name) => {
    const course = byName.get(name.trim())
    if (course && !ids.includes(course.id)) ids.push(course.id)
  })
  ;(workspace.gradeCourses[grade] ?? []).forEach((id) => {
    if (!ids.includes(id)) ids.push(id)
  })
  return { ...workspace, gradeCourses: { ...workspace.gradeCourses, [grade]: ids } }
}

/** 新增课程（同名复用），并加入该年级的矩阵列 */
export function addCourses(workspace: Workspace, grade: string, names: string[]): Workspace {
  let courses = workspace.courses
  let gradeList = workspace.gradeCourses[grade] ?? []
  names.map((name) => name.trim()).filter(Boolean).forEach((name) => {
    let course = courses.find((item) => item.name === name)
    if (!course) {
      course = { id: uid('k'), name, biweekly: false }
      courses = [...courses, course]
    }
    if (!gradeList.includes(course.id)) gradeList = [...gradeList, course.id]
  })
  return { ...workspace, courses, gradeCourses: { ...workspace.gradeCourses, [grade]: gradeList } }
}

export type TeacherWorkloadRow = {
  teacherId: string
  name: string
  hours: number
  subjectText: string
  classCount: number
  detailText: string
}

export function teacherWorkload(workspace: Workspace): TeacherWorkloadRow[] {
  type Acc = { teacherId: string; name: string; hours: number; subjects: Map<string, number>; classes: Set<string>; details: string[] }
  const map = new Map<string, Acc>()
  workspace.teachers.forEach((teacher) => {
    map.set(teacher.id, { teacherId: teacher.id, name: teacher.name, hours: 0, subjects: new Map(), classes: new Set(), details: [] })
  })
  workspace.classes.forEach((schoolClass) => {
    const row = workspace.matrix[schoolClass.id] ?? {}
    Object.entries(row).forEach(([courseId, cell]) => {
      const rec = map.get(cell.teacherId)
      if (!rec) return
      const hours = Number(cell.hours) || 0
      rec.hours += hours
      const name = courseName(workspace, courseId)
      rec.subjects.set(name, (rec.subjects.get(name) ?? 0) + hours)
      rec.classes.add(schoolClass.id)
      rec.details.push(`${classLabel(schoolClass)}·${name}`)
    })
  })
  return [...map.values()]
    .filter((rec) => rec.hours > 0)
    .map((rec) => ({
      teacherId: rec.teacherId,
      name: rec.name,
      hours: rec.hours,
      subjectText: [...rec.subjects.entries()].map(([name, hours]) => `${name}(${hours})`).join('+'),
      classCount: rec.classes.size,
      detailText: rec.details.join('、'),
    }))
    .sort((a, b) => b.hours - a.hours)
}

export type TeachingPasteRow = { className: string; courseName: string; teacherName: string; hours: number }

export function parseTeachingPaste(text: string): TeachingPasteRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  const rows: TeachingPasteRow[] = []
  lines.forEach((line) => {
    const parts = line.split(/[\t,，]/).map((part) => part.trim())
    if (parts.length < 3) return
    if (/班级|课程/.test(parts[0]) && /课程|教师/.test(parts[1])) return
    const [className, course, teacher, hours] = parts
    rows.push({ className, courseName: course, teacherName: teacher, hours: Number(hours) || 0 })
  })
  return rows
}

export function findClassByLabel(workspace: Workspace, label: string) {
  return workspace.classes.find((item) => classLabel(item) === label || `${item.grade}${item.name}` === label || item.name === label)
}

/** 批量导入任课：清空目标班矩阵并替换，清除涉及这些班的连堂/单双周 */
export function importTeaching(
  workspace: Workspace,
  grade: string,
  scope: 'grade' | 'all',
  rows: TeachingPasteRow[],
): { workspace: Workspace; count: number } {
  const targetClasses = scope === 'all' ? workspace.classes : workspace.classes.filter((item) => item.grade === grade)
  const matrix = { ...workspace.matrix }
  targetClasses.forEach((item) => { matrix[item.id] = {} })

  const ids = new Set(targetClasses.map((item) => item.id))
  const linked = workspace.linked.filter((item) => !item.classIds.some((id) => ids.has(id)))
  const biweekly = workspace.biweekly.filter((item) => !item.classIds.some((id) => ids.has(id)))

  let courses = workspace.courses
  let gradeCourses = workspace.gradeCourses
  let teachers = workspace.teachers

  const ensureCourse = (name: string) => {
    let course = courses.find((item) => item.name === name)
    if (!course) {
      course = { id: uid('k'), name, biweekly: false }
      courses = [...courses, course]
    }
    if (scope === 'grade') {
      const list = gradeCourses[grade] ?? []
      if (!list.includes(course.id)) gradeCourses = { ...gradeCourses, [grade]: [...list, course.id] }
    } else {
      const next = { ...gradeCourses }
      Object.keys(next).forEach((g) => {
        const list = next[g] ?? []
        if (!list.includes(course!.id)) next[g] = [...list, course!.id]
      })
      gradeCourses = next
    }
    return course
  }
  const ensureTeacher = (name: string) => {
    let teacher = teachers.find((item) => item.name === name)
    if (!teacher) {
      teacher = { id: uid('t'), name }
      teachers = [...teachers, teacher]
    }
    return teacher
  }

  let count = 0
  rows.forEach((row) => {
    const schoolClass = findClassByLabel(workspace, row.className)
    if (!schoolClass) return
    if (scope === 'grade' && schoolClass.grade !== grade) return
    const course = ensureCourse(row.courseName)
    const teacher = ensureTeacher(row.teacherName)
    matrix[schoolClass.id] = { ...matrix[schoolClass.id], [course.id]: { hours: row.hours, teacherId: teacher.id } }
    count += 1
  })

  return {
    workspace: { ...workspace, matrix, linked, biweekly, courses, gradeCourses, teachers, scheduleStatus: markStale(workspace) },
    count,
  }
}

/** 导出当前任课为「班级,课程,教师,周课时」文本，供批量导入的文本框回填 */
export function exportTeachingText(workspace: Workspace, grade: string, scope: 'grade' | 'all'): string {
  const lines = ['班级,课程,教师,周课时']
  workspace.classes
    .filter((item) => scope === 'all' || item.grade === grade)
    .forEach((item) => {
      Object.entries(workspace.matrix[item.id] ?? {}).forEach(([courseId, cell]) => {
        if (!cell.hours) return
        lines.push(`${classLabel(item)},${courseName(workspace, courseId)},${teacherName(workspace, cell.teacherId)},${cell.hours}`)
      })
    })
  return lines.join('\n')
}

export function addLinkedRule(workspace: Workspace, rule: Omit<LinkedRule, 'id'>): Workspace {
  const linked = [
    ...workspace.linked.filter((item) => !(item.courseId === rule.courseId && item.classIds.some((id) => rule.classIds.includes(id)))),
    { ...rule, id: uid('lk') },
  ]
  return { ...workspace, linked, scheduleStatus: markStale(workspace) }
}

export function removeLinkedRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, linked: workspace.linked.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

export function addBiweeklyRule(workspace: Workspace, rule: Omit<BiweeklyRule, 'id'>): Workspace {
  const biweekly = [...workspace.biweekly, { ...rule, id: uid('bw') }]
  const courses = workspace.courses.map((course) => (
    course.id === rule.courseA || course.id === rule.courseB ? { ...course, biweekly: true } : course
  ))
  return { ...workspace, biweekly, courses, scheduleStatus: markStale(workspace) }
}

export function removeBiweeklyRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, biweekly: workspace.biweekly.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

export function addCombinedRule(workspace: Workspace, rule: Omit<CombinedRule, 'id'>): Workspace {
  return { ...workspace, combined: [...workspace.combined, { ...rule, id: uid('cb') }], scheduleStatus: markStale(workspace) }
}

export function removeCombinedRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, combined: workspace.combined.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

export function addLayeredRule(workspace: Workspace, rule: Omit<LayeredRule, 'id'>): Workspace {
  return { ...workspace, layered: [...workspace.layered, { ...rule, id: uid('ly') }], scheduleStatus: markStale(workspace) }
}

export function removeLayeredRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, layered: workspace.layered.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

export function addVenueRule(workspace: Workspace, rule: Omit<VenueRule, 'id'>): Workspace {
  return { ...workspace, venues: [...workspace.venues, { ...rule, id: uid('vn') }], scheduleStatus: markStale(workspace) }
}

export function removeVenueRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, venues: workspace.venues.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

/* —— 步骤 3 · 设置条件 —— */

export function addRule(workspace: Workspace, rule: Omit<ScheduleRule, 'id'>): Workspace {
  return { ...workspace, rules: [...workspace.rules, { ...rule, id: uid('r') }], scheduleStatus: markStale(workspace) }
}

export function removeRule(workspace: Workspace, id: string): Workspace {
  return { ...workspace, rules: workspace.rules.filter((item) => item.id !== id), scheduleStatus: markStale(workspace) }
}

export function toggleRuleEnabled(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    rules: workspace.rules.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item),
    scheduleStatus: markStale(workspace),
  }
}

export function clearRulesByType(workspace: Workspace, type: RuleType): Workspace {
  return { ...workspace, rules: workspace.rules.filter((item) => item.type !== type), scheduleStatus: markStale(workspace) }
}

export function clearAllRules(workspace: Workspace): Workspace {
  return { ...workspace, rules: [], scheduleStatus: markStale(workspace) }
}

export function enabledRules(workspace: Workspace) {
  return workspace.rules.filter((item) => item.enabled !== false)
}

export function isBannedCell(workspace: Workspace, classId: string, courseId: string, teacherId: string, dayId: number, periodId: number) {
  return enabledRules(workspace).some((rule) => {
    if (rule.type !== '禁排') return false
    const cellHit = (rule.cells ?? []).some((cell) => cell.dayId === dayId && cell.periodId === periodId)
    if (!cellHit) return false
    if (rule.subjectMode === 'teacher') return (rule.teacherIds ?? []).includes(teacherId)
    const courseOk = !rule.courseIds?.length || rule.courseIds.includes(courseId)
    const classOk = !rule.classIds?.length || rule.classIds.includes(classId)
    return courseOk && classOk
  })
}

export type HardConflict = { kind: 'class' | 'teacher'; a: Placement; b: Placement; text: string }

/** 同一课位班级或教师被排两次 */
export function hardConflicts(workspace: Workspace): HardConflict[] {
  const list: HardConflict[] = []
  const classMap = new Map<string, Placement>()
  const teacherMap = new Map<string, Placement>()
  workspace.placements.forEach((placement) => {
    const classKey = `${placement.classId}|${placement.dayId}|${placement.periodId}`
    const day = workspace.days.find((item) => item.id === placement.dayId)
    if (classMap.has(classKey)) {
      list.push({
        kind: 'class', a: classMap.get(classKey)!, b: placement,
        text: `${classLabel(findClass(workspace, placement.classId))} 在周${day?.short}第${placement.periodId}节冲突`,
      })
    } else classMap.set(classKey, placement)

    if (placement.teacherId) {
      const teacherKey = `${placement.teacherId}|${placement.dayId}|${placement.periodId}`
      if (teacherMap.has(teacherKey)) {
        list.push({
          kind: 'teacher', a: teacherMap.get(teacherKey)!, b: placement,
          text: `${teacherName(workspace, placement.teacherId)} 在周${day?.short}第${placement.periodId}节冲突`,
        })
      } else teacherMap.set(teacherKey, placement)
    }
  })
  return list
}

/** 步骤3顶栏预告：只统计条件自相矛盾 + 已排结果违反禁排/硬冲突，不含"必排未落位"等留给步骤4 */
export function estimateRuleConflicts(workspace: Workspace): number {
  let count = 0
  const rules = enabledRules(workspace)

  rules.forEach((ban) => {
    if (ban.type !== '禁排') return
    rules.forEach((must) => {
      if (must.type !== '必排') return
      const courseOverlap = !(ban.courseIds ?? []).length || !(must.courseIds ?? []).length
        || (ban.courseIds ?? []).some((id) => (must.courseIds ?? []).includes(id))
      if (!courseOverlap) return
      ;(ban.cells ?? []).forEach((cell) => {
        if ((must.cells ?? []).some((item) => item.dayId === cell.dayId && item.periodId === cell.periodId)) count += 1
      })
    })
  })

  workspace.placements.forEach((placement) => {
    if (isBannedCell(workspace, placement.classId, placement.courseId, placement.teacherId, placement.dayId, placement.periodId)) count += 1
  })

  count += hardConflicts(workspace).length
  return count
}

/* —— 步骤 4 · 排课调课 —— */

export function isMustCell(workspace: Workspace, classId: string, courseId: string, dayId: number, periodId: number) {
  return enabledRules(workspace).some((rule) => {
    if (rule.type !== '必排') return false
    if (!(rule.courseIds ?? []).includes(courseId)) return false
    if (rule.classIds?.length && !rule.classIds.includes(classId)) return false
    return (rule.cells ?? []).some((cell) => cell.dayId === dayId && cell.periodId === periodId)
  })
}

type Slot = { classId: string; courseId: string; teacherId: string }
export type PlaceCheck = { ok: boolean; reason: 'class' | 'teacher' | 'rule' | null; label: string }

function occupiedMaps(placements: Placement[]) {
  const classAt = new Map<string, Placement>()
  const teacherAt = new Map<string, Placement>()
  placements.forEach((placement) => {
    classAt.set(`${placement.classId}|${placement.dayId}|${placement.periodId}`, placement)
    if (placement.teacherId) teacherAt.set(`${placement.teacherId}|${placement.dayId}|${placement.periodId}`, placement)
  })
  return { classAt, teacherAt }
}

export function canPlace(workspace: Workspace, placements: Placement[], slot: Slot, dayId: number, periodId: number): PlaceCheck {
  const { classAt, teacherAt } = occupiedMaps(placements)
  if (classAt.has(`${slot.classId}|${dayId}|${periodId}`)) return { ok: false, reason: 'class', label: '不可调' }
  if (slot.teacherId && teacherAt.has(`${slot.teacherId}|${dayId}|${periodId}`)) return { ok: false, reason: 'teacher', label: '不可调' }
  if (isBannedCell(workspace, slot.classId, slot.courseId, slot.teacherId, dayId, periodId)) return { ok: false, reason: 'rule', label: '条件冲突' }
  return { ok: true, reason: null, label: '可调' }
}

export type DragPayload = { kind: 'placement' | 'park'; id: string; classId: string; courseId: string; teacherId: string; locked?: boolean }
export type DropHint = { label: string; cls: 'hint-ok' | 'hint-same' | 'hint-bad' | 'hint-rule' } | null

export function dropHint(workspace: Workspace, drag: DragPayload | null, dayId: number, periodId: number, viewClassId: string | null): DropHint {
  if (!drag) return null
  if (drag.locked) return { label: '不可调', cls: 'hint-bad' }
  if (viewClassId && drag.classId && drag.classId !== viewClassId) return { label: '不可调', cls: 'hint-bad' }

  const placements = drag.kind === 'placement' ? workspace.placements.filter((item) => item.id !== drag.id) : workspace.placements
  const slot: Slot = { classId: drag.classId, courseId: drag.courseId, teacherId: drag.teacherId }
  const check = canPlace(workspace, placements, slot, dayId, periodId)
  if (!check.ok) return { label: check.label, cls: check.label === '条件冲突' ? 'hint-rule' : 'hint-bad' }

  const same = workspace.placements.find((item) => (
    item.classId === slot.classId && item.dayId === dayId && item.periodId === periodId && item.courseId === slot.courseId
  ))
  if (same) return { label: '同课程', cls: 'hint-same' }
  return { label: '可调', cls: 'hint-ok' }
}

export function moveToPark(workspace: Workspace, placementId: string): Workspace {
  const placement = workspace.placements.find((item) => item.id === placementId)
  if (!placement || placement.locked) return workspace
  return {
    ...workspace,
    placements: workspace.placements.filter((item) => item.id !== placementId),
    park: [...workspace.park, {
      id: uid('pk'), classId: placement.classId, courseId: placement.courseId, teacherId: placement.teacherId,
      source: placement.source === 'auto' ? 'manual' : placement.source, locked: false,
    }],
  }
}

export function batchParkClass(workspace: Workspace, classId: string): Workspace {
  const moving = workspace.placements.filter((item) => item.classId === classId && !item.locked)
  return {
    ...workspace,
    placements: workspace.placements.filter((item) => !(item.classId === classId && !item.locked)),
    park: [...workspace.park, ...moving.map((item) => ({
      id: uid('pk'), classId: item.classId, courseId: item.courseId, teacherId: item.teacherId,
      source: 'manual' as PlacementSource, locked: false,
    }))],
  }
}

export function placeFromPark(workspace: Workspace, parkId: string, dayId: number, periodId: number): { workspace: Workspace; error?: string } {
  const item = workspace.park.find((entry) => entry.id === parkId)
  if (!item) return { workspace, error: '暂放项不存在' }
  const check = canPlace(workspace, workspace.placements, item, dayId, periodId)
  if (!check.ok) return { workspace, error: check.label === '条件冲突' ? '落点违反禁排条件' : '落点已被占用' }
  return {
    workspace: {
      ...workspace,
      park: workspace.park.filter((entry) => entry.id !== parkId),
      placements: [...workspace.placements, {
        id: uid('p'), classId: item.classId, courseId: item.courseId, teacherId: item.teacherId,
        dayId, periodId, source: 'manual', locked: false,
      }],
    },
  }
}

export function movePlacement(workspace: Workspace, placementId: string, dayId: number, periodId: number): { workspace: Workspace; error?: string } {
  const placement = workspace.placements.find((item) => item.id === placementId)
  if (!placement) return { workspace, error: '课程不存在' }
  if (placement.locked) return { workspace, error: '已锁定，无法移动' }
  if (placement.dayId === dayId && placement.periodId === periodId) return { workspace }
  const others = workspace.placements.filter((item) => item.id !== placementId)
  const check = canPlace(workspace, others, placement, dayId, periodId)
  if (!check.ok) return { workspace, error: check.label === '条件冲突' ? '落点违反禁排条件' : '落点已被占用' }
  return {
    workspace: {
      ...workspace,
      placements: workspace.placements.map((item) => (
        item.id === placementId ? { ...item, dayId, periodId, source: item.source === 'auto' ? 'manual' : item.source } : item
      )),
    },
  }
}

export function deleteBySource(workspace: Workspace, source: PlacementSource): Workspace {
  const removed = workspace.placements.filter((item) => item.source === source && !item.locked)
  const placements = workspace.placements.filter((item) => !(item.source === source && !item.locked))
  const park = [...workspace.park, ...removed.map((item) => ({
    id: uid('pk'), classId: item.classId, courseId: item.courseId, teacherId: item.teacherId, source: item.source, locked: false,
  }))]
  return { ...workspace, placements, park }
}

export function toggleLockPlacement(workspace: Workspace, placementId: string, locked: boolean): Workspace {
  return { ...workspace, placements: workspace.placements.map((item) => item.id === placementId ? { ...item, locked } : item) }
}

export type UnmetItem = { ruleId: string | null; type: RuleType | '硬冲突'; text: string; soft?: boolean; placementId?: string; dayId?: number; periodId?: number; classId?: string }

export function unmetConditions(workspace: Workspace): UnmetItem[] {
  const items: UnmetItem[] = []
  const rules = enabledRules(workspace)

  rules.forEach((rule) => {
    if (rule.type === '禁排') {
      workspace.placements.forEach((placement) => {
        if (!isBannedCell(workspace, placement.classId, placement.courseId, placement.teacherId, placement.dayId, placement.periodId)) return
        const covers = rule.subjectMode === 'teacher'
          ? (rule.teacherIds ?? []).includes(placement.teacherId)
          : (!rule.courseIds?.length || rule.courseIds.includes(placement.courseId)) && (!rule.classIds?.length || rule.classIds.includes(placement.classId))
        const cellHit = (rule.cells ?? []).some((cell) => cell.dayId === placement.dayId && cell.periodId === placement.periodId)
        if (covers && cellHit) {
          const day = workspace.days.find((item) => item.id === placement.dayId)
          items.push({
            ruleId: rule.id, type: rule.type,
            text: `${classLabel(findClass(workspace, placement.classId))}「${courseName(workspace, placement.courseId)}」落在禁排位置（周${day?.short}第${placement.periodId}节）`,
            placementId: placement.id, dayId: placement.dayId, periodId: placement.periodId, classId: placement.classId,
          })
        }
      })
    }
    if (rule.type === '必排') {
      ;(rule.classIds ?? []).forEach((classId) => {
        ;(rule.courseIds ?? []).forEach((courseId) => {
          ;(rule.cells ?? []).forEach((cell) => {
            const hit = workspace.placements.some((placement) => (
              placement.classId === classId && placement.courseId === courseId && placement.dayId === cell.dayId && placement.periodId === cell.periodId
            ))
            if (!hit) {
              const day = workspace.days.find((item) => item.id === cell.dayId)
              items.push({
                ruleId: rule.id, type: rule.type,
                text: `${classLabel(findClass(workspace, classId))}「${courseName(workspace, courseId)}」未落在必排位置（周${day?.short}第${cell.periodId}节）`,
                dayId: cell.dayId, periodId: cell.periodId, classId,
              })
            }
          })
        })
      })
    }
    if (rule.type === '各天限制' && rule.limitType === '最少') {
      ;(rule.classIds ?? []).forEach((classId) => {
        ;(rule.courseIds ?? []).forEach((courseId) => {
          ;(rule.dayIds ?? []).forEach((dayId) => {
            const count = workspace.placements.filter((placement) => placement.classId === classId && placement.courseId === courseId && placement.dayId === dayId).length
            if (count < (rule.limitCount ?? 0)) {
              const day = workspace.days.find((item) => item.id === dayId)
              items.push({
                ruleId: rule.id, type: rule.type,
                text: `${classLabel(findClass(workspace, classId))}「${courseName(workspace, courseId)}」周${day?.short}仅 ${count} 节，少于最少 ${rule.limitCount} 节`,
                dayId, classId,
              })
            }
          })
        })
      })
    }
    if (rule.type === '课程优先排') {
      let bad = 0
      ;(rule.classIds?.length ? rule.classIds : workspace.classes.map((item) => item.id)).forEach((classId) => {
        ;(rule.courseIds ?? []).forEach((courseId) => {
          workspace.placements.forEach((placement) => {
            if (placement.classId === classId && placement.courseId === courseId && !(rule.periodIds ?? []).includes(placement.periodId)) bad += 1
          })
        })
      })
      if (bad > 0) {
        items.push({ ruleId: rule.id, type: rule.type, soft: true, text: `「${(rule.courseIds ?? []).map((id) => courseName(workspace, id)).join('、')}」有 ${bad} 节未落在优先节次` })
      }
    }
  })

  hardConflicts(workspace).forEach((conflict) => {
    items.push({
      ruleId: null, type: '硬冲突', text: conflict.text,
      placementId: conflict.b.id, classId: conflict.b.classId, dayId: conflict.b.dayId, periodId: conflict.b.periodId,
    })
  })

  return items
}

/**
 * 占位式排课：按课程/班级顺序把待排课时塞进第一个可用课位，必排位置优先满足。
 * 不实现原型 engine.jsx 的评分启发式（优先节次打分/每日分布/主科偏好），
 * 那是贪心演示算法，HANDOFF 明令不能直接搬进产品。
 * 已由后端求解器取代，planRemaining/replan/fillRemaining 仅为测试保留。
 */
export function planRemaining(workspace: Workspace, options: { clearUnlocked: boolean }): { placements: Placement[]; park: ParkItem[] } {
  let placements = options.clearUnlocked ? workspace.placements.filter((item) => item.locked) : [...workspace.placements]

  const placedCount = new Map<string, number>()
  placements.forEach((item) => {
    const key = `${item.classId}|${item.courseId}`
    placedCount.set(key, (placedCount.get(key) ?? 0) + 1)
  })

  const mustJobs: { classId: string; courseId: string; teacherId: string; dayId: number; periodId: number }[] = []
  enabledRules(workspace).forEach((rule) => {
    if (rule.type !== '必排') return
    ;(rule.classIds?.length ? rule.classIds : workspace.classes.map((item) => item.id)).forEach((classId) => {
      ;(rule.courseIds ?? []).forEach((courseId) => {
        const cell = workspace.matrix[classId]?.[courseId]
        if (!cell) return
        ;(rule.cells ?? []).forEach((position) => {
          mustJobs.push({ classId, courseId, teacherId: cell.teacherId || '', dayId: position.dayId, periodId: position.periodId })
        })
      })
    })
  })

  mustJobs.forEach((job) => {
    const check = canPlace(workspace, placements, job, job.dayId, job.periodId)
    if (!check.ok) return
    const key = `${job.classId}|${job.courseId}`
    const need = Number(workspace.matrix[job.classId]?.[job.courseId]?.hours) || 0
    if ((placedCount.get(key) ?? 0) >= need) return
    placements.push({ id: uid('p'), ...job, source: 'auto', locked: false })
    placedCount.set(key, (placedCount.get(key) ?? 0) + 1)
  })

  const pending: Slot[] = []
  workspace.classes.forEach((schoolClass) => {
    const row = workspace.matrix[schoolClass.id] ?? {}
    Object.entries(row).forEach(([courseId, cell]) => {
      const need = Number(cell.hours) || 0
      const have = placedCount.get(`${schoolClass.id}|${courseId}`) ?? 0
      for (let i = have; i < need; i += 1) pending.push({ classId: schoolClass.id, courseId, teacherId: cell.teacherId || '' })
    })
  })

  pending.forEach((slot) => {
    let placed = false
    for (const day of workspace.days) {
      for (const period of workspace.periods) {
        const check = canPlace(workspace, placements, slot, day.id, period.id)
        if (!check.ok) continue
        placements.push({ id: uid('p'), classId: slot.classId, courseId: slot.courseId, teacherId: slot.teacherId, dayId: day.id, periodId: period.id, source: 'auto', locked: false })
        const key = `${slot.classId}|${slot.courseId}`
        placedCount.set(key, (placedCount.get(key) ?? 0) + 1)
        placed = true
        break
      }
      if (placed) break
    }
  })

  const park: ParkItem[] = []
  workspace.classes.forEach((schoolClass) => {
    const row = workspace.matrix[schoolClass.id] ?? {}
    Object.entries(row).forEach(([courseId, cell]) => {
      const need = Number(cell.hours) || 0
      const have = placements.filter((item) => item.classId === schoolClass.id && item.courseId === courseId).length
      for (let i = have; i < need; i += 1) park.push({ id: uid('pk'), classId: schoolClass.id, courseId, teacherId: cell.teacherId || '', source: 'auto', locked: false })
    })
  })

  return { placements, park }
}

export function replan(workspace: Workspace): Workspace {
  const { placements, park } = planRemaining(workspace, { clearUnlocked: true })
  return { ...workspace, placements, park, scheduleStatus: 'ready' }
}

export function fillRemaining(workspace: Workspace): Workspace {
  const { placements, park } = planRemaining(workspace, { clearUnlocked: false })
  return { ...workspace, placements, park, scheduleStatus: 'ready' }
}

/* —— 步骤 5 · 预览导出 —— */

export function periodsByBand(workspace: Workspace) {
  const bands: string[] = []
  const map = new Map<string, Period[]>()
  workspace.periods.forEach((period) => {
    const band = period.band || '其他'
    if (!map.has(band)) { map.set(band, []); bands.push(band) }
    map.get(band)!.push(period)
  })
  return { bands, map }
}

/** 该课程若参与单双周配对，返回「单」或「双」，否则 null */
export function biweeklyTag(workspace: Workspace, courseId: string): '单' | '双' | null {
  const hit = workspace.biweekly.find((item) => item.courseA === courseId || item.courseB === courseId)
  if (!hit) return null
  return hit.oddCourseId === courseId || hit.courseA === courseId ? '单' : '双'
}
