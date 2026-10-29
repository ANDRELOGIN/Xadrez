const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateElo,
  signPlayerToken,
  verifyPlayerToken,
} = require("../elo");

test("equal-rated decisive game exchanges 16 points with K=32", () => {
  assert.deepEqual(calculateElo(1200, 1200, 1), { white: 1216, black: 1184 });
});

test("equal-rated draw leaves both ratings unchanged", () => {
  assert.deepEqual(calculateElo(1200, 1200, 0.5), { white: 1200, black: 1200 });
});

test("ratings do not fall below the configured floor", () => {
  assert.equal(calculateElo(100, 100, 0).white, 100);
});

test("guest token validates only for its signed player id", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const token = signPlayerToken(id, "test-secret");
  assert.equal(verifyPlayerToken(token, "test-secret"), id);
  assert.equal(verifyPlayerToken(token, "different-secret"), null);
  assert.equal(verifyPlayerToken(`${id.slice(0, -1)}1.${token.split(".")[1]}`, "test-secret"), null);
});
