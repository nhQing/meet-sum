/**
 * Chạy test Python của pipeline.py.
 *
 * Phần lọc ảo giác nằm trong Python, nên nếu chỉ chạy vitest thì nó mục dần mà
 * không ai biết. Máy không có Python thì BỎ QUA chứ không làm đỏ cả bộ test —
 * người chỉ sửa giao diện không nên bị chặn vì thiếu Python.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'python', 'test_pipeline.py')

if (!existsSync(script)) {
  console.log('• Bỏ qua test Python: không thấy python/test_pipeline.py')
  process.exit(0)
}

const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']
for (const bin of candidates) {
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' })
  if (probe.status !== 0) continue
  const res = spawnSync(bin, [script], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
}

console.log('• Bỏ qua test Python: máy này chưa có Python. Cài Python rồi chạy lại để test đầy đủ.')
process.exit(0)
