/**
 * One before/after pair as a single scannable line.
 *
 * The feed gets read while something is going wrong, so a whole object dumped
 * into a row helps nobody. Scalars show both values, containers show a size.
 */

const MAX = 28;

function render(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    const count = Object.keys(value).length;
    return `${count} field${count === 1 ? "" : "s"}`;
  }

  const text = String(value);
  return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
}

export function describeChange({ path, before, after }) {
  const leaf = path.split("/").filter(Boolean).pop() ?? path;
  return `${leaf}: ${render(before)} → ${render(after)}`;
}

export default describeChange;
