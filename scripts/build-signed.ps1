<#
    Build MeetSum và ký bằng certificate của MaiMoney.
    Cần chạy scripts\make-signing-cert.ps1 trước (một lần duy nhất).

    Dùng:  powershell -ExecutionPolicy Bypass -File scripts\build-signed.ps1
#>
param(
    [string]$Pfx = 'certs\MaiMoney-CodeSigning.pfx',
    [ValidateSet('pnpm', 'npm', 'yarn')]
    [string]$PackageManager = 'pnpm'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Pfx)) {
    Write-Host "Chưa có certificate: $Pfx" -ForegroundColor Red
    Write-Host 'Tạo trước bằng: powershell -ExecutionPolicy Bypass -File scripts\make-signing-cert.ps1'
    exit 1
}

$sec = Read-Host -AsSecureString 'Mật khẩu file .pfx'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# electron-builder đọc hai biến môi trường này để ký
$env:CSC_LINK = (Resolve-Path $Pfx).Path
$env:CSC_KEY_PASSWORD = $plain

Write-Host ''
Write-Host 'Đang build bản đã ký...' -ForegroundColor Cyan
& $PackageManager run build:win:signed 2>&1 | Tee-Object -FilePath build.log

$code = $LASTEXITCODE

# dọn biến môi trường để mật khẩu không còn trong phiên terminal
$env:CSC_KEY_PASSWORD = $null
$env:CSC_LINK = $null

Write-Host ''
if ($code -eq 0) {
    Write-Host 'Build xong. File cài đặt nằm trong dist\' -ForegroundColor Green
    Get-ChildItem dist\*.exe | ForEach-Object {
        Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
    }
    Write-Host ''
    Write-Host 'Kiểm tra chữ ký:' -ForegroundColor Cyan
    Get-ChildItem dist\*.exe | ForEach-Object {
        $sig = Get-AuthenticodeSignature $_.FullName
        Write-Host ("  {0}: {1} — {2}" -f $_.Name, $sig.Status, $sig.SignerCertificate.Subject)
    }
}
else {
    Write-Host "Build lỗi (exit $code). Xem chi tiết trong build.log" -ForegroundColor Red
}

exit $code
