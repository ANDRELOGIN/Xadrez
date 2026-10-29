const { createServer } = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { Chess } = require("chess.js");
const { Pool } = require("pg");
const { WebSocket, WebSocketServer } = require("ws");
const {
  INITIAL_RATING,
  PLAYER_ID_PATTERN,
  calculateElo,
  signPlayerToken,
  verifyPlayerToken,
} = require("./elo");

const port = Number(process.env.PORT || 10000);
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "https://andrelogin.github.io,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }) : null;
const waitingPlayers = new Set();
const games = new Map();
let ratingsReady = false;
let identitySecret = null;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendJson(response, status, body, origin) {
  if (allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("vary", "Origin");
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function playerName(playerId) {
  return `Jogador ${playerId.slice(0, 4).toUpperCase()}`;
}

function formatPlayer(row) {
  return {
    id: row.id,
    name: row.display_name,
    rating: row.rating,
    gamesPlayed: row.games_played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
  };
}

async function initializeRatings() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chess_players (
      id UUID PRIMARY KEY,
      display_name TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT ${INITIAL_RATING} CHECK (rating >= 100),
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chess_rated_games (
      game_id UUID PRIMARY KEY,
      white_player_id UUID NOT NULL REFERENCES chess_players(id),
      black_player_id UUID NOT NULL REFERENCES chess_players(id),
      result TEXT NOT NULL CHECK (result IN ('white', 'black', 'draw')),
      white_rating_before INTEGER NOT NULL,
      black_rating_before INTEGER NOT NULL,
      white_rating_after INTEGER NOT NULL,
      black_rating_after INTEGER NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chess_app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await pool.query(
    "INSERT INTO chess_app_settings (key, value) VALUES ('guest_token_secret', $1) ON CONFLICT (key) DO NOTHING",
    [randomBytes(32).toString("hex")],
  );
  const result = await pool.query("SELECT value FROM chess_app_settings WHERE key = 'guest_token_secret'");
  if (!result.rows[0]?.value) throw new Error("Não foi possível carregar a chave de identidade dos visitantes.");
  identitySecret = result.rows[0].value;
  ratingsReady = true;
}

async function getPlayer(playerId) {
  if (!ratingsReady) throw new Error("O banco de ratings ainda não está disponível.");
  await pool.query(
    `INSERT INTO chess_players (id, display_name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [playerId, playerName(playerId)],
  );
  const result = await pool.query(
    `SELECT id, display_name, rating, games_played, wins, draws, losses
     FROM chess_players WHERE id = $1`,
    [playerId],
  );
  if (!result.rows[0]) throw new Error("Não foi possível carregar o rating do jogador.");
  return formatPlayer(result.rows[0]);
}

function tokenFromRequest(request) {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function playerIdFromRequest(request) {
  return identitySecret ? verifyPlayerToken(tokenFromRequest(request), identitySecret) : null;
}

async function getLeaderboard(limit) {
  const result = await pool.query(
    `SELECT id, display_name, rating, games_played, wins, draws, losses
     FROM chess_players
     WHERE games_played > 0
     ORDER BY rating DESC, games_played DESC, created_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(formatPlayer);
}

async function saveRatedGame(game, result) {
  const whiteId = game.playerIds.get("w");
  const blackId = game.playerIds.get("b");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const playerId of [whiteId, blackId]) {
      await client.query(
        `INSERT INTO chess_players (id, display_name) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [playerId, playerName(playerId)],
      );
    }
    const ratingsQuery = await client.query(
      `SELECT id, rating FROM chess_players
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[whiteId, blackId]],
    );
    const ratings = new Map(ratingsQuery.rows.map((row) => [row.id, row.rating]));
    const whiteBefore = ratings.get(whiteId);
    const blackBefore = ratings.get(blackId);
    if (whiteBefore === undefined || blackBefore === undefined) {
      throw new Error("Não foi possível carregar os ratings da partida.");
    }
    const whiteScore = result === "white" ? 1 : result === "draw" ? 0.5 : 0;
    const updatedRatings = calculateElo(whiteBefore, blackBefore, whiteScore);
    const insertedGame = await client.query(
      `INSERT INTO chess_rated_games (
         game_id, white_player_id, black_player_id, result,
         white_rating_before, black_rating_before, white_rating_after, black_rating_after
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (game_id) DO NOTHING
       RETURNING game_id`,
      [game.id, whiteId, blackId, result, whiteBefore, blackBefore, updatedRatings.white, updatedRatings.black],
    );
    if (insertedGame.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    for (const [playerId, before, after, score] of [
      [whiteId, whiteBefore, updatedRatings.white, whiteScore],
      [blackId, blackBefore, updatedRatings.black, 1 - whiteScore],
    ]) {
      await client.query(
        `UPDATE chess_players
         SET rating = $2,
             games_played = games_played + 1,
             wins = wins + $3,
             draws = draws + $4,
             losses = losses + $5
         WHERE id = $1`,
        [playerId, after, score === 1 ? 1 : 0, score === 0.5 ? 1 : 0, score === 0 ? 1 : 0],
      );
      if (!Number.isInteger(before)) throw new Error("Rating inválido ao salvar a partida.");
    }
    await client.query("COMMIT");
    return {
      [whiteId]: { before: whiteBefore, after: updatedRatings.white, delta: updatedRatings.white - whiteBefore },
      [blackId]: { before: blackBefore, after: updatedRatings.black, delta: updatedRatings.black - blackBefore },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function sendGameState(game) {
  const history = game.chess.history({ verbose: true }).map(({ from, to, promotion, san, color }) => ({
    from,
    to,
    promotion,
    san,
    color,
  }));
  const checkmate = game.chess.isCheckmate();
  const draw = game.chess.isDraw();
  const gameOver = checkmate || draw;
  const winner = checkmate ? game.chess.turn() === "w" ? "black" : "white" : null;
  const result = checkmate
    ? `Xeque-mate. Vitória das ${game.chess.turn() === "w" ? "pretas" : "brancas"}.`
    : draw ? "A partida terminou empatada." : null;
  let ratingChanges = null;
  let ratingError = false;

  if (gameOver && !game.ratingProcessed) {
    game.ratingProcessed = true;
    if (!ratingsReady) {
      ratingError = true;
    } else {
      try {
        ratingChanges = await saveRatedGame(game, winner || "draw");
        game.ratingChanges = ratingChanges;
      } catch (error) {
        game.ratingProcessed = false;
        ratingError = true;
        console.error("Erro ao registrar rating da partida:", error.message);
      }
    }
  } else if (gameOver) {
    ratingChanges = game.ratingChanges;
  }

  const state = {
    type: "game_state",
    gameId: game.id,
    fen: game.chess.fen(),
    history,
    gameOver,
    result,
    ratingChanges,
    ratingError,
  };
  for (const player of game.players.values()) send(player, state);
}

async function matchPlayers(first, second) {
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
    playerIds: new Map([
      [firstColor, first.playerId],
      [firstColor === "w" ? "b" : "w", second.playerId],
    ]),
    ratingProcessed: false,
    ratingChanges: null,
  };
  first.gameId = game.id;
  second.gameId = game.id;
  games.set(game.id, game);

  try {
    const profiles = ratingsReady
      ? await Promise.all([getPlayer(first.playerId), getPlayer(second.playerId)])
      : [null, null];
    const profilesById = new Map(profiles.filter(Boolean).map((profile) => [profile.id, profile]));
    for (const [color, player] of game.players) {
      const opponentColor = color === "w" ? "b" : "w";
      const ownProfile = profilesById.get(player.playerId);
      const opponentProfile = profilesById.get(game.playerIds.get(opponentColor));
      send(player, {
        type: "matched",
        gameId: game.id,
        color,
        playerRating: ownProfile?.rating ?? null,
        opponentRating: opponentProfile?.rating ?? null,
        opponentName: opponentProfile?.name ?? "Adversário",
      });
    }
  } catch (error) {
    games.delete(game.id);
    for (const player of game.players.values()) {
      player.gameId = null;
      player.queueState = "idle";
      send(player, { type: "error", message: "Não foi possível carregar o rating. Tente entrar na fila novamente." });
    }
    console.error("Erro ao parear jogadores:", error.message);
  }
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

async function handleMessage(socket, message) {
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
    const playerId = ratingsReady
      ? verifyPlayerToken(message.playerToken, identitySecret)
      : message.playerId;
    if (typeof playerId !== "string" || !PLAYER_ID_PATTERN.test(playerId)) {
      send(socket, { type: "error", message: "Não foi possível identificar seu perfil de visitante. Atualize a página e tente novamente." });
      return;
    }
    socket.playerId = playerId;
    const opponent = [...waitingPlayers].find(
      (player) => player.readyState === WebSocket.OPEN && player.playerId !== playerId,
    );
    if (opponent) {
      await matchPlayers(opponent, socket);
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
    await sendGameState(game);
    return;
  }
  send(socket, { type: "error", message: "Comando desconhecido." });
}

async function handleApiRequest(request, response, url) {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    sendJson(response, allowedOrigins.has(origin) ? 204 : 403, {}, origin);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/guest") {
    if (!ratingsReady) {
      sendJson(response, 503, { error: "O sistema de rating está aguardando a configuração do banco de dados." }, origin);
      return;
    }
    const id = randomUUID();
    const player = await getPlayer(id);
    sendJson(response, 201, { token: signPlayerToken(id, identitySecret), player }, origin);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/rating") {
    if (!ratingsReady) {
      sendJson(response, 503, { error: "O sistema de rating está aguardando a configuração do banco de dados." }, origin);
      return;
    }
    const playerId = playerIdFromRequest(request);
    if (!playerId) {
      sendJson(response, 401, { error: "Perfil de visitante inválido." }, origin);
      return;
    }
    sendJson(response, 200, { player: await getPlayer(playerId) }, origin);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    if (!ratingsReady) {
      sendJson(response, 503, { error: "O sistema de rating está aguardando a configuração do banco de dados." }, origin);
      return;
    }
    const requestedLimit = Number(url.searchParams.get("limit") || 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(20, Math.max(1, requestedLimit)) : 10;
    sendJson(response, 200, { players: await getLeaderboard(limit) }, origin);
    return;
  }
  sendJson(response, 404, { error: "Endpoint não encontrado." }, origin);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    handleApiRequest(request, response, url).catch((error) => {
      console.error("Erro na API de rating:", error.message);
      if (!response.headersSent) sendJson(response, 500, { error: "Não foi possível concluir a solicitação de rating." }, request.headers.origin);
      else response.destroy(error);
    });
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
    handleMessage(socket, message).catch((error) => {
      console.error("Erro ao processar mensagem multiplayer:", error.message);
      send(socket, { type: "error", message: "Não foi possível processar sua solicitação." });
    });
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", (error) => {
    console.error("Erro na conexão multiplayer:", error.message);
    disconnect(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Servidor multiplayer ativo na porta ${port}.`);
  if (!pool) {
    console.warn("Rating desativado: configure DATABASE_URL para habilitar o Elo e o ranking.");
    return;
  }
  initializeRatings().then(() => {
    console.log("Banco de ratings conectado; Elo multiplayer habilitado.");
  }).catch((error) => {
    console.error("Não foi possível inicializar o banco de ratings:", error.message);
    server.close(() => process.exit(1));
  });
});
