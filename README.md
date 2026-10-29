# xeque

Site de xadrez em português com tabuleiro interativo, notação SAN e coordenadas de cada lance, classificação de aberturas e Stockfish 19 no navegador.

## Executar

Abra esta pasta no VS Code e execute no PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Depois abra `http://localhost:4173/` no navegador. O projeto não requer Node.js. É necessária conexão com a internet para carregar `chess.js` e as fontes; os arquivos do engine ficam locais no projeto.

## Multiplayer

O modo multiplayer usa um servidor WebSocket separado do GitHub Pages. Para publicar:

1. Envie os arquivos do projeto, incluindo `server.js`, `package.json` e `render.yaml`, para a branch `main`.
2. No Render, escolha **New > Blueprint** e conecte o repositório `ANDRELOGIN/Xadrez`. O Render usará `render.yaml` para criar o serviço gratuito `xadrez-multiplayer`.
3. Aguarde o serviço ficar **Live** e confirme que `https://xadrez-multiplayer-qxxf.onrender.com/health` responde `ok`.
4. O site continua disponível em `https://andrelogin.github.io/Xadrez/`; o multiplayer pode demorar alguns instantes para responder quando o servidor gratuito estiver iniciando após inatividade.

O servidor valida os lances com `chess.js` e aceita conexões do GitHub Pages e dos endereços locais de desenvolvimento configurados em `ALLOWED_ORIGINS`.

## Publicar no GitHub Pages

O workflow em `.github/workflows/pages.yml` publica o site automaticamente quando há um push na branch `main`.

1. Crie um repositório no GitHub e envie os arquivos desta pasta para a branch `main`.
2. No repositório, abra **Settings > Pages** e selecione **GitHub Actions** como origem.
3. Aguarde a execução do workflow **Publicar no GitHub Pages** em **Actions**. O endereço do site aparecerá no resumo da execução e em **Settings > Pages**.

Como o site é estático e usa `index.html` na raiz, não precisa de etapa de build.

## Arquivo para compartilhar

Gere uma versão autocontida, com tabuleiro de madeira, regras, engine e licenças embutidos:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-standalone.ps1
```

O arquivo `xadrez.html` pode ser enviado como anexo. Em celulares, alguns visualizadores de arquivos bloqueiam JavaScript e Web Workers; para jogar contra o engine, abra a página publicada por HTTPS em Safari ou outro navegador compatível.

## Observações

- Stockfish 19 lite single-threaded roda em Web Worker e não envia posições para um servidor.
- As aberturas são identificadas por prefixos SAN de um repertório inicial e podem ser ampliadas em `app.js`.
- Stockfish.js é distribuído sob GPL-3.0; consulte os termos da versão usada antes de publicar ou redistribuir o site.