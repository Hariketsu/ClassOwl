import { BrowserWindow, net, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CSP, secureWebContents } from "./security";

export function registerAppProtocol(): void {
  protocol.handle("classowl", async (request) => {
    const pathname = new URL(request.url).pathname;
    const root = path.resolve(__dirname, "..", "..", "frontend", "dist");
    const requested = path.resolve(root, `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`);
    if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    const isAsset = Boolean(path.extname(requested));
    if (isAsset && !fs.existsSync(requested)) return new Response("Not found", { status: 404 });
    const file = isAsset ? requested : path.join(root, "index.html");
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  });
}

/**
 * 顶栏第一行的高度，与 CSS 的 `--titlebar-h` 必须一致。
 *
 * Windows 的 titleBarOverlay 按像素定高，CSS 侧要留出同样高度的拖拽区，
 * 否则窗口控制按钮会压在品牌区或步骤条上。
 */
const TITLEBAR_HEIGHT = 44;

export function createWindow(): BrowserWindow {
  // 尺寸权衡：720x480 的 S0 穿刺尺寸对课表工作台太小（步骤 4 的课表 + sticky
  // 表头 + 两侧面板放不下）；1440x900 又会在 14 寸 MacBook（逻辑分辨率恰好
  // 1440x900）上一开窗就铺满全屏。1280x800 放得下工作台，又给桌面留出呼吸感。
  // 需要更大字面的用户可以在「设置 → 显示比例」里调整界面缩放。
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "ClassOwl",
    // 应用自己的顶栏已经承担了标题栏的职责（品牌、当前方案、步骤条），
    // 再叠一条原生标题栏就是两层头部。这里让红绿灯浮进应用顶栏。
    //   macOS: hiddenInset —— 保留原生红绿灯，位置内缩。
    //   Windows/Linux: titleBarOverlay —— Electron 画最小化/最大化/关闭，
    //     颜色与顶栏底色对齐，height 与 --titlebar-h 保持一致。
    titleBarStyle: "hiddenInset",
    ...(process.platform === "win32"
      ? {
        titleBarOverlay: {
          color: "#ffffff",
          symbolColor: "#41454d",
          height: TITLEBAR_HEIGHT,
        },
      }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  secureWebContents(window.webContents);
  window.once("ready-to-show", () => window.show());
  // ready-to-show 依赖首帧渲染完成，渲染或加载失败时不触发，窗口就永远停在
  // show:false —— 用户看到的是一个「有菜单栏但没有窗口」的应用。这里兜底。
  window.webContents.once("did-finish-load", () => window.show());
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load ${url}: ${description} (${code})`);
    window.show();
  });
  void window.loadURL(process.env.VITE_DEV_SERVER_URL ?? "classowl://app/index.html");
  return window;
}

/**
 * 后端在主窗口就绪前就崩溃时用的兜底窗口。
 *
 * 不能复用主窗口那条路径：它依赖 preload 向后端取连接信息，而后端已经没了。
 * 这里直接内联展示诊断信息，不加载任何脚本。
 */
export function createRecoveryWindow(diagnostics: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 720,
    height: 480,
    title: "ClassOwl 无法启动",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  secureWebContents(window.webContents);
  const escaped = diagnostics
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>ClassOwl 无法启动</title>
<style>
  body { font: 13px -apple-system, sans-serif; margin: 0; padding: 24px; color: #1f2933; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: #52606d; }
  pre { background: #f5f7fa; border: 1px solid #e4e7eb; border-radius: 6px;
        padding: 12px; overflow: auto; max-height: 300px; white-space: pre-wrap; font-size: 12px; }
</style>
<h1>后端服务未能启动</h1>
<p>请退出后重新打开 ClassOwl。若反复出现，请把下面的诊断信息反馈给开发者。</p>
<pre>${escaped || "（没有 stderr 输出）"}</pre>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return window;
}
