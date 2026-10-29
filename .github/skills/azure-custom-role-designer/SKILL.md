---
name: azure-custom-role-designer
description: Design least-privilege Azure RBAC and Microsoft Entra ID custom roles. Use when a user asks to create, review, right-size or audit a custom role, wants to replace Owner/Contributor with something narrower, or asks which actions a task needs.
---

# Azure / Entra custom role designer

Produces a **reviewed, least-privilege role definition** with evidence for every permission.
Never creates or assigns a role without explicit user approval.

## When to use
- "Create a custom role that can X on Y"
- "Is Owner/Contributor too much for <identity>? Right-size it"
- "Review this role JSON" / "audit our custom roles"
- Entra ID: "a role that can only manage app registrations / reset passwords in an AU"

## Workflow (follow in order)

### 1. Clarify the request (ask only for what is missing)
| Question | Why |
|---|---|
| Azure resources or Entra ID (directory objects)? | Different role systems, different permission names |
| Tasks in plain words ("restart VMs", "read Key Vault secrets") | Map to actions |
| Scope: management group / subscription / resource group / resource (Azure) or tenant / administrative unit / app (Entra) | Sets `AssignableScopes` / `directoryScopeId` |
| Who gets it (user, group, managed identity) and via PIM? | Assignment plan |
| Existing identity to right-size? | Enables evidence-based design (step 3) |

### 2. Check built-in roles first
A custom role is only justified when no built-in role fits.
```bash
az role definition list --query "[?roleType=='BuiltInRole' && contains(roleName,'<keyword>')].{name:roleName, id:name}" -o table
az role definition list --name "<Built-in name>" --query "[0].permissions" -o json
```
If a built-in role covers the need with ≤ 1–2 extra actions, recommend it instead (state the gap).

### 3. Gather evidence for the actions
**a) From the provider catalogue (always):**
```bash
az provider operation show --namespace Microsoft.Compute \
  --query "resourceTypes[].operations[].{action:name, desc:displayName, data:isDataAction}" -o table
```
`isDataAction = true` → goes in `DataActions`, otherwise `Actions`.
Docs index: https://learn.microsoft.com/azure/role-based-access-control/resource-provider-operations

**b) From real usage, when right-sizing an existing identity (preferred):**
```bash
az monitor activity-log list --subscription <sub> --caller <caller> \
  --start-time <ISO, ≤ 90 days ago> --end-time <ISO> --max-events 5000 \
  --query "[?status.value=='Succeeded'].operationName.value" -o tsv | sort | uniq -c | sort -rn
```
Gotchas (verified):
- The Activity Log keeps **90 days**; `--start-time` older than that fails with `BadRequest`.
- It records **write / delete / action** operations only, **never reads (GET)**. Read needs must be inferred (e.g. `<provider>/*/read`) or taken from resource diagnostic logs.
- `--max-events` silently truncates. A wide window can return an empty or partial list even when events exist. Query in slices (e.g. 7 days) and sanity-check against a known event before trusting an empty result.
- `caller` format differs by principal: UPN for users; **object ID** for managed identities (verified 2026-10-29). For other service principals, sample a few raw events first.
- `--caller` is a server-side filter, but long windows still time out (exit code 124 at 30 days for a busy identity). Use **10-day slices** and report any slice that failed as a coverage gap.
- Each operation appears twice (`Started` + `Succeeded`): filter on `Succeeded`.

**c) Entra ID permissions** (only these object types support custom roles):
- App registrations: https://learn.microsoft.com/entra/identity/role-based-access-control/custom-available-permissions
- Enterprise apps: …/custom-enterprise-app-permissions · Users: …/custom-user-permissions · Groups: …/custom-group-permissions · Devices: …/custom-device-permissions

Before proposing a new role, compare every observed operation with the identity's **other** role assignments (`az role definition list --name "<role>" --query "[0].permissions[0].actions"`); only the uncovered operations need the custom role. Discard one-off operations (e.g. a single resource-group write during a test) after confirming with the user.

### 4. Draft the role
Use the templates in this folder: `azure-custom-role.template.json`, `entra-custom-role.template.json`.
Worked example: `examples/sre-agent-mi-rightsizing.md`.

Design rules (Azure):
1. **No bare `*`** in `Actions`. Prefer `Microsoft.X/<type>/read|write|action` over `Microsoft.X/*`.
2. **Never** include `Microsoft.Authorization/*`, `Microsoft.Authorization/roleAssignments/write`, `roleDefinitions/write` or `elevateAccess/action` unless the role is explicitly an access-management role, and flag it as HIGH risk.
3. `NotActions` **subtracts** from `Actions`; it is **not a deny**. Another role assignment can still grant the excluded action.
4. Keep `AssignableScopes` as narrow as the use case: one subscription or resource group. Root `/` is not allowed. Only **one management group** can be listed, and roles with `DataActions` **cannot** be assigned at management-group scope.
5. Name convention: `<ORG>-<Workload>-<Capability>` (e.g. `RACARB-Arc-VMOperator`), description states scope, purpose, owner and date.
6. Read access: include `Microsoft.Resources/subscriptions/resourceGroups/read` so the role can navigate the portal; add `Microsoft.Insights/alertRules/*` and `Microsoft.Support/*` only if needed.

Design rules (Entra):
1. Requires **Entra ID P1**.
2. **Create** permissions (e.g. `microsoft.directory/applications/create`) only work when assigned at **tenant scope** (`/`).
3. Scopes available: tenant `/`, administrative unit `/administrativeUnits/<id>`, single app `/<application objectId>` (object ID, not appId).
4. Groups that receive Entra roles must be **role-assignable** (`isAssignableToRole=true`, set at creation only).

### 5. Risk review (include in every answer)
| Check | Result |
|---|---|
| Wildcards used | list them |
| Privilege-escalation actions (`Microsoft.Authorization/*`, `*/listKeys/action`, `Microsoft.Compute/virtualMachines/runCommand/action`, `Microsoft.KeyVault/vaults/secrets/getSecret/action`, `Microsoft.Web/sites/config/list/action`) | flag each as HIGH |
| Data-plane access (`DataActions`) | list |
| Broader than evidence? | actions not seen in usage |
| Closest built-in role and delta | e.g. "Virtual Machine Contributor − 14 actions" |

### 6. Validate and deliver
- Validate JSON: `python3 -m json.tool role.json`.
- Show the final JSON, the risk table and the deployment commands.
- **Create only after explicit approval** (Review mode shows an approval card):
  ```bash
  az role definition create --role-definition @role.json --subscription <sub>
  az role definition update --role-definition @role.json --subscription <sub>   # changes: must include "Name" or "id"
  ```
  Entra (the agent cannot write to Graph: hand the user this script):
  ```powershell
  Connect-MgGraph -Scopes RoleManagement.ReadWrite.Directory
  New-MgRoleManagementDirectoryRoleDefinition -BodyParameter (Get-Content role.json -Raw | ConvertFrom-Json -AsHashtable)
  ```
- Offer next steps: PIM-eligible assignment script, PR to the roles-as-code folder, and removal of the over-privileged assignment it replaces (never remove automatically).

## Agent-specific constraints (this SRE Agent)
- Azure CLI writes allowed: `create`, `update`, `set` (with approval). **Not allowed:** `delete`, `remove`, `az rest`. So: role creation works; PIM eligibility (`roleEligibilityScheduleRequests`) and Entra writes must be handed to the user as scripts.
- Graph is read-only through the MCPEnterprise bridge (use it to read Entra role definitions/assignments).
- Custom roles per tenant: max 5,000 (Azure); propagation of a new or changed role can take a few minutes.
