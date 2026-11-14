/**
 * Images de conteneurs installées depuis le web (ADR 0057) : Kali (`warband/kali:complete-1`, comme
 * l'extension) et Exegol (`nwodtuhs/exegol:<tag>`). Aucun terminal n'est nécessaire.
 *
 * - Kali : `ensureWarbandKaliImage` du cœur (pull de la base par l'API Engine avec progression par couches,
 *   puis `docker build` du Dockerfile du cœur, une seule source de vérité). L'image n'est reconstruite que
 *   si elle est absente (ou sur demande, quand aucun conteneur ne s'en sert).
 * - Exegol : pull Docker de `nwodtuhs/exegol:<tag>` par l'API Engine (même progression). Le contrat
 *   d'utilisation (EULA) est accepté par l'humain seulement (`exegolEula`), jamais implicitement ; sans lui, ni
 *   installation ni création d'Exegol.
 * - Une seule installation à la fois (`image.busy`), annulable (SIGTERM puis SIGKILL côté processus), plafonnée
 *   à 30 minutes. Aucun argument libre : étiquettes validées, arguments docker/exegol fixes. Les détails d'erreur
 *   sont masqués et bornés avant d'être diffusés.
 */
import { randomBytes } from "node:crypto";
import {
  CodedError,
  createRecorder,
  createRedactor,
  type DockerImageLayer,
  type DockerImageProgress,
  ensureWarbandKaliImage,
  errorInfo,
  pullDockerImage,
  resolveBinary,
  secretsFromEnv,
  WARBAND_KALI_IMAGE,
} from "@warband/core";
import { formatError, t } from "@warband/messages";
import type { DockerApi } from "../docker/api.js";
import type { ExegolPort } from "./cockpit.js";
import type { HostUi } from "./hostui.js";

/** Dépôt des images Exegol officielles et étiquettes proposées (liste fixe ; la saisie libre reste validée). */
export const EXEGOL_REPO = "nwodtuhs/exegol";
export const EXEGOL_TAGS = ["free", "full", "light", "web", "osint", "ad", "nightly"] as const;
export const DEFAULT_EXEGOL_TAG = "free";
export const EXEGOL_EULA_URL = "https://docs.exegol.com/legal/eula";
/** Étiquette Docker : minuscules, chiffres, `.`, `_`, `-` ; ni point ni tiret initial. */
export const EXEGOL_TAG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const isExegolTag = (v: unknown): v is string => typeof v === "string" && EXEGOL_TAG.test(v);

/** Plafond d'une installation (pull ou build), puis intervalle minimal entre deux diffusions. */
export const IMAGE_TIMEOUT_MS = 30 * 60_000;
export const PROGRESS_INTERVAL_MS = 120;
/** Plafond d'un détail d'erreur diffusé (caractères). */
const MAX_DETAIL = 400;

export interface ImagesStatus {
  docker: { present: boolean; daemon: boolean };
  kali: { image: string; installed: boolean; size?: number };
  exegol: {
    cli: boolean;
    eulaAccepted: boolean;
    installed: { tag: string; size?: number }[];
    available: string[];
  };
}

export type InstallRequest = { kind: "kali"; rebuild?: boolean } | { kind: "exegol"; tag: string };

/** Progression d'une installation, avant mise en forme (`operation` du cockpit, `imageProgress` du shell). */
export interface InstallProgress {
  phase: "pull" | "build";
  /** Texte d'étape, localisé. */
  stage: string;
  layers: DockerImageLayer[];
}

/** Message sortant `imageProgress` (diffusé à la coquille ; ne porte aucun secret ni chemin hôte). */
export interface ImageProgressMessage {
  type: "imageProgress";
  id: string;
  kind: "kali" | "exegol";
  phase: "pull" | "build" | "";
  stage: string;
  message?: string;
  layers: DockerImageLayer[];
  busy: boolean;
  done?: boolean;
  cancelled?: boolean;
  error?: string;
  code?: string;
}

