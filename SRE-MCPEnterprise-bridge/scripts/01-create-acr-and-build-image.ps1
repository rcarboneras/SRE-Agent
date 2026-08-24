# This script creates an Azure Container Registry (ACR) and builds a Docker image from the specified source path, then pushes the image to the ACR.

param(
  # Resource group to create/use for the ACR. Choose any name; created if it doesn't already exist.
  [Parameter(Mandatory = $true)] [string] $ResourceGroupName,
  # Azure region for the resource group/ACR, e.g. "eastus". See `az account list-locations -o table`.
  [Parameter(Mandatory = $true)] [string] $Location,
  # Globally unique ACR name (5-50 alphanumeric chars) to create/use, e.g. "acrsremcpbridge".
  [Parameter(Mandatory = $true)] [string] $AcrName,
  # Docker image repository name within the ACR; default is fine unless you need a custom name.
  [string] $ImageName = "sre-license-mcp-bridge",
  # Docker image tag/version; bump this when rebuilding a new version of the image.
  [string] $ImageTag = "1.0.0",
  # Path to the folder containing the Dockerfile to build; defaults to the repo's src/ folder.
  [string] $SourcePath = "..\src"
)

$ErrorActionPreference = "Stop"

# In PowerShell 7+, make native command failures honor $ErrorActionPreference.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

# Resolve source path relative to this script so execution directory does not matter.
if (-not [System.IO.Path]::IsPathRooted($SourcePath)) {
  $SourcePath = Join-Path -Path $PSScriptRoot -ChildPath $SourcePath
}

$SourcePath = (Resolve-Path -Path $SourcePath).Path

try {
  az group create --name $ResourceGroupName --location $Location | Out-Null

  # az acr show exits non-zero when the registry does not exist; that's expected here, so ignore it.
  $acrExists = & {
    $ErrorActionPreference = "SilentlyContinue"
    if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
      $PSNativeCommandUseErrorActionPreference = $false
    }
    az acr show --resource-group $ResourceGroupName --name $AcrName --query name --output tsv 2>$null
  }
  if (-not $acrExists) {
    az acr create --resource-group $ResourceGroupName --name $AcrName --sku Basic | Out-Null
  }

  $image = "$AcrName.azurecr.io/$($ImageName):$ImageTag"

  # Build in Azure Container Registry so local Docker is not required.
  az acr build --registry $AcrName --image "$($ImageName):$ImageTag" --platform linux/amd64 $SourcePath | Out-Null

  Write-Output $image
}
catch {
  Write-Error "Script failed: $_"
  throw
}
