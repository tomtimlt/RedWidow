/**
 * Comptes de test côté serveur (équivalent du SecretStorage `warband.testAccounts.*` de VS Code).
 * Métadonnées dans l'état (`accounts`), secrets dans le coffre (`account.<id>`). Le secret ne sort
 * que par `reveal` (renvoyé au seul demandeur par l'appelant) et par `testAccountsFor`, qui alimente
 * le moteur ; il n'est jamais copié dans l'état, un message diffusé ou un journal.
 */
import { randomUUID } from "node:crypto";
import {
  CREDENTIAL_KINDS,
  type CredentialKind,
  type TestAccount,
  testAccountSchema,
  testAccountsSchema,
} from "@warband/core";
import type { ServerStorage } from "../storage/index.js";

export const ACCOUNTS_KEY = "accounts";
export const accountSecretKey = (id: string): string => `account.${id}`;

/** Plafonds : le schéma du cœur limite à 20 comptes par projet ; le total reste borné. */
export const MAX_ACCOUNTS = 200;
export const MAX_ACCOUNTS_PER_PROGRAMME = 20;

export interface AccountMeta {
  id: string;
  programme: string;
  label: string;
  login: string;
  createdBy: "human" | "agent";
  /** Date ISO de création. */
  createdAt: string;
  /** Nature du secret (absente : mot de passe, comptes saisis à la main). Jamais la valeur. */
  kind?: CredentialKind;
}

export interface AccountInput {
  programme: string;
  label: string;
  login: string;
  secret: string;
  kind?: CredentialKind;
}

const isMeta = (v: unknown): v is AccountMeta => {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.programme === "string" &&
    typeof m.label === "string" &&
    typeof m.login === "string" &&
    (m.createdBy === "human" || m.createdBy === "agent") &&
    typeof m.createdAt === "string" &&
    (m.kind === undefined || (CREDENTIAL_KINDS as readonly unknown[]).includes(m.kind))
  );
};

export class AccountStore {
  constructor(
    private readonly storage: ServerStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Métadonnées seulement, de la plus ancienne à la plus récente. */
  list(): AccountMeta[] {
    const raw = this.storage.state.get(ACCOUNTS_KEY);
    return Array.isArray(raw) ? raw.filter(isMeta).map((m) => ({ ...m })) : [];
  }

  /**
   * Ajoute un compte (créé par un humain). `null` si le plafond est atteint ou si le libellé existe déjà
   * pour ce programme. Le secret est écrit dans le coffre avant les métadonnées.
   */
  async add(
    input: AccountInput,
    createdBy: "human" | "agent" = "human",
  ): Promise<AccountMeta | null> {
    const all = this.list();
    const same = all.filter((a) => a.programme === input.programme);
    if (
      all.length >= MAX_ACCOUNTS ||
      same.length >= MAX_ACCOUNTS_PER_PROGRAMME ||
      same.some((a) => a.label === input.label)
    )
      return null;
    const meta: AccountMeta = {
      id: randomUUID(),
      programme: input.programme,
      label: input.label,
      login: input.login,
      createdBy,
      createdAt: this.now().toISOString(),
      ...(input.kind !== undefined && { kind: input.kind }),
    };
    await this.storage.secrets.set(accountSecretKey(meta.id), input.secret);
    this.storage.state.set(ACCOUNTS_KEY, [...all, meta]);
    return meta;
  }

  /** Valeur du secret : réservée au geste explicite `accountReveal`. */
  async reveal(id: string): Promise<string | null> {
    if (!this.list().some((a) => a.id === id)) return null;
    return (await this.storage.secrets.get(accountSecretKey(id))) ?? null;
  }

  async remove(id: string): Promise<boolean> {
    const all = this.list();
    if (!all.some((a) => a.id === id)) return false;
    this.storage.state.set(
      ACCOUNTS_KEY,
      all.filter((a) => a.id !== id),
    );
    await this.storage.secrets.delete(accountSecretKey(id));
    return true;
  }

  /**
   * Comptes passés au moteur pour un projet : ceux dont le programme est l'identifiant ou le nom du
   * projet (sans casse). Forme du cœur (`testAccountsSchema`) ; un compte sans secret est omis.
   */
  async testAccountsFor(project: { id: string; name: string } | null): Promise<TestAccount[]> {
    if (project === null) return [];
    const wanted = new Set([project.id.toLowerCase(), project.name.toLowerCase()]);
    const out: TestAccount[] = [];
    for (const a of this.list()) {
      if (!wanted.has(a.programme.toLowerCase())) continue;
      const secret = await this.storage.secrets.get(accountSecretKey(a.id));
      if (!secret) continue;
      // Le moteur ne connaît que `password` et `cookie` ; un jeton sans login garde son libellé comme identifiant.
      const account: TestAccount = {
        label: a.label,
        host: "",
        identifier: a.login || (a.kind === "cookie" ? "" : a.label),
        secret,
        kind: a.kind === "cookie" ? "cookie" : "password",
      };
      // Un compte invalide est écarté seul : il ne doit pas priver le moteur des autres.
      if (testAccountSchema.safeParse(account).success) out.push(account);
    }
    return testAccountsSchema.safeParse(out).success ? out : [];
  }
}
