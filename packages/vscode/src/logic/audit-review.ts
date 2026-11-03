import { type AuditReview, type AuditStore, auditReviewSchema } from "@warband/core";

/** Les références viennent du registre de l’hôte, jamais d’un champ libre de la webview. */
export async function reviewAuditTest(options: {
  store: AuditStore;
  projectId: string;
  testId: string;
  claim: AuditReview;
  isCurrent(): Promise<void>;
}): Promise<void> {
  const claim = auditReviewSchema.parse(options.claim);
  await options.isCurrent();
  const view = await options.store.view(options.projectId);
  const test = view.tests.find((t) => t.id === options.testId);
  if (!test) throw Error("Audit test is unavailable; refresh the registry");
  await options.isCurrent();
  await options.store.append(
    options.projectId,
    {
      actor: "operator",
      kind: "test.review",
      data: { testId: test.id, claim: { ...claim, evidenceIds: test.evidenceIds } },
    },
    true,
  );
}
