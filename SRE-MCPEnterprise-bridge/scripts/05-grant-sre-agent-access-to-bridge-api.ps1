# Example:
# .\05-grant-sre-agent-access-to-bridge-api.ps1 `
#   -BridgeAppClientId "<bridge-app-client-id>" `
#   -SreAgentManagedIdentityPrincipalId "<sre-agent-managed-identity-principal-object-id>"
#
# This script grants the SRE Agent's managed identity the app role needed to call the bridge API.

param(
  # The "bridgeAppClientId" output from 02-create-bridge-api-app.ps1.
  [Parameter(Mandatory = $true)] [string] $BridgeAppClientId,
  # Principal (object) ID of the SRE Agent's managed identity; find it via `az identity show` for that identity or the Azure portal.
  [Parameter(Mandatory = $true)] [string] $SreAgentManagedIdentityPrincipalId,
  # Must match the AppRoleValue used in 02-create-bridge-api-app.ps1.
  [string] $AppRoleValue = "McpBridge.Access"
)

$ErrorActionPreference = "Stop"

$bridgeSpId = (az ad sp show --id $BridgeAppClientId --query id --output tsv).Trim()
$appRoleId = (az ad app show `
  --id $BridgeAppClientId `
  --query "appRoles[?value=='$AppRoleValue'].id | [0]" `
  --output tsv).Trim()

$existing = az rest `
  --method GET `
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SreAgentManagedIdentityPrincipalId/appRoleAssignments" `
  --query "value[?resourceId=='$bridgeSpId' && appRoleId=='$appRoleId'].id | [0]" `
  --output tsv

if ($existing) {
  Write-Host "SRE Agent managed identity already has $AppRoleValue."
  return
}

$body = @{
  principalId = $SreAgentManagedIdentityPrincipalId
  resourceId = $bridgeSpId
  appRoleId = $appRoleId
} | ConvertTo-Json -Compress

$file = Join-Path $env:TEMP "sre-agent-bridge-role-assignment.json"
[System.IO.File]::WriteAllText($file, $body, [System.Text.UTF8Encoding]::new($false))

az rest `
  --method POST `
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SreAgentManagedIdentityPrincipalId/appRoleAssignments" `
  --headers "Content-Type=application/json" `
  --body "@$file" | Out-Null

Write-Host "Granted $AppRoleValue to SRE Agent managed identity."
