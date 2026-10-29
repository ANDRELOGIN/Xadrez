import { Chess } from "https://esm.sh/chess.js@1.4.0";

const PIECES = {
  wk: "♚", wq: "♛", wr: "♜", wb: "♝", wn: "♞", wp: "♟",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

const OPENINGS = [
  { eco: "B20", name: "Defesa Siciliana", detail: "Uma resposta dinâmica e assimétrica a 1. e4.", moves: ["e4", "c5"] },
  { eco: "B10", name: "Defesa Caro-Kann", detail: "Estrutura sólida para enfrentar 1. e4.", moves: ["e4", "c6"] },
  { eco: "C00", name: "Defesa Francesa", detail: "As pretas desafiam o centro com ...d5.", moves: ["e4", "e6"] },
  { eco: "B01", name: "Defesa Escandinava", detail: "Uma resposta direta: as pretas atacam o centro imediatamente.", moves: ["e4", "d5"] },
  { eco: "C20", name: "Jogo Aberto", detail: "As brancas ocupam o centro com o peão do rei.", moves: ["e4", "e5"] },
  { eco: "C44", name: "Abertura dos Quatro Cavalos", detail: "Desenvolvimento natural e disputa central equilibrada.", moves: ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"] },
  { eco: "C50", name: "Abertura Italiana", detail: "As brancas miram o ponto mais sensível do centro.", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
  { eco: "C60", name: "Abertura Ruy Lopez", detail: "Pressão estratégica sobre o cavalo que defende e5.", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  { eco: "C40", name: "Defesa Petrov", detail: "As pretas respondem ao ataque com um contra-ataque central.", moves: ["e4", "e5", "Nf3", "Nf6"] },
  { eco: "D06", name: "Abertura do Peão da Dama", detail: "As brancas abrem o jogo pelo flanco da dama.", moves: ["d4", "d5"] },
  { eco: "D30", name: "Gambito da Dama", detail: "Pressão central com uma oferta temporária de peão.", moves: ["d4", "d5", "c4"] },
  { eco: "E20", name: "Defesa Índia do Rei", detail: "As pretas cedem espaço e preparam um contra-ataque.", moves: ["d4", "Nf6", "c4", "g6"] },
  { eco: "A10", name: "Abertura Inglesa", detail: "Controle do centro à distância, com o peão da coluna c.", moves: ["c4"] },
  { eco: "A04", name: "Abertura Reti", detail: "Desenvolvimento flexível antes de ocupar o centro.", moves: ["Nf3"] },
];
const CHESS_QUOTES = [
  { text: "Ao ver um bom lance, procure um melhor.", author: "Emanuel Lasker" },
  { text: "Nunca busque um peão enquanto seu desenvolvimento estiver incompleto.", author: "Aron Nimzowitsch" },
  { text: "Existem dois tipos de sacrifício: os corretos e os meus.", author: "Mikhail Tal" },
  { text: "Até um plano ruim é melhor do que plano nenhum.", author: "Mikhail Chigorin" },
  { text: "Para melhorar, estude o final antes de tudo.", author: "Jose Capablanca" },
  { text: "Os erros estão todos no tabuleiro, esperando para serem cometidos.", author: "Savielly Tartakower" },
];

const MULTIPLAYER_SERVER_URL = "wss://xadrez-multiplayer-qxxf.onrender.com";
const MULTIPLAYER_API_URL = "https://xadrez-multiplayer-qxxf.onrender.com";
const GUEST_TOKEN_STORAGE_KEY = "xeque-multiplayer-guest-token";
const RATING_API_TIMEOUT_MS = 8000;
let game = new Chess();
const boardElement = document.querySelector("#board");
const moveListElement = document.querySelector("#move-list");
const sideSelect = document.querySelector("#side-select");
const depthSelect = document.querySelector("#depth-select");
const engineState = document.querySelector("#engine-state");
const turnLabel = document.querySelector("#turn-label");
const toast = document.querySelector("#toast");
const modePicker = document.querySelector("#mode-picker");
const queueScreen = document.querySelector("#queue-screen");
const workspace = document.querySelector("#partida");
const gameControls = document.querySelector("#game-controls");
const siteFooter = document.querySelector("#site-footer");
const mainNav = document.querySelector(".main-nav");
const siteStatus = document.querySelector("#site-status");
const queueMessage = document.querySelector("#queue-message");
const queueRetry = document.querySelector("#queue-retry");
let humanColor = "w";
let selectedSquare = null;
let legalMoves = [];
let currentPly = 0;
let mode = "menu";
let multiplayerSocket = null;
let multiplayerGameId = null;
let opponentConnected = false;
let multiplayerOpponentName = "Adversário";
let opponentRating = null;
let playerRating = null;
let guestToken = null;
let guestProfileRequest = null;
let fallbackPlayerId = null;
let engineReady = false;
let engineThinking = false;
let engineGeneration = 0;
let toastTimer;
let quoteOffset = 0;
let engine = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function updateRatingSummary(player) {
  document.querySelector("#rating-value").textContent = String(player.rating);
  document.querySelector("#rating-games").textContent = `${player.gamesPlayed} ${player.gamesPlayed === 1 ? "partida" : "partidas"}`;
  document.querySelector("#player-handle").textContent = player.name;
}

function renderLeaderboard(players) {
  const leaderboard = document.querySelector("#leaderboard");
  leaderboard.replaceChildren();
  if (!players.length) {
    const empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "Jogue uma partida multiplayer para entrar no ranking.";
    leaderboard.append(empty);
    return;
  }
  players.forEach((player, index) => {
    const row = document.createElement("li");
    row.className = "leaderboard-row";
    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = player.name;
    const rating = document.createElement("strong");
    rating.className = "leaderboard-rating";
    rating.textContent = String(player.rating);
    row.append(rank, name, rating);
    leaderboard.append(row);
  });
}

async function fetchRatingApi(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATING_API_TIMEOUT_MS);
  try {
    return await fetch(`${MULTIPLAYER_API_URL}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getFallbackPlayerId() {
  if (!fallbackPlayerId) fallbackPlayerId = crypto.randomUUID();
  return fallbackPlayerId;
}

async function ensureGuestProfile() {
  if (guestToken) return { token: guestToken, player: playerRating };
  if (guestProfileRequest) return guestProfileRequest;
  guestProfileRequest = (async () => {
    let storedToken = null;
    try {
      storedToken = localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
    } catch (error) {
      console.error("Não foi possível acessar o armazenamento do navegador:", error);
    }

    if (storedToken) {
      const response = await fetchRatingApi("/api/rating", {
        headers: { authorization: `Bearer ${storedToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        guestToken = storedToken;
        playerRating = data.player;
        return { token: guestToken, player: playerRating };
      }
      if (response.status !== 401 && response.status !== 503) {
        throw new Error(`O servidor de rating respondeu ${response.status}.`);
      }
      if (response.status === 503) return null;
      try {
        localStorage.removeItem(GUEST_TOKEN_STORAGE_KEY);
      } catch (error) {
        console.error("Não foi possível remover um perfil de visitante inválido:", error);
      }
    }

    const response = await fetchRatingApi("/api/guest", { method: "POST" });
    if (response.status === 503) return null;
    if (!response.ok) throw new Error(`Não foi possível criar o perfil de visitante (${response.status}).`);
    const data = await response.json();
    guestToken = data.token;
    playerRating = data.player;
    try {
      localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, guestToken);
    } catch (error) {
      console.error("Não foi possível salvar o perfil de visitante neste navegador:", error);
    }
    return { token: guestToken, player: playerRating };
  })();
  try {
    return await guestProfileRequest;
  } finally {
    guestProfileRequest = null;
  }
}

async function loadRatingDashboard() {
  try {
    const profile = await ensureGuestProfile();
    if (!profile) throw new Error("O servidor de rating ainda não está configurado.");
    updateRatingSummary(profile.player);
    const response = await fetchRatingApi("/api/leaderboard?limit=5");
    if (!response.ok) throw new Error(`O ranking respondeu ${response.status}.`);
    const data = await response.json();
    renderLeaderboard(data.players);
  } catch (error) {
    console.error("Não foi possível carregar o rating multiplayer:", error);
    document.querySelector("#rating-value").textContent = "—";
    document.querySelector("#rating-games").textContent = "Rating indisponível";
    document.querySelector("#player-handle").textContent = "Visitante";
    const leaderboard = document.querySelector("#leaderboard");
    leaderboard.replaceChildren();
    const unavailable = document.createElement("li");
    unavailable.className = "leaderboard-empty";
    unavailable.textContent = "O ranking multiplayer está temporariamente indisponível.";
    leaderboard.append(unavailable);
  }
}

function showGame() {
  modePicker.hidden = true;
  queueScreen.hidden = true;
  workspace.hidden = false;
  gameControls.hidden = false;
  siteFooter.hidden = false;
  mainNav.hidden = false;
}

function resetGame() {
  game.reset();
  currentPly = 0;
  selectedSquare = null;
  legalMoves = [];
  render();
}

function closeMultiplayerConnection() {
  const socket = multiplayerSocket;
  multiplayerSocket = null;
  multiplayerGameId = null;
  opponentConnected = false;
  multiplayerOpponentName = "Adversário";
  opponentRating = null;
  if (!socket) return;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  socket.close();
}

function returnToModePicker() {
  invalidateEngine();
  closeMultiplayerConnection();
  mode = "menu";
  resetGame();
  modePicker.hidden = false;
  queueScreen.hidden = true;
  workspace.hidden = true;
  gameControls.hidden = true;
  siteFooter.hidden = true;
  mainNav.hidden = true;
  siteStatus.textContent = "escolha um modo";
  engineState.textContent = engineReady ? "Stockfish pronto" : "carregando engine";
  document.querySelector("#opponent-name").textContent = "Stockfish";
  queueRetry.hidden = true;
}

function selectSoloMode() {
  invalidateEngine();
  closeMultiplayerConnection();
  mode = "solo";
  humanColor = "w";
  sideSelect.value = humanColor;
  resetGame();
  siteStatus.textContent = "partida solo";
  engineState.textContent = engineReady ? "Stockfish pronto" : "carregando engine";
  document.querySelector("#opponent-name").textContent = "Stockfish";
  showGame();
  initializeEngine();
}

function setQueueMessage(title, message, retry = false) {
  document.querySelector("#queue-title").textContent = title;
  queueMessage.textContent = message;
  queueRetry.hidden = !retry;
}

function startMultiplayerSearch() {
  invalidateEngine();
  closeMultiplayerConnection();
  mode = "queue";
  opponentConnected = false;
  setQueueMessage("Procurando adversário", "Conectando à sala de partidas...");
  modePicker.hidden = true;
  queueScreen.hidden = false;
  workspace.hidden = true;
  gameControls.hidden = true;
  siteFooter.hidden = true;
  mainNav.hidden = true;
  siteStatus.textContent = "conectando";

  let socket;
  try {
    socket = new WebSocket(MULTIPLAYER_SERVER_URL);
  } catch (error) {
    setQueueMessage("Não foi possível conectar", "Tente novamente em instantes.", true);
    siteStatus.textContent = "multiplayer indisponível";
    return;
  }
  multiplayerSocket = socket;

  socket.onopen = () => {
    if (multiplayerSocket !== socket || mode !== "queue") return;
    ensureGuestProfile().then((profile) => {
      if (multiplayerSocket !== socket || mode !== "queue") return;
      const identity = profile?.token
        ? { playerToken: profile.token }
        : { playerId: getFallbackPlayerId() };
      socket.send(JSON.stringify({ type: "join_queue", ...identity }));
      siteStatus.textContent = "buscando jogador";
    }).catch((error) => {
      console.error("Não foi possível preparar o perfil para a partida:", error);
      if (multiplayerSocket !== socket || mode !== "queue") return;
      showToast("Rating indisponível; tentando entrar como visitante.");
      socket.send(JSON.stringify({ type: "join_queue", playerId: getFallbackPlayerId() }));
      siteStatus.textContent = "buscando jogador";
    });
  };
  socket.onmessage = ({ data }) => {
    if (multiplayerSocket !== socket) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      showToast("O servidor enviou uma resposta inválida.");
      return;
    }

    if (message.type === "queued" && mode === "queue") {
      setQueueMessage("Procurando adversário", "Você está na fila. Assim que alguém entrar, a partida começa.");
      return;
    }
    if (message.type === "matched" && mode === "queue") {
      mode = "multiplayer";
      multiplayerGameId = message.gameId;
      humanColor = message.color;
      opponentConnected = true;
      playerRating = message.playerRating === null ? playerRating : { ...playerRating, rating: message.playerRating };
      opponentRating = message.opponentRating;
      multiplayerOpponentName = message.opponentName || "Adversário";
      game.reset();
      currentPly = 0;
      selectedSquare = null;
      legalMoves = [];
      document.querySelector("#opponent-name").textContent = "Adversário";
      engineState.textContent = "jogando ao vivo";
      siteStatus.textContent = "multiplayer ao vivo";
      showGame();
      render();
      return;
    }
    if (message.type === "game_state" && mode === "multiplayer" && message.gameId === multiplayerGameId) {
      const synchronizedGame = new Chess();
      try {
        for (const move of message.history) {
          synchronizedGame.move({ from: move.from, to: move.to, promotion: move.promotion });
        }
      } catch (error) {
        showToast("Não foi possível sincronizar a posição da partida.");
        return;
      }
      game = synchronizedGame;
      currentPly = game.history().length;
      selectedSquare = null;
      legalMoves = [];
      render();
      if (message.gameOver) {
        const change = playerRating && message.ratingChanges?.[playerRating.id];
        if (change) {
          playerRating = { ...playerRating, rating: change.after, gamesPlayed: playerRating.gamesPlayed + 1 };
          updateRatingSummary(playerRating);
          const difference = change.delta > 0 ? `+${change.delta}` : String(change.delta);
          showToast(`${message.result} Elo ${change.before} → ${change.after} (${difference}).`);
          loadRatingDashboard();
        } else if (message.ratingError) {
          showToast(`${message.result} O rating não pôde ser salvo.`);
        } else {
          showToast(message.result);
        }
      }
      return;
    }
    if (message.type === "opponent_left" && mode === "multiplayer") {
      opponentConnected = false;
      engineState.textContent = "adversário desconectado";
      siteStatus.textContent = "partida encerrada";
      updateStatus();
      showToast("Seu adversário saiu da partida.");
      return;
    }
    if (message.type === "error") {
      if (mode === "queue") {
        setQueueMessage("Não foi possível entrar na fila", message.message, true);
        siteStatus.textContent = "multiplayer indisponível";
      }
      showToast(message.message);
    }
  };
  socket.onerror = () => {
    if (multiplayerSocket !== socket) return;
    if (mode === "queue") {
      setQueueMessage("Servidor indisponível", "O servidor pode estar iniciando. Tente novamente em instantes.", true);
      siteStatus.textContent = "multiplayer indisponível";
    }
  };
  socket.onclose = () => {
    if (multiplayerSocket !== socket) return;
    multiplayerSocket = null;
    if (mode === "queue") {
      setQueueMessage("Conexão encerrada", "Não foi possível manter a conexão com a sala.", true);
      siteStatus.textContent = "multiplayer indisponível";
    } else if (mode === "multiplayer") {
      opponentConnected = false;
      engineState.textContent = "conexão interrompida";
      siteStatus.textContent = "conexão interrompida";
      updateStatus();
      showToast("A conexão da partida foi interrompida.");
    }
  };
}

