# This script grants Microsoft Graph application permissions (app roles) to the bridge Container App's
# managed identity so it can read tenant/license/audit data on behalf of the bridge.

param(
  # The "bridgeManagedIdentityPrincipalId" output from 03-deploy-container-app.ps1's deployment outputs.
  [Parameter(Mandatory = $true)] [string] $BridgeManagedIdentityPrincipalId,
  # Microsoft Graph app role values to grant; default list covers what the bridge needs.
  [string[]] $GraphRoles = @(
    "Organization.Read.All",
    "Directory.Read.All",
    "User.Read.All",
    "AuditLog.Read.All",
    "Reports.Read.All"
  )
)

$ErrorActionPreference = "Stop"

$graphAppId = "00000003-0000-0000-c000-000000000000"
$graphSpId = (az ad sp show --id $graphAppId --query id --output tsv).Trim()

foreach ($role in $GraphRoles) {
  $appRoleId = (az ad sp show `
    --id $graphSpId `
    --query "appRoles[?value=='$role' && contains(allowedMemberTypes, 'Application')].id | [0]" `
    --output tsv).Trim()

  $existing = az rest `
    --method GET `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$BridgeManagedIdentityPrincipalId/appRoleAssignments" `
    --query "value[?resourceId=='$graphSpId' && appRoleId=='$appRoleId'].id | [0]" `
    --output tsv

  if ($existing) {
    Write-Host "Already granted: $role"
    continue
  }

  $body = @{
    principalId = $BridgeManagedIdentityPrincipalId
    resourceId = $graphSpId
    appRoleId = $appRoleId
  } | ConvertTo-Json -Compress

  $file = Join-Path $env:TEMP "graph-role-$role.json"
  [System.IO.File]::WriteAllText($file, $body, [System.Text.UTF8Encoding]::new($false))

  Write-Host "Granting: $role"
  az rest `
    --method POST `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$BridgeManagedIdentityPrincipalId/appRoleAssignments" `
    --headers "Content-Type=application/json" `
    --body "@$file" | Out-Null
}
