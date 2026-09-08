import { describe, expect, it } from 'vitest'
import { run } from '../src/main/lib/proc'

const node = process.execPath

/** Tiến trình in ra `n` lần, cách nhau `gap` ms, rồi thoát. */
const chatty = (n: number, gap: number): string =>
  `let i=0;const t=setInterval(()=>{process.stderr.write("tick "+i+"\\n");if(++i>=${n}){clearInterval(t);process.exit(0)}},${gap})`

/** Tiến trình im lặng hoàn toàn trong `ms` rồi mới thoát. */
const silent = (ms: number): string => `setTimeout(()=>process.exit(0),${ms})`

describe('run — hạn chót im lặng thay cho hạn chót tuyệt đối', () => {
  it('còn in ra tiến độ thì KHÔNG bị giết, dù chạy lâu hơn hạn im lặng nhiều lần', async () => {
    // Đây là lỗi đã làm mất 6 giờ: tiến trình chạy đúng nhưng vẫn bị giết vì
    // quá mốc tuyệt đối. Hạn im lặng phải được đẩy lại sau mỗi lần có output.
    const res = await run(node, ['-e', chatty(10, 60)], { idleTimeoutMs: 400 })
    expect(res.code).toBe(0)
    expect(res.stderr).toContain('tick 9')
  })

  it('im lặng nhưng còn trong hạn thì vẫn được chạy xong', async () => {
    // Khoảng lặng hợp lệ: nạp model vài GB từ đĩa không in ra gì cả
    const res = await run(node, ['-e', silent(300)], { idleTimeoutMs: 3000 })
    expect(res.code).toBe(0)
  })

  it('im lặng quá hạn thì bị giết, và câu báo nói rõ là treo', async () => {
    const err = await run(node, ['-e', silent(4000)], { idleTimeoutMs: 300 }).catch(
      (e: Error) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('không báo tiến độ')
  })

  it('hạn tuyệt đối vẫn chặn được tiến trình in liên tục mà không tiến lên', async () => {
    const err = await run(node, ['-e', chatty(1000, 20)], {
      timeoutMs: 300,
      idleTimeoutMs: 60_000
    }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('quá thời gian chờ')
  })

  it('có timeoutMessage thì câu nhắc được ghép vào lỗi', async () => {
    const err = await run(node, ['-e', silent(5000)], {
      idleTimeoutMs: 250,
      timeoutMessage: 'Bấm Tiếp tục là chạy tiếp từ chỗ dở.'
    }).catch((e: Error) => e)
    expect((err as Error).message).toContain('Bấm Tiếp tục')
  })

  it('không đặt hạn nào thì chạy tự nhiên như trước', async () => {
    const res = await run(node, ['-e', 'process.stdout.write("xong")'])
    expect(res.code).toBe(0)
    expect(res.stdout).toBe('xong')
  })

  it('tiến trình thoát bình thường thì không có timer nào bắn muộn sau đó', async () => {
    // Nếu quên clear timer, hạn im lặng sẽ reject SAU khi promise đã resolve —
    // thành unhandled rejection, rất khó truy.
    const res = await run(node, ['-e', 'process.exit(3)'], { idleTimeoutMs: 200 })
    expect(res.code).toBe(3)
    await new Promise((r) => setTimeout(r, 400))
  })
})
