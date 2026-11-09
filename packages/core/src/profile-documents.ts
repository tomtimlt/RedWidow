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

/** Le plan est contrôlé par record_step ; la reconnaissance ne dépend que de l’engagement. */
export function missingProfileDocument(tool: string, ctx: PolicyContext): Reason | null {
  const operational =
    tool === HTTP_REQUEST_TOOL || isProgramShellTool(tool) || KALI_OPERATIONAL_TOOLS.has(tool);
  if (!operational) return null;
  const profile = isAgentProfile(ctx.profile) ? ctx.profile : DEFAULT_AGENT_PROFILE;
  for (const document of profileDocuments(profile)) {
    if (document === "campaign") continue;
    let approved = false;
    try {
      if (document === "program") {
        const status = ctx.program?.();
        approved = status?.state === "approved" && status.applied !== undefined;
      } else {
        const status = ctx.engagement?.().status;
        approved = status?.state === "approved" && status.applied !== undefined;
      }
    } catch {
      /* Une lecture incertaine n’est jamais une validation. */
    }
    if (!approved)
      return reason(document === "program" ? "program.required" : "engagement.required");
  }
  return null;
}
