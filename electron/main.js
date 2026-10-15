/**
 * lumen 桌面外壳（Electron 主进程）。
 * 职责：窗口、菜单、文件对话框、启动/守护 Python sidecar。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow = null
let sidecar = null
let sidecarInfo = null // { port, token }

const BACKEND_DIR = path.join(__dirname, '..', 'backend')

function pythonBin() {
  // 优先使用 backend/.venv（开发环境），否则用系统 python3
  const venv = path.join(BACKEND_DIR, '.venv', 'bin', 'python')
  if (fs.existsSync(venv)) return venv
  return process.env.LUMEN_PYTHON || 'python3'
}

function startSidecar() {
  return new Promise((resolve, reject) => {
    sidecar = spawn(pythonBin(), [path.join(BACKEND_DIR, 'run.py')], {
      cwd: BACKEND_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let resolved = false
    let buf = ''
    sidecar.stdout.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'ready' && !resolved) {
            resolved = true
            sidecarInfo = { port: msg.port, token: msg.token }
            resolve(sidecarInfo)
          }
        } catch { /* 忽略非 JSON 行 */ }
      }
    })
    sidecar.stderr.on('data', (d) => console.error('[sidecar]', d.toString()))
    sidecar.on('exit', (code) => {
      if (!resolved) reject(new Error(`sidecar 启动失败 (exit ${code})`))
      else if (mainWindow) mainWindow.close()
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'lumen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadURL(`http://127.0.0.1:${sidecarInfo.port}/`)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    await startSidecar()
    createWindow()
  } catch (e) {
    console.error(e)
    dialog.showErrorBox('lumen 启动失败', String(e && e.message || e))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (sidecar) sidecar.kill()
  app.quit()
})

app.on('before-quit', () => {
  if (sidecar) sidecar.kill()
})

// ---- IPC ----
ipcMain.handle('get-sidecar-info', () => sidecarInfo)

ipcMain.handle('open-file-dialog', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '教材', extensions: ['pdf', 'docx', 'md', 'txt', 'epub'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  })
  return r.canceled ? [] : r.filePaths
})
