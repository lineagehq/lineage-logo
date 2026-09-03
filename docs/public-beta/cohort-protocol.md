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
free-form vulnerability details as part of this protocol.

## Required milestones

Record each milestone only as `pass`, `fail`, `blocked`, or `not_attempted` in the
versioned [receipt schema](walkthrough-receipt.schema.json). The required order is:

1. `fresh_install`: install the exact published beta from the registry in a fresh local directory.
2. `non_destructive_bootstrap`: run the shipped bootstrap and verify it does not overwrite,
   merge, or delete existing files.
3. `proposal_comprehension`: use the shipped, redacted agent context/proposal contract and
   identify the proposal as pending review rather than an applied change.
4. `review`: inspect the proposal and choose a review decision without maintainer coaching.
5. `accept`: accept the reviewed proposal.
6. `save`: save the accepted result through the product's normal Save flow.
7. `clean_reopen`: reopen cleanly and verify the saved accepted result remains available.

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

## Invalid-attempt rules

Set `attempt_status` to `invalid` and stop counting the attempt if any of these occur:

- Maintainer coaching, hints, remote control, or environment repair during the walkthrough.
- A local tarball, source checkout, linked package, unpublished build, unsupported platform,
  unsupported browser, or Node.js version below 22 is used.
- Any required milestone is skipped, missing, or represented as successful without completing it.
- The receipt includes personal data, credentials, tokens, private paths, SVG contents,
  browser/session data, or free-form confidential vulnerability details.
- The workflow collects participant feedback, consent, contact information, or telemetry.

Use `incomplete` for a stopped attempt that is not invalid. It is still non-counting.

## Receipt handling

Create one JSON object that validates against the linked schema. It records only a neutral
walkthrough identifier, exact beta version, bounded environment, milestone statuses, one
recovery result, and a controlled issue code. Keep it local. This protocol offers neither
confidential handling nor a response-time commitment.
