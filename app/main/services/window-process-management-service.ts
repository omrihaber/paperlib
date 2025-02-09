import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  app,
  ipcMain,
  nativeTheme,
  screen,
  shell,
} from "electron";
import os from "os";
import path, { join, posix } from "path";

import { errorcatching } from "@/base/error";
import { Eventable } from "@/base/event";
import { createDecorator } from "@/base/injection/injection";
import { Process } from "@/base/process-id";
import {
  IPreferenceService,
  PreferenceService,
} from "@/common/services/preference-service";
import { WindowStorage } from "@/main/window-storage";

interface WindowOptions extends BrowserWindowConstructorOptions {
  entry: string;
}

export enum APPTheme {
  System = "system",
  Light = "light",
  Dark = "dark",
}

export interface IWindowProcessManagementServiceState {
  serviceReady: string;
  requestPort: string;
  destroyed: string;
  rendererProcess: string;
  [key: string]: string;
}

export const IWindowProcessManagementService = createDecorator(
  "windowProcessManagementService"
);

export class WindowProcessManagementService extends Eventable<IWindowProcessManagementServiceState> {
  public browserWindows: WindowStorage;

  constructor(
    @IPreferenceService private readonly _preferenceService: PreferenceService
  ) {
    super("windowProcessManagementService", {
      serviceReady: "",
      requestPort: "",
      destroyed: "",
      rendererProcess: "",
    });

    this.browserWindows = new WindowStorage();

    ipcMain.on("request-port", (event, senderID) => {
      this.fire({ requestPort: senderID });
    });
  }

  /**
   * Create Process with a BrowserWindow
   * @param id - window id
   * @param options - window options
   * @param eventCallbacks - callbacks for events
   */
  @errorcatching("Failed to create window.", true, "WinProcessManagement")
  create(
    id: string,
    options: WindowOptions,
    eventCallbacks?: Record<string, (win: BrowserWindow) => void>
  ) {
    if (this.browserWindows.has(id)) {
      this.browserWindows.destroy(id);
    }

    const { entry, ...windowOptions } = options;

    this.browserWindows.set(id, new BrowserWindow(windowOptions));

    const entryURL = this._constructEntryURL(entry);
    if (entryURL.startsWith("http")) {
      this.browserWindows.get(id).loadURL(entryURL);
    } else {
      this.browserWindows.get(id).loadFile(entryURL);
    }
    if (app.isPackaged || process.env.NODE_ENV === "test") {
    } else {
      this.browserWindows.get(id).webContents.openDevTools();
    }

    // Make all links open with the browser, not with the application
    this.browserWindows.get(id).webContents.setWindowOpenHandler(({ url }) => {
      if (
        url.includes(process.env.VITE_DEV_SERVER_URL || "") &&
        process.env.NODE_ENV === "development"
      ) {
        return { action: "allow" };
      }
      if (url.startsWith("http")) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });
    this.browserWindows
      .get(id)
      .webContents.on("will-navigate", function (e, url) {
        if (
          url.includes(process.env.VITE_DEV_SERVER_URL || "") &&
          process.env.NODE_ENV === "development"
        ) {
          return;
        }
        e.preventDefault();
        shell.openExternal(url);
      });

    nativeTheme.themeSource = this._preferenceService.get("preferedTheme") as
      | "dark"
      | "light"
      | "system";

    this._setNonMacSpecificStyles(this.browserWindows.get(id));

    for (const eventName of [
      "ready-to-show",
      "blur",
      "focus",
      "close",
      "show",
      "unmaximize",
      "maximize",
    ]) {
      this.browserWindows.get(id).on(eventName as any, (e) => {
        this.fire({ [id]: eventName });

        if (eventCallbacks && eventCallbacks[eventName]) {
          eventCallbacks[eventName](this.browserWindows.get(id));
        }
      });
    }

    this.fire({ [id]: "created" });
  }