function initializeEngine() {
  if (engine) return;
  try {
    engine = typeof globalThis.createStockfishWorker === "function"
      ? globalThis.createStockfishWorker()
      : new Worker("stockfish-worker.js");
  } catch (error) {
    engineState.textContent = "engine indisponível";
    return;
  }

  engine.onmessage = ({ data }) => {
    const line = String(data).trim();
    if (line === "uciok") {
      engineReady = true;
      engineState.textContent = "Stockfish pronto";
      maybeStartEngine();
    }
    if (line.startsWith("bestmove ")) {
      const generation = engineGeneration;
      engineThinking = false;
      engineState.textContent = engineReady ? "Stockfish pronto" : "carregando engine";
      const uci = line.split(/\s+/)[1];
      if (generation !== engineGeneration || !uci || uci === "(none)" || game.isGameOver()) return;
      try {
        game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
        currentPly = game.history().length;
        render();
        updateStatus();
      } catch (error) {
        engineState.textContent = "engine indisponível";
        showToast("Não foi possível aplicar o lance do engine.");
      }
    }
  };
  engine.onerror = () => {
    engineReady = false;
    engineThinking = false;
    engineState.textContent = "engine indisponível";
    showToast("O Stockfish não carregou. Tente abrir novamente este arquivo.");
  };
  engineState.textContent = "carregando engine";
  engine.postMessage("uci");
}

