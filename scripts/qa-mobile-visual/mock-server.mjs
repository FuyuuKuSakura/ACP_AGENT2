/**
 * QA mock server — 移动端视觉验收（A-2）用的 lan-server 替身。
 *
 * 实现真实端点形态（与 extension lan-server 对齐）：
 * - 静态托管 packages/mobile/dist（SPA 回退 index.html）
 * - POST /api/pair {pair_token} → {device_token}（无效 401）
 * - GET  /api/health?token=（token 错 → 401）
 * - GET  /assets/*?token=（本目录 assets/ 下的 SVG 角色素材）
 * - WS   /ws?token=（upgrade 前校验 token，错 → 401 拒绝升级）
 *
 * WS 场景（hello → handshake 后按 120ms 节奏推全量样例）：
 * 3 个会话 digest 快照 —— sess-auth（running，todoProgress 3/7）/
 * sess-mobile（waiting_option，未决 option_request + 本回合工具 chip）/
 * sess-docs（done）；外加 todo_update、tool_call/tool_result、status_update、
 * agent_stream、session/global companion_message、emotion_update，
 * 以及「你离开期间…」前缀的 global 归来摘要。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../packages/mobile/dist')
const ASSETS = path.join(__dirname, 'assets')
const PORT = Number(process.env.PORT ?? 8791)

const PAIR_TOKEN = 'QA-PAIR-2026'
const DEVICE_TOKEN = 'qa-device-token-7f3d9a2b'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

// ---------------------------------------------------------------------------
// 场景数据（中文会话名、代码相关摘要）
// ---------------------------------------------------------------------------

const NOW = Date.now()
const MIN = 60_000

const SESSIONS = {
  'sess-auth': {
    title: 'auth 模块重构',
    personaId: 'kaltsit',
    status: 'running',
    latestSeq: 2,
  },
  'sess-mobile': {
    title: '移动端适配联调',
    personaId: 'kaltsit',
    status: 'waiting_option',
    latestSeq: 5,
  },
  'sess-docs': {
    title: '文档站部署脚本',
    personaId: 'amiya',
    status: 'done',
    latestSeq: 3,
  },
}

const AUTH_TODOS = [
  { id: 't1', text: '梳理现有 token 校验调用点', done: true },
  { id: 't2', text: '重写 packages/core/src/auth/token.ts', done: true },
  { id: 't3', text: '迁移 session 中间件到新校验', done: true },
  { id: 't4', text: '改 auth/middleware.ts 的刷新逻辑', done: false },
  { id: 't5', text: '补 RefreshToken 过期单测', done: false },
  { id: 't6', text: '跑 core 全量测试', done: false },
  { id: 't7', text: '更新 architecture.md §6.3 说明', done: false },
]

const HISTORIES = {
  'sess-mobile': [
    {
      type: 'message',
      id: 'm-mob-1',
      role: 'user',
      text: '帮我把移动端会话列表接到新的 digest 协议上，顺便确认构建能过。',
      ts: NOW - 58 * MIN,
    },
    {
      type: 'message',
      id: 'm-mob-2',
      role: 'agent',
      text: '好的，我先看了 packages/mobile 的现状。已经完成：\n\n- 列表数据源切到 session_digest_update，排序按状态分组\n- 未读角标改用 seq 差值，进会话即清零\n\n跑构建时发现 .env 里还有旧的 API_BASE 自定义配置，和新协议的 /ws 路径冲突。怎么处理需要你拍板，确认后我继续。',
      ts: NOW - 51 * MIN,
    },
    {
      type: 'event',
      eventType: 'todo_update',
      payload: {
        items: [
          { id: 'm1', text: '列表数据源切到 digest 协议', done: true },
          { id: 'm2', text: '未读角标改 seq 差值', done: true },
          { id: 'm3', text: '构建验证（.env 配置待确认）', done: false },
        ],
      },
      ts: NOW - 50 * MIN,
    },
    {
      type: 'event',
      eventType: 'companion_message',
      payload: {
        text: '列表那块改完咯，就是构建卡在旧配置上，等你拿个主意。',
        scope: 'session',
        emotion: 'working',
        sourceSessionId: 'sess-mobile',
        sourceTitle: '移动端适配联调',
      },
      ts: NOW - 49 * MIN,
    },
    {
      type: 'message',
      id: 'm-mob-3',
      role: 'system',
      text: '回合 2 完成 · 用时 1 分 12 秒',
      ts: NOW - 49 * MIN,
    },
  ],
  'sess-auth': [
    {
      type: 'message',
      id: 'm-auth-1',
      role: 'user',
      text: 'auth 模块的重构继续，今天把 token 刷新这块收掉。',
      ts: NOW - 12 * MIN,
    },
    {
      type: 'message',
      id: 'm-auth-2',
      role: 'agent',
      text: '收到。token.ts 已经重写完，旧的 session 校验调用点也迁移了一半。现在继续改 middleware 的刷新逻辑。',
      ts: NOW - 9 * MIN,
    },
  ],
  'sess-docs': [
    {
      type: 'message',
      id: 'm-docs-1',
      role: 'user',
      text: '给文档站写个一键部署脚本，push 到 main 就自动发布。',
      ts: NOW - 90 * MIN,
    },
    {
      type: 'message',
      id: 'm-docs-2',
      role: 'agent',
      text: '搞定啦。scripts/deploy-docs.sh 已经写好，CI 里加了 main 分支触发的 workflow，README 也补了使用说明。一共动了 3 个文件。',
      ts: NOW - 44 * MIN,
    },
  ],
}

// ---------------------------------------------------------------------------
// 信封与发送
// ---------------------------------------------------------------------------

const seqCounter = {}

function env(type, payload, extra = {}) {
  return JSON.stringify({ v: 1, type, ts: Date.now(), ...extra, payload })
}

function nextSeq(sessionId) {
  seqCounter[sessionId] = (seqCounter[sessionId] ?? SESSIONS[sessionId]?.latestSeq ?? 0) + 1
  return seqCounter[sessionId]
}

function send(ws, type, payload, extra) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(env(type, payload, extra))
}

/** handshake 后的场景推送（120ms 节奏，模拟真实广播时序）。 */
function pushScenario(ws) {
  const steps = [
    // 1) 全量 digest 快照（QQ 式列表数据源）
    () =>
      send(ws, 'session_digest_update', {
        sessionId: 'sess-docs',
        title: SESSIONS['sess-docs'].title,
        status: 'done',
        currentAction: '回合完成：部署脚本与 CI 已就绪',
        pendingOptionRequest: false,
        lastActivityAt: Date.now() - 42 * MIN,
        seq: 3,
      }),
    () =>
      send(ws, 'session_digest_update', {
        sessionId: 'sess-auth',
        title: SESSIONS['sess-auth'].title,
        status: 'running',
        currentAction: '正在改 auth/middleware.ts',
        todoProgress: { done: 3, total: 7 },
        pendingOptionRequest: false,
        lastActivityAt: Date.now() - 2 * MIN,
        seq: 2,
      }),
    () =>
      send(ws, 'session_digest_update', {
        sessionId: 'sess-mobile',
        title: SESSIONS['sess-mobile'].title,
        status: 'waiting_option',
        currentAction: '等待确认：.env 旧配置如何处理',
        pendingOptionRequest: true,
        lastActivityAt: Date.now() - 6 * MIN,
        seq: 5,
      }),
    // 2) sess-auth 工作状态页素材：todo + 工具时间线 + 状态行 + 流式
    () => send(ws, 'todo_update', { items: AUTH_TODOS }, { sessionId: 'sess-auth', seq: nextSeq('sess-auth') }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-auth-1',
        name: 'read_file',
        kind: 'read',
        args: { path: 'packages/core/src/auth/token.ts' },
        displayTarget: 'packages/core/src/auth/token.ts',
      }, { sessionId: 'sess-auth', turnId: 'turn-auth-4', seq: nextSeq('sess-auth') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-auth-1',
        ok: true,
        summary: '读取 214 行',
        durationMs: 320,
      }, { sessionId: 'sess-auth' }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-auth-2',
        name: 'edit',
        kind: 'edit',
        args: { path: 'packages/core/src/auth/session.ts' },
        displayTarget: 'packages/core/src/auth/session.ts',
      }, { sessionId: 'sess-auth', turnId: 'turn-auth-4', seq: nextSeq('sess-auth') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-auth-2',
        ok: true,
        summary: '替换 3 处校验调用',
        durationMs: 1180,
      }, { sessionId: 'sess-auth' }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-auth-3',
        name: 'Bash',
        kind: 'bash',
        args: { command: 'pnpm --filter @dionysus/core test auth' },
        displayTarget: 'pnpm --filter @dionysus/core test auth',
      }, { sessionId: 'sess-auth', turnId: 'turn-auth-4', seq: nextSeq('sess-auth') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-auth-3',
        ok: true,
        summary: '18 个用例全部通过',
        durationMs: 9600,
      }, { sessionId: 'sess-auth' }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-auth-4',
        name: 'edit',
        kind: 'edit',
        args: { path: 'packages/core/src/auth/middleware.ts' },
        displayTarget: 'packages/core/src/auth/middleware.ts',
      }, { sessionId: 'sess-auth', turnId: 'turn-auth-4', seq: nextSeq('sess-auth') }),
    () =>
      send(ws, 'status_update', {
        status: 'executing',
        detail: '正在修改 middleware 的刷新逻辑',
        progress: 0.45,
      }, { sessionId: 'sess-auth' }),
    () =>
      send(ws, 'agent_stream', {
        chunk: 'middleware 的刷新逻辑改到一半：旧的 session 校验已下线，正在接新的 RefreshToken 轮换……',
        isFinal: false,
        status: 'outputting',
        isThinking: false,
      }, { sessionId: 'sess-auth', turnId: 'turn-auth-4', seq: nextSeq('sess-auth') }),
    // 3) sess-mobile 对话页素材：本回合工具 chip + 未决 option_request
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-mob-1',
        name: 'read_file',
        kind: 'read',
        args: { path: 'packages/mobile/.env.example' },
        displayTarget: 'packages/mobile/.env.example',
      }, { sessionId: 'sess-mobile', turnId: 'turn-mob-3', seq: nextSeq('sess-mobile') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-mob-1',
        ok: true,
        summary: '读取 12 行',
        durationMs: 180,
      }, { sessionId: 'sess-mobile' }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-mob-2',
        name: 'search',
        kind: 'search',
        args: { pattern: 'API_BASE' },
        displayTarget: 'API_BASE（全仓搜索）',
      }, { sessionId: 'sess-mobile', turnId: 'turn-mob-3', seq: nextSeq('sess-mobile') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-mob-2',
        ok: true,
        summary: '4 处引用：.env、vite.config.ts、pairing.ts、README',
        durationMs: 640,
      }, { sessionId: 'sess-mobile' }),
    () =>
      send(ws, 'tool_call', {
        toolCallId: 'tc-mob-3',
        name: 'Bash',
        kind: 'bash',
        args: { command: 'npm run build --workspace @dionysus/mobile' },
        displayTarget: 'npm run build --workspace @dionysus/mobile',
      }, { sessionId: 'sess-mobile', turnId: 'turn-mob-3', seq: nextSeq('sess-mobile') }),
    () =>
      send(ws, 'tool_result', {
        toolCallId: 'tc-mob-3',
        ok: false,
        summary: '构建失败：API_BASE 与 /ws 路径冲突',
        durationMs: 4200,
      }, { sessionId: 'sess-mobile' }),
    () =>
      send(ws, 'option_request', {
        question: '检测到 .env 里还有旧的 API_BASE 自定义配置，和新协议冲突，如何处理？',
        options: [
          { id: 'merge', label: '保留并合并', description: '旧键改名保留，新协议键优先生效' },
          { id: 'overwrite', label: '覆盖为新配置', description: '按 .env.example 重新生成' },
          { id: 'skip', label: '跳过此步骤', description: '保持现状，构建问题稍后再处理' },
        ],
        uiType: 'button_group',
        timeoutSeconds: 600,
      }, { sessionId: 'sess-mobile', traceId: 'opt-mob-1' }),
    // 4) 角色汇报：会话级 + fleet 级 + 情绪
    () =>
      send(ws, 'emotion_update', { emotion: 'working', confidence: 0.9 }, {}),
    () =>
      send(ws, 'companion_message', {
        text: 'auth 重构做到第 3 步啦，token 校验这块快收尾了。',
        scope: 'session',
        emotion: 'working',
        sourceSessionId: 'sess-auth',
        sourceTitle: 'auth 模块重构',
      }, { sessionId: 'sess-auth' }),
    () =>
      send(ws, 'companion_message', {
        text: '配置合并这事我拿不准，等你拍板呢。',
        scope: 'session',
        emotion: 'working',
        sourceSessionId: 'sess-mobile',
        sourceTitle: '移动端适配联调',
      }, { sessionId: 'sess-mobile' }),
    () =>
      send(ws, 'companion_message', {
        text: '1 个任务还在跑，1 个等你确认，文档站部署那边已经完工咯。',
        scope: 'global',
        emotion: 'happy',
      }, {}),
    // 5) 归来摘要（「你离开期间」前缀，mobile 落首屏顶部卡片）
    () =>
      send(ws, 'companion_message', {
        text: '你离开期间：会话「文档站部署脚本」完成 1 回合（成功）、执行 6 项操作；会话「移动端适配联调」在等待你确认选项 ❗；会话「auth 模块重构」进度 3/7，正在改 middleware。',
        scope: 'global',
        emotion: 'happy',
      }, {}),
    () =>
      send(ws, 'emotion_update', { emotion: 'happy', confidence: 0.85 }, {}),
  ]
  steps.forEach((fn, i) => setTimeout(fn, 120 * (i + 1)))
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------

