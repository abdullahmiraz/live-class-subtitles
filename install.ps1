# Live Class Subtitles companion app: installer for Windows 10/11 (no admin rights needed).
#   Easiest: download and double-click Install-Companion-Windows.cmd from the latest GitHub release, or paste
#   this into PowerShell:  irm https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.ps1 | iex
# Installs uv (which brings its own Python), downloads the app and the speech models (~350 MB, once) into
# %LOCALAPPDATA%\LiveClassSubtitles and starts it at every sign-in (Startup folder shortcut). Run again to update.
# Uninstall: run with $env:LCS_UNINSTALL = 1 first.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
$Repo = 'abdullahmiraz/live-class-subtitles'
$Dir = Join-Path $env:LOCALAPPDATA 'LiveClassSubtitles'
$Server = Join-Path $Dir 'server'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Live Class Subtitles.lnk'

function Stop-Companion {
  Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
    Where-Object { $_.ExecutablePath -like "$Server*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($env:LCS_UNINSTALL) {
  Stop-Companion
  Remove-Item $Shortcut -ErrorAction SilentlyContinue
  Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Uninstalled.'
  return
}

# uv: a single-file Python manager (https://docs.astral.sh/uv); it fetches Python 3.12 by itself
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing uv (Python manager)...'
  Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

Write-Host "Downloading Live Class Subtitles into $Dir ..."
Stop-Companion
$zip = Join-Path $env:TEMP 'live-class-subtitles.zip'
$tmp = Join-Path $env:TEMP 'live-class-subtitles-src'
Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/main" -OutFile $zip
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip -DestinationPath $tmp -Force
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Copy-Item -Path (Join-Path (Get-ChildItem $tmp | Select-Object -First 1).FullName '*') -Destination $Dir -Recurse -Force
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

Set-Location $Server
$py = Join-Path $Server '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { uv venv -q --python 3.12 .venv }
Write-Host 'Installing Python packages...'
uv pip install -q --python $py -r requirements.txt
& $py download_models.py
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check your internet connection and run the installer again.' }

# start at sign-in, hidden (pythonw = no console window)
$pyw = Join-Path $Server '.venv\Scripts\pythonw.exe'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($Shortcut)
$lnk.TargetPath = $pyw
$lnk.Arguments = 'server.py'
$lnk.WorkingDirectory = $Server
$lnk.WindowStyle = 7
$lnk.Description = 'Live Class Subtitles companion (local speech recognition)'
$lnk.Save()
Start-Process -FilePath $pyw -ArgumentList 'server.py' -WorkingDirectory $Server -WindowStyle Hidden

Write-Host ''
Write-Host 'Done: the Live Class Subtitles companion is running and starts by itself when you sign in.' -ForegroundColor Green
Write-Host 'In the extension: popup -> Advanced -> Speech recognition -> Companion app (best).'
