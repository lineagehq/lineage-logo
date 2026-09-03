# Public beta walkthrough protocol v1

This is a local operating protocol, not an invitation, enrollment plan, or feedback
collection mechanism. Do not select or contact participants, inspect contact data,
observe walkthroughs, or collect consent or feedback under this document.

## Bounded operating conditions

Count only an independent, unaided walkthrough of the published, exact public-beta
package. The person running it uses Node.js 22 or newer, macOS or Linux, and Chromium.
They install from the registry; local tarballs, a repository checkout, a linked package,
and an unpublished build are not valid substitutes. Windows and browsers other than
Chromium are outside this initial walkthrough contract.

The maintainer must not coach, hint, take control, answer step-by-step questions, or
repair the environment during an attempt. A person may use the shipped public
instructions and normal product help only. No one should transmit screenshots, traces,
SVG bytes, private paths, browser/session data, credentials, tokens, names, emails, or
free-form text as part of this protocol.

## Required milestones

Record each milestone as a controlled status plus bounded numeric duration and friction
code in the versioned [receipt schema](walkthrough-receipt.schema.json). The required order is:

1. `fresh_install`: install through `@beta` from the registry in a fresh local directory,
   then run `lineage-logo --version` and record that exact resolved installed version.
2. `non_destructive_bootstrap`: run the shipped bootstrap and verify it does not overwrite,
   merge, or delete existing files.
3. `proposal_comprehension`: use the shipped, redacted agent context/proposal contract and
   identify the proposal as pending review rather than an applied change.
4. `review`: inspect the proposal and choose a review decision without maintainer coaching.
5. `accept_and_durable_save`: choose **Accept all** once. This one atomic action must
   return a durable path and digest, the artifact must exist, and no separate normal Save
   action is instructed or scored.
6. `clean_reopen`: reopen cleanly and verify the saved accepted result remains available
   while `concepts/seatify-constellation.svg` remains unchanged.

The walkthrough oracle passes only when the receipt has `attempt_status: "valid"` and
every required milestone is `pass`. An incomplete, failed, blocked, or invalid attempt
does not count; do not infer missing milestones from a later success.

## Recovery rubric

Use one deterministic recovery action, then record its result:

| Situation | Recovery action | Count rule |
| --- | --- | --- |
| A transient-looking failure at the current step | `retry_same_step_once` | Continue only if that retry passes and every later milestone passes. |
| The fresh install state is no longer trustworthy | `restart_from_fresh_install` | Start a new receipt; the original remains non-counting. |
| A safety, data-loss, unsupported-environment, or repeat failure occurs | `stop` | Stop; the attempt does not count. |
| No recovery is needed | `none` | Use `not_needed`. |

Never recover by using a local tarball, repository checkout, linked package, manual file
editing, or maintainer intervention. Do not convert a `fail`, `blocked`, or
`not_attempted` milestone to `pass` after the fact.

The receipt pairs are fixed: `none` uses `not_needed`; either retry action uses `passed`
or `failed`; and `stop` uses `not_attempted`. A valid receipt has no recovery, so it must
use `none` and `not_needed`.

## Invalid-attempt rules

Set `attempt_status` to `invalid` and stop counting the attempt if any of these occur:

- Maintainer coaching, hints, remote control, or environment repair during the walkthrough.
- A local tarball, source checkout, linked package, unpublished build, unsupported platform,
  unsupported browser, or Node.js version below 22 is used.
- Any required milestone is skipped, missing, or represented as successful without completing it.
- The receipt includes personal data, credentials, tokens, private paths, SVG contents,
  browser/session data, or free-form text.
- The workflow collects participant feedback, consent, contact information, or telemetry.

Use `incomplete` for a stopped attempt that is not invalid. It is still non-counting.

## Receipt handling

Start from the shipped [non-counting receipt example](walkthrough-receipt.example.json).
Copy it from the installed package while the terminal is in the install project:

```bash
cp node_modules/lineage-logo/docs/public-beta/walkthrough-receipt.example.json walkthrough-receipt.json
```

Replace only controlled fields with observed values: the invitation-supplied
`walkthrough_id` and `participant_slot`; the exact installed version; the platform,
Node major version, and browser enum; each milestone status, integer duration in
seconds, and friction code; the overall attempt status; the one recovery action/result
pair; and the one issue code. Do not add properties or narrative. The shipped example
is intentionally `incomplete` and does not count until actual evidence supports every
field required for a valid attempt.

Validate the completed file against the shipped draft-2020-12 schema with this exact,
pinned participant-side command:

```bash
npx --yes ajv-cli@5.0.0 validate --spec=draft2020 --strict=false -s node_modules/lineage-logo/docs/public-beta/walkthrough-receipt.schema.json -d walkthrough-receipt.json
```

The command must exit zero and report `walkthrough-receipt.json valid`.
Do not transmit a receipt unless validation reports `valid`.

The receipt records only a neutral walkthrough identifier, a pseudonymous participant slot,
the exact resolved installed version, bounded environment and milestone values,
one recovery result, and one controlled issue code. Assign distinct slots to establish
three distinct participants. Maintain no identity linkage: do not retain names, contacts,
account identifiers, or a name-to-slot/reidentification map.

Keep the receipt local until the invitation supplies an owner-approved privacy-safe
return channel that preserves that separation. Then transmit only the schema-valid JSON receipt
through that channel, with no free-text message or other attachment. If no such channel has
been approved, transmit nothing. This protocol offers
neither confidential handling nor a response-time commitment and must not be used for vulnerability reports.
