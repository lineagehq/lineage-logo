# Security policy

The public beta intentionally has no private vulnerability-reporting channel.
Maintainers therefore cannot accept reports that require confidential handling.
Do not put exploit details, credentials, private paths, unpublished SVGs, or
other sensitive material in a public issue.

The public issue tracker may be used for non-sensitive security-hardening ideas
only when the report can be safely disclosed in full. Otherwise, withhold the
details until a future release names a confidential route. This is an explicit
beta limitation, not a security-reporting best practice.

The local server is designed to bind only to loopback, restrict filesystem
access to the explicit workspace, protect agent routes with an owner-only bearer
capability, and reject active or external SVG content. These controls reduce
risk; they are not a security warranty. Security support is best effort, with no
response-time SLA or commitment to support older beta versions.
