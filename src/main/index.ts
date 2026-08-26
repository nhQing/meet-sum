import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { recoverInterrupted } from './lib/pipeline'
import { listProjects } from './lib/store'
import { registerMediaProtocol, registerPrivilegedScheme } from './lib/mediaProtocol'
import { appIconPath, dataRoot } from './lib/paths'

registerPrivilegedScheme()

let mainWindow: BrowserWindow | null = null

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
