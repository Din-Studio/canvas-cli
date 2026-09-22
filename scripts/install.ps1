# scenemint-canvas Windows 引导安装器
#
#   irm https://github.com/Din-Studio/canvas-cli/releases/latest/download/install.ps1 | iex
#
# 唯一职责：取得一个校验通过的 scenemint-canvas 并写入 PATH。此后的更新请重跑本命令。
# 环境变量：CANVAS_VERSION 锁版本、CANVAS_MIRROR 自定义镜像、CANVAS_HOME 安装前缀。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'Din-Studio/canvas-cli'
$Direct = 'https://github.com'
$Asset = 'scenemint-canvas.tar.gz'
$InstallRoot = if ($env:CANVAS_HOME) { $env:CANVAS_HOME }
               else { Join-Path $env:LOCALAPPDATA 'scenemint-canvas' }
$AppDir = Join-Path $InstallRoot 'app'
$BinDir = Join-Path $InstallRoot 'bin'

function Say { param([string]$m) Write-Host "scenemint-canvas-installer: $m" }
function Die { param([string]$m) throw "scenemint-canvas-installer: $m" }

# 候选源基址，直连优先。
function Get-Sources {
    $list = @($Direct)
    if ($env:CANVAS_MIRROR) { $list += ($env:CANVAS_MIRROR.TrimEnd('/') + '/' + $Direct) }
    $list += "https://ghfast.top/$Direct"
    $list += "https://gh-proxy.com/$Direct"
    return $list
}

# 资产名不含版本号：latest/download/X 只是到 download/<最新tag>/X 的重定向，
# 因此无需先发现版本号即可下载。
function Get-AssetUrl {
    param([string]$Base, [string]$AssetName)
    if ($env:CANVAS_VERSION) {
        $v = $env:CANVAS_VERSION.TrimStart('v')
        return "$Base/$Repo/releases/download/v$v/$AssetName"
    }
    return "$Base/$Repo/releases/latest/download/$AssetName"
}

function Get-Remote {
    param([string]$Uri, [string]$OutFile)
    try {
        $p = @{ Uri = $Uri; OutFile = $OutFile; MaximumRedirection = 5; TimeoutSec = 600 }
        if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('UseBasicParsing')) {
            $p.UseBasicParsing = $true
        }
        Invoke-WebRequest @p
        return $true
    } catch { return $false }
 }

# 本包是纯 ESM、零依赖，但运行时需要 Node.js 22+。
function Assert-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { Die '需要 Node.js 22 或更高版本（https://nodejs.org/）' }
    $v = (& $cmd.Source --version) -replace '^v', ''
    $major = [int]($v -split '\.')[0]
    if ($major -lt 22) { Die "需要 Node.js 22 或更高版本，当前: v$v" }
}

if ($env:OS -ne 'Windows_NT') { Die '此安装器仅支持 Windows' }
Assert-Node
if ($null -eq (Get-Command tar -ErrorAction SilentlyContinue)) {
    Die '需要 tar（Windows 10 1803+ 自带 tar.exe）；请升级系统或改用 WSL 安装'
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("scenemint-canvas-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    # checksums.txt 只有几百字节，慢链路上也容易直连成功。先只向直连索取：
    # 校验和一旦来自可信源，归档包就可以安全地走镜像——镜像换不掉包。
    $sumFile = Join-Path $tmp 'checksums.txt'
    $trusted = Get-Remote -Uri (Get-AssetUrl $Direct 'checksums.txt') -OutFile $sumFile
    if (-not $trusted) {
        foreach ($base in Get-Sources) {
            if ($base -eq $Direct) { continue }
            if (Get-Remote -Uri (Get-AssetUrl $base 'checksums.txt') -OutFile $sumFile) { break }
        }
    }
    if (-not (Test-Path $sumFile)) { Die '无法获取校验和文件，已中止以免安装未经校验的归档' }

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sumFile) {
        $parts = $line -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].Trim().TrimStart('*') -eq $Asset) {
            $expected = $parts[0].ToLowerInvariant()
        }
    }
    if ($expected -notmatch '^[0-9a-f]{64}$') { Die "校验和文件中没有 $Asset" }

    $version = if ($env:CANVAS_VERSION) { $env:CANVAS_VERSION } else { 'latest' }
    Say "版本 $version"

    $archive = Join-Path $tmp $Asset
    $ok = $false
    foreach ($base in Get-Sources) {
        Say "下载 $Asset （$base）"
        if (Get-Remote -Uri (Get-AssetUrl $base $Asset) -OutFile $archive) { $ok = $true; break }
        Say '该来源不可用，尝试下一个'
    }
    if (-not $ok) { Die '所有下载来源均失败' }

    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Die "SHA-256 校验和不匹配，已中止`n  期望: $expected`n  实际: $actual" }
    Say 'SHA-256 校验通过'
    if (-not $trusted) { Say '警告 —— 校验和取自镜像而非 GitHub 直连，只能防传输损坏，不能防篡改' }

    $extract = Join-Path $tmp 'extract'
    New-Item -ItemType Directory -Path $extract -Force | Out-Null
    # npm pack 的归档根目录是 package/；剥掉这一层再落位。
    & tar -xzf $archive -C $extract --strip-components=1
    if ($LASTEXITCODE -ne 0) { Die '归档解压失败' }
    if (-not (Test-Path (Join-Path $extract 'bin\scenemint-canvas.mjs'))) {
        Die '归档中缺少 bin\scenemint-canvas.mjs'
    }

    $staging = Join-Path $tmp 'pkg'
    Move-Item -LiteralPath $extract -Destination $staging
    if (Test-Path -LiteralPath "$AppDir.old") { Remove-Item -LiteralPath "$AppDir.old" -Recurse -Force }
    if (Test-Path -LiteralPath $AppDir) { Move-Item -LiteralPath $AppDir -Destination "$AppDir.old" }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Move-Item -LiteralPath $staging -Destination $AppDir
    if (Test-Path -LiteralPath "$AppDir.old") { Remove-Item -LiteralPath "$AppDir.old" -Recurse -Force }

    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    $shim = Join-Path $BinDir 'scenemint-canvas.cmd'
    # %~dp0 是 shim 自身目录，整条路径不烘焙绝对位置，安装目录可整体搬迁。
    Set-Content -LiteralPath $shim -Encoding ascii -Value @'
@echo off
node "%~dp0\..\app\bin\scenemint-canvas.mjs" %*
'@

    $normalized = [IO.Path]::GetFullPath($BinDir).TrimEnd('\')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $normalized })) {
        [Environment]::SetEnvironmentVariable('Path', (@($entries + $normalized) -join ';'), 'User')
        Say "已将 $normalized 写入用户 PATH"
    }
    $env:Path = "$normalized;$env:Path"

    & node (Join-Path $AppDir 'bin\scenemint-canvas.mjs') --version
    Say "scenemint-canvas 已安装: $shim"
    Say '打开新终端后运行 scenemint-canvas --help；后续更新请重跑本安装命令'
}
finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
