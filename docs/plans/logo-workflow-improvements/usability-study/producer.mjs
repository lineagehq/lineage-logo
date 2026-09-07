import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const directory = path.dirname(fileURLToPath(import.meta.url));
export function prepareProposal(stage, handoff, transactionId = randomUUID()) {
  if (!['draft', 'corrected', 'followup'].includes(stage) || handoff?.kind !== 'lineage-logo-agent-handoff' || handoff.schemaVersion !== 1) throw new Error('Invalid study stage or handoff.');
  const snapshot = handoff.snapshot;
  if (!snapshot || !Array.isArray(snapshot.layers) || typeof snapshot.svg !== 'string' || createHash('sha256').update(snapshot.svg).digest('hex') !== snapshot.digest) throw new Error('Invalid handoff snapshot digest.');
  const targetId = stage === 'followup' ? 'seat-orbit' : 'constellation-logo';
  const matches = snapshot.layers.filter(layer => layer.svgId === targetId);
  if (matches.length !== 1 || matches[0].locked || matches[0].hidden) throw new Error('Expected one available study target.');
  const target = { sessionKey: matches[0].layerId };
  const operation = stage === 'followup'
    ? { type: 'setPaint', operationId: 'study-followup', target, property: 'fill', value: '#e6f4ef' }
    : { type: 'replaceLayer', operationId: 'study-structure', target };
  return {
    proposal: { protocolVersion: 1, transactionId, producer: { kind: 'deterministic-study-producer' }, document: { sessionId: snapshot.sessionId, baseRevision: snapshot.baseRevision }, operations: [operation] },
    instanceId: snapshot.instanceId,
    artifact: stage === 'followup' ? null : path.join(directory, 'assets', stage === 'draft' ? 'proposal.svg' : 'corrected-proposal.svg'),
  };
}
// This producer only submits through the installed public CLI. It never drives the
// editor, accepts a proposal, edits a workspace file, or offers procedural coaching.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [stage, handoffPath, proposalPath, installedCli] = process.argv.slice(2);
  if (!stage || !handoffPath || !proposalPath || !installedCli || process.argv.length !== 6) throw new Error('Usage: node producer.mjs STAGE HANDOFF.json NEW_PROPOSAL.json INSTALLED_CLI');
  const result = prepareProposal(stage, JSON.parse(readFileSync(handoffPath, 'utf8')));
  writeFileSync(proposalPath, JSON.stringify(result.proposal), { flag: 'wx', mode: 0o600 });
  const args = ['submit', '--instance', result.instanceId, '--proposal', proposalPath, '--json', '--quiet'];
  if (result.artifact) args.push('--artifact', result.artifact, '--group-id', 'constellation-logo');
  const child = spawn(installedCli, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', () => { process.stderr.write('Installed CLI could not start.\n'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
