// @vitest-environment jsdom
/**
 * ResumeSessionMenu（聊天视图「恢复历史会话」入口）测试：
 * - 打开发 cli_session_list_request（traceId 含 sessionId）；
 * - 响应渲染历史会话（标题/时间），选中发 /resume <id>（client_command）；
 * - supported=false → 「该助手暂不支持」；空列表 → 明确提示。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ResumeSessionMenu } from './ResumeSessionMenu.js'
import { FakeTransport, resetAllStores } from './testUtils.js'

const SID = 's1'
const TRACE = `chat:cli-session-list:${SID}`

function renderMenu(transport = new FakeTransport()) {
  render(<ResumeSessionMenu sessionId={SID} transport={transport} />)
  return transport
}

beforeEach(() => {
  resetAllStores()
})
afterEach(cleanup)

describe('ResumeSessionMenu', () => {
  it('打开面板发 cli_session_list_request；响应渲染历史会话列表', () => {
    const transport = renderMenu()
    fireEvent.click(screen.getByTestId('resume-history-button'))

    const reqs = transport.ofType('cli_session_list_request')
    expect(reqs).toHaveLength(1)
    expect(reqs[0].traceId).toBe(TRACE)
    expect(reqs[0].payload).toEqual({ sessionId: SID })

    act(() => {
      transport.emit({
        v: 1,
        type: 'cli_session_list_response',
        traceId: TRACE,
        ts: Date.now(),
        payload: {
          sessionId: SID,
          supported: true,
          sessions: [
            { id: 'ses_1', workDir: '/proj/a', title: '重构 auth', updatedAt: 1_700_000_000_000 },
            { id: 'ses_2', workDir: '/proj/a' },
          ],
        },
      })
    })

    expect(screen.getByTestId('resume-item-ses_1').textContent).toContain('重构 auth')
    expect(screen.getByTestId('resume-item-ses_2').textContent).toContain('ses_2')
  })

  it('选中历史会话 → 发 /resume <id>（client_command），面板关闭', () => {
    const transport = renderMenu()
    fireEvent.click(screen.getByTestId('resume-history-button'))
    act(() => {
      transport.emit({
        v: 1,
        type: 'cli_session_list_response',
        traceId: TRACE,
        ts: Date.now(),
        payload: {
          sessionId: SID,
          supported: true,
          sessions: [{ id: 'ses_1', workDir: '/proj/a' }],
        },
      })
    })

    fireEvent.click(screen.getByTestId('resume-item-ses_1'))

    const cmds = transport.ofType('client_command')
    expect(cmds).toHaveLength(1)
    expect(cmds[0].sessionId).toBe(SID)
    expect(cmds[0].payload.command).toBe('/resume')
    expect(cmds[0].payload.args).toBe('ses_1')
    expect(screen.queryByTestId('resume-history-panel')).toBeNull()
  })

  it('supported=false → 标注「该助手暂不支持」', () => {
    const transport = renderMenu()
    fireEvent.click(screen.getByTestId('resume-history-button'))
    act(() => {
      transport.emit({
        v: 1,
        type: 'cli_session_list_response',
        traceId: TRACE,
        ts: Date.now(),
        payload: { sessionId: SID, supported: false, sessions: [] },
      })
    })
    expect(screen.getByTestId('resume-history-unsupported').textContent).toContain('该助手暂不支持')
  })

  it('空列表 → 提示该工作目录下没有历史会话', () => {
    const transport = renderMenu()
    fireEvent.click(screen.getByTestId('resume-history-button'))
    act(() => {
      transport.emit({
        v: 1,
        type: 'cli_session_list_response',
        traceId: TRACE,
        ts: Date.now(),
        payload: { sessionId: SID, supported: true, sessions: [] },
      })
    })
    expect(screen.getByTestId('resume-history-empty').textContent).toContain('没有历史会话')
  })
})
