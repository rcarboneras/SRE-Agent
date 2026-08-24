# Example:
# .\06-verify-deployment.ps1 `
#   -ResourceGroupName "rg-sre-mcp-bridge" `
#   -ContainerAppName "ca-license-mcp-bridge" `
#   -BridgeAudience "api://<bridge-app-client-id>"
#
# This script verifies the deployment by checking the Container App's health endpoint, printing the
# running image, and optionally calling the MCP endpoint with a bearer token.

param(
  # Same resource group used in the prior scripts.
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  # The Container App name; matches -ContainerAppName from 03-deploy-container-app.ps1 (default "ca-license-mcp-bridge").
  [Parameter(Mandatory = $true)] [string] $ContainerAppName,
  # The bridge API audience. Use "api://<bridge-app-client-id>"; a raw GUID is normalized automatically.
  [Parameter(Mandatory = $true)] [string] $BridgeAudience
)

$ErrorActionPreference = "Stop"

if ($BridgeAudience -match '^[0-9a-fA-F-]{36}$') {
  $BridgeAudience = "api://$BridgeAudience"
}

if ($BridgeAudience -notmatch '^(api://|https://)') {
  throw "BridgeAudience must be an Application ID URI, for example api://<bridge-app-client-id>."
}

$fqdn = az containerapp show `
  --resource-group $ResourceGroupName `
  --name $ContainerAppName `
  --query "properties.configuration.ingress.fqdn" `
  --output tsv

$healthUrl = "https://$fqdn/health"
$mcpUrl = "https://$fqdn/mcp"

Write-Host "Health URL: $healthUrl"
Invoke-RestMethod -Uri $healthUrl -TimeoutSec 60

Write-Host "Container image:"
az containerapp show `
  --resource-group $ResourceGroupName `
  --name $ContainerAppName `
  --query "properties.template.containers[0].image" `
  --output tsv

Write-Host "Attempting MCP tools/list with an Azure CLI token for $BridgeAudience."
$token = az account get-access-token --resource $BridgeAudience --query accessToken --output tsv 2>$null
if ($token) {
  Invoke-WebRequest `
    -Uri $mcpUrl `
    -Method POST `
    -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
    -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' `
    -TimeoutSec 60
}
else {
  Write-Host "Could not acquire token for $BridgeAudience with current Azure CLI session."
}
