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
  it("ne masque ni les petites valeurs ni leurs variantes encodées", () => {
    const accounts = createTestAccounts([
      { label: "A", host: "", identifier: "admin", secret: "a1", kind: "password" },
    ]);
    const text = "administrator panel a1b2";
    expect(accounts.redact(text)).toBe(text);
    for (const value of ["admin", "a1", "admin:a1"])
      for (const variant of [
        value,
        encodeURIComponent(value),
        Buffer.from(value).toString("base64"),
      ])
        expect(accounts.redact(variant)).toBe(variant);
  });
  it.each(["a+b", "ééé"])("ne protège pas une valeur courte après encodage : %s", (secret) => {
    const accounts = createTestAccounts([
      { label: "A", host: "", identifier: "admin", secret, kind: "password" },
    ]);
    expect(accounts.redact(encodeURIComponent(secret))).toBe(encodeURIComponent(secret));
    expect(accounts.redact(Buffer.from(secret).toString("base64"))).toBe(
      Buffer.from(secret).toString("base64"),
    );
  });
  it("masque dès six caractères, en clair, en base64 et dans une URL", () => {
    const identifier = "admin+";
    const secret = "a1/b2?";
    const accounts = createTestAccounts([
      { label: "A", host: "", identifier, secret, kind: "password" },
    ]);
    for (const value of [identifier, secret]) {
      for (const variant of [
        value,
        encodeURIComponent(value),
        new URLSearchParams({ v: value }).toString().slice(2),
        Buffer.from(value).toString("base64"),
      ]) {
        expect(accounts.redact(`texte ${variant} fin`)).toBe("texte [REDACTED] fin");
      }
    }
  });

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
  it("masque les valeurs admissibles avant le sink et préserve le type des événements", () => {
    const accounts = createTestAccounts([
      { label: "A", host: "", identifier: "alice@example.com", secret: "xy1234", kind: "password" },
    ]);
    accounts.receiveCookies("A", "https://example.com/", ["sid=valeur-session; Max-Age=0"]);
    const recorder = createRecorder({ redact: accounts.redact });
    const rows: unknown[] = [];
    recorder.subscribe((event) => rows.push(event));
    recorder.emit({ kind: "user.message", text: "alice@example.com xy1234 valeur-session" });
    expect(JSON.stringify(rows)).not.toContain("alice@example.com");
    expect(JSON.stringify(rows)).not.toContain("xy1234");
    expect(JSON.stringify(rows)).not.toContain("valeur-session");
    expect(rows[0]).toMatchObject({ kind: "user.message" });
    const payload = accounts.redact({
      kind: "tool.requested",
      input: { id: "xy1234", accountId: "xy1234", code: "xy1234", list: [{ id: "xy1234" }] },
      reason: { code: "account.invalid", params: { id: "xy1234" } },
    });
    expect(JSON.stringify(payload)).not.toContain('"xy1234"');
    expect(payload.kind).toBe("tool.requested");
    expect(payload.reason.code).toBe("account.invalid");
  });
});
