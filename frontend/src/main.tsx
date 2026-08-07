import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import './styles.css'
import './plan-center.css'
import './settings.css'

// 窗口是无边框的，顶栏要为系统窗口控制按钮让位，而 macOS 的红绿灯在左、
// Windows 的三按钮在右。用 <html> 上的 class 驱动 CSS 的 --titlebar-inset*，
// 浏览器里跑（vite dev / vitest）两个 class 都不加，inset 为默认的 16px。
const platform = navigator.userAgent.includes('Macintosh')
  ? 'is-mac'
  : navigator.userAgent.includes('Windows') ? 'is-win' : ''
if (platform && 'classowl' in window) document.documentElement.classList.add(platform)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>,
)
