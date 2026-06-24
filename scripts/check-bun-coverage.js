#!/usr/bin/env node

const fs = require("node:fs");

const lcovPath = process.argv[2];
if (!lcovPath) {
  console.error("Usage: node scripts/check-bun-coverage.js <lcov.info>");
  process.exit(2);
}

const content = fs.readFileSync(lcovPath, "utf8");
const records = content
  .split("end_of_record")
  .map((record) => record.trim())
  .filter(Boolean);

let found = false;
const failures = [];

for (const record of records) {
  const source = record.match(/^SF:(.+)$/m)?.[1] ?? "unknown";
  const linesFound = Number(record.match(/^LF:(\d+)$/m)?.[1] ?? 0);
  const linesHit = Number(record.match(/^LH:(\d+)$/m)?.[1] ?? 0);
  const funcsFound = Number(record.match(/^FNF:(\d+)$/m)?.[1] ?? 0);
  const funcsHit = Number(record.match(/^FNH:(\d+)$/m)?.[1] ?? 0);

  if (linesFound > 0 || funcsFound > 0) {
    found = true;
  }

  if (linesFound !== linesHit || funcsFound !== funcsHit) {
    failures.push(`${source}: lines ${linesHit}/${linesFound}, funcs ${funcsHit}/${funcsFound}`);
  }
}

if (!found) {
  console.error("No coverage records found.");
  process.exit(1);
}

if (failures.length > 0) {
  console.error("Bun coverage must be 100% for files included in frontend unit tests.");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Bun coverage is 100% for files included in frontend unit tests.");