  createMainRenderer() {
    const windowSize = this._preferenceService.get("windowSize") as {
      height: number;
      width: number;
    };
    return this.create(
      Process.renderer,
      {
        entry: "app/index.html",
        title: "Paperlib",
        width: windowSize.width,
        height: windowSize.height,
        minWidth: 600,
        minHeight: 400,
        useContentSize: true,
        webPreferences: {
          preload: join(__dirname, "preload.js"),
          webSecurity: false,
          nodeIntegration: true,
          contextIsolation: false,
          enableBlinkFeatures: "CSSColorSchemeUARendering",
        },
        frame: false,
        vibrancy: "sidebar",
        visualEffectState: "active",
      },
      {
        close: (win: BrowserWindow) => {
          const winSize = win.getNormalBounds();
          if (winSize) {
            this._preferenceService.set({
              windowSize: {
                width: winSize.width,
                height: winSize.height,
              },
            });
          }

          for (const [windowId, window] of Object.entries(
            this.browserWindows.all()
          )) {
            if (windowId !== Process.renderer) {
              window.close();
              window.destroy();
            }
          }
          this.browserWindows.get(Process.renderer).destroy();

          if (process.platform !== "darwin") app.quit();
        },
      }
    );
  }

  createQuickpasteRenderer() {
    const options: WindowOptions = {
        entry: "app/index_quickpaste.html",
        title: "Quickpaste",
        width: 600,
        height: 76,
        minWidth: 600,
        minHeight: 76,
        maxWidth: 600,
        maxHeight: 394,
        useContentSize: true,
        webPreferences: {
          webSecurity: false,
          nodeIntegration: true,
          contextIsolation: false,
        },
        frame: false,
        vibrancy: "sidebar",
        visualEffectState: "active",
        show: false,
    }
    if (os.platform() === "darwin") {
      options["type"] = "panel";
    }
    
    this.create(
      "quickpasteProcess",
      options,
      {
        blur: (win: BrowserWindow) => {
          win.setSize(600, 76);
          win.hide();
        },

        focus: (win: BrowserWindow) => {
          win.setSize(600, 76);
        },
        show: (win: BrowserWindow) => {
          win.setSize(600, 76);
        },
      }
    );

    if (os.platform() === "darwin") {
      this.browserWindows
        .get("quickpasteProcess")
        .setVisibleOnAllWorkspaces(true);
    }
  }

  /**
   * Destroy the window with the given id.
   * @param windowId - The id of the window to be destroyed
   */
  destroy(windowId: string) {
    if (this.browserWindows.has(windowId)) {
      this.browserWindows.destroy(windowId);
      this.fire({ destroyed: windowId });
    }
  }

  /**
   * Fire the serviceReady event. This event is fired when the service of the window is ready to be used by other processes.
   * @param windowId - The id of the window that fires the event
   */
  fireServiceReady(windowId: string) {
    this.fire({ serviceReady: windowId });
  }

  /**
   * Show the window with the given id.
   * @param windowId - The id of the window to be shown
   */
  show(windowId: string) {
    const win = this.browserWindows.get(windowId);
    if (win) {
      win.show();
    }
  }

  /**
   * Hide the window with the given id.
   * @param windowId - The id of the window to be hidden
   */
  hide(windowId: string, restoreFocus = false) {
    const win = this.browserWindows.get(windowId);
    if (win) {
      if (restoreFocus) {
        if (os.platform() === "darwin") {
          win.hide();
          app.hide();
        } else {
          win.minimize();
          win.hide();
        }
      } else {
        win.hide();
      }
    }
  }

  /**
   * Minimize the window with the given id.
   * @param windowId - The id of the window to be minimized
   */
  minimize(windowId: string) {
    if (windowId === Process.renderer) {
      const win = this.browserWindows.get(windowId);
      win.minimize();

      for (const [windowId, win] of Object.entries(this.browserWindows.all())) {
        if (windowId !== Process.renderer) {
          win.hide();
        }
      }
    }
  }

  /**
   * Unmaximize the window with the given id.
   * @param windowId - The id of the window to be unmaximized
   */
  unmaximize(windowId: string) {
    if (windowId === Process.renderer) {
      const win = this.browserWindows.get(windowId);
      win.unmaximize();
    }
  }

  /**
   * Maximize the window with the given id.
   * @param windowId - The id of the window to be maximized
   */
  maximize(windowId: string) {
    if (windowId === Process.renderer) {
      const win = this.browserWindows.get(windowId);
      win.maximize();
    }
  }

