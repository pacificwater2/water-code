function normalizeText(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function splitLines(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function formatRange(start, count) {
  return `${start + 1},${count}`;
}

export function buildUnifiedDiff({ oldText = "", newText = "", path = "file", contextLines = 3 }) {
  const before = splitLines(oldText);
  const after = splitLines(newText);

  const oldLabel = before.length === 0 ? "/dev/null" : `a/${path}`;
  const newLabel = after.length === 0 ? "/dev/null" : `b/${path}`;

  if (normalizeText(oldText) === normalizeText(newText)) {
    return `--- ${oldLabel}\n+++ ${newLabel}\n(no changes)`;
  }

  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }

  let oldSuffix = before.length - 1;
  let newSuffix = after.length - 1;
  while (
    oldSuffix >= prefix &&
    newSuffix >= prefix &&
    before[oldSuffix] === after[newSuffix]
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  const oldHunkStart = Math.max(0, prefix - contextLines);
  const newHunkStart = Math.max(0, prefix - contextLines);
  const oldHunkEnd = Math.min(before.length, oldSuffix + 1 + contextLines);
  const newHunkEnd = Math.min(after.length, newSuffix + 1 + contextLines);

  const diffLines = [
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    `@@ -${formatRange(oldHunkStart, oldHunkEnd - oldHunkStart)} +${formatRange(
      newHunkStart,
      newHunkEnd - newHunkStart
    )} @@`
  ];

  for (let index = oldHunkStart; index < prefix; index += 1) {
    diffLines.push(` ${before[index]}`);
  }

  for (let index = prefix; index <= oldSuffix; index += 1) {
    diffLines.push(`-${before[index]}`);
  }

  for (let index = prefix; index <= newSuffix; index += 1) {
    diffLines.push(`+${after[index]}`);
  }

  for (let index = oldSuffix + 1; index < oldHunkEnd; index += 1) {
    diffLines.push(` ${before[index]}`);
  }

  return diffLines.join("\n");
}
