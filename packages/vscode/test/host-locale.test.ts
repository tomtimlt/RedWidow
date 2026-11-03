import { readFileSync } from "node:fs";
import { getUiLocale, setUiLocale, t } from "@warband/messages";
import { afterEach, describe, expect, it } from "vitest";
import { parseStudioMessage, studioLabel } from "../src/logic/studio.js";

const readJson = (file: string) =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

afterEach(() => setUiLocale("fr"));

describe("langue des réglages transmise à l’hôte", () => {
  it.each(["fr", "en"])("accepte uniquement le message %s exact", (locale) => {
    expect(parseStudioMessage({ type: "setLocale", locale })).toEqual({
      type: "setLocale",
      locale,
    });
    expect(parseStudioMessage({ type: "setLocale", locale, path: "/tmp" })).toBeNull();
    expect(parseStudioMessage({ type: "setLocale", locale, enabled: true })).toBeNull();
  });

  it.each(["EN", "en-US", "", "es", null, false, {}, ["en"], undefined])(
    "rejette une valeur de langue non canonique : %j",
    (locale) => {
      expect(parseStudioMessage({ type: "setLocale", locale })).toBeNull();
    },
  );

  it("relit les libellés produit à l’émission et conserve les valeurs interpolées", () => {
    const container = "projet-français {0} <unsafe>";
    expect(getUiLocale()).toBe("fr");
    expect(studioLabel("appearance")).toBe("Apparence");
    setUiLocale("en");
    expect(studioLabel("appearance")).toBe("Appearance");
    expect(t`Le conteneur ${container} est arrêté.`).toBe(`Container ${container} is stopped.`);
    expect(t`${"Venator Ops"} · Réglages`).toBe("Venator Ops · Settings");
    setUiLocale("fr");
    expect(studioLabel("appearance")).toBe("Apparence");
  });
});

describe("localisation native VS Code", () => {
  const manifest = readJson("extension.manifest.json");
  const fr = readJson("package.nls.fr.json");
  const defaultEn = readJson("package.nls.json");
  const en = readJson("package.nls.en.json");

  it("dispose des mêmes clés et d’un anglais par défaut complet", () => {
    expect(defaultEn).toEqual(en);
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    const references = JSON.stringify(manifest).matchAll(/%([^%]+)%/g);
    const keys = [...references].flatMap((match) => (match[1] ? [match[1]] : []));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(fr[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
      expect(typeof fr[key], key).toBe("string");
      expect(typeof en[key], key).toBe("string");
    }
  });

  it("propose fr/en avec une préférence application indépendante de la langue native", () => {
    const language = manifest.contributes.configuration.properties["warband.language"];
    expect(language.enum).toEqual(["fr", "en"]);
    expect(language.default).toBe("en");
    expect(language.scope).toBe("application");
    expect(en[language.description.slice(1, -1)]).toContain("VS Code language");
  });
});
