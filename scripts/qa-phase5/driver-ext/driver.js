/**
 * Phase 5 集成 E2E driver（QA 专用，非产品代码）。
 *
 * 职责：
 * - 轮询 $DIONYSUS_QA_DIR/signals/ 下的 *.cmd 信号文件（内容 = 命令 id），
 *   读取后删除并执行对应 vscode 命令（沿用 qa-phase3 的信号机制）；
 * - 特殊信号 `capture-pair-token`：临时包装同进程共享的 node:crypto
 *   randomBytes（pair token 规格 = 16 字节随机，见 packages/extension/src/
 *   pairing.ts PAIR_TOKEN_BYTES），执行 dionysus.showPairingQr，把窗口期内
 *   全部 16 字节输出连同调用栈（bundle 未压缩，PairingManager.issueToken
 *   帧可辨）写入 out/pair-token.json，随后恢复原始实现。
 *   —— 取 pair token 的可行路径说明：pair token 只存 PairingManager 内存、
 *   不落盘，activate() 也无 exports，宿主外唯一载体是配对弹层 webview HTML。
 *   driver 与 dionysus 同处一个扩展宿主进程，randomBytes 是进程级单例，
 *   包装它可在不改产品源码的前提下精确截获签发瞬间的 token；
 *   主控脚本再以 POST /api/pair 实际换票交叉验证捕获的正确性。
 * - 全程写 out/driver.log。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vscode = require('vscode')

const QA_DIR =
  process.env.DIONYSUS_QA_DIR || path.join(os.homedir(), 'ACP_AGENT2', 'scripts', 'qa-phase5')
const SIGNALS_DIR = path.join(QA_DIR, 'signals')
const LOG_FILE = path.join(QA_DIR, 'out', 'driver.log')
const PAIR_TOKEN_FILE = path.join(QA_DIR, 'out', 'pair-token.json')

function log(line) {
  const stamp = new Date().toISOString()
  try {
    fs.appendFileSync(LOG_FILE, `${stamp} ${line}\n`)
  } catch {
    /* out/ 尚未创建时静默丢弃 */
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

/** 捕获一次配对二维码签发流程中的 pair token 候选。 */
async function capturePairToken() {
  const original = crypto.randomBytes
  const hits = []
  crypto.randomBytes = function patchedRandomBytes(size, ...rest) {
    const value = original.call(crypto, size, ...rest)
    if (size === 16) {
      const buf = rest.length === 0 ? value : value
      const stack = new Error().stack || ''
      hits.push({
        token: Buffer.from(buf).toString('base64url'),
        fromIssueToken: stack.includes('issueToken'),
        stackTop: stack.split('\n').slice(1, 5).join(' | '),
      })
    }
    return value
  }
  try {
    await runCommand('dionysus.showPairingQr')
    // render() 异步（QRCode.toString await），留出落定时间
    await new Promise((resolve) => setTimeout(resolve, 2500))
  } finally {
    crypto.randomBytes = original
  }
  const payload = { capturedAt: new Date().toISOString(), candidates: hits }
  fs.writeFileSync(PAIR_TOKEN_FILE, JSON.stringify(payload, null, 2), 'utf8')
  log(`pair-token-captured: ${hits.length} candidate(s), issueToken-hits=${hits.filter((h) => h.fromIssueToken).length}`)
}

function activate() {
  fs.mkdirSync(SIGNALS_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  log('driver activated')

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
      if (!command) continue
      if (command === 'capture-pair-token') void capturePairToken()
      else void runCommand(command)
    }
  }, 400)

  return { dispose: () => clearInterval(poller) }
}

function deactivate() {}

module.exports = { activate, deactivate }
