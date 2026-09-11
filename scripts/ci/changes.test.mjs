import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './changes.mjs';

test('README uses docs and packaging only', () => assert.deepEqual(classify(['README.md']), { app: false, docs: true, site: false, packaging: true }));
test('animation plus README selects both lightweight checks', () => assert.deepEqual(classify(['README.md', 'site/assets/demo.gif']), { app: false, docs: true, site: true, packaging: true }));
test('mixed code and docs retain application checks', () => assert.equal(classify(['docs/guide.md', 'src/main.ts']).app, true));
test('unknown paths, fixtures, config and workflows fail closed', () => {
  for (const path of ['new-file', 'examples/test.svg', 'package-lock.json', '.github/workflows/ci.yml', 'scripts/ci/changes.mjs', 'docs/public-beta/fixture.svg']) assert.equal(classify([path]).app, true);
});
test('empty comparison fails closed', () => assert.equal(classify([]).app, true));
test('public beta docs retain packaging validation', () => assert.equal(classify(['docs/public-beta/README.md']).packaging, true));

import { passed } from './gate.mjs';
const jobs = app => Object.fromEntries([
  ['changes', { result: 'success', outputs: { app: String(app) } }],
  ...['content', 'verify', 'browser-qa', 'critical-browsers', 'clean-install', 'newer-lts'].map(name => [name, { result: name === 'content' || app ? 'success' : 'skipped' }]),
]);
test('gate accepts intentional docs skips and successful full suite', () => {
  assert.equal(passed(jobs(false)), true);
  assert.equal(passed(jobs(true)), true);
});
test('gate rejects failures, cancellation and unexpected skips', () => {
  for (const name of Object.keys(jobs(true))) for (const result of ['failure', 'cancelled', 'skipped']) {
    const checks = jobs(true);
    checks[name].result = result;
    assert.equal(passed(checks), false);
  }
  const checks = jobs(false);
  delete checks.content;
  assert.equal(passed(checks), false);
});
