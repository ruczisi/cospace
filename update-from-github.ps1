#Requires -Version 5.1
<#
.SYNOPSIS
    从 GitHub 更新 cospace 源码并重新构建

.DESCRIPTION
    1. 从 origin/main 拉取最新代码
    2. 安装/更新前端依赖 (npm install)
    3. 构建 agent-bridge
    4. 构建 Tauri 应用生成 exe
    5. 排除所有临时文件

.NOTES
    使用前请确保已安装 Git、Node.js、Rust 和 Tauri CLI
#>

param(
    [switch]$SkipPull,
    [switch]$SkipBuild,
    [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

# 颜色输出
function Write-Info { param([string]$msg) Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Success { param([string]$msg) Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Error2 { param([string]$msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================" -ForegroundColor Blue
Write-Host "  Cospace - 从 GitHub 更新并构建" -ForegroundColor Blue
Write-Host "============================================" -ForegroundColor Blue
Write-Host ""

# 1. 检查环境
Write-Info "检查必要环境..."

$tools = @(
    @{ Name = "Git"; Cmd = "git --version" },
    @{ Name = "Node.js"; Cmd = "node --version" },
    @{ Name = "npm"; Cmd = "npm --version" },
    @{ Name = "Rust"; Cmd = "rustc --version" }
)

foreach ($tool in $tools) {
    try {
        $ver = Invoke-Expression $tool.Cmd 2>$null
        Write-Success "$($tool.Name): $ver"
    } catch {
        Write-Error2 "$($tool.Name) 未安装或未添加到 PATH"
        exit 1
    }
}

# 检查 Tauri CLI
$tauriCli = npx tauri --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Tauri CLI 未全局安装，将使用 npx 运行"
}

# 2. Git 操作
if (-not $SkipPull) {
    Write-Host ""
    Write-Info "步骤 1/5: 从 GitHub 拉取最新代码..."

    # 检查远程连接
    try {
        git remote update 2>$null
        Write-Success "远程仓库连接正常"
    } catch {
        Write-Warn "远程仓库连接失败，跳过拉取"
        $SkipPull = $true
    }

    if (-not $SkipPull) {
        # 检查本地变更
        $localChanges = git status --short
        if ($localChanges) {
            Write-Warn "检测到本地未提交的变更:"
            Write-Host $localChanges -ForegroundColor DarkGray
            $choice = Read-Host "是否暂存本地变更并继续? (y/n)"
            if ($choice -eq 'y' -or $choice -eq 'Y') {
                git stash push -m "auto-stash before update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
                Write-Success "本地变更已暂存"
            } else {
                Write-Warn "用户取消，退出更新"
                exit 0
            }
        }

        # 拉取更新
        Write-Info "正在拉取 origin/main..."
        git pull origin main
        if ($LASTEXITCODE -eq 0) {
            Write-Success "代码已更新到最新版本"
        } else {
            Write-Error2 "拉取失败，请检查网络或手动解决冲突"
            exit 1
        }
    }
} else {
    Write-Warn "跳过拉取步骤 (--SkipPull)"
}

# 3. 安装前端依赖
Write-Host ""
Write-Info "步骤 2/5: 安装前端依赖..."

if (Test-Path "node_modules") {
    Write-Info "node_modules 已存在，执行增量更新..."
    npm install
} else {
    Write-Info "首次安装依赖..."
    npm install
}

if ($LASTEXITCODE -ne 0) {
    Write-Error2 "npm install 失败"
    exit 1
}
Write-Success "前端依赖安装完成"

# 4. 构建 agent-bridge
Write-Host ""
Write-Info "步骤 3/5: 构建 agent-bridge..."

$bridgeDir = "src-tauri/agent-bridge"
if (Test-Path $bridgeDir) {
    Set-Location $bridgeDir
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run build
    Set-Location $projectDir
    Write-Success "agent-bridge 构建完成"
} else {
    Write-Warn "agent-bridge 目录不存在，跳过"
}

# 5. 构建 Tauri 应用
if (-not $SkipBuild) {
    Write-Host ""
    Write-Info "步骤 4/5: 构建 Tauri 应用 (生成 exe)..."
    Write-Warn "此步骤可能需要 5-15 分钟，请耐心等待..."

    # 清理旧构建产物（保留 dist-tauri 中的安装包）
    if (Test-Path "src-tauri/target") {
        Write-Info "清理旧的 Rust 构建产物..."
        Remove-Item "src-tauri/target" -Recurse -Force -ErrorAction SilentlyContinue
    }

    npx tauri build

    if ($LASTEXITCODE -ne 0) {
        Write-Error2 "Tauri 构建失败"
        exit 1
    }

    Write-Success "Tauri 应用构建完成"

    # 显示生成的文件
    $exePath = "src-tauri/target/release/cospace.exe"
    $msiPath = "src-tauri/target/release/bundle/msi/*.msi"
    $nsisPath = "src-tauri/target/release/bundle/nsis/*.exe"

    if (Test-Path $exePath) {
        $exeSize = (Get-Item $exePath).Length / 1MB
        Write-Success "生成文件: $exePath ($([math]::Round($exeSize, 2)) MB)"
    }

    $msiFiles = Get-Item $msiPath -ErrorAction SilentlyContinue
    if ($msiFiles) {
        foreach ($f in $msiFiles) {
            $size = $f.Length / 1MB
            Write-Success "生成安装包: $($f.Name) ($([math]::Round($size, 2)) MB)"
        }
    }
} else {
    Write-Warn "跳过构建步骤 (--SkipBuild)"
}

# 6. 运行测试（可选）
if (-not $SkipTest -and -not $SkipBuild) {
    Write-Host ""
    Write-Info "步骤 5/5: 运行测试..."
    npm run test
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "测试未全部通过，请查看上方输出"
    } else {
        Write-Success "测试通过"
    }
} else {
    Write-Warn "跳过测试步骤"
}

# 完成
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  更新完成!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

if (-not $SkipBuild) {
    Write-Host "生成的文件位置:" -ForegroundColor Cyan
    Write-Host "  - 可执行文件: src-tauri\target\release\cospace.exe" -ForegroundColor White
    Write-Host "  - MSI 安装包: src-tauri\target\release\bundle\msi\" -ForegroundColor White
    Write-Host "  - NSIS 安装包: src-tauri\target\release\bundle\nsis\" -ForegroundColor White
    Write-Host ""
}

Write-Host "使用说明:" -ForegroundColor Cyan
Write-Host "  直接运行: .\update-from-github.ps1" -ForegroundColor White
Write-Host "  仅拉取:   .\update-from-github.ps1 -SkipBuild" -ForegroundColor White
Write-Host "  仅构建:   .\update-from-github.ps1 -SkipPull" -ForegroundColor White
Write-Host ""
