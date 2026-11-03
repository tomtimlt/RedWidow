/** Un registre ancien peut ignorer un réglage ajouté par la mise à jour de l’extension. */
export async function saveMachinePreference<T>(
  value: T,
  deps: {
    registered: boolean;
    update(value: T): PromiseLike<void>;
    fallback(value: T | undefined): PromiseLike<void>;
  },
): Promise<void> {
  if (deps.registered) {
    try {
      await deps.update(value);
      await deps.fallback(undefined);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !/not a registered configuration/i.test(error.message))
        throw error;
    }
  }
  await deps.fallback(value);
}
