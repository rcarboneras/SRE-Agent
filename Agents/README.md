# Role Designer — installation and deployment in Azure SRE Agent

**Role Designer** is an [Azure SRE Agent](https://sre.azure.com) custom agent that designs, reviews, right-sizes and audits **Azure RBAC and Microsoft Entra ID custom roles** following the principle of least privilege. Every permission it proposes is justified with evidence (the requested task, the Activity Log or a documented dependency), and it never creates or modifies a role without explicit approval.

It is made of two pieces that are installed separately:

| Piece | Path in the repo | What it provides |
|---|---|---|
| Skill `azure-custom-role-designer` | [`Skills/azure-custom-role-designer/`](../Skills/azure-custom-role-designer/) | The method: 6-step workflow, design rules, risk review, commands and known errors |
| Agent `role_designer` | [`Agents/role_designer.agent.yaml`](role_designer.agent.yaml) | The specialist: instructions, fixed answer format, assigned tools and skill |

It does not need any MCP connector: it queries Microsoft Graph directly with read-only `az ad` commands.

---

## Contents

```text
Agents/
├── README.md                          ← this document
└── role_designer.agent.yaml           ← agent definition (paste into the YAML tab)
Skills/
└── azure-custom-role-designer/
    ├── SKILL.md                       ← skill instructions (paste into the editor)
    ├── azure-custom-role.template.json
    ├── entra-custom-role.template.json
    └── examples/
        ├── update-role.example.json             ← correct format for az role definition update
        ├── sre-agent-mi-rightsizing.md          ← real example of right-sizing an identity
        └── RACARB-SREAgent-ArcDemoVMOperator.json
```

The examples in `examples/` come from the original environment; they are for reference and do not need to be adapted.

---

## Prerequisites

| Requirement | What for | Required |
|---|---|---|
| A deployed Azure SRE Agent | Where the agent is installed | Yes |
| **SRE Agent Administrator** role for the installer | Create skills and agents, and approve actions | Yes |
| **Reader** for the agent identity on the subscriptions to analyze | Read roles, assignments, provider operations and Activity Log | Yes |
| Graph **`Directory.Read.All`** permission (application) for the agent identity | `az ad` queries for users, groups and service principals | Yes, if `az ad` returns 403 |
| `Microsoft.Authorization/roleDefinitions/read` and `write` at the scope | Let the agent create or update Azure roles (always with approval) | Optional (see step 1.3) |
| Microsoft Entra ID **P1** | Entra ID custom roles | Only for Entra roles |
| Microsoft Entra ID **P2** (included in E5) | Eligible assignments with PIM | Only if PIM is used |

---

## Step 1. Prepare the agent identity

### 1.1 Get the identity

```bash
az resource show \
  --ids /subscriptions/<SUB_ID>/resourceGroups/<AGENT_RG>/providers/Microsoft.App/agents/<AGENT_NAME> \
  --query "{type:identity.type, systemPrincipalId:identity.principalId, userAssigned:identity.userAssignedIdentities}" -o json
```

Note the `principalId` (object ID) of the identity the agent uses. If it has a user-assigned identity, it is usually that one. The following steps call it `<MI_OBJECT_ID>`.

### 1.2 Read access in Azure

```bash
az role assignment create --assignee-object-id <MI_OBJECT_ID> --assignee-principal-type ServicePrincipal \
  --role Reader --scope /subscriptions/<SUB_ID>
```

Repeat the command for each subscription you want to analyze, or assign it at a management group.

### 1.3 Role creation (optional)

Decide who creates the roles:

- **A person creates the roles (recommended):** the agent designs the role and delivers the JSON and the command; someone with permissions runs it. Nothing else needs to be granted.
- **The agent creates the roles after approval:** grant the identity a minimal custom role at the scope where roles will be created.

```bash
az role definition create --role-definition '{
  "Name": "<ORG>-RoleDefinitionWriter",
  "IsCustom": true,
  "Description": "Create and update custom role definitions. No delete, no role assignments.",
  "Actions": ["Microsoft.Authorization/roleDefinitions/read", "Microsoft.Authorization/roleDefinitions/write"],
  "NotActions": [], "DataActions": [], "NotDataActions": [],
  "AssignableScopes": ["/subscriptions/<SUB_ID>"]
}'
az role assignment create --assignee-object-id <MI_OBJECT_ID> --assignee-principal-type ServicePrincipal \
  --role "<ORG>-RoleDefinitionWriter" --scope /subscriptions/<SUB_ID>
```

`roleDefinitions/write` is a sensitive permission: whoever holds it can create roles with any permission. Limit its scope and keep the approval policy from step 4.

### 1.4 Microsoft Graph read access

Run this as Global Administrator or Privileged Role Administrator, only if the agent's `az ad` queries return 403 or `Authorization_RequestDenied`:

```bash
MI=<MI_OBJECT_ID>
GRAPH_SP=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)
# 7ab1d382-f21e-4acd-a863-ba3e13f7da61 = Directory.Read.All (application)
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI/appRoleAssignments" \
  --body "{\"principalId\":\"$MI\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"7ab1d382-f21e-4acd-a863-ba3e13f7da61\"}"
```

Do not grant Graph write permissions (`User.ReadWrite.All`, `Group.ReadWrite.All`, …). The agent does not use them: Entra ID changes are always delivered as scripts for a person to run.

---

## Step 2. Create the skill (always before the agent)

1. Go to **sre.azure.com → your agent → Builder → Create → Skill**.
2. **Name:** `azure-custom-role-designer`. It must be exactly this name, because the agent references it that way.
3. **Description:** copy the `description` line from the `SKILL.md` header. The agent uses this text to decide when to activate the skill.
4. **Editor:** paste the full content of [`SKILL.md`](../Skills/azure-custom-role-designer/SKILL.md).
5. **Files:** use **Upload folder** to upload the two `*.template.json` files and the `examples/` folder with the same names, because `SKILL.md` refers to them.
6. **Tools:** leave it empty; the tools belong to the agent.
7. Click **Create**. The skill appears in the **Skills** tab of the Agent Canvas.

---

## Step 3. Create the agent

1. Go to **Builder → Agent Canvas → Create → Custom agent**.
2. Open the **YAML** tab, delete its content and paste the full [`role_designer.agent.yaml`](role_designer.agent.yaml).
3. Switch to the **Form** tab and check:
   - **Custom agent name:** `role_designer`
   - **Instructions:** filled in
   - **Skills:** `azure-custom-role-designer`
   - **Tools:** `RunAzCliReadCommands`, `GetAzCliHelp`, `RunAzCliWriteCommands`
4. Click **Create**. The agent appears as a node in the Agent Canvas.

If the YAML tab shows an error, create the agent from **Form**: enter the name, paste the `system_prompt` text into **Instructions** and pick the skill and tools in the selectors.

---

## Step 4. Enforce approval before any change

The YAML has `agent_type: Autonomous` because that is how the editor exports it. In testing, the agent still asked for approval before `az role definition create`, but do not rely on that alone:

1. **Settings → Tool access policies → Global → Ask** with the pattern `RunAzCliWriteCommands`.
2. **Settings → Basics:** keep the agent's default mode as **Review**. In Autonomous mode, an *Ask* rule is approved automatically.

Only **SRE Agent Administrators** can approve.

---

## Step 5. Test in the playground

Go to **Agent Canvas → Test playground** and select `role_designer`. Test threads are read-only.

| Test prompt | Expected result |
|---|---|
| "I need someone to restart VMs in `<rg>`" | Recommends the built-in **Virtual Machine Contributor** role or a smaller custom one, explaining the difference |
| "Right-size the permissions of the identity `<name or appId>`" | Resolves the object ID with `az ad sp show`, analyzes the Activity Log in 10-day slices and compares it with its current roles |
| "A role that can only reset passwords in the AU `<name>`" | Entra role: proposes the built-in **Password Administrator** scoped to the administrative unit and delivers a script (does not run it) |
| "Audit the custom roles in subscription `<SUB>`" | Read-only report: wildcards, escalation actions, broad scopes, unassigned roles, duplicates of built-in roles |
| "Create that role" (in a normal thread) | Shows the **Approve/Deny** card before running anything |

Every design answer must follow the 6-part format: summary, role JSON, why each action, risk review, deployment and next steps. If it does not, adjust `system_prompt` or `SKILL.md` and test again.

---

## Step 6. Daily use

- **In chat:** open a new thread, type `/agent`, pick `role_designer` and make the request in natural language. The agent sees the previous context of the thread.
- **Without `/agent`:** the skill is also available to the main agent, but `role_designer` guarantees the format and the restricted tools.
- **Periodic audit:** create a scheduled task, for example monthly, with the prompt *"Audit the custom roles in subscription `<SUB>` and post the result to Teams"* assigned to `role_designer`, in Review mode.

---

## Update to a new version

1. **Skill:** Builder → Skills → `azure-custom-role-designer` → **Edit**. Paste the new `SKILL.md`, upload any changed files and click **Save**.
2. **Agent:** Agent Canvas → `role_designer` node → **Edit** → **YAML** tab. Paste the new YAML and click **Save**.
3. **Record:** after saving, copy the YAML shown by the editor back to the repository, so the repo always reflects what is deployed.

---

## Troubleshooting

All these errors came up during development and are verified.

| Error | Cause | Fix |
|---|---|---|
| `Invalid YAML: Failed to locate agent specification in YAML` | Flat YAML (`name`, `system_prompt` at the root) | Use the `api_version: azuresre.ai/v1` / `kind: AgentConfiguration` / `spec:` format from this repo |
| `This field is required` in the YAML tab | `azuresre.ai/v2` / `kind: ExtendedAgent` format | Same v1 format, or create the agent from **Form** |
| The skill does not appear in **Choose skills** | The skill does not exist or has a different name | Create the skill first (step 2) with the exact name |
| `KeyError: 'roleName'` in `az role definition update` | JSON in creation format (`Name`/`Id`) | Use the format from [`examples/update-role.example.json`](../Skills/azure-custom-role-designer/examples/update-role.example.json) (`roleName` + full `id`) |
| `ValidationError` when using `az rest` | `az rest` is not allowed in the agent's tools | Intended: the agent delivers the script to the user |
| `az ad …` returns 403 / `Authorization_RequestDenied` | The identity cannot read Graph | Step 1.4 (`Directory.Read.All`) |
| Activity Log: `exit code 124` or empty result | Window too long or `--max-events` truncated | 10-day slices with `--caller <objectId>`; managed identities appear as **object ID** |
| `BadRequest: start time cannot be more than 90 days` | The Activity Log keeps 90 days | Limit the window to 90 days |
| `RoleAssignmentExists` when creating a PIM eligibility | The eligibility already exists | Use `AdminExtend` / `AdminUpdate` |
| `RoleAssignmentRequestPolicyValidationFailed` | The role's PIM settings do not allow permanent eligibility | Use a duration (e.g. `P365D`) or deliberately change the role settings |
| The agent creates a role without asking for approval | The step 4 policy is missing or the mode is Autonomous | Apply step 4 and repeat the test |

---

## Known limitations

- **Entra roles and PIM cannot be read from the agent:** Entra ID role definitions and assignments and PIM schedules have no `az ad` command, and `az rest` is blocked. The agent asks the user to run a Microsoft Graph PowerShell script and paste back the output.
- **All Entra or PIM writes are manual:** creating Entra roles, assigning roles and creating PIM eligibilities are always delivered as scripts.
- **What the Activity Log does not show:** it does not record reads and only keeps 90 days, so read requirements are inferred.
- **Never deletes:** the agent does not delete roles or assignments; it only recommends it.

---

## Uninstall

1. Agent Canvas → `role_designer` node → delete it.
2. Builder → Skills → `azure-custom-role-designer` → delete it.
3. Revoke the permissions granted in step 1 that are no longer needed (`<ORG>-RoleDefinitionWriter` role, `Directory.Read.All`).
