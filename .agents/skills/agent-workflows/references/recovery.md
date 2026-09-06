# Recovery and missing capabilities

Stop mutation and inspect before choosing recovery on uncertainty, an expired lease, ownership changes, or revision conflicts.

## Honest capability boundary

Training preflight can report `missingCapabilities` while remaining active. Continue only through steps whose evidence can be proven. At the first step requiring a recorded gap, propose only the capabilities needed to execute the bounded browser action; do not falsely request the unavailable proof capability. After the action lease is issued, commit the following assessment fragment with the full committed result:

```json
{
  "assessment": {
    "stepId": "inspect-preview",
    "expectations": [
      {
        "expectation": "Exact workflow expectation",
        "outcome": "blocked",
        "observation": "Not assessable because media-inspection is unavailable.",
        "evidence": []
      }
    ],
    "proposedOutcome": "blocked",
    "block": {
      "code": "capability_unavailable",
      "capability": "media-inspection"
    }
  },
  "artifacts": []
}
```

Include every expectation exactly once. The runner rejects this block unless the run is training, preflight recorded the named gap, and the current step requires it. Descendants become dependency-blocked and cleanup still runs.

## Recovery

- On `REVISION_CONFLICT`, inspect and rebuild the request against current state; do not reuse the request ID with changed input.
- Retry an identical evidence request with the same request ID after interrupted response delivery. The runner reconstructs the exact response.
- On `LEASE_EXPIRED`, stop browser mutation and inspect. The first fresh request at or after the exact expiry durably records the runner-owned expiry; this never asserts whether the external action executed. If that request is inspect, it returns the reconciliation state. Any other command records expiry, returns `LEASE_EXPIRED`, and must be followed by inspect. Lease-scoped evidence slots and optional authority are invalidated. Reconcile the named uncertain lease, then use a fresh lifecycle run rather than retrying the possibly executed action.
- On ownership or reconciliation errors, do not claim success from visible state alone.

Never use `capability_unavailable` in evaluation or replay. Any retry, intervention, pause/resume, emergency stop, reconciliation, handoff, unexpected state, uncertainty, deviation, or capability gap invalidates lifecycle proof; use a fresh lifecycle run identity.
