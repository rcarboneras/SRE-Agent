# Example:
# .\03-deploy-container-app.ps1 `
#   -ResourceGroupName "rg-sre-mcp-bridge" `
#   -TemplateFile "..\infra\azuredeploy.json" `
#   -ContainerImage "acrsremcpbridge001.azurecr.io/sre-license-mcp-bridge:1.0.0" `
#   -AcrName "acrsremcpbridge001" `
#   -TenantId "<tenant-id>" `
#   -BridgeAudience "api://<bridge-app-client-id>" `
#   -AllowedClientIds "<sre-agent-managed-identity-client-id>"
#
# This script deploys the ARM template to create the Container Apps environment, user-assigned
# managed identity, and Container App running the bridge image.

param(
  # Same resource group used in 01-create-acr-and-build-image.ps1.
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  # Path to the ARM template, e.g. "..\infra\azuredeploy.json".
  [Parameter(Mandatory = $true)] [string] $TemplateFile,
  # Full image reference printed by 01-create-acr-and-build-image.ps1, e.g. "<acr>.azurecr.io/sre-license-mcp-bridge:1.0.0".
  [Parameter(Mandatory = $true)] [string] $ContainerImage,
  # Same ACR name used in 01-create-acr-and-build-image.ps1.
  [Parameter(Mandatory = $true)] [string] $AcrName,
  # Your Entra tenant ID; get it with `az account show --query tenantId --output tsv`.
  [Parameter(Mandatory = $true)] [string] $TenantId,
  # Example: -BridgeAudience "api://330998d3-6339-44ea-9c68-a6f704d9574f".
  [Parameter(Mandatory = $true)] [string] $BridgeAudience,
  # Comma-separated client IDs allowed to call the bridge, normally the SRE Agent managed identity's client ID.
  [Parameter(Mandatory = $true)] [string] $AllowedClientIds,
  # Azure region for the deployment; defaults to the resource group's region if omitted.
  [string] $Location,
  # Name of the Container Apps environment to create; default is fine.
  [string] $EnvironmentName = "cae-license-mcp-bridge",
  # Name of the Container App to create; default is fine.
  [string] $ContainerAppName = "ca-license-mcp-bridge",
  # Name of the user-assigned managed identity to create for the Container App; default is fine.
  [string] $ManagedIdentityName = "id-license-mcp-bridge"
)

$ErrorActionPreference = "Stop"

if ($BridgeAudience -match '^[0-9a-fA-F-]{36}$') {
  $BridgeAudience = "api://$BridgeAudience"
}

if ($BridgeAudience -notmatch '^(api://|https://)') {
  throw "BridgeAudience must be an Application ID URI, for example api://<bridge-app-client-id>."
}

$params = @(
  "containerImage=$ContainerImage",
  "acrName=$AcrName",
  "tenantId=$TenantId",
  "bridgeAudience=$BridgeAudience",
  "allowedClientIds=$AllowedClientIds",
  "environmentName=$EnvironmentName",
  "containerAppName=$ContainerAppName",
  "managedIdentityName=$ManagedIdentityName"
)

if ($Location) {
  $params += "location=$Location"
}

az deployment group create `
  --resource-group $ResourceGroupName `
  --template-file $TemplateFile `
  --parameters $params `
  --query "properties.outputs" `
  --output json