/** Opérations Docker de bas niveau (injectables : tests). Les défauts s'appuient sur le cœur. */
export interface ImageOps {
  /** Le client `docker` est-il présent (nécessaire à la construction de Kali) ? */
  dockerPresent(): boolean;
  pull(
    image: string,
    o: { signal: AbortSignal; onProgress(p: DockerImageProgress): void },
  ): Promise<void>;
  /** Kali complet : pull de la base puis build, seulement si l'image est absente. */
  buildKali(o: { signal: AbortSignal; onProgress(p: DockerImageProgress): void }): Promise<void>;
}

/**
 * Opérations par défaut : API Engine du socket du serveur pour les pulls, CLI `docker` pour le build
 * (processus sous `safeEnv`, sans shell). `dockerBinary` : nom nu ou chemin absolu (tests).
 */
export function createImageOps(options: { socketPath: string; dockerBinary?: string }): ImageOps {
  const endpoint = `unix://${options.socketPath}`;
  const binary = options.dockerBinary ?? "docker";
  return {
    dockerPresent: () => resolveBinary(binary) !== null,
    async pull(image, o) {
      const recorder = createRecorder();
      try {
        await pullDockerImage(image, {
          recorder,
          signal: o.signal,
          endpoint,
          binary,
          onProgress: o.onProgress,
          inactivityTimeoutMs: 5 * 60_000,
        });
      } finally {
        recorder.close();
      }
    },
    async buildKali(o) {
      const recorder = createRecorder();
      try {
        await ensureWarbandKaliImage({
          recorder,
          signal: o.signal,
          endpoint,
          binary,
          onProgress: o.onProgress,
          inactivityTimeoutMs: 5 * 60_000,
        });
      } finally {
        recorder.close();
      }
    },
  };
}

export interface ImageHostOptions {
  docker: DockerApi;
  /** Image Kali du serveur (`REDWIDOW_KALI_IMAGE`, `warband/kali:complete-1` par défaut). */
  kaliImage: string;
  exegol: ExegolPort;
  ui: Pick<HostUi, "confirm" | "external">;
  ops: ImageOps;
  audit(entry: Record<string, unknown>): void;
  locale(): "fr" | "en";
  /** Valeurs secrètes du coffre, masquées dans tout détail d'erreur diffusé. */
  secretValues?(): Promise<string[]>;
}

