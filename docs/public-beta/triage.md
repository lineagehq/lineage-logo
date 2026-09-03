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
| Atomic Accept all does not return a durable path, digest, and artifact | `accept_and_durable_save` | Stop after the permitted recovery rule. |
| Clean reopen does not retain the accepted saved result | `reopen_or_persistence` | Stop; treat as a release blocker. |
| Platform, Node version, or browser falls outside the protocol | `unsupported_environment` | Mark invalid; it cannot count. |
| Possible data loss, secret exposure, or other safety concern | `safety_or_data_loss` | Stop immediately and retain no sensitive detail. |

## Deterministic precedence

When more than one receipt signal is present, select exactly the first matching signal in
this machine-readable order. The selected code is the only `issue_code` in the receipt.
For example, unsupported environment wins over an installation failure, and possible data
loss wins over an unsafe bootstrap signal.

```json
{
  "precedence": [
    { "signal": "safety_or_data_loss", "issue_code": "safety_or_data_loss" },
    { "signal": "unsupported_environment", "issue_code": "unsupported_environment" },
    { "signal": "bootstrap_safety", "issue_code": "bootstrap_safety" },
    { "signal": "reopen_or_persistence", "issue_code": "reopen_or_persistence" },
    { "signal": "accept_and_durable_save", "issue_code": "accept_and_durable_save" },
    { "signal": "proposal_or_review", "issue_code": "proposal_or_review" },
    { "signal": "install_failure", "issue_code": "install_failure" }
  ]
}
```

The issue code is an outcome label, not a diagnosis. The bounded receipt schema deliberately
has no text field for descriptions, paths, artifact contents, session data, or confidential
reports. There is no confidential-reporting channel or SLA in this operating kit.

For a non-`none` code, set the affected milestone to `fail` or `blocked`, apply the recovery
rubric in the protocol, and preserve the resulting non-counting receipt. A receipt with an
unsupported environment or prohibited data is invalid; all other stopped receipts are
incomplete unless the invalid-attempt rules say otherwise.
