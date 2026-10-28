const test = require("node:test");
const assert = require("node:assert");
const s = require("../utils/scoring");
const { buildMentorAdvice } = require("../utils/mentor");

test("NEET marking: +4, -1, 0", () => {
  assert.strictEqual(s.calcMarks("A", "A"), 4);
  assert.strictEqual(s.calcMarks("B", "A"), -1);
  assert.strictEqual(s.calcMarks(null, "A"), 0);
});

test("percent never goes below 0 or above 100", () => {
  assert.strictEqual(s.percentOf(-3, 20), 0);
  assert.strictEqual(s.percentOf(20, 20), 100);
  assert.strictEqual(s.percentOf(10, 0), 0);
});

test("stars", () => {
  assert.strictEqual(s.starsFor(59, 60), 0);
  assert.strictEqual(s.starsFor(60, 60), 1);
  assert.strictEqual(s.starsFor(80, 60), 2);
  assert.strictEqual(s.starsFor(95, 60), 3);
  assert.strictEqual(s.starsFor(90, 95), 0); // below pass mark
});

test("adaptive difficulty stays between 1 and 3", () => {
  assert.strictEqual(s.nextDifficulty(2, true), 3);
  assert.strictEqual(s.nextDifficulty(3, true), 3);
  assert.strictEqual(s.nextDifficulty(1, false), 1);
  assert.strictEqual(s.nextDifficulty(3, false), 2);
});

test("revision boxes and intervals", () => {
  assert.strictEqual(s.nextBox(1, true), 2);
  assert.strictEqual(s.nextBox(5, true), 5);
  assert.strictEqual(s.nextBox(4, false), 1);
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(s.intervalDays), [1, 3, 7, 14, 30]);
  assert.strictEqual(s.addDaysIST(0), s.todayIST());
});

test("confidence classification", () => {
  assert.strictEqual(s.classifyConfidence("sure", false), "overconfident");
  assert.strictEqual(s.classifyConfidence("guess", true), "lucky");
  assert.strictEqual(s.classifyConfidence("sure", true), "calibrated");
});

test("battle points reward speed", () => {
  assert.strictEqual(s.battlePoints(false, 20, 20), 0);
  assert.strictEqual(s.battlePoints(true, 20, 20), 150);
  assert.strictEqual(s.battlePoints(true, 0, 20), 100);
});

test("validation helpers", () => {
  assert.ok(s.isValidEmail("a@b.co"));
  assert.ok(!s.isValidEmail("nope"));
  assert.ok(s.isValidPassword("abcdefg1"));
  assert.ok(!s.isValidPassword("abcdefgh"));
  assert.ok(!s.isValidPassword("a1"));
});

test("mentor gives a starter tip, then targets the weakest topic", () => {
  assert.strictEqual(buildMentorAdvice({}).length, 1);
  const tips = buildMentorAdvice({ topicStats: [{ topicId: 7, name: "Cell Biology", answered: 5, correct: 1 }], totalAnswered: 5, streak: 2 });
  assert.ok(tips[0].href.endsWith("/adaptive/7"));
});
