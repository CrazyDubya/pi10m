# Windows Setup

Pi requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.pi/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. Managed Portable Git Bash (`~/.pi/agent/bin/portable-git/bin/bash.exe`)
4. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

If no bash is found, Pi downloads Git for Windows Portable Git into `~/.pi/agent/bin/portable-git`. Set `PI_OFFLINE=1` to disable automatic downloads.

## Custom Shell Path

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```