  /**
   * Close the window with the given id.
   * @param windowId - The id of the window to be closed
   */
  close(windowId: string) {
    if (os.platform() === "darwin") {
      if (windowId === Process.renderer) {
        for (const [windowId, win] of Object.entries(
          this.browserWindows.all()
        )) {
          win.hide();
        }
      } else {
        const win = this.browserWindows.get(windowId);
        win.hide();
      }
    } else {
      if (windowId === Process.renderer) {
        for (const [windowId, win] of Object.entries(
          this.browserWindows.all()
        )) {
          win.close();
        }
        app.quit();
      } else {
        const win = this.browserWindows.get(windowId);
        win.close();
      }
    }
  }

  /**
   * Force close the window with the given id.
   * @param windowId - The id of the window to be force closed
   */
  forceClose(windowId: string) {
    if (windowId === Process.renderer) {
      for (const [windowId, win] of Object.entries(this.browserWindows.all())) {
        win.close();
      }
    } else {
      const win = this.browserWindows.get(windowId);
      win.close();
    }
  }

  /**
   * Change the theme of the app.
   * @param theme - The theme to be changed to
   */
  @errorcatching("Failed to change theme.", true, "WinProcessManagement")
  changeTheme(theme: APPTheme) {
    nativeTheme.themeSource = theme;
  }

  /**
   * Check if the app is in dark mode.
   * @returns Whether the app is in dark mode
   */
  isDarkMode(): boolean {
    return nativeTheme.shouldUseDarkColors;
  }

  /**
   * Resize the window with the given id.
   * @param windowId - The id of the window to be resized
   * @param width - The width of the window
   * @param height - The height of the window
   */
  @errorcatching("Failed to resize window.", true, "WinProcessManagement")
  resize(windowId: string, width: number, height: number) {
    const win = this.browserWindows.get(windowId);
    if (win) {
      win.setSize(width, height);
    }
  }

  /**
   * Get the size of the screen.
   * @returns The size of the screen
   */
  getScreenSize() {
    const { x, y } = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint({ x, y });
    const { width, height } = currentDisplay.workAreaSize;

    return { width, height };
  }

  private _constructEntryURL(url: string) {
    // Is absolute path
    if (path.isAbsolute(url)) {
      return url;
    }

    if (app.isPackaged) {
      return join(__dirname, url);
    } else if (process.env.NODE_ENV === "test") {
      return join(__dirname, url);
    } else {
      return posix.join(process.env.VITE_DEV_SERVER_URL as string, url);
    }
  }

  private _setNonMacSpecificStyles(win: BrowserWindow) {
    if (os.platform() !== "darwin") {
      win.webContents.insertCSS(`
  
  
  /* Track */
  ::-webkit-scrollbar-track {
    background: var(--q-bg-secondary);
    border-radius: 2px;
  }
  /* Handle */
  ::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 2px;
  }
  /* Handle on hover */
  ::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
  ::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }
  
  ::-webkit-scrollbar-corner {
    background: transparent;
    width: 0 !important;
    height: 0 !important;
  }
  
  .sidebar-windows-bg {
    background-color: #efefef;
  }
  
  .splitpanes__splitter {
    background-color: #efefef;
  }
  
  @media (prefers-color-scheme: dark) {
    .sidebar-windows-bg {
      background-color: rgb(50, 50, 50);
    }
    .splitpanes__splitter {
      background-color: rgb(50, 50, 50);
    }
    .plugin-windows-bg {
      background-color: rgb(50, 50, 50);
    }
  }
  
  `);
    }
  }

  /**
   * Check if the window exists with the given id.
   * @param windowId - The id of the window to be checked
   * @returns Whether the window exists.
   */
  exist(windowId: string): boolean {
    return this.browserWindows.has(windowId);
  }

  /**
   * Focus the window with the given id.
   * @param windowId - The id of the window to be focused
   */
  focus(windowId: string): void {
    if (this.exist(windowId)) {
      this.browserWindows.get(windowId).focus();
    }
  }

  /**
   * Blur the window with the given id.
   * @param windowId - The id of the window to be blurred
   */
  blur(windowId: string): void {
    if (this.exist(windowId)) {
      this.browserWindows.get(windowId).blur();
    }
  }
}