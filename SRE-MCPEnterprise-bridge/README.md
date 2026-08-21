# Tenant License Optimization MCP Bridge for Azure SRE Agent

## Solution summary

This solution lets Azure SRE Agent query Microsoft Graph tenant licensing data through a custom MCP bridge hosted on Azure Container Apps. SRE Agent authenticates to the bridge with managed identity. The bridge validates the Entra JWT, then uses its own user-assigned managed identity to call Microsoft Graph and expose license-optimization MCP tools.

| Component | Function | Estimated cost |
| --- | --- | --- |
| Azure SRE Agent MCP connector | Connects SRE Agent to the MCP bridge using Streamable-HTTP and managed identity. | Included with Azure SRE Agent usage/pricing. |
| Azure Container Apps, Consumption | Hosts the Node.js MCP bridge. Configured with scale-to-zero, 0.25 vCPU, 0.5 Gi memory, and max 1 replica for lowest cost. | Near-zero when idle; pay per vCPU-second/request while active. Region and usage dependent. |
| Azure Container Apps managed environment | Runtime environment for the Container App. | No separate fixed charge in Consumption; workload usage is billed. |
| Azure Container Registry Basic | Stores the MCP bridge container image. | Low fixed monthly cost, commonly around a few USD/month; region dependent. |
| User-assigned managed identity for bridge | Pulls the image from ACR and calls Microsoft Graph. | No direct cost. |
| Microsoft Entra app registration for bridge API | Defines the bridge API audience and app role used by SRE Agent managed identity. | No direct cost. |
| Microsoft Graph API | Provides tenant license, user, sign-in, and report data. | No extra API charge; requires appropriate Microsoft 365/Entra licenses and permissions. |
| SRE Agent managed identity | Acquires a token for the bridge API and calls the MCP connector. | No direct cost. |

## MCP tools exposed by the bridge

| Tool | Purpose |
| --- | --- |
| `microsoft_graph_suggest_queries` | EnterpriseMCP-style query suggestion tool for common read-only Graph scenarios. |
| `microsoft_graph_get` | EnterpriseMCP-style read-only Microsoft Graph v1.0 GET executor. |
| `microsoft_graph_list_properties` | EnterpriseMCP-style schema helper for common Entra/Graph entities. |
| `get_tenant_directory_summary` | Returns organization, domain, SKU, user, group, app, and service principal summary data. |
| `get_tenant_license_consumption` | Reads `/subscribedSkus` and returns purchased/consumed license data by SKU. |
| `find_unassigned_licenses` | Calculates unassigned capacity and SKU utilization percentage. |
| `get_assigned_licenses_per_user` | Lists users with assigned licenses. |
| `search_directory_users` | Searches users by display name or UPN and returns license/sign-in relevant fields. |
| `get_user_license_details` | Returns license details for a specific user. |
| `detect_inactive_licensed_users` | Finds licensed users whose last sign-in is older than the threshold. |
| `generate_license_optimization_recommendations` | Generates read-only optimization recommendations from SKU utilization and inactive licensed users. |
| `list_directory_groups` | Lists groups for access governance and hygiene analysis. |
| `list_applications_without_owners` | Finds app registrations that do not have owners. |
| `list_service_principals` | Lists enterprise applications/service principals. |
| `list_tenant_domains` | Lists tenant domains and verification/default state. |
| `list_recent_directory_audits` | Lists recent directory audit events for provenance/investigation context. |

## Folder contents

| Path | Description |
| --- | --- |
| `src\` | Parameterized Node.js/TypeScript MCP bridge source. |
| `infra\azuredeploy.json` | ARM template for Azure Container Apps, ACR pull identity, and lowest-cost compute settings. |
| `infra\azuredeploy.parameters.example.json` | Example parameter file. |
| `scripts\` | End-to-end deployment, identity, permission, and verification scripts. |
| `diagram\tenant-license-mcp-bridge-azure-icons.drawio` | Editable architecture diagram for diagrams.net/draw.io with embedded official Azure icons. |
| `diagram\tenant-license-mcp-bridge-azure-icons.svg` | Viewable architecture diagram with embedded official Azure icons. |
| `diagram\tenant-license-mcp-runtime-flow-azure-icons.drawio` | Editable runtime interaction flow diagram showing each user interaction step through final response. |
| `diagram\tenant-license-mcp-runtime-flow-azure-icons.svg` | Viewable runtime interaction flow diagram with embedded official Azure icons. |
| `icons\azure-official\` | Official Azure SVG icons used by the diagram, downloaded from Microsoft Learn Azure Architecture Center. |
| `icons\README.md` | Source and usage note for the official Azure icons. |
| `docs\Tenant-License-MCP-Bridge-Prerequisites.docx` | Word document with prerequisites and recreation steps. |

## High-level deployment flow

1. Create/push the MCP bridge image to Azure Container Registry.
2. Create the Entra app registration representing the bridge API.
3. Deploy Azure Container Apps using the parameterized ARM template.
4. Grant Microsoft Graph application permissions to the bridge managed identity.
5. Grant the SRE Agent managed identity access to the bridge API app role.
6. Configure SRE Agent MCP connector with managed identity and the bridge token scope.

## SRE Agent connector settings

Use these values after deployment:

| Field | Value |
| --- | --- |
| Name | `license-optimization-mcp` |
| Connection type | `Streamable-HTTP` |
| URL | ARM output `sreAgentConnectorUrl` |
| Authentication method | `Managed identity` |
| Managed identity | The SRE Agent user-assigned managed identity |
| Federated identity credential | Unchecked |
| Azure AD token scope | `api://<bridge-app-client-id>/.default` |
