import type { FlowPlan, FlowStepKey } from './flow'
import type { ParkItem, Placement, Workspace } from './workspace'

/** preload 返回纯数据而非 Response：Response 跨 contextBridge 会丢方法。 */
export type BridgeReply = { ok: boolean; status: number; body: unknown }

declare global {
  interface Window {
    classowl?: {
      request(path: string, init?: RequestInit): Promise<BridgeReply>
      onBackendCrashed?(callback: (stderr: string) => void): () => void
      dialog?: {
        saveExport(opts: {
          fileName: string
          format: ExportFormat
        }): Promise<{ targetPath: string } | null>
        capturePng(opts: {
          targetPath: string
          scale: 1 | 2 | 3
        }): Promise<{ ok: true } | { ok: false; message: string }>
        saveFile?(opts: {
          fileName: string
          dataBase64: string
        }): Promise<{ targetPath: string } | null>
        openFile?(): Promise<{ fileName: string; dataBase64: string } | null>
      }
    }
  }
}

export type DocumentState = {
  schemaVersion: number
  rev: number
  doc: Workspace
  undoDepth: number
  redoDepth: number
}

export type SaveResult = Pick<DocumentState, 'rev' | 'undoDepth' | 'redoDepth'>
export type HistoryResult = Pick<DocumentState, 'rev' | 'doc' | 'undoDepth' | 'redoDepth'>
export type ImportLevel = 1 | 2 | 3
export type ImportResult = Pick<DocumentState, 'rev' | 'doc'>
export type SolverStatus = 'queued' | 'running' | 'done' | 'infeasible' | 'cancelled' | 'error'
export type SolverResult = {
  placements: Placement[]
  park: ParkItem[]
  unmet: { text: string }[]
}
export type SolverJob = {
  status: SolverStatus
  progress: number
  message: string
  result?: SolverResult
}
export type ExportFormat = 'excel' | 'pdf' | 'png'
export type ExportJob = {
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  message: string
  path?: string
}

/** 浏览器里跑 vite dev / vitest 时没有 preload，退回同源 fetch。 */
async function viaFetch(path: string, init?: RequestInit): Promise<BridgeReply> {
  const response = await fetch(`/api/v1${path}`, init)
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    body: text ? JSON.parse(text) : null,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const bridge = typeof window === 'undefined' ? undefined : window.classowl
  const isDevelopmentBrowser = typeof window === 'undefined'
    || ['http:', 'https:'].includes(window.location.protocol)
  if (!bridge && !isDevelopmentBrowser) {
    throw new Error('ClassOwl 后端连接不可用')
  }
  const reply = bridge
    ? await bridge.request(path, init)
    : await viaFetch(path, init)

  if (!reply.ok) {
    const detail = (reply.body as { detail?: string } | null)?.detail
    throw new Error(detail ?? `请求失败（HTTP ${reply.status}）`)
  }
  return reply.body as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const listPlans = () => request<FlowPlan[]>('/plans')

export const createPlan = (input: {
  name?: string
  academicYear?: string
  term?: string
  source?: 'blank' | 'sample'
} = {}) => request<FlowPlan>('/plans', json('POST', input))

export const patchPlan = (planId: string, input: Partial<{
  name: string
  academicYear: string
  term: string
  progress: number
  status: FlowPlan['status']
  lastStep: FlowStepKey
}>) => request<FlowPlan>(`/plans/${planId}`, json('PATCH', input))

export const deletePlan = (planId: string) =>
  request<void>(`/plans/${planId}`, { method: 'DELETE' })

export const duplicatePlan = (planId: string) =>
  request<FlowPlan>(`/plans/${planId}/duplicate`, { method: 'POST' })

export const importFrom = (planId: string, sourcePlanId: string, level: ImportLevel) =>
  request<ImportResult>(`/plans/${planId}/import-from`, json('POST', { sourcePlanId, level }))

/** 方案完整快照（含排课结果）的 zip 导出，base64 载荷。 */
export const exportPlan = (planId: string) =>
  request<{ fileName: string; data: string }>(`/plans/${planId}/export`)

/** 从 zip 文件导入新方案（区别于 importFrom：从已有方案复制数据）。 */
export const importPlanFile = (input: { name?: string; data: string }) =>
  request<FlowPlan>('/plans/import', json('POST', input))

export type ImportRecord = {
  id: number
  kind: 'teaching' | 'plan'
  source: string
  summary: string
  createdAt: string
}

export const listImportRecords = (planId: string) =>
  request<ImportRecord[]>(`/plans/${planId}/imports`)

export const recordImport = (planId: string, input: {
  kind: ImportRecord['kind']
  source: string
  summary: string
}) => request<ImportRecord>(`/plans/${planId}/imports`, json('POST', input))

export const getDoc = (planId: string) =>
  request<DocumentState>(`/plans/${planId}/doc`)

export const putDoc = (
  planId: string,
  baseRev: number,
  doc: Workspace,
  checkpoint: string | null,
) => request<SaveResult>(`/plans/${planId}/doc`, json('PUT', { baseRev, doc, checkpoint }))

export const undo = (planId: string) =>
  request<HistoryResult>(`/plans/${planId}/undo`, { method: 'POST' })

export const redo = (planId: string) =>
  request<HistoryResult>(`/plans/${planId}/redo`, { method: 'POST' })

export const startSolver = (
  planId: string,
  input: { timeLimitSeconds?: number; keepExisting?: boolean } = {},
) => request<{ jobId: string }>(`/plans/${planId}/solve`, json('POST', input))

export const getSolver = (jobId: string) =>
  request<SolverJob>(`/solver/${jobId}`)

export const cancelSolver = (jobId: string) =>
  request<{ ok: true }>(`/solver/${jobId}/cancel`, { method: 'POST' })

export const startExport = (
  planId: string,
  input: {
    format: Exclude<ExportFormat, 'png'>
    options: unknown
    targetPath: string
  },
) => request<{ jobId: string }>(`/plans/${planId}/exports`, json('POST', input))

export const getExportJob = (jobId: string) =>
  request<ExportJob>(`/exports/${jobId}`)

function exportDialog() {
  const dialog = typeof window === 'undefined' ? undefined : window.classowl?.dialog
  if (!dialog) throw new Error('保存对话框不可用，请在 ClassOwl 桌面应用中导出')
  return dialog
}

export const saveExport = (options: {
  fileName: string
  format: ExportFormat
}) => exportDialog().saveExport(options)

export const capturePng = (options: {
  targetPath: string
  scale: 1 | 2 | 3
}) => exportDialog().capturePng(options)
