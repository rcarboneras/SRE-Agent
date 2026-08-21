param(
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  [Parameter(Mandatory = $true)] [string] $ContainerAppName,
  [Parameter(Mandatory = $true)] [string] $BridgeAudience
)

$ErrorActionPreference = "Stop"

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

Write-Host "Manual token test requires interactive/user consent for Azure CLI if not already granted."
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
