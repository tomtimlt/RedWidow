/**
 * Neutralise les séquences de contrôle d'un texte non fiable avant de l'AFFICHER (sortie d'un
 * conteneur, argv d'une demande d'approbation) : sinon `\x1b[2K`, `\r` ou un OSC peuvent effacer
 * ou réécrire la question d'approbation voisine. Le texte renvoyé au modèle reste brut.
 * Retire : OSC/DCS/APC/PM/SOS (jusqu'à BEL ou ST), CSI, autres ESC, C0 sauf `\n` et `\t` (donc `\r`),
 * DEL, C1, marques et contrôles bidirectionnels.
 */
const CONTROL = new RegExp(
  [
    "\\u001b[\\]PX^_][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?", // OSC, DCS, SOS, PM, APC
    "\\u001b\\[[0-?]*[ -/]*[@-~]?", // CSI
    "\\u001b[ -/]*[0-~]?", // autres séquences ESC
    "[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]", // C0 (sauf \t \n), DEL, C1
    "[\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", // bidi
  ].join("|"),
  "g",
);

export function stripControl(text: string): string {
  return text.replace(CONTROL, "");
}
