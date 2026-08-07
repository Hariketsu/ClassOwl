export const FLOW_STEPS = [
  { key: 'input-information', label: '班级作息', english: 'timetable' },
  { key: 'arrange-teaching', label: '课时任课', english: 'teaching' },
  { key: 'setting-rules', label: '设置条件', english: 'rules' },
  { key: 'adjust-schedule', label: '排课调课', english: 'adjust' },
  { key: 'preview-export', label: '预览导出', english: 'preview' },
] as const

export type FlowStepKey = typeof FLOW_STEPS[number]['key']

export type FlowPlan = {
  id: string
  name: string
  academicYear: string
  term: string
  updatedAt: string
  progress: number
  status: 'draft' | 'ready'
  lastStep: FlowStepKey
}
