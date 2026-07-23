/**
 * Phase 3 门禁真机联调 driver（QA 专用，非产品代码）。
 *
 * 职责：
 * - 激活后自动打开 Dionysus 聊天面板并聚焦 sidebar 会话列表；
 * - 轮询 $DIONYSUS_QA_DIR/signals/ 下的 *.cmd 信号文件（内容 = 命令 id），
 *   读取后删除并执行对应 vscode 命令——宿主机脚本借此精确控制
 *   「新建会话 B」等动作的时序，与 AppleScript 键入交错编排；
 * - 全程写 out/driver.log：每个动作的时间戳 + dionysus globalStorage
 *   sessions/*.jsonl 的大小/mtime 快照（两会话并行增长的旁证）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

const QA_DIR =
  process.env.DIONYSUS_QA_DIR || path.join(os.homedir(), 'ACP_AGENT2', 'scripts', 'qa-phase3')
const SIGNALS_DIR = path.join(QA_DIR, 'signals')
const LOG_FILE = path.join(QA_DIR, 'out', 'driver.log')

function log(line) {
  const stamp = new Date().toISOString()
  try {
    fs.appendFileSync(LOG_FILE, `${stamp} ${line}\n`)
  } catch {
    /* out/ 尚未创建时静默丢弃 */
  }
}

/** dionysus 插件的 sessions 目录（与本 driver 的 globalStorage 同级，publisher.name 目录）。 */
function sessionsDir(context) {
  return path.join(context.globalStorageUri.fsPath, '..', 'dionysus.dionysus-vscode', 'sessions')
}

function snapshotSessions(context) {
  const dir = sessionsDir(context)
  let files
  try {
    files = fs.readdirSync(dir)
  } catch {
    log('sessions-dir: (不存在)')
    return
  }
  for (const f of files.sort()) {
    try {
      const st = fs.statSync(path.join(dir, f))
      log(`sessions-dir: ${f} size=${st.size} mtime=${st.mtime.toISOString()}`)
    } catch {
      /* 文件被 rename 的瞬间，跳过 */
    }
  }
}

async function runCommand(command) {
  log(`exec: ${command}`)
  try {
    await vscode.commands.executeCommand(command)
    log(`exec-done: ${command}`)
  } catch (err) {
    log(`exec-fail: ${command}: ${err && err.message}`)
  }
}

function activate(context) {
  fs.mkdirSync(SIGNALS_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  log('driver activated')

  // 起始动作：打开聊天面板 → 聚焦会话列表（两个视图都建立 webview 连接）
  const timers = [
    setTimeout(() => void runCommand('dionysus.openChat'), 3000),
    setTimeout(() => void runCommand('dionysus.sessionList.focus'), 7000),
    setTimeout(() => void runCommand('dionysus.openChat'), 9000), // 焦点还给聊天面板
  ]

  // 信号文件轮询：宿主机写 signals/NNN.cmd（内容 = 命令 id）
  const poller = setInterval(() => {
    let files
    try {
      files = fs.readdirSync(SIGNALS_DIR).filter((f) => f.endsWith('.cmd')).sort()
    } catch {
      return
    }
    for (const f of files) {
      const full = path.join(SIGNALS_DIR, f)
      let command
      try {
        command = fs.readFileSync(full, 'utf8').trim()
        fs.unlinkSync(full)
      } catch {
        continue
      }
      if (command) void runCommand(command)
    }
  }, 400)

  // sessions 目录快照（并行增长的旁证）
  const snapshotter = setInterval(() => snapshotSessions(context), 5000)

  context.subscriptions.push({
    dispose() {
      for (const t of timers) clearTimeout(t)
      clearInterval(poller)
      clearInterval(snapshotter)
    },
  })
}

function deactivate() {}

module.exports = { activate, deactivate }