function visiblePosition() {
  const position = new Chess();
  game.history({ verbose: true }).slice(0, currentPly).forEach((move) => {
    position.move({ from: move.from, to: move.to, promotion: move.promotion });
  });
  return position;
}

function renderBoard(position, history) {
  boardElement.replaceChildren();
  const files = humanColor === "w" ? "abcdefgh" : "hgfedcba";
  const ranks = humanColor === "w" ? "87654321" : "12345678";
  const lastMove = history[currentPly - 1];
  const board = position.board();

  for (const rankChar of ranks) {
    for (const file of files) {
      const square = `${file}${rankChar}`;
      const fileIndex = file.charCodeAt(0) - 97;
      const rank = Number(rankChar);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `square ${(fileIndex + rank) % 2 === 0 ? "light" : "dark"}`;
      cell.dataset.square = square;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", square);
      if (lastMove && (square === lastMove.from || square === lastMove.to)) cell.classList.add("last-move");
      if (square === selectedSquare && currentPly === history.length) cell.classList.add("selected");
      const targetMove = legalMoves.find((move) => move.to === square);
      if (targetMove && currentPly === history.length) {
        cell.classList.add("legal");
        if (position.get(square)) cell.classList.add("capture");
      }

      const piece = board[8 - rank][fileIndex];
      if (piece) {
        const glyph = document.createElement("span");
        glyph.className = `piece ${piece.color === "w" ? "white" : "black"}`;
        glyph.textContent = PIECES[`${piece.color}${piece.type}`];
        cell.append(glyph);
      }
      if ((humanColor === "w" && file === "a") || (humanColor === "b" && file === "h")) {
        const label = document.createElement("span");
        label.className = "coord rank";
        label.textContent = rankChar;
        cell.append(label);
      }
      if ((humanColor === "w" && rankChar === "1") || (humanColor === "b" && rankChar === "8")) {
        const label = document.createElement("span");
        label.className = "coord file";
        label.textContent = file;
        cell.append(label);
      }
      boardElement.append(cell);
    }
  }
}

