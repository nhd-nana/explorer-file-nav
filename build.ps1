# 打包扩展 —— 生成可上传到 VS Code Marketplace 的 .vsix
#
# 更新流程：
#   1) 改代码（改完 Reload Window 即可在本地验证，无需重新打包）
#   2) 提升 package.json 里的 "version"（不加版本号会被 Marketplace 拒绝）
#   3) 运行本脚本
#   4) 打开 https://marketplace.visualstudio.com/manage → gy903 → New extension → 上传新 vsix
#
# 本地回归测试： node test/simulate.js "<某个文件路径>" next|prev [sortOrder] [preview]

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$j = Get-Content package.json -Raw | ConvertFrom-Json
Write-Host "打包 $($j.publisher).$($j.name)  v$($j.version)" -ForegroundColor Cyan

npx --yes @vscode/vsce package

$vsix = Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ""
Write-Host "产物 : $($vsix.FullName)" -ForegroundColor Green
Write-Host "上传 : https://marketplace.visualstudio.com/manage" -ForegroundColor Yellow
