import json
import time
import urllib.request
from pathlib import Path

BASE = 'http://127.0.0.1:10086/command'
SESSION = 'dionysus-test'
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = str(PROJECT_ROOT)


def send(action: str, args: dict | None = None):
    payload = json.dumps({
        'action': action,
        'args': args or {},
        'session': SESSION,
    }).encode()
    req = urllib.request.Request(BASE, data=payload, headers={
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def screenshot(name: str):
    path = f'{OUT_DIR}/{name}.png'
    res = send('screenshot', {'path': path})
    print('screenshot', name, res.get('data', res))
    return path


def main():
    # Close any previous session
    try:
        send('close_session')
    except Exception as e:
        print('close_session ignored', e)

    print('navigate')
    nav = send('navigate', {'url': 'http://127.0.0.1:5173/', 'newTab': True, 'group_title': 'Dionysus Test'})
    print(nav)
    time.sleep(2)
    # Clear any persisted legacy theme so the new default cel theme loads.
    send('evaluate', {'code': 'localStorage.clear(); location.reload();'})
    time.sleep(4)
    screenshot('wb_initial')

    # Open settings
    snap = send('snapshot')
    print('snapshot keys', list(snap.get('data', {}).keys()))
    # Try to find settings button by accessibility name
    tree = json.dumps(snap.get('data', {}).get('tree', {}))
    settings_ref = None
    for line in tree.split('"'):
        if line.startswith('@e'):
            ref = line
            # We'll just try a known CSS selector first
    try:
        click = send('click', {'selector': '[aria-label="设置"]'}) or send('click', {'selector': '@e3'})
        print('open settings', click)
        time.sleep(1)
        screenshot('wb_settings_open')
    except Exception as e:
        print('settings click failed', e)

    # Close settings via overlay or X button
    try:
        send('click', {'selector': '[aria-label="关闭设置"]'})
        time.sleep(0.5)
    except Exception as e:
        print('close settings failed', e)

    # Collapse sidebar
    try:
        send('click', {'selector': '[aria-label="收起侧边栏"]'})
        time.sleep(1)
        screenshot('wb_sidebar_collapsed')
        send('click', {'selector': '[aria-label="展开侧边栏"]'})
        time.sleep(1)
        screenshot('wb_sidebar_expanded')
    except Exception as e:
        print('sidebar toggle failed', e)

    # Send a user message
    try:
        send('fill', {'selector': '[placeholder="输入消息…"]', 'value': '帮我新建一个 hello.py'})
        time.sleep(0.3)
        send('click', {'selector': '[aria-label="发送"]'})
        time.sleep(1)
        screenshot('wb_user_message')
    except Exception as e:
        print('send message failed', e)

    # Simulate agent stream with tool call and options via evaluate
    simulate_script = """
        (() => {
            const store = window.__Dionysus_CHAT_STORE__;
            if (!store) return 'no store';
            store.getState().setStreaming(true);
            store.getState().setStreamingStatus({ status: 'thinking', detail: '正在思考' });
            store.getState().addAgentChunk('好的，我先帮你创建文件。\\n');
            store.getState().addAgentChunk('🔧 调用工具: Write(path="hello.py", content="print(\\"Hello Exusiai\\")")\\n');
            store.getState().addAgentChunk('文件已创建，还需要运行吗？\\n');
            store.getState().updateActiveToolResult('写入成功', 'success');
            store.getState().setOptions([
              { id: 'run', label: '运行一下', description: '在终端运行 hello.py' },
              { id: 'skip', label: '先跳过', description: '暂时不运行' }
            ], 'button_group');
            return 'injected';
        })()
    """
    try:
        ev = send('evaluate', {'code': simulate_script})
        print('evaluate', ev)
        time.sleep(1)
        screenshot('wb_agent_stream')
    except Exception as e:
        print('simulate stream failed', e)

    # Click first option
    try:
        send('click', {'selector': 'button:has-text("运行一下")'})
        time.sleep(1)
        screenshot('wb_option_selected')
    except Exception as e:
        print('option click failed', e)

    # Final state
    time.sleep(1)
    screenshot('wb_final')

    # Close session
    send('close_session')
    print('done')


if __name__ == '__main__':
    main()
