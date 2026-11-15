import type { EngagementSheet } from "../engagement/sheet.js";
import type { EngagementStatus } from "../engagement/store.js";
import { hostInLists, hostOfTarget } from "./scope.js";
import type { ProgramSheet } from "./sheet.js";
import type { ProgramStatus } from "./store.js";

/** Listes de périmètre d'une fiche (programme ou engagement). */
export type ScopeLists = Pick<ProgramSheet | EngagementSheet, "inScope" | "outOfScope">;

/**
 * Fiches de périmètre **approuvées** (programme, engagement). Une fiche absente, non approuvée ou
 * dont la lecture échoue est ignorée : sans fiche approuvée, aucune vérification (ADR 0055).
 */
export function approvedScopeSheets(
  program?: () => ProgramStatus,
  engagement?: () => EngagementStatus,
): ScopeLists[] {
  const sheets: ScopeLists[] = [];
  try {
    const status = program?.();
    if (status?.state === "approved" && status.applied) sheets.push(status.applied);
  } catch {
    // Fiche illisible : traitée comme absente.
  }
  try {
    const status = engagement?.();
    if (status?.state === "approved" && status.applied) sheets.push(status.applied);
  } catch {
    // Fiche illisible : traitée comme absente.
  }
  return sheets;
}

/**
 * Vrai si l'hôte de la cible est dans le périmètre de **chaque** fiche (exclusion prioritaire,
 * règles de `scope.ts`). Une cible illisible est hors périmètre.
 */
export function targetInScope(sheets: readonly ScopeLists[], target: string): boolean {
  const host = hostOfTarget(target);
  if (host === null) return false;
  return sheets.every((s) => hostInLists(s.inScope.value, s.outOfScope.value, host));
}

/** Contrôle de cible pour les fiches approuvées, ou `undefined` s'il n'y en a pas. */
export function scopeChecker(
  sheets: readonly ScopeLists[],
): ((target: string) => boolean) | undefined {
  return sheets.length === 0 ? undefined : (target) => targetInScope(sheets, target);
}
