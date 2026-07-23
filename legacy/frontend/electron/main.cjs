const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let mainWindow = null
let backendProcess = null

function getResourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  // Dev mode: __dirname = frontend/electron, project root is two levels up.
  return path.resolve(__dirname, '..', '..')
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function waitForBackend(url, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) {
            resolve()
          } else {
            throw new Error('not ok')
          }
        })
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Backend failed to start'))
          } else {
            setTimeout(check, 300)
          }
        })
    }
    check()
  })
}

function startBackend() {
  const resourcesRoot = getResourcesRoot()
  const userDataBackend = path.join(app.getPath('userData'), 'Backend')
  const userDataConfig = path.join(userDataBackend, 'config')
  const userDataData = path.join(userDataBackend, 'data')

  // Copy builtin config into a writable userData location on first run.
  const bundledConfig = path.join(resourcesRoot, 'backend', 'config')
  if (fs.existsSync(bundledConfig) && !fs.existsSync(userDataConfig)) {
    copyRecursive(bundledConfig, userDataConfig)
  }
  if (!fs.existsSync(userDataData)) {
    fs.mkdirSync(userDataData, { recursive: true })
  }

  const bundledExecutable = path.join(resourcesRoot, 'backend', 'dist', 'dionysus_server')
  const frontendDist = path.join(resourcesRoot, 'frontend', 'dist')

  const env = {
    ...process.env,
    Dionysus_CONFIG_DIR: userDataConfig,
    Dionysus_DATA_DIR: userDataData,
    Dionysus_server__static_dir: frontendDist,
    Dionysus_server__host: '127.0.0.1',
    Dionysus_server__port: '8765',
  }

  if (fs.existsSync(bundledExecutable)) {
    backendProcess = spawn(bundledExecutable, [], {
      cwd: userDataBackend,
      env,
      stdio: 'inherit',
    })
  } else if (!app.isPackaged) {
    // Dev fallback: run from the local Python venv.
    const projectRoot = resourcesRoot
    const python = path.join(projectRoot, 'backend', '.venv', 'bin', 'python')
    backendProcess = spawn(
      python,
      ['-m', 'uvicorn', 'dionysus_server.main:app', '--host', '127.0.0.1', '--port', '8765'],
      {
        cwd: path.join(projectRoot, 'backend'),
        env,
        stdio: 'inherit',
      },
    )
  } else {
    throw new Error('Bundled backend executable not found')
  }

  backendProcess.on('error', (err) => {
    console.error('Backend process error:', err)
  })
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM')
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL('http://127.0.0.1:8765')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  try {
    startBackend()
    await waitForBackend('http://127.0.0.1:8765/api/server/info')
    createWindow()
  } catch (err) {
    console.error('Failed to start Dionysus:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.on('before-quit', () => {
  stopBackend()
})
