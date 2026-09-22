# SRE Agent MCP Enterprise Bridge

This repository contains a small, reusable MCP bridge that lets **Azure SRE Agent** query Microsoft Entra / Microsoft Graph tenant licensing data through MCP tools.

## Why this solution exists

Microsoft provides **Microsoft MCP Server for Enterprise**:

https://github.com/mcp/microsoft/EnterpriseMCP

EnterpriseMCP exposes Microsoft Graph-backed tools such as:

- `microsoft_graph_suggest_queries`
- `microsoft_graph_get`
- `microsoft_graph_list_properties`

However, EnterpriseMCP currently requires a **pre-registered Entra MCP client application** and does **not** support Dynamic Client Registration (DCR). Azure SRE Agent's generic OAuth MCP connector currently supports OAuth only for MCP servers that support DCR, and it does not expose fields for a custom client ID/client secret.

Because of that OAuth mismatch, SRE Agent cannot connect directly to EnterpriseMCP today.

This bridge solves the gap:

```text
Azure SRE Agent
  -> Managed identity token
  -> Azure Container Apps MCP bridge
  -> Bridge managed identity
  -> Microsoft Graph
```

The bridge gives SRE Agent a compatible MCP endpoint while preserving Entra-based authentication, no stored secrets, and read-only Microsoft Graph access.

## What the bridge does

- Accepts MCP Streamable-HTTP requests from SRE Agent.
- Validates the SRE Agent managed identity JWT.
- Uses its own user-assigned managed identity to call Microsoft Graph.
- Exposes EnterpriseMCP-style Graph helper tools and purpose-built license optimization tools.
- Runs on Azure Container Apps Consumption with scale-to-zero for low cost.

## Components

| Component | Purpose |
| --- | --- |
| Azure SRE Agent MCP connector | Calls the bridge over Streamable-HTTP. |
| SRE Agent managed identity | Authenticates SRE Agent to the bridge API. |
| Bridge API app registration | Defines the token audience and `McpBridge.Access` app role. |
| Azure Container App | Hosts the Node.js MCP bridge. |
| Bridge user-assigned managed identity | Pulls the image from ACR and calls Microsoft Graph. |
| Azure Container Registry | Stores the bridge container image. |
| Microsoft Graph | Provides tenant license, user, app, group, audit, and sign-in data. |

## Requirements

### Azure subscription and providers

- An Azure subscription and a resource group in a region that supports Azure Container Apps Consumption.
- Azure CLI signed in to the target tenant and subscription. The scripts use the `account`, `group`, `acr`, `deployment`, and `ad` command groups, plus `az rest` for Microsoft Graph calls.
- The following resource providers must be registered in the subscription:
  - `Microsoft.ContainerRegistry`
  - `Microsoft.App`
  - `Microsoft.ManagedIdentity`
  - `Microsoft.Authorization`
- The deployment identity must be allowed to create and update the resource group, Azure Container Registry, Container Apps managed environment, Container App, and user-assigned managed identity.
- The deployment identity must also be allowed to create the `AcrPull` role assignment on the ACR. `Contributor` alone does not include permission to create role assignments; use `Owner`, `User Access Administrator` plus the required resource permissions, or an equivalent custom role.

Provider registration can be checked or performed with:

```powershell
az provider show --namespace Microsoft.ContainerRegistry --query registrationState --output tsv
az provider show --namespace Microsoft.App --query registrationState --output tsv
az provider show --namespace Microsoft.ManagedIdentity --query registrationState --output tsv
az provider show --namespace Microsoft.Authorization --query registrationState --output tsv

# Run only when a provider is not Registered.
az provider register --namespace Microsoft.ContainerRegistry
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.ManagedIdentity
az provider register --namespace Microsoft.Authorization
```

### Microsoft Entra and Microsoft Graph permissions

The person running the permission scripts needs a directory role that permits managing app registrations, service principals, and app-role assignments. `Application Administrator` or `Cloud Application Administrator` is typically sufficient for these operations, subject to the tenant's consent policy. A more privileged administrator may be required by tenant policy to grant Microsoft Graph application permissions.

The bridge API app registration created by script 02 exposes:

- The `McpBridge.Access` application role for the SRE Agent managed identity.
- The `user_impersonation` delegated scope for the API definition. The bridge flow uses the application role; it does not depend on delegated user access.

Script 04 grants the bridge user-assigned managed identity these Microsoft Graph **application permissions**:

