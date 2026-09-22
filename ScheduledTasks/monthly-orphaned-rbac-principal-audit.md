# Monthly Orphaned RBAC Principal Audit

## Scheduled task prompt

```text
Autonomous Scheduled Run

Goal: Produce a fresh, read-only orphaned-RBAC audit covering exact Resource Group, Subscription, Management Group, and tenant-root assignments. An orphaned principal is an Azure RBAC-assigned principal that does not resolve in the current Entra directory.

Scope: All subscriptions and management groups readable by this agent. Include only direct role assignments whose scopes are exactly a resource group, subscription, management group, or tenant root. Exclude assignments scoped below a resource group.

Fast workflow:
1. Use the user-assigned managed identity client ID 11f299d1-abc0-450c-9e40-68f13c658e56 for ARM and Azure Resource Graph reads; the default system identity may return 403 for Resource Graph.
2. Discover enabled subscriptions, query Azure Resource Graph for subscription- and resource-group-scoped Microsoft.Authorization/roleAssignments, and enumerate direct management-group role assignments through ARM. Deduplicate by role-assignment ID.
3. Tenant-root assignments: direct ARM listing can be denied. Use an inherited assignment query from one readable subscription with `az role assignment list --all --include-inherited`, keep only scope `/`, and deduplicate by assignment ID.
4. Resolve all distinct principal IDs efficiently with Microsoft Graph `directoryObjects/getByIds` in batches of at most 900. Include `user`, `group`, `servicePrincipal`, and `device` types. Do not use one-by-one lookup except as a narrow fallback.
5. Mark a principal orphaned only when it is absent from the current Entra directory. Preserve Azure RBAC principal type. Resolve role definition IDs to role names through ARM; fall back to the ID only if the definition cannot be read.
6. Do not change RBAC, Entra objects, Azure resources, schedules, or configuration.

Reliability:
- For transient ARM or Microsoft Graph failures only (HTTP 408, 429, and 5xx), retry up to 3 times with bounded exponential backoff: 2, 5, then 10 seconds.
- Do not retry authorization, invalid-request, or resource-not-found errors. Record the failed scope and continue with remaining readable scopes.
- If tenant-root direct listing is denied, use the inherited-assignment fallback. If that fallback fails, record tenant-root coverage as unavailable.
- Validate that both output files exist, are non-empty, and contain the expected headers before publishing them.
- Never fail the whole run because one management group, subscription, role definition, or directory-object lookup is unavailable; finish with an explicit coverage-limitation section.

Artifacts and output:
- Create two timestamped files under the current thread's `tmp/ThreadFiles/` directory. Use a UTC `YYYYMMDD-HHMMSS` suffix; never overwrite prior artifacts.
  1. `orphaned-rbac-principals-<timestamp>.csv` with columns: scopeType, scope, principalId, principalType, permission, assignmentId, directoryStatus.
  2. `orphaned-rbac-report-<timestamp>.md` containing the run timestamp, coverage/limitation summary, metrics table, and the complete Markdown table of every orphaned assignment.
- Persist both files for download and include both links in the run output.
- Keep the chat output concise: include a summary table only, not the full assignment list. The Markdown report must carry the complete table.

Idempotence: Each run must take a fresh inventory and create new timestamped artifacts.
```
