$files = Get-ChildItem -Path src/node/__tests__/exposure -Recurse -File
foreach ($file in $files) {
    if ($file.Extension -eq ".ts") {
        $lines = (Get-Content $file.FullName).Count
        if ($lines -gt 300) {
            Write-Host "$($file.FullName): $lines lines"
        }
    }
}
