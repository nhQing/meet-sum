import { describe, expect, it } from 'vitest'
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

  it('chỉ Windows đã đóng gói mới tự cài được', () => {
    // trong test app.isPackaged là undefined nên luôn false, đúng như bản dev
    expect(updateState().canInstall).toBe(false)
  })
})
