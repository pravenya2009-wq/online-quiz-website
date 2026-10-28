// "AI Quiz Mentor" - a rule-based coach. It reads the student's statistics and applies
// simple if/else rules. No external AI service is used, so it works offline and is free.

function buildMentorAdvice({ topicStats = [], overconfident = 0, lucky = 0, dueCount = 0, totalAnswered = 0, streak = 0 }) {
  const tips = [];

  if (totalAnswered === 0) {
    return [{
      emoji: "🚀", title: "Start your first quest",
      text: "Open the Adventure Map and clear Level 1. I will start coaching you as soon as I see your answers.",
      href: "#/map", label: "Open the map",
    }];
  }

  const ranked = topicStats
    .filter((t) => t.answered >= 3)
    .map((t) => ({ ...t, accuracy: Math.round((t.correct / t.answered) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy);

  if (ranked.length) {
    const weakest = ranked[0];
    if (weakest.accuracy < 60) {
      tips.push({
        emoji: "🎯", title: `Power up: ${weakest.name}`,
        text: `Your accuracy in this topic is ${weakest.accuracy}%. Adaptive practice gives easier questions first, then raises the difficulty as you improve.`,
        href: `#/adaptive/${weakest.topicId}`, label: "Start adaptive practice",
      });
    } else {
      const best = ranked[ranked.length - 1];
      tips.push({
        emoji: "💪", title: `Strong in ${best.name}`,
        text: `You are scoring ${best.accuracy}% here. Try a Live Battle to test your speed too.`,
        href: "#/battle", label: "Open battles",
      });
    }
  }

  if (overconfident >= 2) {
    tips.push({
      emoji: "⚠️", title: "Watch out for overconfidence",
      text: `You marked "Sure" on ${overconfident} answers that were wrong. These are usually misconceptions - read the explanations again.`,
      href: "#/revision", label: "Fix them in revision",
    });
  }
  if (lucky >= 2) {
    tips.push({
      emoji: "🎲", title: "Lucky guesses are not mastery",
      text: `${lucky} of your correct answers were guesses. I added them to your revision list so they become real knowledge.`,
      href: "#/revision", label: "Revise now",
    });
  }
  if (dueCount > 0) {
    tips.push({
      emoji: "🔁", title: `${dueCount} revision card${dueCount === 1 ? "" : "s"} due`,
      text: "Reviewing on schedule is the fastest way to remember things for NEET.",
      href: "#/revision", label: "Start revision",
    });
  }
  if (streak === 0) {
    tips.push({
      emoji: "🔥", title: "Light your streak",
      text: "Finish any quiz or revision card today to start a daily streak.",
      href: "#/map", label: "Pick a quest",
    });
  }
  if (!tips.length) {
    tips.push({ emoji: "✅", title: "You are on track", text: "Keep going - clear the next level on the map.", href: "#/map", label: "Open the map" });
  }
  return tips;
}

module.exports = { buildMentorAdvice };
