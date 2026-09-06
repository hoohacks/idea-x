/**
 * A wrapping row of things must space itself with `gap`, never with `spacing`.
 *
 * MUI's Stack compiles `spacing` to `margin-left` on every child after the
 * first. A margin does not reset at the start of a wrapped line, so the moment
 * the row is too narrow, whichever child wraps is pushed in by it -- a ragged
 * left edge that only appears on a phone. It was on the stat bar of nearly
 * every organizer page.
 *
 * Where the code set both, they added up: 8px of margin plus 8px of gap is a
 * 16px space, twice what the same row got elsewhere.
 *
 * `useFlexGap` is MUI's own answer to this, and it does not exist in 5.10.2 --
 * the version here. Passing it is silently inert, which is worse than not
 * knowing, so this refuses that too.
 *
 * This is a source check rather than a render check on purpose: jsdom has no
 * layout, so nothing else in the suite can see a wrap at all.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname);

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) found.push(full);
  }
  return found;
}

/** Every `<Stack ...>` opening tag, brace-aware so `sx={{ ... }}` is not cut short. */
function stackTags(text) {
  const tags = [];
  const opener = /<Stack(?=[\s/>])/g;
  let match;
  while ((match = opener.exec(text))) {
    let i = opener.lastIndex;
    let depth = 0;
    while (i < text.length) {
      const char = text[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        tags.push({ tag: text.slice(match.index, i + 1), line: text.slice(0, match.index).split("\n").length });
        break;
      }
      i += 1;
    }
  }
  return tags;
}

const files = sourceFiles(SRC);

test("the check has something to look at", () => {
  expect(files.length).toBeGreaterThan(40);
});

test("no wrapping row Stack spaces itself with margins", () => {
  const offenders = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const { tag, line } of stackTags(text)) {
      if (!/spacing=\{/.test(tag)) continue;
      if (!/flexWrap/.test(tag)) continue;
      const isRow = /direction="row"/.test(tag) || /direction=\{/.test(tag);
      if (!isRow) continue;
      offenders.push(`${path.relative(SRC, file)}:${line}`);
    }
  }

  expect(offenders).toEqual([]);
});

test("nothing passes useFlexGap, which this version of MUI ignores", () => {
  const version = require("@mui/material/package.json").version;
  const [major, minor] = version.split(".").map(Number);
  const supported = major > 5 || (major === 5 && minor >= 15);

  const used = files
    .filter((file) => /useFlexGap/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));

  // when MUI is upgraded far enough, useFlexGap becomes the better fix and this
  // stops standing in the way of it
  if (supported) return;
  // the version is in the message so a future reader knows why this ever cared
  expect({ version, used }).toEqual({ version, used: [] });
});
