import { expect, it, vi } from "vitest";
import { prepareEditorShellWorkspace } from "../src/logic/editor-shell-workspace.js";

it("conserve le terminal manuel en cas d’échec du partage et signale la cause", async () => {
  const warn = vi.fn();
  const cause = new Error("montage inaccessible");
  expect(await prepareEditorShellWorkspace(async () => "/redwidow/Workspace/p", warn)).toBe(
    "/redwidow/Workspace/p",
  );
  expect(
    await prepareEditorShellWorkspace(async () => {
      throw cause;
    }, warn),
  ).toBe("/workspace");
  expect(warn).toHaveBeenCalledWith(cause);
  expect(await prepareEditorShellWorkspace(null, warn)).toBe("/workspace");
  expect(warn).toHaveBeenCalledTimes(1);
});
