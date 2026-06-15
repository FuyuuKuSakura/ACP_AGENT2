const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const BACKEND_PORT = 8765

let mainWindow = null
let backendProcess = null

function waitForBackend(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Backend failed to start'))
            return
          }
          setTimeout(check, 500)
        })
    }
    check()
  })
}

function startBackend() {
  const python = path.join(PROJECT_ROOT, 'backend', '.venv', 'bin', 'python')
  const launcher = path.join(PROJECT_ROOT, 'scripts', 'launcher.py')
  backendProcess = spawn(python, [launcher, '--no-frontend', '--host', '127.0.0.1'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  })
  backendProcess.on('exit', (code) => {
    console.log(`backend exited with code ${code}`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Dionysus',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const isDev = !app.isPackaged
  const loadUrl = isDev ? 'http://localhost:5173' : `http://127.0.0.1:${BACKEND_PORT}`

  waitForBackend(`http://127.0.0.1:${BACKEND_PORT}/api/server/info`)
    .then(() => {
      mainWindow.loadURL(loadUrl)
    })
    .catch((err) => {
      console.error(err)
      mainWindow.loadFile(path.join(PROJECT_ROOT, 'frontend', 'dist', 'index.html'))
    })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  startBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill()
  }
})
