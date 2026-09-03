# Local walkthrough issue triage v1

Apply this deterministic rubric to a local receipt. It does not create an issue, contact
anyone, collect feedback, or promise a response time. Do not add free-form details to the
receipt.

| Receipt signal | Issue code | Local disposition |
| --- | --- | --- |
| No problem and all milestones pass | `none` | Retain the minimal receipt locally. |
| Exact registry installation cannot complete | `install_failure` | Stop the attempt; inspect only reproducible, non-sensitive local conditions later. |
| Bootstrap overwrites, merges, deletes, or appears unsafe | `bootstrap_safety` | Stop immediately; do not retry by editing files. |
| Proposal cannot be understood as pending review, or review cannot complete | `proposal_or_review` | Stop after the permitted recovery rule. |
| Accept or normal Save cannot complete | `accept_or_save` | Stop after the permitted recovery rule. |
| Clean reopen does not retain the accepted saved result | `reopen_or_persistence` | Stop; treat as a release blocker. |
| Platform, Node version, or browser falls outside the protocol | `unsupported_environment` | Mark invalid; it cannot count. |
| Possible data loss, secret exposure, or other safety concern | `safety_or_data_loss` | Stop immediately and retain no sensitive detail. |

The issue code is an outcome label, not a diagnosis. The bounded receipt schema deliberately
has no text field for descriptions, paths, artifact contents, session data, or confidential
reports. There is no confidential-reporting channel or SLA in this operating kit.

For a non-`none` code, set the affected milestone to `fail` or `blocked`, apply the recovery
rubric in the protocol, and preserve the resulting non-counting receipt. A receipt with an
unsupported environment or prohibited data is invalid; all other stopped receipts are
incomplete unless the invalid-attempt rules say otherwise.
