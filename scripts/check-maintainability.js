#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const limits = {
  sourceFileLines: 500,
  testFileLines: 500,
  docFileLines: 500,
  functionLines: 200,
};

const targets = {
  sourceFileLines: 350,
  functionLines: 100,
};

const sourceRoots = [
  "frontend/src",
  "frontend/src-tauri/src",
  "llama-helper/src",
  "mcp",
  "scripts",
];
const docRoots = ["README.md", "CONTRIBUTING.md", "CLAUDE.md", "docs", ".github"];
const requiredDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/README.md",
  "docs/VALIDATION.md",
  "docs/MCP_SERVER.md",
  "docs/CALENDAR.md",
  "docs/MODELS.md",
  "docs/RELEASES.md",
  "docs/AGENT_SOURCES.md",
  "docs/architecture.md",
];

const ignoredParts = new Set([
  "node_modules",
  ".next",
  "out",
  "target",
  "coverage",
  ".venv",
  ".jscpd-report",
  "binaries",
  "gen",
]);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".rs", ".py"]);
const docExtensions = new Set([".md", ".mdx"]);

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function shouldIgnore(filePath) {
  return relative(filePath)
    .split("/")
    .some((part) => ignoredParts.has(part));
}

function walk(entry) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute) || shouldIgnore(absolute)) {
    return [];
  }

  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return [absolute];
  }

  const files = [];
  for (const child of fs.readdirSync(absolute)) {
    files.push(...walk(path.join(entry, child)));
  }
  return files;
}

function readLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function isTestFile(filePath) {
  const name = relative(filePath);
  return (
    name.includes("/tests/") ||
    name.includes("__tests__") ||
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".test.js") ||
    name.endsWith(".test.mjs") ||
    name.endsWith("_test.rs") ||
    name.includes("test_")
  );
}

function stripStringsAndComments(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/#.*$/, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function braceDelta(line) {
  const clean = stripStringsAndComments(line);
  return (clean.match(/{/g) || []).length - (clean.match(/}/g) || []).length;
}

function findBraceFunctionEnd(lines, startIndex) {
  let seenOpeningBrace = false;
  let depth = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const delta = braceDelta(lines[index]);
    if (!seenOpeningBrace && lines[index].includes("{")) {
      seenOpeningBrace = true;
    }
    depth += delta;

    if (seenOpeningBrace && depth <= 0) {
      return index;
    }
  }

  return startIndex;
}

function pythonFunctionEnd(lines, startIndex) {
  const startLine = lines[startIndex];
  const indent = startLine.match(/^\s*/)[0].length;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    const nextIndent = line.match(/^\s*/)[0].length;
    if (nextIndent <= indent) {
      return index - 1;
    }
  }

  return lines.length - 1;
}

function collectFunctionSpans(filePath, lines) {
  const ext = path.extname(filePath);
  const spans = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (ext === ".py") {
      const match = trimmed.match(/^(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (match) {
        const end = pythonFunctionEnd(lines, index);
        spans.push({ name: match[2], start: index + 1, end: end + 1, lines: end - index + 1 });
      }
      continue;
    }

    if (ext === ".rs") {
      const match = trimmed.match(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/);
      if (match) {
        const end = findBraceFunctionEnd(lines, index);
        spans.push({ name: match[1], start: index + 1, end: end + 1, lines: end - index + 1 });
      }
      continue;
    }

    const functionMatch =
      trimmed.match(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/) ||
      trimmed.match(/^(export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=].*=>/) ||
      trimmed.match(
        /^(public|private|protected)?\s*(async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*{/,
      );

    if (functionMatch) {
      const name = functionMatch[3] || functionMatch[2] || functionMatch[1] || "anonymous";
      const end = findBraceFunctionEnd(lines, index);
      spans.push({ name, start: index + 1, end: end + 1, lines: end - index + 1 });
    }
  }

  return spans;
}

const errors = [];
const largeFiles = [];
const largeFunctions = [];

for (const doc of requiredDocs) {
  if (!fs.existsSync(path.join(root, doc))) {
    errors.push(`required documentation is missing: ${doc}`);
  }
}

for (const filePath of sourceRoots.flatMap(walk)) {
  const ext = path.extname(filePath);
  if (!sourceExtensions.has(ext) || shouldIgnore(filePath)) {
    continue;
  }

  const lines = readLines(filePath);
  const rel = relative(filePath);
  const maxLines = isTestFile(filePath) ? limits.testFileLines : limits.sourceFileLines;

  if (lines.length > maxLines) {
    errors.push(`${rel} has ${lines.length} lines; hard limit is ${maxLines}`);
  }
  if (lines.length > targets.sourceFileLines) {
    largeFiles.push({ rel, lines: lines.length });
  }

  for (const span of collectFunctionSpans(filePath, lines)) {
    if (span.lines > limits.functionLines) {
      errors.push(
        `${rel}:${span.start} ${span.name} has ${span.lines} lines; hard limit is ${limits.functionLines}`,
      );
    }
    if (span.lines > targets.functionLines) {
      largeFunctions.push({ rel, ...span });
    }
  }
}

for (const filePath of docRoots.flatMap(walk)) {
  const ext = path.extname(filePath);
  if (!docExtensions.has(ext) || shouldIgnore(filePath)) {
    continue;
  }

  const lines = readLines(filePath);
  if (lines.length > limits.docFileLines) {
    errors.push(
      `${relative(filePath)} has ${lines.length} lines; docs hard limit is ${limits.docFileLines}`,
    );
  }
}

largeFiles.sort((left, right) => right.lines - left.lines);
largeFunctions.sort((left, right) => right.lines - left.lines);

console.log("Maintainability hard limits:");
console.log(`- source files <= ${limits.sourceFileLines} lines`);
console.log(`- test files <= ${limits.testFileLines} lines`);
console.log(`- docs <= ${limits.docFileLines} lines`);
console.log(`- detected functions/components <= ${limits.functionLines} lines`);

if (largeFiles.length > 0) {
  console.log("\nLargest source files above the refactor target:");
  for (const item of largeFiles.slice(0, 10)) {
    console.log(`- ${item.rel}: ${item.lines} lines`);
  }
}

if (largeFunctions.length > 0) {
  console.log("\nLargest detected functions/components above the refactor target:");
  for (const item of largeFunctions.slice(0, 10)) {
    console.log(`- ${item.rel}:${item.start} ${item.name}: ${item.lines} lines`);
  }
}

if (errors.length > 0) {
  console.error("\nMaintainability check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("\nMaintainability check passed.");
