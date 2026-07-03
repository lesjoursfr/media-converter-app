declare module "electron" {
  export const app: {
    getAppPath(): string;
    on(event: string, listener: () => void): void;
    quit(): void;
    whenReady(): Promise<void>;
  };

  export class BrowserWindow {
    constructor(options: unknown);
    static getAllWindows(): Array<BrowserWindow>;
    loadFile(filePath: string): Promise<void>;
    webContents: {
      send(channel: string, payload: unknown): void;
    };
  }

  export const dialog: {
    showOpenDialog(
      browserWindow: BrowserWindow,
      options: {
        filters?: Array<{ extensions: Array<string>; name: string }>;
        properties?: Array<string>;
      }
    ): Promise<{ canceled: boolean; filePaths: Array<string> }>;
  };

  export const ipcMain: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle(channel: string, listener: (event: unknown, ...args: Array<any>) => unknown): void;
  };

  export const ipcRenderer: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoke(channel: string, ...args: Array<any>): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(channel: string, listener: (event: unknown, payload: any) => void): void;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}

declare module "node:child_process" {
  export type ChildProcessWithoutNullStreams = {
    currentProcess?: unknown;
    kill(signal?: string): boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: Array<any>) => void): void;
    stderr: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
    stdout: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
  };

  export function spawn(
    command: string,
    args?: Array<string>,
    options?: {
      stdio?: Array<string>;
    }
  ): ChildProcessWithoutNullStreams;
}

declare module "node:path" {
  export function join(...paths: Array<string>): string;
}

declare const process: {
  cwd(): string;
  platform: string;
};