| Permission | Used for |
| --- | --- |
| `Organization.Read.All` | Tenant organization and subscribed SKU information. |
| `Directory.Read.All` | Domains, groups, applications, and service principals. |
| `User.Read.All` | User profiles and assigned licenses. |
| `AuditLog.Read.All` | Directory audit events and sign-in activity. |
| `Reports.Read.All` | Microsoft 365 usage and licensing report data where applicable. |

Tenant-wide admin consent is required for these application permissions. The bridge identity must be the identity created by the ARM deployment, and its principal ID is the `bridgeManagedIdentityPrincipalId` output.

### SRE Agent identity

- An SRE Agent user-assigned managed identity that can be selected by the MCP connector.
- Its client ID must be passed to script 03 as `AllowedClientIds`.
- Its principal (object) ID must be passed to script 05 as `SreAgentManagedIdentityPrincipalId`.
- Script 05 grants this identity the bridge API's `McpBridge.Access` application role. The connector must request the scope `api://<bridge-app-client-id>/.default` and send a token whose audience is `api://<bridge-app-client-id>`.

### Local tools and inputs

- PowerShell 7 or later is recommended.
- Azure CLI with permission to use the commands and Graph operations described above.
- The bridge source must be available locally for `az acr build`; local Docker is not required because the image is built in ACR.
- Required deployment values: subscription, resource group, Azure region, globally unique ACR name, tenant ID, bridge app client ID, bridge managed identity output, and SRE Agent managed identity IDs.

## MCP tools exposed

| Tool | Purpose |
| --- | --- |
| `microsoft_graph_suggest_queries` | Suggests common read-only Graph queries. |
| `microsoft_graph_get` | Executes read-only Microsoft Graph v1.0 GET requests. |
| `microsoft_graph_list_properties` | Lists common Graph entity properties. |
| `get_tenant_directory_summary` | Summarizes organization, domains, SKUs, users, groups, apps, and service principals. |
| `get_tenant_license_consumption` | Returns purchased and consumed license units by SKU. |
| `find_unassigned_licenses` | Calculates unassigned licenses and utilization by SKU. |
| `get_assigned_licenses_per_user` | Lists users with assigned licenses. |
| `search_directory_users` | Searches users by display name or UPN. |
| `get_user_license_details` | Returns license details for one user. |
| `detect_inactive_licensed_users` | Finds licensed users with no recent sign-in activity. |
| `generate_license_optimization_recommendations` | Generates license reclamation and renewal recommendations. |
| `list_directory_groups` | Lists groups for governance and hygiene review. |
| `list_applications_without_owners` | Finds app registrations without owners. |
| `list_service_principals` | Lists enterprise applications/service principals. |
| `list_tenant_domains` | Lists tenant domains and verification state. |
| `list_recent_directory_audits` | Lists recent directory audit events. |

## Repository layout

| Path | Purpose |
| --- | --- |
| `src\` | Node.js/TypeScript MCP bridge source and Dockerfile. |
| `infra\azuredeploy.json` | Parameterized ARM template for Container Apps and managed identity. |
| `infra\azuredeploy.parameters.example.json` | Example deployment parameters. |
| `scripts\` | Deployment and permission scripts. |
| `docs\architecture-simple.drawio` / `.svg` | Customer-facing architecture diagram. |
| `docs\flow-simple.drawio` / `.svg` | Customer-facing request and permission flow diagram. |
| `docs\Tenant-License-MCP-Bridge-Peer-Briefing.pptx` | Short customer/peer presentation. |
| `docs\Tenant-License-MCP-Bridge-Prerequisites.docx` | Customer-facing prerequisites and setup guide. |

## Deployment sequence

Run the scripts in order from the `scripts` folder:

1. `01-create-acr-and-build-image.ps1`
2. `02-create-bridge-api-app.ps1`
3. `03-deploy-container-app.ps1`
4. `04-grant-graph-permissions-to-bridge-mi.ps1`
5. `05-grant-sre-agent-access-to-bridge-api.ps1`
6. `06-verify-deployment.ps1`

## SRE Agent connector settings

| Field | Value |
| --- | --- |
| Name | `license-optimization-mcp` |
| Connection type | `Streamable-HTTP` |
| URL | Output from ARM deployment: `sreAgentConnectorUrl` |
| Authentication method | `Managed identity` |
| Managed identity | SRE Agent user-assigned managed identity |
| Federated identity credential | Unchecked |
| Azure AD token scope | `api://<bridge-app-client-id>/.default` |

Important:

