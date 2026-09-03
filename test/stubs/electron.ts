/** Bản giả tối thiểu của electron, chỉ đủ cho các module thuần logic chạy trong test. */
import { tmpdir } from 'os'
import { join } from 'path'

export const app = {
  getPath: (): string => join(tmpdir(), 'meetsum-test'),
  getAppPath: (): string => process.cwd(),
  getVersion: (): string => '0.0.0-test',
  // Electron thật LUÔN có trường này. Thiếu nó thì trên Windows các biểu thức
  // dạng "... && app.isPackaged" trả undefined, còn trên Linux/macOS lại chập
  // mạch thành false — test đâm ra đúng sai tuỳ hệ điều hành đang chạy.
  isPackaged: false
}
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer): string => b.toString('utf-8')
}
export const ipcMain = { handle: (): void => undefined }
export const dialog = {}
export const shell = {}
export const protocol = { registerSchemesAsPrivileged: (): void => undefined, handle: (): void => undefined }
export const BrowserWindow = class {}
