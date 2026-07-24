$env:ANTHROPIC_API_KEY = "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"
$env:ANTHROPIC_BASE_URL = "https://openrouter.ai/api"
$env:OPENROUTER_API_KEY = $env:ANTHROPIC_API_KEY

Clear-Host
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " Claude Code + OpenRouter + Synergy " -ForegroundColor White -BackgroundColor Blue
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Model:        tencent/hy3-preview:free" -ForegroundColor Yellow
Write-Host "OpenSpec:     Activo (Workflow)" -ForegroundColor Green
Write-Host "Superpowers:  Activo (Advanced Tools)" -ForegroundColor Green
Write-Host "Status:       Sincronizado" -ForegroundColor Cyan
Write-Host "-----------------------------------------------" -ForegroundColor Gray

# Ejecutar Claude Code con el modelo especificado y pasar todos los argumentos
claude --model tencent/hy3-preview:free $args