function renderMoves(history) {
  moveListElement.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<span class="empty-icon">♘</span><p>A partida começa<br />com <strong>1. e4</strong> ou qualquer outro lance.</p>';
    moveListElement.append(empty);
    return;
  }

  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);
    for (let offset = 0; offset < 2; offset += 1) {
      const move = history[index + offset];
      if (!move) {
        row.append(document.createElement("span"));
        continue;
      }
      const ply = index + offset + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `move-cell${currentPly === ply ? " current" : ""}`;
      button.title = `Ir para ${move.from} → ${move.to}`;
      button.setAttribute("aria-label", `${number.textContent} ${offset === 0 ? "brancas" : "pretas"}: ${move.san}, ${move.from} para ${move.to}`);
      button.addEventListener("click", () => {
        currentPly = ply;
        selectedSquare = null;
        legalMoves = [];
        render();
        updateStatus();
      });
      const san = document.createElement("span");
      san.className = "move-san";
      san.textContent = move.san;
      const coords = document.createElement("span");
      coords.className = "move-uci";
      coords.textContent = `${move.from}→${move.to}`;
      button.append(san, coords);
      row.append(button);
    }
    moveListElement.append(row);
  }
  moveListElement.scrollTop = moveListElement.scrollHeight;
}

function updateOpening(history) {
  const sans = history.map((move) => move.san);
  const opening = OPENINGS
    .filter((entry) => entry.moves.every((move, index) => sans[index] === move))
    .sort((left, right) => right.moves.length - left.moves.length)[0];
  document.querySelector("#opening-eco").textContent = opening ? `ECO ${opening.eco}` : sans.length ? "ECO —" : "ECO —";
  document.querySelector("#opening-name").textContent = opening ? opening.name : sans.length ? "Abertura em desenvolvimento" : "Abertura inicial";
  document.querySelector("#opening-detail").textContent = opening ? opening.detail : sans.length ? "Sem classificação no repertório; continue desenvolvendo suas peças." : "A abertura aparece conforme os lances acontecem.";
}