```text
Container App BRIDGE_AUDIENCE = api://<bridge-app-client-id>
SRE Agent token scope         = api://<bridge-app-client-id>/.default
```

## Security model

- SRE Agent does not receive direct Microsoft Graph permissions.
- The bridge validates the SRE Agent managed identity token before accepting MCP requests.
- The bridge uses its own managed identity for Microsoft Graph app-only access.
- Graph access is read-only.
- The bridge does not assign, remove, or modify licenses.

## Example prompts for testing

Use these prompts in SRE Agent after the `license-optimization-mcp` connector is connected and the tools are selected.

### Interactive prompts

#### 1. Tenant license consumption overview

```text
Use the license-optimization-mcp connector to get the current tenant license consumption.

Show me:
- All subscribed SKUs
- Purchased/enabled units
- Consumed units
- Unassigned units
- Utilization percentage per SKU

Return the result as a table and highlight any SKU with utilization below 70%.
```

#### 2. Find unassigned licenses

```text
Use the license-optimization-mcp connector to identify unassigned licenses in the tenant.

For each SKU, show:
- SKU part number
- Total enabled licenses
- Consumed licenses
- Unassigned licenses
- Utilization percentage

Then summarize which SKUs have the highest reclaim or cost-avoidance opportunity.
```

#### 3. Detect inactive licensed users

```text
Use the license-optimization-mcp connector to find users who have assigned licenses but have not signed in during the last 90 days.

Return:
- User display name
- User principal name
- Account enabled status
- Last sign-in date
- Number of assigned licenses

Group the results by accountEnabled = true or false, and recommend which users should be reviewed first.
```

#### 4. Generate license optimization recommendations

```text
Use the license-optimization-mcp connector to generate tenant license optimization recommendations.

Analyze:
- License consumption by SKU
- Unassigned license capacity
- Licensed users inactive for 90 days
- SKUs with low utilization

Return:
- Executive summary
- Top 5 optimization opportunities
- Risks or validation steps before reclaiming licenses
- Suggested next actions for the license owner
```

#### 5. User-specific license investigation

```text
Use the license-optimization-mcp connector to investigate license assignment for this user: <user@domain.com>.

Show:
- Basic user profile
- Account enabled status
- Assigned licenses
- License details and service plans
- Last sign-in activity if available

Then tell me whether this user appears active and whether the license assignment should be reviewed.
```

#### 6. EnterpriseMCP-style Graph query test

```text
Use the license-optimization-mcp connector and the microsoft_graph_suggest_queries tool to suggest Microsoft Graph queries for this intent:

"Find licensed users who have not signed in recently and estimate potential license savings."

Then use the most relevant read-only Graph query through microsoft_graph_get and summarize the results.
```

### Scheduled prompts

#### 7. Weekly license optimization report

```text
Every Monday at 9:00 AM, use the license-optimization-mcp connector to generate a weekly license optimization report.

Include:
- Current license consumption by SKU
- Unassigned licenses by SKU
- SKUs under 70% utilization
- Licensed users inactive for more than 90 days
- Top 5 recommended cleanup actions

Format the output as an executive summary followed by a detailed table.
```

#### 8. Monthly renewal readiness review

```text
On the first business day of every month, use the license-optimization-mcp connector to prepare a license renewal readiness report.

Analyze:
- Purchased versus consumed licenses
- Month-over-month license utilization if prior reports are available
- Unassigned license capacity
- Inactive licensed users over 90 days
- Potential over-provisioned SKUs

Provide recommendations for renewal quantity review, license reclamation, and follow-up with business owners.
```

#### 9. Daily inactive licensed user watch

```text
Every weekday at 8:30 AM, use the license-optimization-mcp connector to check for newly inactive licensed users.

Use a 90-day inactivity threshold.

Return only:
- Users that are newly detected compared with the previous run, if memory/history is available
- User principal name
- Last sign-in date
- Assigned license count
- Recommended review priority

If there are no new findings, respond with a short "No new inactive licensed users detected" summary.
```

#### 10. Weekly Entra hygiene and license governance check

```text
Every Friday at 3:00 PM, use the license-optimization-mcp connector to run an Entra hygiene and license governance check.

Include:
- License utilization by SKU
- Unassigned licenses
- Inactive licensed users
- App registrations without owners
- Service principal inventory summary
- Recent directory audit events that may affect license or identity governance

Return:
- Key risks
- Recommended actions
- Items that require admin review
- Items that can be safely monitored
```
