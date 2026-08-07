import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePng, getExportJob, saveExport, startExport } from './api'
import { runExportJob } from './Step5Preview'

vi.mock('./api', () => ({
  capturePng: vi.fn(),
  getExportJob: vi.fn(),
  saveExport: vi.fn(),
  startExport: vi.fn(),
}))

type ExportConfig = Parameters<typeof runExportJob>[1]

const config = (format: ExportConfig['format'] = 'Excel'): ExportConfig => ({
  format,
  classes: ['c1'],
  fileName: '一年级课表',
  title: '一年级课表',
  showTeacher: true,
  showNotes: false,
  showBiweekly: true,
  sheetLayout: '每班一个工作表',
  includeStats: true,
  paper: 'A4',
  orientation: '横向',
  pagination: '每班一页',
  imageRange: '当前预览',
  imageScale: '2× 高清',
  showTitleLegend: true,
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('导出流程', () => {
  it('拿到路径后提交、轮询并返回成功路径', async () => {
    vi.useFakeTimers()
    vi.mocked(saveExport).mockResolvedValue({ targetPath: '/tmp/一年级课表.xlsx' })
    vi.mocked(startExport).mockResolvedValue({ jobId: 'job-1' })
    vi.mocked(getExportJob)
      .mockResolvedValueOnce({ status: 'running', progress: 50, message: '生成中' })
      .mockResolvedValueOnce({ status: 'done', progress: 100, message: '完成' })
    const onStarted = vi.fn()

    const result = runExportJob('plan-1', config(), onStarted)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(startExport).toHaveBeenCalledWith('plan-1', expect.objectContaining({
      format: 'excel',
      targetPath: '/tmp/一年级课表.xlsx',
    }))
    expect(getExportJob).toHaveBeenCalledTimes(1)
    expect(onStarted).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(400)
    await expect(result).resolves.toEqual({
      targetPath: '/tmp/一年级课表.xlsx',
      currentPreviewOnly: false,
    })
  })

  it('轮询到失败状态时抛出后端消息', async () => {
    vi.mocked(saveExport).mockResolvedValue({ targetPath: '/tmp/课表.pdf' })
    vi.mocked(startExport).mockResolvedValue({ jobId: 'job-2' })
    vi.mocked(getExportJob).mockResolvedValue({
      status: 'error',
      progress: 100,
      message: 'PDF 写入失败',
    })

    await expect(runExportJob('plan-1', config('PDF'))).rejects.toThrow('PDF 写入失败')
  })

  it('用户取消保存时不提交请求', async () => {
    vi.mocked(saveExport).mockResolvedValue(null)

    await expect(runExportJob('plan-1', config())).resolves.toBeNull()

    expect(startExport).not.toHaveBeenCalled()
    expect(getExportJob).not.toHaveBeenCalled()
    expect(capturePng).not.toHaveBeenCalled()
  })

  it('PNG 直接截图，并标记非当前预览范围的限制', async () => {
    vi.mocked(saveExport).mockResolvedValue({ targetPath: '/tmp/课表.png' })
    vi.mocked(capturePng).mockResolvedValue({ ok: true })
    const png = { ...config('PNG 图片'), imageRange: '全部班级' }

    await expect(runExportJob('plan-1', png)).resolves.toEqual({
      targetPath: '/tmp/课表.png',
      currentPreviewOnly: true,
    })
    expect(capturePng).toHaveBeenCalledWith({ targetPath: '/tmp/课表.png', scale: 2 })
    expect(startExport).not.toHaveBeenCalled()
  })
})
