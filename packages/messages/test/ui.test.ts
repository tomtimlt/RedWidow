import { afterEach, expect, it } from "vitest";
import { createUiTranslator, getUiLocale, setUiLocale, t, UI_EN, uiText } from "../src/ui.js";

afterEach(() => setUiLocale("fr"));

it("bascule de façon réversible sans traduire les valeurs interpolées", () => {
  const key = Object.keys(UI_EN).find((key) => key.includes("{0}"));
  if (!key) throw new Error("Aucun modèle de message");
  const value = "<script>Privé ${x} & {0}</script> Échec";
  const fr = uiText("fr", key, { "0": value });
  const en = uiText("en", key, { "0": value });
  expect(fr).toContain(value);
  expect(en).toContain(value);
  setUiLocale("en");
  expect(t(key, { "0": value })).toBe(en);
  setUiLocale("fr");
  expect(t(key, { "0": value })).toBe(fr);
  expect(getUiLocale()).toBe("fr");
});

it("les templates assemblent les valeurs sans les interpréter comme des clés", () => {
  const translate = createUiTranslator(() => "en");
  const user = "Échec {2}";
  expect(translate`Donnée inconnue ${user}`).toBe(`Donnée inconnue ${user}`);
  expect(t("texte inconnu")).toBe("texte inconnu");
  setUiLocale("invalid");
  expect(getUiLocale()).toBe("fr");
});

it("les traductions conservent les paramètres des messages", () => {
  const slots = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
  for (const [key, value] of Object.entries(UI_EN)) {
    expect(typeof value).toBe("string");
    expect(value.length, key).toBeGreaterThan(0);
    expect(slots(value), key).toEqual(slots(key));
  }
});
