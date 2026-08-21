param(
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  [Parameter(Mandatory = $true)] [string] $TemplateFile,
  [Parameter(Mandatory = $true)] [string] $ContainerImage,
  [Parameter(Mandatory = $true)] [string] $AcrName,
  [Parameter(Mandatory = $true)] [string] $TenantId,
  [Parameter(Mandatory = $true)] [string] $BridgeAudience,
  [Parameter(Mandatory = $true)] [string] $AllowedClientIds,
  [string] $Location,
  [string] $EnvironmentName = "cae-license-mcp-bridge",
  [string] $ContainerAppName = "ca-license-mcp-bridge",
  [string] $ManagedIdentityName = "id-license-mcp-bridge"
)

$ErrorActionPreference = "Stop"

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
