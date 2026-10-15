import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodedError,
  extractTar,
  packHostPath,
  packTar,
  readBounded,
  tarStreamLimit,
  unpackTar,
} from "../src/index.js";

interface Raw {
  name: string;
  type?: string;
  data?: string;
  size?: number;
  link?: string;
  prefix?: string;
}

/** Construit une archive à la main, y compris des archives piégées que `packTar` refuserait. */
function header(r: Raw, typeOverride?: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(r.name, 0, 100);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${(r.size ?? r.data?.length ?? 0).toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.fill(0x20, 148, 156);
  h.write(typeOverride ?? r.type ?? "0", 156);
  if (r.link) h.write(r.link, 157, 100);
  h.write("ustar\0", 257);
  h.write("00", 263);
  if (r.prefix) h.write(r.prefix, 345, 155);
  h.write(
    `${h
      .reduce((s, b) => s + b, 0)
      .toString(8)
      .padStart(7, "0")}\0`,
    148,
  );
  return h;
}

function raw(entries: Raw[], opts: { end?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  for (const r of entries) {
    parts.push(header(r));
    if (r.data) {
      const d = Buffer.from(r.data);
      parts.push(d, Buffer.alloc((512 - (d.length % 512)) % 512));
    }
  }
  if (opts.end !== false) parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function pax(records: string[]): Raw {
  const body = records
    .map((r) => {
      const base = ` ${r}\n`;
      let len = base.length + 1;
      while (String(len).length + base.length !== len) len = String(len).length + base.length;
      return `${len}${base}`;
    })
    .join("");
  return { name: "PaxHeader", type: "x", data: body };
}

function rejected(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CodedError);
    expect((e as CodedError).code).toBe("sandbox.tarRejected");
    expect((e as CodedError).params?.reason).toBe(reason);
    return;
  }
  throw new Error(`refus attendu : ${reason}`);
}

let dir: string;
const opts = () => ({ cwd: dir, home: join(dir, "home") });
const snapshot = () => readdirSync(dir, { recursive: true }).sort();

beforeEach(() => {
  dir = mkdtempSync(join(realpathSync.native(tmpdir()), "john-tar-"));
  mkdirSync(join(dir, "home"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("lecture stricte : archives piégées refusées, rien d'écrit", () => {
  const good: Raw = { name: "root/", type: "5" };
  const cases: [string, Raw[], string][] = [
    ["lien symbolique", [good, { name: "root/l", type: "2", link: "/etc/passwd" }], "symlink"],
    ["lien dur", [good, { name: "root/h", type: "1", link: "root/x" }], "hardlink"],
    ["périphérique", [good, { name: "root/d", type: "3" }], "special"],
    ["FIFO", [good, { name: "root/f", type: "6" }], "special"],
    ["..", [good, { name: "root/../../x", data: "x" }], "traversal"],
    ["chemin absolu", [{ name: "/etc/x", data: "x" }], "absolute"],
    ["ADS", [good, { name: "root/a.txt:s", data: "x" }], "winName"],
    ["lettre de lecteur", [{ name: "C:x", data: "x" }], "winName"],
    ["nom réservé", [good, { name: "root/NUL.txt", data: "x" }], "winName"],
    ["point final", [good, { name: "root/a.", data: "x" }], "winName"],
    ["antislash", [good, { name: "root\\x", data: "x" }], "name"],
    [
      "doublon (casse)",
      [good, { name: "root/a", data: "1" }, { name: "root/A", data: "2" }],
      "duplicate",
    ],
    ["deux racines", [good, { name: "autre", data: "x" }], "multiRoot"],
    [
      "fichier parent",
      [
        { name: "root", data: "x" },
        { name: "root/y", data: "y" },
      ],
      "conflict",
    ],
    ["taille déclarée", [{ name: "root", size: 5000, data: "x" }], "tooLarge"],
  ];
  for (const [label, entries, reason] of cases) {
    it(label, () => {
      const before = snapshot();
      const buf = raw(entries);
      rejected(() => unpackTar(buf, { maxBytes: 1000 }), reason);
      rejected(() => extractTar(buf, "out", opts(), { maxBytes: 1000 }), reason);
      expect(snapshot()).toEqual(before);
    });
  }

  it("un fichier valide avant l'entrée piégée n'est pas écrit", () => {
    const before = snapshot();
    const buf = raw([
      good,
      { name: "root/ok", data: "ok" },
      { name: "root/l", type: "2", link: "x" },
    ]);
    rejected(() => extractTar(buf, "out", opts()), "symlink");
    expect(snapshot()).toEqual(before);
  });

  it("archive tronquée, somme de contrôle fausse, octets parasites", () => {
    const ok = raw([{ name: "f", data: "hello" }]);
    rejected(() => unpackTar(ok.subarray(0, 600)), "truncated");
    const bad = Buffer.from(ok);
    bad[0] = 0x67;
    rejected(() => unpackTar(bad), "checksum");
    rejected(() => unpackTar(Buffer.concat([ok, Buffer.from("zz")])), "malformed");
  });

  it("taille réelle : flux borné pendant la lecture", async () => {
    async function* gen() {
      yield new Uint8Array(600);
      yield new Uint8Array(600);
    }
    await expect(readBounded(gen(), 1000)).rejects.toMatchObject({ code: "sandbox.tarRejected" });
    expect((await readBounded(gen(), 1200)).length).toBe(1200);
    expect(tarStreamLimit()).toBeGreaterThan(256 * 1024 * 1024);
  });

  it("plafond du nombre d'entrées", () => {
    const buf = raw([good, { name: "root/a", data: "1" }, { name: "root/b", data: "2" }]);
    rejected(() => unpackTar(buf, { maxEntries: 2 }), "tooManyEntries");
  });
});

describe("pax", () => {
  it("accepte path (nom long) et l'applique à l'entrée suivante", () => {
    const long = `root/${"d".repeat(120)}/f.txt`;
    const buf = raw([
      { name: "root/", type: "5" },
      pax([`path=${long}`]),
      { name: "trunc", data: "hi" },
    ]);
    expect(unpackTar(buf).map((e) => e.path)).toEqual(["root", long]);
  });

  it("refuse size, linkpath, sparse, enregistrement mal formé, pax orphelin, pax global", () => {
    for (const rec of ["size=1", "linkpath=/etc/x", "GNU.sparse.map=0,1"]) {
      rejected(() => unpackTar(raw([pax([rec]), { name: "f", data: "x" }])), "pax");
    }
    const badLen = raw([
      { name: "PaxHeader", type: "x", data: "999 path=a\n" },
      { name: "f", data: "x" },
    ]);
    rejected(() => unpackTar(badLen), "pax");
    rejected(() => unpackTar(raw([pax(["path=a"])])), "pax");
    rejected(() => unpackTar(raw([{ name: "g", type: "g", data: "" }])), "pax");
  });

  it("le chemin pax est contrôlé comme un nom ordinaire", () => {
    rejected(() => unpackTar(raw([pax(["path=../x"]), { name: "t", data: "x" }])), "traversal");
    rejected(() => unpackTar(raw([pax(["path=/abs"]), { name: "t", data: "x" }])), "absolute");
  });
});

describe("put -> get", () => {
  it("aller-retour d'un arbre identique", () => {
    const src = join(dir, "proj");
    mkdirSync(join(src, "sub", "deep"), { recursive: true });
    writeFileSync(join(src, "a.txt"), "alpha");
    writeFileSync(join(src, "sub", "b.bin"), Buffer.from([0, 1, 2, 255]));
    writeFileSync(join(src, "sub", "deep", "c.txt"), "x".repeat(1500));
    const tar = packHostPath(src, "proj", opts());
    const out = extractTar(tar, "copie", opts());
    expect(out).toBe(join(dir, "copie"));
    expect(readFileSync(join(out, "a.txt"), "utf8")).toBe("alpha");
    expect([...readFileSync(join(out, "sub", "b.bin"))]).toEqual([0, 1, 2, 255]);
    expect(readFileSync(join(out, "sub", "deep", "c.txt"), "utf8")).toBe("x".repeat(1500));
    expect(readdirSync(dir).filter((n) => n.startsWith(".john-get-"))).toEqual([]);
  });

  it("fichier seul, nom long coupé en préfixe ustar", () => {
    writeFileSync(join(dir, "f.txt"), "data");
    const name = `${"a".repeat(60)}/${"b".repeat(60)}/f.txt`;
    const entries = unpackTar(packTar([{ type: "file", path: name, data: Buffer.from("data") }]));
    expect(entries).toEqual([{ type: "file", path: name, data: Buffer.from("data") }]);
    const out = extractTar(packHostPath(join(dir, "f.txt"), "f.txt", opts()), "g.txt", opts());
    expect(readFileSync(out, "utf8")).toBe("data");
  });

  it("destination existante refusée, contenu intact", () => {
    writeFileSync(join(dir, "f.txt"), "new");
    writeFileSync(join(dir, "dest"), "old");
    rejected(
      () => extractTar(packHostPath(join(dir, "f.txt"), "f.txt", opts()), "dest", opts()),
      "destExists",
    );
    expect(readFileSync(join(dir, "dest"), "utf8")).toBe("old");
  });

  it("destination hors espace de travail ou sensible refusée", () => {
    const tar = packTar([{ type: "file", path: "f", data: Buffer.from("x") }]);
    rejected(() => extractTar(tar, join(dir, "..", "john-tar-hors"), opts()), "destDenied");
    rejected(() => extractTar(tar, join(dir, "home", ".ssh"), opts()), "sensitive");
  });

  it("put : entrée sensible d'un répertoire refusée, lien symbolique ignoré", () => {
    const src = join(dir, "home");
    mkdirSync(join(src, ".ssh"), { recursive: true });
    writeFileSync(join(src, ".ssh", "id"), "secret");
    rejected(() => packHostPath(src, "proj", opts()), "sensitive");
    rmSync(join(src, ".ssh"), { recursive: true });
    writeFileSync(join(src, "ok"), "1");
    try {
      symlinkSync(join(dir, "home"), join(src, "lien"), "junction");
    } catch {
      // création de lien impossible sur ce système : le reste du test suffit
    }
    expect(unpackTar(packHostPath(src, "proj", opts())).map((e) => e.path)).toEqual([
      "proj",
      "proj/ok",
    ]);
  });

  it("put : plafonds de taille et d'entrées", () => {
    const src = join(dir, "p");
    mkdirSync(src);
    writeFileSync(join(src, "a"), "12345");
    writeFileSync(join(src, "b"), "12345");
    rejected(() => packHostPath(src, "p", opts(), { maxBytes: 9 }), "tooLarge");
    rejected(() => packHostPath(src, "p", opts(), { maxEntries: 2 }), "tooManyEntries");
  });

  it("put : nom de racine invalide refusé", () => {
    writeFileSync(join(dir, "f"), "x");
    rejected(() => packHostPath(join(dir, "f"), "../x", opts()), "traversal");
    rejected(() => packHostPath(join(dir, "f"), "a:b", opts()), "winName");
  });

  it("le paramètre entry est borné et neutralisé", () => {
    try {
      unpackTar(raw([{ name: `a${"\u001b[2K".repeat(10)}`, data: "x" }]));
    } catch (e) {
      expect(String((e as CodedError).params?.entry)).not.toContain("\u001b");
    }
    try {
      unpackTar(raw([{ name: "x", data: "x" }, pax([`path=${"/".repeat(5)}${"y".repeat(3000)}`])]));
    } catch (e) {
      expect(String((e as CodedError).params?.entry ?? "").length).toBeLessThanOrEqual(61);
    }
  });
});