function updateMentor(history, position) {
  let tip;
  if (position.isCheckmate()) tip = "Xeque-mate! Volte um lance e repare como as peças trabalharam juntas.";
  else if (position.isCheck()) tip = "Seu rei está em xeque: capture a peça, bloqueie a linha ou mova o rei.";
  else if (currentPly < history.length) tip = "Revise este momento: que peça sua ficou mais exposta depois desse lance?";
  else if (history.length === 0) tip = "No xadrez, comece disputando o centro com um peão.";
  else if (position.moves({ verbose: true }).some((move) => move.captured)) tip = "Tem captura disponível! Antes de tomar, confira o que fica desprotegido depois.";
  else if (history.length < 8) tip = "Desenvolva cavalos e bispos; deixar o rei seguro cedo costuma ajudar.";
  else if (history.length < 20) tip = "Procure a peça menos ativa e pense em como melhorar a posição dela.";
  else tip = "No final, seu rei também vira peça de ataque. Traga-o para o centro com cuidado.";

  document.querySelector("#mentor-tip").textContent = tip;
  const quote = CHESS_QUOTES[(Math.floor(currentPly / 2) + quoteOffset) % CHESS_QUOTES.length];
  document.querySelector("#mentor-quote").textContent = `“${quote.text}”`;
  document.querySelector("#mentor-author").textContent = quote.author;
}

