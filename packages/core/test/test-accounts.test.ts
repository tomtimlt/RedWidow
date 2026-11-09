import { describe, expect, it } from "vitest";
import { createRecorder } from "../src/recorder.js";
import { createTestAccounts } from "../src/test-accounts.js";

const makeAccounts = () =>
  createTestAccounts([
    { label: "A", host: "", identifier: "alice@example.com", secret: "xy", kind: "password" },
    {
      label: "B",
      host: "",
      identifier: "bob@example.com",
      secret: "other-secret",
      kind: "password",
    },
  ]);

describe("comptes de test", () => {
  it("substitue les champs HTTP et les arguments sans contrainte d’hôte", () => {
    const accounts = makeAccounts();
    expect(
      accounts.prepareHttp({
        url: "http://example.com/login",
        headers: { Authorization: "{{compte:A:secret}}" },
        body: "{{compte:A:identifiant}}",
      }),
    ).toMatchObject({ headers: { Authorization: "xy" }, body: "alice@example.com" });
    expect(accounts.substitute({ argv: ["curl", "{{compte:B:secret}}"] })).toEqual({
      argv: ["curl", "other-secret"],
    });
    expect(accounts.environment().RW_COMPTE_A_SECRET).toBe("xy");
  });
  it("isole les sessions et respecte les domaines et chemins des cookies", () => {
    const accounts = makeAccounts();
    accounts.receiveCookies("A", "https://example.com/login", [
      "sid=valeur-session; Path=/; Secure",
      "sub=autre; Path=/private",
    ]);
    expect(
      accounts.prepareHttp({ url: "https://example.com/private/page", session: "A" }).headers
        ?.Cookie,
    ).toContain("sid=valeur-session");
    expect(
      accounts.prepareHttp({ url: "https://example.com/private/page", session: "A" }).headers
        ?.Cookie,
    ).toContain("sub=autre");
    expect(
      accounts.prepareHttp({ url: "http://example.com/", session: "A" }).headers?.Cookie,
    ).toBeUndefined();
    expect(
      accounts.prepareHttp({ url: "https://elsewhere.example/", session: "A" }).headers?.Cookie,
    ).toBeUndefined();
    expect(
      accounts.prepareHttp({ url: "https://example.com/", session: "B" }).headers?.Cookie,
    ).toBeUndefined();
  });
  it("masque les valeurs courtes avant le sink et préserve le type des événements", () => {
    const accounts = makeAccounts();
    accounts.receiveCookies("A", "https://example.com/", ["sid=valeur-session; Max-Age=0"]);
    const recorder = createRecorder({ redact: accounts.redact });
    const rows: unknown[] = [];
    recorder.subscribe((event) => rows.push(event));
    recorder.emit({ kind: "user.message", text: "alice@example.com xy valeur-session" });
    expect(JSON.stringify(rows)).not.toContain("alice@example.com");
    expect(JSON.stringify(rows)).not.toContain("xy");
    expect(JSON.stringify(rows)).not.toContain("valeur-session");
    expect(rows[0]).toMatchObject({ kind: "user.message" });
    const payload = accounts.redact({
      kind: "tool.requested",
      input: { id: "xy", accountId: "xy", code: "xy", list: [{ id: "xy" }] },
      reason: { code: "account.invalid", params: { id: "xy" } },
    });
    expect(JSON.stringify(payload)).not.toContain('"xy"');
    expect(payload.kind).toBe("tool.requested");
    expect(payload.reason.code).toBe("account.invalid");
  });
});
