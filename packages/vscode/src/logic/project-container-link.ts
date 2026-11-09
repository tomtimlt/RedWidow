import {
  activeProject,
  CodedError,
  lookupContainer,
  type ProjectFile,
  parseMentions,
  promptForTargets,
  type StoredProject,
} from "@warband/core";

/** Une mention propose une liaison humaine ; elle ne donne jamais une permission. */
export function unlinkedContainerMentions(
  text: string,
  rows: readonly { name: string }[],
  allowed: readonly string[],
): string[] {
  return [
    ...new Set(
      parseMentions(promptForTargets(text)).flatMap((token) => {
        const name = lookupContainer(token, rows);
        return name && !allowed.includes(name) ? [name] : [];
      }),
    ),
  ];
}

/** Parcours partagé par le cockpit et la carte du chat : montage vérifié avant liaison. */
export async function linkWithProjectWorkspace<T>(
  name: string,
  deps: {
    expectedProjectId?: string;
    read(): Promise<ProjectFile | null>;
    prepare(project: StoredProject, name: string): Promise<unknown>;
    prepareRuntime(name: string): Promise<void>;
    link(name: string, projectId: string): Promise<T>;
  },
): Promise<T> {
  const file = await deps.read();
  const before = file && activeProject(file);
  if (!before || (deps.expectedProjectId !== undefined && before.id !== deps.expectedProjectId))
    throw new CodedError("project.absent");
  await deps.prepare({ ...before, containers: [...new Set([...before.containers, name])] }, name);
  await deps.prepareRuntime(name);
  if ((await deps.read())?.activeId !== before.id) throw new CodedError("project.absent");
  const result = await deps.link(name, before.id);
  const afterFile = await deps.read();
  const after = afterFile && activeProject(afterFile);
  if (!after || after.id !== before.id) throw new CodedError("project.absent");
  await deps.prepare(after, name);
  return result;
}
