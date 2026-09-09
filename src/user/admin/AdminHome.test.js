/**
 * countLegacyScoreTeams.
 *
 * Pulled out of AdminHome's onValue callback because the count is easy to get
 * subtly wrong and nothing else exercises it: legacy cards live under TWO
 * team-node fields, not one. dangerZone.js clears both teams/{id}/scores and
 * teams/{id}/finalScores when asked to start from scratch, and TeamSearch
 * still merges finalScores in when it shows the final round. A team whose
 * leftover cards are only under finalScores is real data the app no longer
 * ranks with -- missing it here means the "Finish the score migration"
 * blocker on the home page never fires.
 */
import { countLegacyScoreTeams } from "./AdminHome";

describe("countLegacyScoreTeams", () => {
  test("counts a team whose leftover cards are only under finalScores", () => {
    const teams = {
      t1: { name: "Clean", submitted: true },
      t2: { name: "Leftover", submitted: true, finalScores: { j1: { problem: 8 } } },
    };
    expect(countLegacyScoreTeams(teams)).toBe(1);
  });

  test("counts a team whose leftover cards are only under scores", () => {
    const teams = {
      t1: { name: "Clean", submitted: true },
      t2: { name: "Leftover", submitted: true, scores: { j1: { problem: 8 } } },
    };
    expect(countLegacyScoreTeams(teams)).toBe(1);
  });

  test("counts a team once even if both fields still have cards", () => {
    const teams = {
      t1: {
        name: "Double leftover",
        submitted: true,
        scores: { j1: { problem: 8 } },
        finalScores: { j1: { problem: 8 } },
      },
    };
    expect(countLegacyScoreTeams(teams)).toBe(1);
  });

  test("is zero once neither field has anything left", () => {
    const teams = { t1: { name: "Migrated", submitted: true } };
    expect(countLegacyScoreTeams(teams)).toBe(0);
  });
});
