/** Cache de présentation : aucun appel d'action ne doit utiliser ces données. */
export function createStudioDockerCache<T>(
  load: (project: string | null) => Promise<T>,
  now = Date.now,
) {
  let key: string | null = null;
  let generation = 0;
  let value: T | undefined;
  let lastStarted = Number.NEGATIVE_INFINITY;
  let pending = false;
  let failed = false;
  let currentProject: string | null = null;

  const select = (project: string | null, projectGeneration: number) => {
    const next = JSON.stringify([project, projectGeneration]);
    if (next !== key) {
      key = next;
      currentProject = project;
      generation++;
      value = undefined;
      lastStarted = Number.NEGATIVE_INFINITY;
      pending = false;
      failed = false;
    }
  };
  const cache = {
    select,
    snapshot: () => ({ value, pending, failed }),
    refresh(onComplete: () => void) {
      if (pending || now() - lastStarted < 10_000) return false;
      pending = true;
      failed = false;
      lastStarted = now();
      const requested = generation;
      const project = currentProject;
      void Promise.resolve()
        .then(() => load(project))
        .then((next) => {
          if (generation === requested) value = next;
        })
        .catch(() => {
          if (generation === requested) {
            value = undefined;
            failed = true;
          }
        })
        .finally(() => {
          if (generation !== requested) return;
          pending = false;
          onComplete();
        });
      return true;
    },
  };
  return {
    ...cache,
    async present(
      project: string | null,
      projectGeneration: number,
      refresh: boolean,
      send: (snapshot: ReturnType<typeof cache.snapshot>) => Promise<boolean>,
      onComplete: () => void,
    ) {
      select(project, projectGeneration);
      const requested = generation;
      const sent = await send(cache.snapshot());
      if (sent && generation === requested && refresh && cache.refresh(onComplete)) onComplete();
    },
  };
}
