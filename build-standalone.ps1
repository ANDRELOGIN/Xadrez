$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$index = [System.IO.File]::ReadAllText((Join-Path $root "index.html"))
$styles = [System.IO.File]::ReadAllText((Join-Path $root "styles.css"))
$app = [System.IO.File]::ReadAllText((Join-Path $root "app.js"))
$engine = [System.IO.File]::ReadAllText((Join-Path $root "engine\stockfish-19-lite-single.js"))
$wasm = [System.IO.File]::ReadAllBytes((Join-Path $root "engine\stockfish-19-lite-single.wasm"))

$chessUrl = "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js"
$chessLicenseUrl = "https://unpkg.com/chess.js@1.4.0/LICENSE"
$stockfishLicenseUrl = "https://raw.githubusercontent.com/nmrugg/stockfish.js/v19.0.1/Copying.txt"
$chess = (Invoke-WebRequest -Uri $chessUrl -ErrorAction Stop).Content
$chessLicense = (Invoke-WebRequest -Uri $chessLicenseUrl -ErrorAction Stop).Content
$stockfishLicense = (Invoke-WebRequest -Uri $stockfishLicenseUrl -ErrorAction Stop).Content

if ($chess -match "(?m)^\s*import\s") {
  throw "A versão baixada de chess.js não pode ser incorporada sem imports."
}

$app = [regex]::Replace($app, '(?m)^import \{ Chess \} from "https://esm\.sh/chess\.js@1\.4\.0";\r?\n', "")
$wasmBase64 = [Convert]::ToBase64String($wasm)
$wasmUrl = "data:application/wasm;base64,$wasmBase64"
$wasmPathHook = "r||t:self.location.href"
if (-not $engine.Contains($wasmPathHook)) {
  throw "Não foi possível localizar o ponto de carregamento do WASM no Stockfish."
}
$engine = $engine.Replace($wasmPathHook, "r||t:`"$wasmUrl`"")
$workerBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($engine))

$html = [regex]::Replace($index, '(?m)^\s*<link rel="preconnect".*\r?\n', "")
$html = [regex]::Replace($html, '(?m)^\s*<link href="https://fonts\.googleapis\.com/.*\r?\n', "")
$html = $html.Replace('    <link rel="stylesheet" href="styles.css" />', "    <style>`n$styles`n    </style>")
$inlineScripts = @"
    <script id="engine-worker-source" type="application/octet-stream">$workerBase64</script>
    <script type="module">
globalThis.createStockfishWorker = () => {
  const source = atob(document.querySelector("#engine-worker-source").textContent.trim());
  const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  return new Worker(workerUrl);
};
$chess
$app
    </script>
"@
$html = $html.Replace('    <script type="module" src="app.js"></script>', $inlineScripts.TrimEnd())
$licenses = [ordered]@{
  "chess.js 1.4.0 (BSD-2-Clause)" = $chessLicense
  "Stockfish.js 19.0.1 (GPL-3.0)" = $stockfishLicense
} | ConvertTo-Json -Compress
$licenses = $licenses.Replace("</", "<\/")
$html = $html.Replace('  </body>', "    <script type=`"application/json`" id=`"third-party-licenses`">$licenses</script>`n  </body>")

$output = Join-Path $root "xadrez.html"
[System.IO.File]::WriteAllText($output, $html, [System.Text.UTF8Encoding]::new($false))
Write-Output "Arquivo criado: $output"
Write-Output "Tamanho: $([Math]::Round((Get-Item $output).Length / 1MB, 2)) MB"