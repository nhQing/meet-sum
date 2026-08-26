<#
    Tạo certificate tự ký để ký MeetSum cho nội bộ MaiMoney.
    Chạy MỘT LẦN trên máy build. Kết quả nằm trong thư mục certs\:

      MaiMoney-CodeSigning.pfx   -> giữ bí mật, chỉ dùng trên máy build để ký
      MaiMoney-CodeSigning.cer   -> gửi cho đồng nghiệp cài (không chứa khoá bí mật)

    Dùng:  powershell -ExecutionPolicy Bypass -File scripts\make-signing-cert.ps1
#>
param(
    [string]$Subject = 'CN=MaiMoney, O=MaiMoney, C=VN',
    [string]$OutDir = 'certs',
    [int]$Years = 3
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host 'Đang tạo certificate...' -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($Years)

Write-Host "Đã tạo. Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green
Write-Host "Hết hạn: $($cert.NotAfter.ToString('dd/MM/yyyy'))"

$pw = Read-Host -AsSecureString 'Đặt mật khẩu bảo vệ file .pfx (nhớ kỹ, dùng mỗi lần build)'

$pfx = Join-Path $OutDir 'MaiMoney-CodeSigning.pfx'
$cer = Join-Path $OutDir 'MaiMoney-CodeSigning.cer'

Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null

Write-Host ''
Write-Host 'Xong. Hai file đã tạo:' -ForegroundColor Green
Write-Host "  $pfx   <- BÍ MẬT, không commit, không gửi cho ai"
Write-Host "  $cer   <- gửi file này cho đồng nghiệp"
Write-Host ''
Write-Host 'Bước tiếp theo:' -ForegroundColor Cyan
Write-Host '  1. Build bản đã ký:      powershell -ExecutionPolicy Bypass -File scripts\build-signed.ps1'
Write-Host '  2. Gửi đồng nghiệp file: certs\MaiMoney-CodeSigning.cer  +  scripts\install-signing-cert.ps1'
Write-Host '     Họ chạy install-signing-cert.ps1 bằng quyền Administrator một lần.'
