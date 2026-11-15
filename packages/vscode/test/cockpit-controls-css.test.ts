import { expect, it } from "vitest";
import { readCssFile } from "./css.js";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

it("Bypass : pas de flèches sur les champs numériques", () => {
  const chat = strip(readCssFile("chat"));
  expect(chat).toContain("#bypass-pop input::-webkit-inner-spin-button");
  expect(chat).toMatch(/#bypass-pop input\s*\{[^}]*appearance:\s*textfield/);
});

it("cockpit : puces de projet et contrôle segmenté stylés", () => {
  const cockpit = strip(readCssFile("cockpit"));
  expect(cockpit).toMatch(/\.cockpit-project-link\s*\{/);
  expect(cockpit).toMatch(/\.cockpit-segment-opt\[aria-pressed="true"\]\s*\{/);
});
