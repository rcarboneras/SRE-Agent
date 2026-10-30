# Worked example: right-sizing the SRE Agent managed identity (2026-10-29)

**Identity:** user-assigned MI `sreagentracarb-iui7ijcc7z75u`
(object ID `123da879-b7a9-4904-a8b1-8d1ea1ab2e31`, client ID `9ff94ae2-…`)

**Current subscription-level roles:** Owner, Reader, Monitoring Contributor
(plus narrow roles: Grafana Viewer, Automation Contributor on `aa-arcdemo`,
Azure Connected Machine Resource Manager on `arcdc2`, Monitoring Contributor on `rg-sreagent`).

## Evidence (Activity Log, caller = MI object ID, status Succeeded)
Coverage: 2026-08-30 → 2026-10-29 (60 days). 2026-08-01 → 08-30 timed out and is **not covered**.

| Operation | Scope | Covered by existing role? |
|---|---|---|
| `Microsoft.AlertsManagement/alerts/changestate/action` (hundreds) | arc-demo VMs / Arc machines | Yes: Monitoring Contributor (`Microsoft.AlertsManagement/alerts/*`) |
| `Microsoft.Insights/dataCollectionRules/write` (3, 2026-09-10) | `ARC-DEMO/.../am-AzureArc-Managedops-AM-DCR` | Yes: Monitoring Contributor (`Microsoft.Insights/dataCollectionRules/*`) |
| `Microsoft.Compute/virtualMachines/start/action` (~nightly ~23:52 UTC) | `arc-demo/HVHOST`, once `arc-demo/vm2025sql` | **No**: only Owner covers it today |
| `Microsoft.Resources/subscriptions/resourcegroups/write` (1, 2026-10-28) | `rg-pim-test` | One-off (PIM test build); not a standing need |
| `Microsoft.Management/register/action` (2, 2026-10-28) | provider registration | One-off side effect of `az account management-group list` |

Reads are never in the Activity Log; Reader + Monitoring Contributor (`*/read`) already cover them.

## Result
- **Remove** Owner on the subscription.
- **Keep** Reader + Monitoring Contributor.
- **Add** custom role `RACARB-SREAgent-ArcDemoVMOperator` on RG `arc-demo` (see JSON in this folder).

Risk: the custom role has no wildcards, no `Microsoft.Authorization/*`, no data actions; assignable only to `arc-demo`.
Optional additions only if mitigation runbooks need them: `virtualMachines/restart/action`, `virtualMachines/deallocate/action`.
Not recommended: `Microsoft.Authorization/roleDefinitions/write` for the agent; let a human create roles.

## Lessons recorded in SKILL.md
- MI caller in the Activity Log = **object ID**.
- With `--caller`, 30-day windows timed out (exit 124); **10-day slices** worked.
