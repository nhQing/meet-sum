import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewer, updateState } from '../src/main/lib/updater'

describe('isNewer — so sánh phiên bản', () => {
  it('lớn hơn ở bất kỳ vị trí nào cũng là mới hơn', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
    expect(isNewer('1.1.0', '1.0.9')).toBe(true)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
  })

  it('bằng hoặc cũ hơn thì không', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
    expect(isNewer('1.9.9', '2.0.0')).toBe(false)
  })

  it('bỏ tiền tố v và phần hậu tố', () => {
    expect(isNewer('v1.2.0', '1.1.0')).toBe(true)
    expect(isNewer('1.2.0-beta.1', '1.2.0')).toBe(false)
  })

  it('so sánh theo số chứ không theo chữ (10 > 9)', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.9.0', '1.10.0')).toBe(false)
  })

  it('chuỗi rác không làm nổ, coi như không có bản mới', () => {
    expect(isNewer('', '1.0.0')).toBe(false)
    expect(isNewer('abc', '1.0.0')).toBe(false)
  })
})

describe('trạng thái cập nhật ban đầu', () => {
  it('mặc định là chưa có bản mới, chưa tải gì', () => {
    const s = updateState()
    expect(s.available).toBe(false)
    expect(s.downloading).toBe(false)
    expect(s.downloaded).toBe(false)
    expect(s.releaseUrl).toContain('nhQing/meet-sum')
  })

  it('bản dev thì không tự cài được, trên hệ điều hành nào cũng vậy', () => {
    // app.isPackaged = false trong stub, nên false ở cả Windows lẫn macOS/Linux
    expect(updateState().canInstall).toBe(false)
  })
})

/**
 * canInstall phải LUÔN là boolean thật.
 *
 * "A && B" trả về giá trị của B, không phải boolean. Với
 * `process.platform === 'win32' && app.isPackaged`, trên Linux/macOS vế đầu sai
 * nên chập mạch thành false và mọi thứ trông ổn; còn trên Windows nó trả thẳng
 * app.isPackaged ra ngoài. Bug này từng lọt qua vì tôi chỉ chạy test trên Linux.
 * Nay giả lập cả hai hệ điều hành ngay trong test.
 */
describe('canInstall luôn là boolean, không phụ thuộc máy đang chạy', () => {
  const realPlatform = process.platform

  const asPlatform = async (platform: string, isPackaged: unknown): Promise<unknown> => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    vi.resetModules()
    vi.doMock('electron', async () => {
      const real = (await vi.importActual('../test/stubs/electron')) as Record<string, unknown>
      return { ...real, app: { ...(real.app as object), isPackaged } }
    })
    const mod = (await import('../src/main/lib/updater')) as { updateState: () => { canInstall: boolean } }
    return mod.updateState().canInstall
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    vi.doUnmock('electron')
    vi.resetModules()
  })

  it('Windows + đã đóng gói -> true', async () => {
    expect(await asPlatform('win32', true)).toBe(true)
  })

  it('Windows + bản dev -> false', async () => {
    expect(await asPlatform('win32', false)).toBe(false)
  })

  it('Windows mà isPackaged thiếu -> vẫn phải là false, KHÔNG được rò undefined', async () => {
    // đây chính là ca làm test đỏ trên máy Windows trước khi sửa
    expect(await asPlatform('win32', undefined)).toBe(false)
  })

  it('macOS -> luôn false, vì bản không ký Developer ID không tự cài được', async () => {
    expect(await asPlatform('darwin', true)).toBe(false)
  })

  it('Linux -> false', async () => {
    expect(await asPlatform('linux', true)).toBe(false)
  })
})
