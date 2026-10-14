import { describe, expect, it, vi } from "vitest";
import { renameWithRetry } from "../src/policy-store.js";

const err = (code: string) => Object.assign(new Error(code), { code });
const wait = async () => {};

describe("renameWithRetry", () => {
  it("réessaie 3 fois sous win32 puis réussit", async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(err("EPERM"))
      .mockRejectedValueOnce(err("EBUSY"))
      .mockRejectedValueOnce(err("EACCES"))
      .mockResolvedValueOnce(undefined);
    await renameWithRetry("a", "b", { platform: "win32", rename, wait });
    expect(rename).toHaveBeenCalledTimes(4);
  });

  it("échoue après 3 réessais", async () => {
    const rename = vi.fn().mockRejectedValue(err("EPERM"));
    await expect(
      renameWithRetry("a", "b", { platform: "win32", rename, wait }),
    ).rejects.toMatchObject({
      code: "EPERM",
    });
    expect(rename).toHaveBeenCalledTimes(4);
  });

  it("ne réessaie pas une autre erreur, ni hors win32", async () => {
    const other = vi.fn().mockRejectedValue(err("ENOSPC"));
    await expect(
      renameWithRetry("a", "b", { platform: "win32", rename: other, wait }),
    ).rejects.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
    const posix = vi.fn().mockRejectedValue(err("EPERM"));
    await expect(
      renameWithRetry("a", "b", { platform: "linux", rename: posix, wait }),
    ).rejects.toThrow();
    expect(posix).toHaveBeenCalledTimes(1);
  });
});