function updateStatus() {
  const moves = game.history({ verbose: true });
  const moveCount = Math.ceil(moves.length / 2);
  const isMultiplayer = mode === "multiplayer";
  document.querySelector("#move-count").textContent = `${moveCount} ${moveCount === 1 ? "lance" : "lances"}`;
  document.querySelector("#player-state").textContent = humanColor === "w" ? "brancas" : "pretas";
  document.querySelector(".engine-token").textContent = isMultiplayer ? "•" : "S";
  document.querySelector("#opponent-name").textContent = isMultiplayer
    ? `${multiplayerOpponentName}${opponentRating === null ? "" : ` · ${opponentRating}`}`
    : "Stockfish";
  document.querySelector("#player-rating-state").hidden = !isMultiplayer;
  document.querySelector("#player-rating-state").textContent = isMultiplayer && playerRating
    ? `Elo ${playerRating.rating}`
    : isMultiplayer ? "Elo indisponível" : "";
  const topIsWhite = humanColor === "b";
  const capturedTop = moves.filter((move) => move.captured && move.color === (topIsWhite ? "w" : "b")).map((move) => PIECES[`${move.color === "w" ? "b" : "w"}${move.captured}`]).join(" ");
  const capturedBottom = moves.filter((move) => move.captured && move.color === (humanColor === "w" ? "w" : "b")).map((move) => PIECES[`${move.color === "w" ? "b" : "w"}${move.captured}`]).join(" ");
  document.querySelector("#captured-top").textContent = capturedTop;
  document.querySelector("#captured-bottom").textContent = capturedBottom;

  if (game.isCheckmate()) turnLabel.textContent = isMultiplayer
    ? game.turn() === humanColor ? "Xeque-mate: você perdeu" : "Xeque-mate: você venceu"
    : game.turn() === humanColor ? "Xeque-mate" : "Xeque-mate: você venceu";
  else if (game.isDraw()) turnLabel.textContent = "Empate";
  else if (game.isCheck()) turnLabel.textContent = game.turn() === humanColor ? "Você está em xeque" : isMultiplayer ? "Adversário em xeque" : "Engine em xeque";
  else if (currentPly !== moves.length) turnLabel.textContent = "Revendo partida";
  else if (isMultiplayer && !opponentConnected) turnLabel.textContent = "Partida encerrada";
  else turnLabel.textContent = game.turn() === humanColor ? "Sua vez" : isMultiplayer ? "Vez do adversário" : engineThinking ? "Engine pensando" : "Vez do engine";

  document.querySelector("#undo-button").disabled = isMultiplayer || moves.length === 0 || engineThinking;
  sideSelect.disabled = isMultiplayer;
  depthSelect.disabled = isMultiplayer;
  document.querySelector("#new-game-button").innerHTML = isMultiplayer
    ? "Encontrar outro adversário"
    : '<span aria-hidden="true">＋</span> Nova partida';
  document.querySelector("#first-move").disabled = currentPly === 0;
  document.querySelector("#previous-move").disabled = currentPly === 0;
  document.querySelector("#next-move").disabled = currentPly >= moves.length;
  document.querySelector("#last-move").disabled = currentPly >= moves.length;
}

function render() {
  const history = game.history({ verbose: true });
  const position = visiblePosition();
  renderBoard(position, history);
  renderMoves(history);
  updateOpening(history.slice(0, currentPly));
  updateMentor(history, position);
  updateStatus();
}

