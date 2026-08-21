# This script creates an Azure Container Registry (ACR) and builds a Docker image from the specified source path, then pushes the image to the ACR.

param(
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  [Parameter(Mandatory = $true)] [string] $Location,
  [Parameter(Mandatory = $true)] [string] $AcrName,
  [string] $ImageName = "sre-license-mcp-bridge",
  [string] $ImageTag = "1.0.0",
  [string] $SourcePath = "..\src"
)

$ErrorActionPreference = "Stop"

az group create --name $ResourceGroupName --location $Location | Out-Null

$acrExists = az acr show --resource-group $ResourceGroupName --name $AcrName --query name --output tsv 2>$null
if (-not $acrExists) {
  az acr create --resource-group $ResourceGroupName --name $AcrName --sku Basic | Out-Null
}

az acr login --name $AcrName | Out-Null

Push-Location $SourcePath
try {
  $image = "$AcrName.azurecr.io/$($ImageName):$ImageTag"
  docker build --platform linux/amd64 -t $image .
  docker push $image
  Write-Output $image
}
finally {
  Pop-Location
}
