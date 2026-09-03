#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MILESTONES = [
  "fresh_install",
  "non_destructive_bootstrap",
  "proposal_comprehension",
  "review",
  "accept_and_durable_save",
  "clean_reopen",
];
const FRICTION_CODES = new Set([
  "none", "install", "bootstrap", "context", "proposal", "review",
  "accept_and_durable_save", "reopen",
]);
const PARTICIPANT_ID = /^P-[A-F0-9]{32}$/;
const WALKTHROUGH_ID = /^W-[A-F0-9]{32}$/;
const SHA256 = /^[A-F0-9]{64}$/;

class ValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new ValidationError(code);
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function parseUtcDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) reject("INVALID_DATE");
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    reject("INVALID_DATE");
  }
  return milliseconds;
}

function assertCountingReceipt(receipt) {
  const keys = ["receipt_version", "kind", "walkthrough_id", "participant_slot", "installed_version", "environment", "attempt_status", "milestones", "recovery", "issue_code"];
  if (!hasExactKeys(receipt, keys)) reject("INVALID_RECEIPT");
  if (receipt.receipt_version !== 1 || receipt.kind !== "lineage-logo.public-beta.walkthrough") reject("INVALID_RECEIPT");
  if (!PARTICIPANT_ID.test(receipt.participant_slot) || !WALKTHROUGH_ID.test(receipt.walkthrough_id)) reject("INVALID_RECEIPT");
  if (receipt.installed_version !== "0.1.0-beta.3" || receipt.attempt_status !== "valid" || receipt.issue_code !== "none") reject("NON_COUNTING_RECEIPT");

  if (!hasExactKeys(receipt.environment, ["platform", "node_major", "browser"])) reject("INVALID_RECEIPT");
  if (!["macos", "linux"].includes(receipt.environment.platform)
    || !Number.isInteger(receipt.environment.node_major) || receipt.environment.node_major < 22
    || receipt.environment.browser !== "chromium") reject("NON_COUNTING_RECEIPT");

  if (!hasExactKeys(receipt.milestones, MILESTONES)) reject("INVALID_RECEIPT");
  for (const name of MILESTONES) {
    const milestone = receipt.milestones[name];
    if (!hasExactKeys(milestone, ["status", "duration_seconds", "friction_code"])) reject("INVALID_RECEIPT");
    if (milestone.status !== "pass"
      || !Number.isInteger(milestone.duration_seconds)
      || milestone.duration_seconds < 0 || milestone.duration_seconds > 3600
      || !FRICTION_CODES.has(milestone.friction_code)) reject("NON_COUNTING_RECEIPT");
  }
  if (!hasExactKeys(receipt.recovery, ["action", "result"])
    || receipt.recovery.action !== "none" || receipt.recovery.result !== "not_needed") {
    reject("NON_COUNTING_RECEIPT");
  }
}

function assertAttestationShape(attestation) {
  if (attestation?.attestation_version !== 1
    || attestation?.kind !== "lineage-logo.public-beta.distinct-user-attestation"
    || attestation?.channel_class !== "owner_approved_private_authenticated_deletable"
    || attestation?.accepted_count !== 3
    || !Array.isArray(attestation?.accepted_receipts)
    || attestation.accepted_receipts.length !== 3) reject("INVALID_ATTESTATION");
  for (const entry of attestation.accepted_receipts) {
    if (!hasExactKeys(entry, ["participant_id", "walkthrough_id", "receipt_sha256"])
      || !PARTICIPANT_ID.test(entry.participant_id)
      || !WALKTHROUGH_ID.test(entry.walkthrough_id)
      || !SHA256.test(entry.receipt_sha256)) reject("INVALID_ATTESTATION");
  }
}

function assertUnique(entries, field) {
  if (new Set(entries.map((entry) => entry[field])).size !== 3) reject("DUPLICATE_BINDING");
}

async function validate(attestationPath, receiptPaths) {
  let attestation;
  let receiptBytes;
  try {
    [attestation, ...receiptBytes] = await Promise.all([
      readFile(attestationPath, "utf8").then(JSON.parse),
      ...receiptPaths.map((path) => readFile(path)),
    ]);
  } catch {
    reject("UNREADABLE_INPUT");
  }

  assertAttestationShape(attestation);
  const start = parseUtcDate(attestation.collection_window_start);
  const end = parseUtcDate(attestation.collection_window_end);
  const attested = parseUtcDate(attestation.attestation_date);
  if (start > end || attested < end) reject("INVALID_DATE_ORDER");
  const inclusiveDays = ((end - start) / 86_400_000) + 1;
  if (!Number.isInteger(attestation.collection_window_days)
    || attestation.collection_window_days !== inclusiveDays
    || inclusiveDays < 1 || inclusiveDays > 14) reject("INVALID_WINDOW");

  const entries = attestation.accepted_receipts;
  assertUnique(entries, "participant_id");
  assertUnique(entries, "walkthrough_id");
  assertUnique(entries, "receipt_sha256");

  const entriesByDigest = new Map(entries.map((entry) => [entry.receipt_sha256, entry]));
  for (const bytes of receiptBytes) {
    const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    const entry = entriesByDigest.get(digest);
    if (!entry) reject("DIGEST_MISMATCH");
    let receipt;
    try {
      receipt = JSON.parse(bytes.toString("utf8"));
    } catch {
      reject("INVALID_RECEIPT");
    }
    assertCountingReceipt(receipt);
    if (entry.participant_id !== receipt.participant_slot || entry.walkthrough_id !== receipt.walkthrough_id) {
      reject("IDENTIFIER_MISMATCH");
    }
    entriesByDigest.delete(digest);
  }
  if (entriesByDigest.size !== 0) reject("DIGEST_MISMATCH");
}

if (process.argv.length !== 6) {
  process.stderr.write('{"ok":false,"code":"INVALID_ARGUMENT_COUNT"}\n');
  process.exitCode = 1;
} else {
  try {
    await validate(process.argv[2], process.argv.slice(3));
    process.stdout.write('{"ok":true,"code":"ATTESTATION_VALID"}\n');
  } catch (error) {
    const code = error instanceof ValidationError ? error.code : "VALIDATION_FAILED";
    process.stderr.write(`{"ok":false,"code":"${code}"}\n`);
    process.exitCode = 1;
  }
}
