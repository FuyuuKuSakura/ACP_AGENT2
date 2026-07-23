/**
 * mobile 入口：先落主题（防首屏闪色），再挂载 App。
 * 配对/传输/消息管线接线全部在 App 内（可测）。
 */
import { createRoot } from 'react-dom/client'

import './index.css'

import App from './App.js'
import { applyTheme, loadThemeMode } from './theme.js'

applyTheme(loadThemeMode())

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<App />)
}