function handleRequest(ws, raw) {
  let msg
  try {
    msg = JSON.parse(raw.toString())
  } catch {
    return
  }
  switch (msg.type) {
    case 'hello':
      send(ws, 'handshake', {
        v: 1,
        clientId: 'qa-mock-client',
        sessions: Object.entries(SESSIONS).map(([sessionId, s]) => ({
          sessionId,
          title: s.title,
          status: s.status,
          latestSeq: s.latestSeq,
        })),
      })
      pushScenario(ws)
      break
    case 'ping':
      send(ws, 'pong', {})
      break
    case 'session_list_request':
      send(ws, 'session_list_response', {
        sessions: Object.entries(SESSIONS).map(([id, s]) => ({
          id,
          title: s.title,
          personaId: s.personaId,
          status: s.status,
          lastMessagePreview: HISTORIES[id][HISTORIES[id].length - 1].text?.slice(0, 40),
          updatedAt: Date.now() - 5 * MIN,
          unreadCount: 0,
        })),
      })
      break
    case 'persona_list_request':
      send(ws, 'persona_list_response', {
        personas: [
          {
            id: 'kaltsit',
            name: '凯尔希',
            description: '冷静克制的医疗顾问，偶尔毒舌。',
            avatarPath: 'personas/kaltsit/avatar.svg',
            avatarSource: 'builtin',
            voice: {
              tone: '冷静克制，偶尔毒舌',
              catchphrases: ['咯', '吧'],
              taboos: ['加油哦'],
              examples: [
                { plain: '任务完成了', styled: '搞定咯，要看看结果吗？' },
              ],
              rewriterPrompt: '以{tone}的语气改写：{examples}',
            },
            touchZones: {},
            portraitUrls: {
              default: 'personas/kaltsit/portrait-idle.svg',
              idle: 'personas/kaltsit/portrait-idle.svg',
              working: 'personas/kaltsit/portrait-working.svg',
              happy: 'personas/kaltsit/portrait-happy.svg',
            },
          },
          {
            id: 'amiya',
            name: '阿米娅',
            description: '温柔可靠的罗德岛领袖。',
            avatarSource: 'builtin',
            voice: {
              tone: '温柔坚定',
              catchphrases: ['博士'],
              taboos: [],
              examples: [{ plain: '任务完成了', styled: '博士，任务完成了。' }],
              rewriterPrompt: '以{tone}的语气改写：{examples}',
            },
            touchZones: {},
          },
        ],
      })
      break
    case 'history_request': {
      const sid = msg.payload?.sessionId
      send(ws, 'history_response', {
        sessionId: sid,
        entries: HISTORIES[sid] ?? [],
        hasMore: false,
      }, { traceId: msg.traceId })
      break
    }
    case 'sync_request':
      send(ws, 'sync_response', {
        sessionId: msg.payload?.sessionId,
        events: [],
        latestSeq: SESSIONS[msg.payload?.sessionId]?.latestSeq ?? 0,
        truncated: false,
      })
      break
    case 'option_selected':
      send(ws, 'option_resolved', {
        requestTraceId: msg.traceId ?? 'opt-mob-1',
        selectedId: msg.payload?.selectedId,
        origin: 'mobile',
      }, { sessionId: msg.sessionId })
      break
    case 'user_input':
    case 'interrupt':
    case 'new_session':
    case 'client_command':
      console.log(`[mock] ${msg.type}:`, JSON.stringify(msg.payload ?? {}))
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// HTTP + WS 服务器
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/api/pair' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let token
      try {
        token = JSON.parse(body).pair_token
      } catch {
        token = undefined
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (token === PAIR_TOKEN) {
        res.writeHead(200)
        res.end(JSON.stringify({ device_token: DEVICE_TOKEN }))
      } else {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'invalid_pair_token' }))
      }
    })
    return
  }

  if (pathname === '/api/health') {
    const token = url.searchParams.get('token')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (token && token !== DEVICE_TOKEN) {
      res.writeHead(401)
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true, server: 'qa-mock', sessions: Object.keys(SESSIONS).length }))
    return
  }

  if (pathname.startsWith('/assets/')) {
    // 与 extension lan-server 一致：mobile 打包产物（vite 默认也输出到 assets/）
    // 是公开静态文件，精确命中 dist 直出；未命中才进角色素材路由（强制鉴权）。
    const distFile = path.join(DIST, pathname)
    if (distFile.startsWith(DIST) && existsSync(distFile) && statSync(distFile).isFile()) {
      res.setHeader('Content-Type', MIME[path.extname(distFile)] ?? 'application/octet-stream')
      createReadStream(distFile).pipe(res)
      return
    }
    const token = url.searchParams.get('token')
    if (token !== DEVICE_TOKEN) {
      res.writeHead(401).end('unauthorized')
      return
    }
    const rel = pathname.slice('/assets/'.length)
    const file = path.join(ASSETS, rel)
    if (!file.startsWith(ASSETS) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
    return
  }

  // 静态托管 mobile dist（SPA 回退）
  let file = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    file = path.join(DIST, 'index.html')
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== DEVICE_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  console.log('[mock] ws connected')
  ws.on('message', (raw) => handleRequest(ws, raw))
})

server.listen(PORT, () => {
  console.log(`[mock] qa-mobile-visual mock server on http://localhost:${PORT}`)
  console.log(`[mock] pair token: ${PAIR_TOKEN}  device token: ${DEVICE_TOKEN}`)
})
