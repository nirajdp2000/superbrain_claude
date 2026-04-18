Set-Location 'D:\Crypto Mining\codex\Codex_superbrain\superbrain'
New-Item -ItemType Directory -Force '.\logs' | Out-Null
node src/server.mjs *>> '.\logs\superbrain-service.log'
