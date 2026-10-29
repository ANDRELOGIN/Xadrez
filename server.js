const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const { Chess } = require("chess.js");
const { WebSocket, WebSocketServer } = require("ws");

const port = Number(process.env.PORT || 10000);
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "https://andrelogin.github.io,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const waitingPlayers = new Set();
const games = new Map();

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendGameState(game) {
  const history = game.chess.history({ verbose: true }).map(({ from, to, promotion, san, color }) => ({
    from,
    to,
    promotion,
    san,
    color,
  }));
  const checkmate = game.chess.isCheckmate();
  const draw = game.chess.isDraw();
  const result = checkmate
    ? `Xeque-mate. Vitória das ${game.chess.turn() === "w" ? "pretas" : "brancas"}.`
    : draw ? "A partida terminou empatada." : null;
  const state = {
    type: "game_state",
    gameId: game.id,
    fen: game.chess.fen(),
    history,
    gameOver: checkmate || draw,
    result,
  };
  for (const player of game.players.values()) send(player, state);
}

function matchPlayers(first, second) {
  waitingPlayers.delete(first);
  first.queueState = "playing";
  second.queueState = "playing";
  const firstColor = Math.random() < 0.5 ? "w" : "b";
  const game = {
    id: randomUUID(),
    chess: new Chess(),
    players: new Map([
      [firstColor, first],
      [firstColor === "w" ? "b" : "w", second],
    ]),
  };
  first.gameId = game.id;
  second.gameId = game.id;
  games.set(game.id, game);
  send(first, { type: "matched", gameId: game.id, color: firstColor });
  send(second, { type: "matched", gameId: game.id, color: firstColor === "w" ? "b" : "w" });
}

function disconnect(socket) {
  waitingPlayers.delete(socket);
  if (!socket.gameId) return;
  const game = games.get(socket.gameId);
  games.delete(socket.gameId);
  socket.gameId = null;
  if (!game) return;
  for (const player of game.players.values()) {
    if (player === socket) continue;
    player.gameId = null;
    player.queueState = "idle";
    send(player, { type: "opponent_left" });
  }
}

function handleMessage(socket, message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    send(socket, { type: "error", message: "Mensagem inválida." });
    return;
  }
  if (message.type === "join_queue") {
    if (socket.queueState === "waiting") {
      send(socket, { type: "queued" });
      return;
    }
    if (socket.queueState !== "idle" || socket.gameId) {
      send(socket, { type: "error", message: "Você já está em uma partida." });
      return;
    }
    const opponent = [...waitingPlayers].find((player) => player.readyState === WebSocket.OPEN);
    if (opponent) {
      matchPlayers(opponent, socket);
    } else {
      socket.queueState = "waiting";
      waitingPlayers.add(socket);
      send(socket, { type: "queued" });
    }
    return;
  }
  if (message.type === "move") {
    const game = games.get(socket.gameId);
    if (!game || message.gameId !== game.id) {
      send(socket, { type: "error", message: "A partida não está mais ativa." });
      return;
    }
    const color = [...game.players].find(([, player]) => player === socket)?.[0];
    if (!color || game.chess.turn() !== color || game.chess.isGameOver()) {
      send(socket, { type: "error", message: "Ainda não é a sua vez." });
      return;
    }
    const { from, to, promotion } = message.move || {};
    if (typeof from !== "string" || typeof to !== "string" ||
        !/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) ||
        promotion !== undefined && !["q", "r", "b", "n"].includes(promotion)) {
      send(socket, { type: "error", message: "Lance inválido." });
      return;
    }
    try {
      game.chess.move({ from, to, promotion });
    } catch {
      send(socket, { type: "error", message: "Esse lance não é permitido." });
      return;
    }
    sendGameState(game);
    return;
  }
  send(socket, { type: "error", message: "Comando desconhecido." });
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});
const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });

server.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  if (!allowedOrigins.has(origin) || request.url !== "/") {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

webSocketServer.on("connection", (socket) => {
  socket.queueState = "idle";
  socket.messageTimes = [];
  socket.on("message", (data) => {
    const now = Date.now();
    socket.messageTimes = socket.messageTimes.filter((time) => now - time < 10000);
    if (socket.messageTimes.length >= 30) {
      socket.close(1008, "Limite de mensagens excedido.");
      return;
    }
    socket.messageTimes.push(now);
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", message: "Não foi possível ler a mensagem." });
      return;
    }
    handleMessage(socket, message);
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", (error) => {
    console.error("Erro na conexão multiplayer:", error.message);
    disconnect(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Servidor multiplayer ativo na porta ${port}.`);
});
