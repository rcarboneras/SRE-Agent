param(
  [string] $DisplayName = "sre-license-mcp-bridge-api",
  [string] $AppRoleValue = "McpBridge.Access"
)

$ErrorActionPreference = "Stop"

$appId = az ad app create `
  --display-name $DisplayName `
  --sign-in-audience AzureADMyOrg `
  --query appId `
  --output tsv

az ad app update --id $appId --identifier-uris "api://$appId"

$app = az ad app show --id $appId | ConvertFrom-Json
$appObjectId = $app.id

$scopeId = [guid]::NewGuid().ToString()
$roleId = [guid]::NewGuid().ToString()

$body = @{
  api = @{
    oauth2PermissionScopes = @(
      @{
        adminConsentDescription = "Allows the caller to access the SRE License MCP Bridge."
        adminConsentDisplayName = "Access SRE License MCP Bridge"
        id = $scopeId
        isEnabled = $true
        type = "User"
        userConsentDescription = "Allows you to access the SRE License MCP Bridge."
        userConsentDisplayName = "Access SRE License MCP Bridge"
        value = "user_impersonation"
      }
    )
  }
  appRoles = @(
    @{
      allowedMemberTypes = @("Application")
      description = "Allows managed identities to call the SRE License MCP Bridge."
      displayName = "Access SRE License MCP Bridge"
      id = $roleId
      isEnabled = $true
      value = $AppRoleValue
    }
  )
} | ConvertTo-Json -Depth 20

$file = Join-Path $env:TEMP "bridge-api-app-update.json"
[System.IO.File]::WriteAllText($file, $body, [System.Text.UTF8Encoding]::new($false))

az rest `
  --method PATCH `
  --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
  --headers "Content-Type=application/json" `
  --body "@$file" | Out-Null

az ad sp create --id $appId | Out-Null

[pscustomobject]@{
  bridgeAppClientId = $appId
  bridgeAudience = "api://$appId"
  bridgeTokenScope = "api://$appId/.default"
  appRoleValue = $AppRoleValue
} | ConvertTo-Json