interface Job {
  id: string;
  kind: "kali" | "exegol";
  abort: AbortController;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export class ImageHost {
  private job: Job | undefined;
  private readonly listeners = new Set<(m: ImageProgressMessage) => void>();
  private accepted = false;

  constructor(private readonly options: ImageHostOptions) {}

  /** Une installation est-elle en cours ? */
  get busy(): boolean {
    return this.job !== undefined;
  }

  /** Abonnement aux diffusions `imageProgress` (de toute installation, quelle que soit son origine). */
  listen(fn: (m: ImageProgressMessage) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private broadcast(m: ImageProgressMessage): void {
    for (const fn of this.listeners) fn(m);
  }

  // ------------------------------------------------------------------------------------------
  // État
  // ------------------------------------------------------------------------------------------

  /** Images locales d'après le démon : `null` si le démon est injoignable. */
  private async localImages(): Promise<{ tags: string[]; size?: number }[] | null> {
    try {
      const res = await this.options.docker.json("GET", "/images/json");
      if (res.status !== 200 || !Array.isArray(res.data)) return null;
      const out: { tags: string[]; size?: number }[] = [];
      for (const row of res.data) {
        if (!isRecord(row) || !Array.isArray(row.RepoTags)) continue;
        const tags = row.RepoTags.filter((x): x is string => typeof x === "string");
        out.push({ tags, ...(typeof row.Size === "number" && { size: row.Size }) });
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Contrat Exegol enregistré ? Une fois vrai, le reste (l'acceptation ne se révoque pas ici). */
  async eulaAccepted(signal?: AbortSignal): Promise<boolean> {
    if (this.accepted) return true;
    if (!this.options.exegol.installed()) return false;
    try {
      this.accepted = await this.options.exegol.eulaAccepted(
        signal ?? new AbortController().signal,
      );
    } catch {
      this.accepted = false;
    }
    return this.accepted;
  }

  async status(): Promise<ImagesStatus> {
    const [images, eula] = await Promise.all([this.localImages(), this.eulaAccepted()]);
    const kaliImage = this.options.kaliImage;
    const kali = images?.find((i) => i.tags.includes(kaliImage));
    const exegol = new Map<string, number | undefined>();
    for (const image of images ?? [])
      for (const ref of image.tags)
        if (ref.startsWith(`${EXEGOL_REPO}:`))
          exegol.set(ref.slice(EXEGOL_REPO.length + 1), image.size);
    return {
      docker: { present: this.options.ops.dockerPresent(), daemon: images !== null },
      kali: {
        image: kaliImage,
        installed: kali !== undefined,
        ...(kali?.size !== undefined && { size: kali.size }),
      },
      exegol: {
        cli: this.options.exegol.installed(),
        eulaAccepted: eula,
        installed: [...exegol]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tag, size]) => ({
            tag,
            ...(size !== undefined && { size }),
          })),
        available: [...EXEGOL_TAGS],
      },
    };
  }

  /** L'image Kali du serveur est-elle présente ? (`false` aussi si le démon ne répond pas.) */
  async kaliInstalled(): Promise<boolean> {
    return (await this.status()).kali.installed;
  }

  /** L'image Exegol `tag` est-elle présente ? `null` : démon injoignable (on ne sait pas). */
  async exegolInstalled(tag: string): Promise<boolean | null> {
    const images = await this.localImages();
    if (images === null) return null;
    return images.some((i) => i.tags.includes(`${EXEGOL_REPO}:${tag}`));
  }

  /**
   * Kali prêt à servir : installe l'image si elle est absente (progression comme `install`), sinon ne fait rien.
   * Démon injoignable : `docker.unavailable`. `true` si une installation a eu lieu.
   */
  async ensureKali(o: {
    signal: AbortSignal;
    onProgress?: (p: InstallProgress) => void;
  }): Promise<boolean> {
    const images = await this.localImages();
    if (images === null) throw new CodedError("docker.unavailable");
    if (images.some((i) => i.tags.includes(this.options.kaliImage))) return false;
    await this.install({ kind: "kali" }, o);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Contrat d'utilisation d'Exegol
  // ------------------------------------------------------------------------------------------

  /**
   * « Accepter le contrat » : l'humain lit (lien officiel, ouvert sur confirmation) puis confirme ; seulement
   * alors la CLI enregistre l'acceptation (`exegol version --accept-eula`). Pas de réponse humaine, refus :
   * aucune exécution, `false`. Déjà accepté : `true` sans dialogue.
   */
  async acceptEula(to?: Parameters<HostUi["confirm"]>[1]): Promise<boolean> {
    if (!this.options.exegol.installed()) throw new CodedError("exegol.notInstalled");
    if (await this.eulaAccepted()) return true;
    const { ui } = this.options;
    // L'ouverture du lien est facultative : le texte de la confirmation cite aussi l'adresse.
    await ui.external(
      { url: EXEGOL_EULA_URL, label: t("Lire le contrat d'utilisation d'Exegol") },
      to,
    );
    const yes = await ui.confirm(
      {
        title: t("Contrat d'utilisation d'Exegol"),
        text: t`Vous déclarez avoir lu et accepter le contrat d'utilisation d'Exegol (${EXEGOL_EULA_URL}). Votre acceptation est enregistrée dans la configuration d'Exegol de ce serveur ; sans elle, aucune image Exegol n'est installée ni aucun conteneur Exegol créé.`,
      },
      to,
    );
    if (!yes) return false;
    const code = await this.options.exegol
      .acceptEula(new AbortController().signal)
      .catch(() => null);
    this.accepted = false;
    if (code !== 0 || !(await this.eulaAccepted())) throw new CodedError("exegol.eulaFailed");
    this.options.audit({ kind: "exegolEula" });
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Installation
  // ------------------------------------------------------------------------------------------

  /**
   * Installation lancée depuis la coquille : retourne tout de suite l'identifiant (le travail se poursuit et
   * est diffusé en `imageProgress`). Occupé : `image.busy` ; étiquette invalide : `image.invalidTag`.
   */
  start(request: InstallRequest): string {
    this.validate(request);
    if (this.job) throw new CodedError("image.busy");
    const abort = new AbortController();
    const id = randomBytes(8).toString("hex");
    void this.install(request, { signal: abort.signal, id, abort }).catch(() => undefined);
    return id;
  }

  /** Annule l'installation `id` (ou, sans identifiant, celle en cours) ; `false` : rien à annuler. */
  cancel(id?: string): boolean {
    if (!this.job || (id !== undefined && this.job.id !== id)) return false;
    this.job.abort.abort();
    return true;
  }

  dispose(): void {
    this.job?.abort.abort();
    this.listeners.clear();
  }

  private validate(request: InstallRequest): void {
    if (request.kind === "exegol" && !isExegolTag(request.tag))
      throw new CodedError("image.invalidTag");
  }

  /**
   * Installe et attend la fin. `onProgress` reçoit la progression pour l'appelant direct (page cockpit :
   * message `operation`) ; la coquille la reçoit toujours par `listen`. Erreurs masquées, bornées, codées.
   */
  async install(
    request: InstallRequest,
    o: {
      signal: AbortSignal;
      onProgress?: (p: InstallProgress) => void;
      id?: string;
      abort?: AbortController;
    },
  ): Promise<void> {
    this.validate(request);
    if (this.job) throw new CodedError("image.busy");
    const id = o.id ?? randomBytes(8).toString("hex");
    const abort = o.abort ?? new AbortController();
    const job: Job = { id, kind: request.kind, abort };
    this.job = job;
    const stop = () => abort.abort();
    o.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, IMAGE_TIMEOUT_MS);
    timer.unref?.();
    const base = { type: "imageProgress" as const, id, kind: request.kind };
    let last = 0;
    let phase = "";
    let pending: InstallProgress | undefined;
    let flush: ReturnType<typeof setTimeout> | undefined;
    const send = (p: InstallProgress) => {
      last = Date.now();
      pending = undefined;
      o.onProgress?.(p);
      this.broadcast({ ...base, phase: p.phase, stage: p.stage, layers: p.layers, busy: true });
    };
    // Espacées : l'API Engine émet des centaines de lignes par seconde pendant un pull. Le dernier état reste
    // diffusé (minuterie de fin) ; un changement d'étape ou la fin d'une étape passe tout de suite.
    const report = (p: InstallProgress, force = false) => {
      if (force || p.phase !== phase || Date.now() - last >= PROGRESS_INTERVAL_MS) {
        phase = p.phase;
        send(p);
        return;
      }
      pending = p;
      flush ??= setTimeout(() => {
        flush = undefined;
        if (pending) send(pending);
      }, PROGRESS_INTERVAL_MS);
      flush.unref?.();
    };
    const first: InstallProgress = {
      phase: "pull",
      stage: t("Téléchargement de l'image…"),
      layers: [],
    };
    report(first, true);
    try {
      if (abort.signal.aborted) throw abort.signal.reason ?? new Error("aborted");
      await this.run(request, abort.signal, report);
      this.options.audit({
        kind: "imageInstall",
        image: request.kind === "kali" ? this.options.kaliImage : `${EXEGOL_REPO}:${request.tag}`,
      });
      this.broadcast({
        ...base,
        phase: "",
        stage: "",
        message: t("Image installée."),
        layers: [],
        busy: false,
        done: true,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        this.broadcast({ ...base, phase: "", stage: "", layers: [], busy: false, cancelled: true });
        throw error;
      }
      const safe = await this.sanitize(error);
      this.broadcast({
        ...base,
        phase: "",
        stage: "",
        layers: [],
        busy: false,
        error: formatError(safe, this.options.locale()),
        code: errorInfo(safe).code,
      });
      throw safe;
    } finally {
      clearTimeout(timer);
      clearTimeout(flush);
      pending = undefined;
      o.signal.removeEventListener("abort", stop);
      this.job = undefined;
    }
  }

  private async run(
    request: InstallRequest,
    signal: AbortSignal,
    report: (p: InstallProgress, force?: boolean) => void,
  ): Promise<void> {
    const { ops } = this.options;
    const onPull = (p: DockerImageProgress) =>
      report(
        {
          phase: p.stage,
          stage:
            p.stage === "build"
              ? t("Installation des outils Kali…")
              : t("Téléchargement de l'image…"),
          layers: p.layers,
        },
        p.complete,
      );
    if (request.kind === "exegol") {
      // Aucune image Exegol sans contrat accepté par l'humain.
      if (!this.options.exegol.installed()) throw new CodedError("exegol.notInstalled");
      if (!(await this.eulaAccepted(signal))) throw new CodedError("exegol.eulaRequired");
      await ops.pull(`${EXEGOL_REPO}:${request.tag}`, { signal, onProgress: onPull });
      return;
    }
    const image = this.options.kaliImage;
    if (image !== WARBAND_KALI_IMAGE) {
      // Image configurée à la main (`REDWIDOW_KALI_IMAGE`) : on la télécharge, on ne la construit pas.
      await ops.pull(image, { signal, onProgress: onPull });
      return;
    }
    if (request.rebuild === true) await this.removeKali(image);
    if (!ops.dockerPresent()) throw new CodedError("process.notFound", { binary: "docker" });
    await ops.buildKali({ signal, onProgress: onPull });
  }

  /** Reconstruction demandée : l'image locale est retirée (jamais forcée : un conteneur qui s'en sert la protège). */
  private async removeKali(image: string): Promise<void> {
    const res = await this.options.docker.json("DELETE", `/images/${image}`);
    if (res.status === 409) throw new CodedError("image.inUse");
    if (res.status !== 200 && res.status !== 404)
      throw new CodedError("docker.failed", {
        binary: "docker",
        command: "rmi",
        exitCode: res.status,
        stderr: "",
      });
  }

  /** Erreur diffusable : détail masqué et borné ; 429 et 404 du registre en codes dédiés. */
  private async sanitize(error: unknown): Promise<CodedError> {
    if (!(error instanceof CodedError)) return new CodedError("container.failed");
    if (error.code !== "docker.failed") return error;
    const params = error.params ?? {};
    const detail = String(params.stderr ?? "");
    const status = Number(params.exitCode);
    if (status === 429 || /toomanyrequests|rate limit|too many requests/i.test(detail))
      return new CodedError("image.rateLimited");
    if (
      status === 404 ||
      /not found|manifest unknown|pull access denied|does not exist/i.test(detail)
    )
      return new CodedError("image.notFound");
    const redact = createRedactor({
      values: [...secretsFromEnv(process.env), ...((await this.options.secretValues?.()) ?? [])],
    });
    return new CodedError("docker.failed", {
      binary: String(params.binary ?? "docker"),
      command: String(params.command ?? ""),
      exitCode:
        typeof params.exitCode === "number" ? params.exitCode : String(params.exitCode ?? ""),
      stderr: redact(detail).slice(-MAX_DETAIL),
    });
  }
}
