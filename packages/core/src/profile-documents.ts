import { type AgentProfile, DEFAULT_AGENT_PROFILE, isAgentProfile } from "./agent-profiles.js";
import type { PolicyContext } from "./approval/policy.js";
import { KALI_OPERATIONAL_TOOLS } from "./kali/tool-specs.js";
import { HTTP_REQUEST_TOOL, isProgramShellTool } from "./program/scope.js";
import { type Reason, reason } from "./reason.js";

export type ProfileDocument = "program" | "engagement" | "campaign";

/** Contrat documentaire du profil, sans effet sur les permissions. */
export function profileDocuments(
  profile: AgentProfile = DEFAULT_AGENT_PROFILE,
): readonly ProfileDocument[] {
  if (profile === "bug-bounty") return ["program"];
  if (profile === "red-team") return ["engagement", "campaign"];
  return [];
}

/** Les lectures documentaires et outils de préparation restent utilisables avant validation. */
export function missingProfileDocument(tool: string, ctx: PolicyContext): Reason | null {
  const operational =
    tool === HTTP_REQUEST_TOOL || isProgramShellTool(tool) || KALI_OPERATIONAL_TOOLS.has(tool);
  if (!operational) return null;
  const profile = isAgentProfile(ctx.profile) ? ctx.profile : DEFAULT_AGENT_PROFILE;
  for (const document of profileDocuments(profile)) {
    let approved = false;
    try {
      if (document === "program") {
        const status = ctx.program?.();
        approved = status?.state === "approved" && status.applied !== undefined;
      } else if (document === "engagement") {
        const status = ctx.engagement?.().status;
        approved = status?.state === "approved" && status.applied !== undefined;
      } else {
        const overview = ctx.campaign?.();
        approved =
          overview?.state === "approved" && overview.plan !== null && overview.plan !== undefined;
      }
    } catch {
      /* Une lecture incertaine n’est jamais une validation. */
    }
    if (!approved)
      return reason(
        document === "program"
          ? "program.required"
          : document === "engagement"
            ? "engagement.required"
            : "campaign.notApproved",
      );
  }
  return null;
}
