<#
    Dành cho MÁY NGƯỜI DÙNG (đồng nghiệp), không phải máy build.
    Cài certificate của MaiMoney vào danh sách tin cậy của Windows, để MeetSum
    không còn bị báo "Unknown publisher".

    Chạy MỘT LẦN, bằng quyền Administrator:
      Chuột phải Start > Terminal (Admin), rồi:
      powershell -ExecutionPolicy Bypass -File install-signing-cert.ps1

    File .cer phải nằm cùng thư mục với script này (hoặc truyền -CerPath).
#>
param(
    [string]$CerPath = (Join-Path $PSScriptRoot 'MaiMoney-CodeSigning.cer')
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host 'Script này cần quyền Administrator.' -ForegroundColor Red
    Write-Host 'Mở lại: chuột phải nút Start > Terminal (Admin), rồi chạy lại lệnh này.'
    exit 1
}

if (-not (Test-Path $CerPath)) {
    # thử tìm trong thư mục hiện tại
    $alt = Join-Path (Get-Location) 'MaiMoney-CodeSigning.cer'
    if (Test-Path $alt) {
        $CerPath = $alt
    }
    else {
        Write-Host "Không tìm thấy file certificate: $CerPath" -ForegroundColor Red
        Write-Host 'Đặt file MaiMoney-CodeSigning.cer cạnh script này rồi chạy lại.'
        exit 1
    }
}

Write-Host "Đang cài: $CerPath" -ForegroundColor Cyan

# Root: để Windows tin cậy chuỗi certificate
Import-Certificate -FilePath $CerPath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
# TrustedPublisher: để không hỏi lại mỗi lần chạy app đã ký bằng cert này
Import-Certificate -FilePath $CerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null

Write-Host ''
Write-Host 'Xong. Máy này giờ tin cậy phần mềm ký bởi MaiMoney.' -ForegroundColor Green
Write-Host 'Cài MeetSum như bình thường — sẽ hiện publisher là MaiMoney thay vì Unknown.'