function maybeStartEngine() {
  if (mode !== "solo" || !engineReady || engineThinking || game.isGameOver() || game.turn() === humanColor) return;
  engineThinking = true;
  engineGeneration += 1;
  engineState.textContent = "calculando lance…";
  updateStatus();
  engine.postMessage(`position fen ${game.fen()}`);
  engine.postMessage(`go depth ${depthSelect.value}`);
}

function invalidateEngine() {
  engineGeneration += 1;
  engineThinking = false;
  if (engineReady) engine.postMessage("stop");
  engineState.textContent = engineReady ? "Stockfish pronto" : "carregando engine";
}

function onSquareClick(event) {
  const square = event.target.closest(".square")?.dataset.square;
  const canPlay = mode === "solo" || mode === "multiplayer" && opponentConnected && multiplayerSocket?.readyState === WebSocket.OPEN;
  if (!square || !canPlay || currentPly !== game.history().length || game.turn() !== humanColor || game.isGameOver() || engineThinking) return;
  const piece = game.get(square);
  if (selectedSquare && legalMoves.some((move) => move.to === square)) {
    const from = selectedSquare;
    let move;
    try {
      move = game.move({ from, to: square, promotion: "q" });
    } catch (error) {
      showToast("Esse lance não é permitido.");
      return;
    }
    currentPly = game.history().length;
    selectedSquare = null;
    legalMoves = [];
    render();
    loadRatingDashboard();
    if (mode === "multiplayer") {
      try {
        multiplayerSocket.send(JSON.stringify({
          type: "move",
          gameId: multiplayerGameId,
          move: { from: move.from, to: move.to, promotion: move.promotion },
        }));
        engineState.textContent = "lance enviado";
      } catch (error) {
        game.undo();
        currentPly = game.history().length;
        render();
        showToast("Não foi possível enviar o lance. Verifique a conexão.");
      }
    } else {
      maybeStartEngine();
    }
    return;
  }
  if (piece && piece.color === humanColor) {
    selectedSquare = square;
    legalMoves = game.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalMoves = [];
  }
  render();
}

boardElement.addEventListener("click", onSquareClick);
document.querySelector("#solo-mode").addEventListener("click", selectSoloMode);
document.querySelector("#multiplayer-mode").addEventListener("click", startMultiplayerSearch);
document.querySelector("#queue-cancel").addEventListener("click", returnToModePicker);
document.querySelector("#queue-retry").addEventListener("click", startMultiplayerSearch);
document.querySelector("#mode-menu-button").addEventListener("click", returnToModePicker);
document.querySelector("#new-game-button").addEventListener("click", () => {
  if (mode === "multiplayer") {
    startMultiplayerSearch();
    return;
  }
  invalidateEngine();
  resetGame();
  maybeStartEngine();
});
document.querySelector("#undo-button").addEventListener("click", () => {
  if (mode !== "solo") return;
  invalidateEngine();
  if (game.history().length) game.undo();
  if (game.history().length && game.turn() !== humanColor) game.undo();
  currentPly = game.history().length;
  selectedSquare = null;
  legalMoves = [];
  render();
});
sideSelect.addEventListener("change", () => {
  if (mode !== "solo") return;
  humanColor = sideSelect.value;
  invalidateEngine();
  currentPly = game.history().length;
  selectedSquare = null;
  legalMoves = [];
  render();
  maybeStartEngine();
});
document.querySelector("#first-move").addEventListener("click", () => { currentPly = 0; selectedSquare = null; legalMoves = []; render(); });
document.querySelector("#previous-move").addEventListener("click", () => { currentPly = Math.max(0, currentPly - 1); selectedSquare = null; legalMoves = []; render(); });
document.querySelector("#next-move").addEventListener("click", () => { currentPly = Math.min(game.history().length, currentPly + 1); selectedSquare = null; legalMoves = []; render(); });
document.querySelector("#last-move").addEventListener("click", () => { currentPly = game.history().length; selectedSquare = null; legalMoves = []; render(); });
document.querySelector("#quote-next").addEventListener("click", () => {
  quoteOffset = (quoteOffset + 1) % CHESS_QUOTES.length;
  updateMentor(game.history({ verbose: true }).slice(0, currentPly), visiblePosition());
});

render();
loadRatingDashboard();