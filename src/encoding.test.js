/**
 * Every source file is UTF-8, and stays UTF-8.
 *
 * Text that has been read as Windows-1252 and written back as UTF-8 still
 * parses, still passes every other test, and still deploys -- it just renders
 * an a-circumflex, a euro sign and a quote where an en dash used to be.
 * One editor, one tool, or one `Set-Content -Encoding utf8` on a file
 * holding a dash is enough to do it, and nothing else here would notice.
 *
 * The signature is a Latin-1 letter followed by punctuation from the range
 * cp1252 maps 0x80-0x9F onto: the first byte of a UTF-8 sequence read as a
 * letter, the rest read as symbols. Ordinary prose, in any language this app
 * uses, does not produce that pair.
 */
const fs = require("fs");
const path = require("path");

const MOJIBAKE = /[À-ÿ][‐-›€ŒœŠšŸŽžƒˆ˜™]/;

const ROOTS = ["src", "e2e", "scripts", "test"];
const EXTENSIONS = [".js", ".mjs", ".json", ".css", ".html", ".md"];

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...sourceFiles(full));
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

const repoRoot = path.resolve(__dirname, "..");
const files = ROOTS.flatMap((root) => {
  const full = path.join(repoRoot, root);
  return fs.existsSync(full) ? sourceFiles(full) : [];
});

test("there is something to check", () => {
  expect(files.length).toBeGreaterThan(50);
});

test("no source file has been through a cp1252 round trip", () => {
  const damaged = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const hit = text.match(MOJIBAKE);
    if (!hit) continue;

    const line = text.slice(0, hit.index).split("\n").length;
    damaged.push(`${path.relative(repoRoot, file)}:${line} — ${JSON.stringify(hit[0])}`);
  }

  expect(damaged).toEqual([]);
});

test("a byte order mark never reaches a source file", () => {
  // Windows PowerShell writes one by default. Node strips it from the entry
  // point, webpack does not always, and a JSON file with one fails to parse.
  const withBom = files.filter((file) => fs.readFileSync(file).slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  expect(withBom.map((file) => path.relative(repoRoot, file))).toEqual([]);
});

test("the event strings are the characters they are meant to be", () => {
  const { EVENT } = require("./eventInfo");

  // en dashes, not hyphens and not three bytes of wreckage
  expect(EVENT.hours).toBe("10:00 AM – 7:00 PM");
  expect(EVENT.judgingHours).toBe("5:00 PM – 7:00 PM");
});
