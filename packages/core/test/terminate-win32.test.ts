import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  killAllGroups,
  killOwnTree,
  terminateProcessTree,
  trackProcessTree,
} from "../src/process/terminate.js";

describe("killOwnTree", () => {
  it("Windows : taskkill /T /F sur son propre PID", () => {
    const launch = vi.fn(() => true);
    killOwnTree({ platform: "win32", taskkillSync: launch });
    expect(launch).toHaveBeenCalledOnce();
    expect((launch.mock.calls[0] as unknown[])[1]).toEqual([
      "/PID",
      String(process.pid),
      "/T",
      "/F",
    ]);
  });

  it("POSIX : SIGKILL au groupe, sans exception si on n'en est pas le chef", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    try {
      expect(() => killOwnTree({ platform: "linux" })).not.toThrow();
      expect(kill).toHaveBeenCalledWith(-process.pid, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });
});

/** Faux enfant : émetteur avec pid, codes de sortie, tubes et `kill` espionné. */
function fakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: string | null;
    stdout: { destroyed: boolean; destroy: () => void };
    stderr: { destroyed: boolean; destroy: () => void };
    kill: ReturnType<typeof vi.fn>;
  };
  const pipe = () => {
    const p = {
      destroyed: false,
      destroy: () => {
        p.destroyed = true;
      },
    };
    return p;
  };
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = pipe();
  child.stderr = pipe();
  child.kill = vi.fn();
  const close = () => {
    child.exitCode = 0;
    child.stdout.destroyed = true;
    child.stderr.destroyed = true;
    child.emit("close", 0, null);
  };
  return { child, asChild: child as unknown as ChildProcess, close };
}

const env = { SystemRoot: "D:\\WinX", ANTHROPIC_API_KEY: "secret", PATH: "C:\\bin" };

describe("terminateProcessTree sous win32", () => {
  it("lance taskkill avec chemin absolu, sans shell, env sûr, forced=true", async () => {
    const { child, asChild, close } = fakeChild();
    const taskkill = vi.fn(async () => {
      close();
      return true;
    });
    const res = await terminateProcessTree(asChild, {
      platform: "win32",
      taskkill,
      env,
      graceMs: 99999,
    });
    expect(res).toEqual({ forced: true });
    expect(taskkill).toHaveBeenCalledTimes(1);
    const [file, args, opts] = taskkill.mock.calls[0] as unknown as [
      string,
      string[],
      { shell: boolean; windowsHide: boolean; timeout: number; env: NodeJS.ProcessEnv },
    ];
    expect(file).toBe("D:\\WinX\\System32\\taskkill.exe");
    expect(args).toEqual(["/PID", "4242", "/T", "/F"]);
    expect(opts.shell).toBe(false);
    expect(opts.windowsHide).toBe(true);
    expect(opts.timeout).toBe(5000);
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(opts.env.SystemRoot).toBe("D:\\WinX");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("replie sur C:\\Windows sans SystemRoot", async () => {
    const { asChild, close } = fakeChild();
    const taskkill = vi.fn(async () => {
      close();
      return true;
    });
    await terminateProcessTree(asChild, { platform: "win32", taskkill, env: {} });
    expect((taskkill.mock.calls[0] as unknown[])[0]).toBe("C:\\Windows\\System32\\taskkill.exe");
  });

  it.each([
    ["échec", async () => false],
    [
      "rejet",
      async () => {
        throw new Error("ENOENT");
      },
    ],
  ])("replie sur child.kill() si taskkill : %s", async (_n, impl) => {
    const { child, asChild, close } = fakeChild();
    child.kill.mockImplementation(() => close());
    const res = await terminateProcessTree(asChild, {
      platform: "win32",
      taskkill: impl as never,
      env,
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(res.forced).toBe(true);
  });

  it("ne lance rien si l'enfant est déjà fermé", async () => {
    const { asChild, close } = fakeChild();
    close();
    const taskkill = vi.fn(async () => true);
    const res = await terminateProcessTree(asChild, { platform: "win32", taskkill, env });
    expect(res).toEqual({ forced: false });
    expect(taskkill).not.toHaveBeenCalled();
  });

  it("n'appelle pas child.kill() si l'enfant se ferme pendant taskkill", async () => {
    const { child, asChild, close } = fakeChild();
    const taskkill = vi.fn(async () => {
      close();
      return false;
    });
    await terminateProcessTree(asChild, { platform: "win32", taskkill, env });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("détruit les tubes après killWaitMs si l'enfant ne se ferme pas", async () => {
    const { child, asChild } = fakeChild();
    const res = await terminateProcessTree(asChild, {
      platform: "win32",
      taskkill: async () => true,
      env,
      killWaitMs: 10,
    });
    expect(res.forced).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });
});

describe("trackProcessTree sous win32 : filet de sortie", () => {
  it("appelle taskkill en synchrone pour chaque arbre vivant", () => {
    const a = fakeChild(111);
    const b = fakeChild(222);
    const taskkillSync = vi.fn(() => true);
    trackProcessTree(a.asChild, { platform: "win32", env, taskkillSync });
    trackProcessTree(b.asChild, { platform: "win32", env, taskkillSync });
    killAllGroups();
    expect(taskkillSync).toHaveBeenCalledTimes(2);
    const [file, args, opts] = taskkillSync.mock.calls[0] as unknown as [
      string,
      string[],
      { shell: boolean; windowsHide: boolean; timeout: number; env: NodeJS.ProcessEnv },
    ];
    expect(file).toBe("D:\\WinX\\System32\\taskkill.exe");
    expect(args).toEqual(["/PID", "111", "/T", "/F"]);
    expect(opts).toMatchObject({ shell: false, windowsHide: true, timeout: 2000 });
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect((taskkillSync.mock.calls[1] as unknown[])[1]).toEqual(["/PID", "222", "/T", "/F"]);
  });

  it("ne lance rien pour un enfant fermé (retiré à close)", () => {
    const a = fakeChild(333);
    const taskkillSync = vi.fn(() => true);
    trackProcessTree(a.asChild, { platform: "win32", env, taskkillSync });
    a.close();
    killAllGroups();
    expect(taskkillSync).not.toHaveBeenCalled();
  });
});
