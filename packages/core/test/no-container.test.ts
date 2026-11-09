import { expect, it } from "vitest";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";

it("signale une mission offensive sans conteneur sans modifier une autorisation", () => {
  const recorder = createRecorder();
  const kinds: string[] = [];
  recorder.subscribe((event) => kinds.push(event.kind));
  const desk = createMissionDesk({ recorder, mission: { profile: "bug-bounty", containers: [] } });
  desk.beginTurn("mission autorisée");
  desk.beginTurn("suite");
  expect(kinds.filter((kind) => kind === "mission.noContainer")).toHaveLength(1);
  expect(desk.context().guidance.join("\n")).toContain("Demander une fois");
  expect(desk.context().guidance.join("\n")).toContain("continuer avec http_request");
  expect(desk.context().guidance.join("\n")).toMatch(/Pas de conteneur.*shell indisponibles/);
  desk.dispose();
});
it("ne signale pas une mission équipée ni un profil pédagogique", () => {
  for (const mission of [
    { profile: "bug-bounty", containers: ["lab"] },
    { profile: "mentor", containers: [] },
  ]) {
    const recorder = createRecorder();
    const kinds: string[] = [];
    recorder.subscribe((event) => kinds.push(event.kind));
    const desk = createMissionDesk({ recorder, mission });
    desk.beginTurn("essai");
    expect(kinds).not.toContain("mission.noContainer");
    desk.dispose();
  }
});
