import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { assertTrustedSender } from "./security";
import {
  Sidecar,
  startSidecar,
  stopSidecar,
  waitUntilReady,
} from "./sidecar";
import {
  createRecoveryWindow,
  createWindow,
  registerAppProtocol,
} from "./window";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "classowl",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let sidecar: Sidecar | undefined;
  let window: BrowserWindow | undefined;
  let stopping = false;

  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  ipcMain.handle("system:quit", (event) => {
    assertTrustedSender(event.senderFrame?.url);
    app.quit();
  });

  // Renderer 经 IPC 取连接信息，避免令牌出现在进程命令行里。
  ipcMain.handle("system:connection", (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!sidecar) throw new Error("Backend is not running");
    return { port: sidecar.port, token: sidecar.token };
  });

  ipcMain.handle("dialog:save-export", async (event, options: {
    fileName: string;
    format: "excel" | "pdf" | "png";
  }) => {
    assertTrustedSender(event.senderFrame?.url);
    const formats = {
      excel: { extension: "xlsx", name: "Excel 工作簿" },
      pdf: { extension: "pdf", name: "PDF 文档" },
      png: { extension: "png", name: "PNG 图片" },
    } as const;
    const format = formats[options?.format];
    if (!format || typeof options.fileName !== "string") {
      throw new Error("Invalid export options");
    }
    const result = await dialog.showSaveDialog({
      defaultPath: `${path.basename(options.fileName)}.${format.extension}`,
      filters: [{ name: format.name, extensions: [format.extension] }],
    });
    return result.canceled || !result.filePath
      ? null
      : { targetPath: result.filePath };
  });

  ipcMain.handle("dialog:capture-png", async (event, options: {
    targetPath: string;
    scale: 1 | 2 | 3;
  }) => {
    assertTrustedSender(event.senderFrame?.url);
    if (
      typeof options?.targetPath !== "string"
      || ![1, 2, 3].includes(options.scale)
    ) {
      return { ok: false, message: "Invalid PNG capture options" };
    }
    const contents = event.sender;
    const originalZoomFactor = contents.getZoomFactor();
    try {
      contents.setZoomFactor(options.scale);
      const image = await contents.capturePage();
      await fs.promises.writeFile(options.targetPath, image.toPNG());
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error) };
    } finally {
      contents.setZoomFactor(originalZoomFactor);
    }
  });

  // 方案导出：保存对话框 + 写入一气呵成，zip 内容以 base64 过桥。
  ipcMain.handle("dialog:save-file", async (event, options: {
    fileName: string;
    dataBase64: string;
  }) => {
    assertTrustedSender(event.senderFrame?.url);
    if (
      typeof options?.fileName !== "string"
      || typeof options?.dataBase64 !== "string"
    ) {
      throw new Error("Invalid save-file options");
    }
    const result = await dialog.showSaveDialog({
      defaultPath: path.basename(options.fileName),
      filters: [{ name: "ClassOwl 方案", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(
      result.filePath,
      Buffer.from(options.dataBase64, "base64"),
    );
    return { targetPath: result.filePath };
  });

  // 方案导入：打开对话框选 zip，读回 base64 交给后端校验。
  ipcMain.handle("dialog:open-file", async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "ClassOwl 方案", extensions: ["zip"] }],
    });
    const [filePath] = result.filePaths;
    if (result.canceled || !filePath) return null;
    const content = await fs.promises.readFile(filePath);
    return {
      fileName: path.basename(filePath),
      dataBase64: content.toString("base64"),
    };
  });

  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    stopping = true;
    void (async () => {
      if (sidecar) await stopSidecar(sidecar);
      app.exit(0);
    })();
  });

  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    registerAppProtocol();
    const dataDir = path.join(app.getPath("userData"), "data");
    for (const directory of ["", "backups", "logs", "temp"]) {
      fs.mkdirSync(path.join(dataDir, directory), { recursive: true });
    }
    const token = randomBytes(32).toString("hex");
    sidecar = await startSidecar(token, dataDir);
    sidecar.process.once("exit", (_code, _signal) => {
      if (stopping) return;
      // 后端在窗口就绪前崩溃时 window 还是 undefined，必须显示恢复窗口，
      // 否则用户看到的是闪退（计划 §4.4）。
      if (window && !window.isDestroyed()) {
        window.webContents.send("backend-crashed", sidecar?.stderrTail() ?? "");
      } else {
        window = createRecoveryWindow(sidecar?.stderrTail() ?? "");
      }
    });
    const status = await waitUntilReady(sidecar);
    if (status.protocolVersion !== 1) {
      throw new Error(`Unsupported protocol version: ${status.protocolVersion}`);
    }
    window = createWindow();
  }).catch(async (error: unknown) => {
    if (sidecar) await stopSidecar(sidecar);
    console.error(error);
    if (!window || window.isDestroyed()) {
      window = createRecoveryWindow(
        `${String(error)}\n\n${sidecar?.stderrTail() ?? ""}`,
      );
    }
  });
}
