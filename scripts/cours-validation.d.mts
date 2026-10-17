export interface EntreeCours {
  nom: string;
  url: string;
  ref: string;
  licence: string;
  sousDossier?: string;
}
export function validerEntree(entree: unknown): string[];
export function validerManifeste(manifeste: unknown): EntreeCours[];
