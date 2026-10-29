const { createHmac, timingSafeEqual } = require("node:crypto");

const INITIAL_RATING = 1200;
const K_FACTOR = 32;
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function calculateElo(whiteRating, blackRating, whiteScore) {
  const expectedWhite = 1 / (1 + 10 ** ((blackRating - whiteRating) / 400));
  const expectedBlack = 1 - expectedWhite;
  const blackScore = 1 - whiteScore;
  return {
    white: Math.max(100, Math.round(whiteRating + K_FACTOR * (whiteScore - expectedWhite))),
    black: Math.max(100, Math.round(blackRating + K_FACTOR * (blackScore - expectedBlack))),
  };
}

function signPlayerToken(playerId, secret) {
  if (!PLAYER_ID_PATTERN.test(playerId)) throw new Error("ID de jogador inválido.");
  const signature = createHmac("sha256", secret).update(playerId).digest("base64url");
  return `${playerId}.${signature}`;
}

function verifyPlayerToken(token, secret) {
  if (typeof token !== "string") return null;
  const [playerId, signature, ...extra] = token.split(".");
  if (extra.length || !PLAYER_ID_PATTERN.test(playerId || "") || !signature) return null;
  const expected = createHmac("sha256", secret).update(playerId).digest();
  let received;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  return received.length === expected.length && timingSafeEqual(received, expected) ? playerId : null;
}

module.exports = {
  INITIAL_RATING,
  PLAYER_ID_PATTERN,
  calculateElo,
  signPlayerToken,
  verifyPlayerToken,
};
