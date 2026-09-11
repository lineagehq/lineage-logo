export function passed(jobs) {
  if (jobs.changes?.result !== 'success') return false;
  const app = jobs.changes.outputs.app;
  if (!['true', 'false'].includes(app)) return false;
  return ['content', 'verify', 'browser-qa', 'critical-browsers', 'clean-install', 'newer-lts'].every(name => {
    const required = name === 'content' || app === 'true';
    return jobs[name]?.result === (required ? 'success' : 'skipped');
  });
}
