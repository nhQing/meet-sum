import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { recoverInterrupted } from './lib/pipeline'
import { listProjects } from './lib/store'
import { registerMediaProtocol, registerPrivilegedScheme } from './lib/mediaProtocol'
import { appIconPath, dataRoot } from './lib/paths'
import { checkOnStartup } from './lib/updater'

registerPrivilegedScheme()

let mainWindow: BrowserWindow | null = null

// Chỉ cho chạy MỘT MeetSum. Mở thêm lần nữa thì bản mới thoát ngay và cửa sổ
// đang mở được đưa lên trước. Không chỉ để gọn: mỗi lần khởi động app gọi
// recoverInterrupted(), nên bản thứ hai sẽ đánh dấu cuộc họp mà bản thứ nhất
// đang bóc băng là "bị ngắt" — hai bản còn cùng ghi đè project.json của nhau.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c10',
    icon: appIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Căn 3 nút đỏ/vàng/xanh vào giữa header cao 52px (mặc định chúng nằm sát mép trên)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Bản thứ hai: app.quit() ở trên chưa kịp thoát hẳn thì cũng không được đụng vào dữ liệu
  if (!gotLock) return
  nativeTheme.themeSource = 'dark'
  dataRoot()
  registerMediaProtocol()
  registerIpc()
  // Lần trước app bị tắt đột ngột / mất điện -> đưa dự án đang dở về trạng thái tạm dừng
  try {
    recoverInterrupted(listProjects().map((r) => r.id))
  } catch {
    // không chặn việc mở app nếu dữ liệu cũ có vấn đề
  }
  createWindow()
  // Kiểm tra bản mới sau khi cửa sổ đã mở, không chặn lúc khởi động
  checkOnStartup()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
