import { shell, WebContents } from "electron";

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src http://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** 畸形 URL 会让 `new URL()` 抛异常，一律当作不可打开。 */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function isTrustedAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "classowl:" && parsed.hostname === "app") return true;
    const devServer = process.env.VITE_DEV_SERVER_URL;
    return Boolean(devServer && parsed.origin === new URL(devServer).origin);
  } catch {
    return false;
  }
}

export function secureWebContents(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (isTrustedAppUrl(url)) return;
    event.preventDefault();
    if (isHttps(url)) void shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
}

/** senderFrame 可能已销毁（null），那种情况一并拒绝。 */
export function assertTrustedSender(url: string | undefined): void {
  if (!isTrustedAppUrl(url)) {
    throw new Error("Rejected IPC from an untrusted frame");
  }
}
