/** Le terminal manuel reste accessible si le partage du projet n'est pas vérifié. */
export async function prepareEditorShellWorkspace(
  prepare: (() => Promise<string>) | null,
  warn: (error: unknown) => void,
): Promise<string> {
  if (!prepare) return "/workspace";
  try {
    return await prepare();
  } catch (error) {
    warn(error);
    return "/workspace";
  }
}
