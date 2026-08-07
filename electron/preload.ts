import { contextBridge, ipcRenderer } from "electron";

let backendCrashed = false;

// 连接信息经 IPC 取得，不走 additionalArguments：那会让令牌出现在
// renderer 进程的命令行里，本机任何进程都能用 `ps aux` 读到。
// 令牌只留在这个闭包里，不通过 contextBridge 暴露给页面 JS。
const connection = ipcRenderer.invoke("system:connection") as Promise<{
  port: number;
  token: string;
}>;

contextBridge.exposeInMainWorld("classowl", {
  /**
   * 返回纯数据而不是 `Response`。
   *
   * contextBridge 只能传可结构化克隆的值，`Response` 跨隔离边界后方法会丢失
   * （renderer 侧调 `.json()` 会报 "r.json is not a function"）。所以在桥内侧
   * 就把 body 解开。
   */
  request: async (path: string, init: RequestInit = {}) => {
    if (backendCrashed) throw new Error("Backend crashed");
    const { port, token } = await connection;
    const headers = new Headers(init.headers);
    headers.set("X-ClassOwl-Token", token);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? (JSON.parse(text) as unknown) : null,
    };
  },
  onBackendCrashed: (callback: (stderr: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, stderr: string) => {
      backendCrashed = true;
      callback(stderr);
    };
    ipcRenderer.on("backend-crashed", listener);
    return () => ipcRenderer.off("backend-crashed", listener);
  },
  system: {
    quit: () => ipcRenderer.invoke("system:quit"),
  },
  dialog: {
    saveExport: (options: {
      fileName: string;
      format: "excel" | "pdf" | "png";
    }) => ipcRenderer.invoke("dialog:save-export", options),
    capturePng: (options: {
      targetPath: string;
      scale: 1 | 2 | 3;
    }) => ipcRenderer.invoke("dialog:capture-png", options),
    saveFile: (options: { fileName: string; dataBase64: string }) =>
      ipcRenderer.invoke("dialog:save-file", options),
    openFile: () => ipcRenderer.invoke("dialog:open-file"),
  },
});
