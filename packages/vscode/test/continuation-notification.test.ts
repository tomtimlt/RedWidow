import type { EngineEvent } from "@warband/core";
import { setUiLocale } from "@warband/messages";
import { describe, expect, it, vi } from "vitest";
import { notifyWaitingHuman } from "../src/logic/continuation-notification.js";

const meta = { v: 1, id: "e", seq: 1, ts: "2026-01-01T00:00:00Z", runId: "r", parentId: null };

describe("notification de continuation", () => {
  it.each([
    ["fr", "RedWidow attend une action de votre part : compte requis", "Ouvrir le chat"],
    ["en", "RedWidow is waiting for you to act: compte requis", "Open chat"],
  ] as const)("ouvre le chat en %s", async (locale, message, action) => {
    setUiLocale(locale);
    const show = vi.fn().mockResolvedValue(action);
    const reveal = vi.fn().mockResolvedValue(undefined);
    const event = {
      ...meta,
      kind: "continuation.waitingHuman",
      openLeads: 1,
      reasons: ["compte requis"],
    } as EngineEvent;
    await notifyWaitingHuman(event, show, reveal);
    expect(show).toHaveBeenCalledWith(message, action);
    expect(reveal).toHaveBeenCalledOnce();
    setUiLocale("fr");
  });
  it("ne révèle pas le chat si le bouton est ignoré", async () => {
    const reveal = vi.fn().mockResolvedValue(undefined);
    await notifyWaitingHuman(
      { ...meta, kind: "continuation.waitingHuman", openLeads: 1, reasons: [] } as EngineEvent,
      async () => undefined,
      reveal,
    );
    expect(reveal).not.toHaveBeenCalled();
  });
});
