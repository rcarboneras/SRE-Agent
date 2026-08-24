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
