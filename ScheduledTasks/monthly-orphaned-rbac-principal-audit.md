# Monthly Orphaned RBAC Principal Audit Prompt

```text
Autonomous Scheduled Run — Monthly orphaned RBAC principal audit

Goal: Produce a read-only, complete audit of Azure RBAC assignments at management-group, subscription, resource-group, and tenant-root scopes whose assigned Entra principal no longer resolves. Include orphaned Users, Groups, and Service Principals; do not modify assignments.

Prerequisite — Microsoft Graph access:
- The user-assigned managed identity client ID must have the Microsoft Graph Application permission `Directory.Read.All`, with tenant-wide admin consent granted. This is a Graph app-role assignment, not an Azure RBAC role assignment.
- Acquire Graph tokens for `https://graph.microsoft.com/.default` with that user-assigned identity.
- If Graph returns 401, 403, consent, or permission errors, do not classify any unresolved principal as deleted. Still create all artifacts, mark the audit as partial coverage, and prominently report the exact prerequisite: `Directory.Read.All` application permission plus admin consent for the user-assigned managed identity.

Scope and identity:
- Enumerate every accessible management group, subscription, and resource group, plus tenant-root assignments where readable.
- Use the user-assigned managed identity client ID for ARM and Azure Resource Graph access when the default identity is denied.
- Collect direct and inherited role assignments where the APIs expose them; reconcile tenant-root assignments through the managed Azure command path if the direct ARM list is denied.

Principal verification:
- De-duplicate principal IDs and verify them against Microsoft Graph using bulk `directoryObjects/getByIds` where available.
- Treat a principal as orphaned only when the directory lookup confirms it does not exist. Do not infer deletion solely from a missing display name, Graph authorization failure, or an incomplete Resource Graph result.
- Preserve scope, scope type, principal ID, principal type, permission/role, and assignment ID for every confirmed orphaned assignment.

Resilience and coverage:
- Retry transient 408, 429, and 5xx failures up to three times with 2, 5, and 10 second backoff.
- Continue scanning other readable scopes if an individual scope fails; report failed or unreadable scopes as coverage warnings.
- Validate that generated files are non-empty and carry their expected headers before reporting success.

Artifacts:
- Use a UTC timestamp in the filenames and create a CSV, Markdown, and self-contained HTML report under the thread file area.
- The CSV and Markdown must contain the orphaned-assignment table and the coverage warnings, if any.
- The HTML must include summary metrics, free-text search, scope-type and principal-type filters, Azure Portal links to each scope and role assignment, and a Copy principal action.
- Make every HTML table column sortable. Each header must be a keyboard-accessible button; expose the active sort on the parent table header using `aria-sort`, show ascending/descending indicators, and use a deterministic assignment-ID tie-breaker. The Actions column must sort by role-assignment ID.
- Return working download links for the CSV, Markdown, and HTML artifacts and a concise count summary by principal type and scope type.

Safety and idempotence:
- Read-only only: never delete, modify, or remediate RBAC assignments.
- If no orphaned assignments are found, still produce the three artifacts with headers and an explicit zero-result summary.
- Clearly distinguish complete coverage from partial coverage with warnings.
```
