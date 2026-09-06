import { ref, get } from "firebase/database";
import { database } from "../../firebase.js";
import { assignmentList } from "../judge/assignmentList.js";
import { calculateAverageScore, countFundableVotes, scoredJudgeCount, compareForRanking, RUBRIC } from "../judge/scoreRubric.js";
import { FIRST_ROUND, FINAL_ROUND } from "../judge/getTeamInfo.js";

/**
 * Getting the event out of the database and onto something you can hold.
 *
 * There was no export of any kind: no CSV, no JSON, no print view. Every
 * recovery path assumed the database was reachable and correct, which is a
 * poor assumption for the one hour of the year that actually matters. This is
 * the backstop under everything else -- a schedule you printed at 4:30 still
 * works when nothing else does, and a scores file downloaded before a wipe is
 * the copy that makes the wipe survivable.
 *
 * Everything here is pure except `loadEventData`, so the formatting can be
 * tested without a database.
 */

/**
 * RFC 4180 quoting.
 *
 * The leading-character guard is not about correctness, it is about Excel: a
 * cell starting =, +, - or @ is interpreted as a formula, and judges' notes are
 * free text typed by strangers. Prefixing a tab keeps the value visible and
 * inert.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `\t${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const RUBRIC_FIELDS = Object.keys(RUBRIC);

function judgeName(judge, fallback = "Unknown") {
  const name = [judge?.firstName, judge?.lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

function rosterOf(schedule) {
  const raw = schedule?.judges;
  return (Array.isArray(raw) ? raw : Object.values(raw ?? {})).filter((e) => e && e.judgeId);
}

/** Everything the exports need, in one read. */
export async function loadEventData() {
  const [teamsSnap, judgesSnap, competitorsSnap, firstSnap, finalSnap, configSnap] =
    await Promise.all([
      get(ref(database, "teams")),
      get(ref(database, "judges")),
      get(ref(database, "competitors")),
      get(ref(database, `scores/${FIRST_ROUND}`)),
      get(ref(database, `scores/${FINAL_ROUND}`)),
      get(ref(database, "config")),
    ]);

  return {
    teams: teamsSnap.val() ?? {},
    judges: judgesSnap.val() ?? {},
    competitors: competitorsSnap.val() ?? {},
    scores: { [FIRST_ROUND]: firstSnap.val() ?? {}, [FINAL_ROUND]: finalSnap.val() ?? {} },
    config: configSnap.val() ?? {},
    exportedAt: new Date().toISOString(),
  };
}

/** One row per team: where it presents, who judges it, how it scored. */
export function scheduleRows({ teams, judges }) {
  const rows = [["Batch", "Time", "Room", "Team", "Team ID", "Submitted", "Judges", "Members"]];

  Object.entries(teams)
    .map(([teamId, team]) => ({ teamId, team }))
    .sort((a, b) => {
      const ab = a.team?.schedule?.batch ?? 99;
      const bb = b.team?.schedule?.batch ?? 99;
      if (ab !== bb) return ab - bb;
      return String(a.team?.schedule?.room ?? "").localeCompare(String(b.team?.schedule?.room ?? ""));
    })
    .forEach(({ teamId, team }) => {
      const schedule = team?.schedule;
      rows.push([
        schedule?.batch ?? "",
        schedule?.time ?? "",
        schedule?.room ?? "",
        team?.name ?? "Unnamed Team",
        teamId,
        team?.submitted ? "yes" : "no",
        rosterOf(schedule)
          .map((entry) => judgeName(judges[entry.judgeId], entry.judgeName))
          .join("; "),
        Object.keys(team?.members ?? {}).length,
      ]);
    });

  return rows;
}

/** One row per score card, with the judge and the provenance intact. */
export function scoreRows({ teams, judges, scores }, round = FIRST_ROUND) {
  const rows = [
    [
      "Round", "Team", "Team ID", "Room", "Time", "Judge", "Judge UID",
      ...RUBRIC_FIELDS.map((field) => RUBRIC[field].label),
      "Total", "Fundable", "Entered by", "Source", "Submitted at", "Notes",
    ],
  ];

  for (const [teamId, cards] of Object.entries(scores?.[round] ?? {})) {
    for (const [judgeUid, card] of Object.entries(cards ?? {})) {
      const total = RUBRIC_FIELDS.reduce((sum, field) => {
        const value = Number(card?.[field]);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0);

      rows.push([
        round,
        teams[teamId]?.name ?? card?.teamName ?? "Unknown",
        teamId,
        card?.room ?? "",
        card?.time ?? "",
        judgeName(judges[judgeUid], judgeUid.slice(0, 8)),
        judgeUid,
        ...RUBRIC_FIELDS.map((field) => card?.[field] ?? ""),
        total,
        card?.fundable === true ? "yes" : "no",
        card?.enteredBy === judgeUid ? "judge" : (judges[card?.enteredBy] ? judgeName(judges[card.enteredBy]) : card?.enteredBy ?? ""),
        card?.source ?? "",
        card?.submittedAt ? new Date(card.submittedAt).toISOString() : "",
        card?.notes ?? "",
      ]);
    }
  }

  return rows;
}

/**
 * The standings, computed the same way the final-round cut computes them.
 *
 * The tiebreak is `compareForRanking` itself, not a second copy of its rule --
 * two teams tied on average and fundable votes used to fall back to whatever
 * order Object.entries(teams) happened to produce, which is Firebase push-key
 * order. That let this export disagree with the Results page on a tie, which
 * is exactly the coin flip compareForRanking exists to remove. Importing the
 * comparator instead of re-deriving it is what keeps the two from drifting
 * apart again.
 */
export function standingsRows({ teams, scores }, round = FIRST_ROUND) {
  const rows = [["Rank", "Team", "Team ID", "Average score", "Judges", "Fundable votes", "Submitted"]];

  Object.entries(teams)
    .map(([teamId, team]) => {
      const cards = scores?.[round]?.[teamId] ?? {};
      return {
        teamId,
        name: team?.name ?? "Unnamed Team",
        submitted: Boolean(team?.submitted),
        averageScore: calculateAverageScore(cards),
        judgeCount: scoredJudgeCount(cards),
        fundableVotes: countFundableVotes(cards),
      };
    })
    .filter((team) => typeof team.averageScore === "number")
    .sort(compareForRanking)
    .forEach((team, index) => {
      rows.push([
        index + 1,
        team.name,
        team.teamId,
        team.averageScore.toFixed(2),
        team.judgeCount,
        team.fundableVotes,
        team.submitted ? "yes" : "no",
      ]);
    });

  return rows;
}

/** One row per judge: what they were given and what they have filed. */
export function judgeRows({ judges, scores }, round = FIRST_ROUND) {
  const rows = [
    ["Judge", "Judge UID", "Email", "Company", "Round 1", "Checked in", "Assigned", "Submitted", "Outstanding"],
  ];

  for (const [judgeUid, judge] of Object.entries(judges)) {
    const assignments = assignmentList(judge?.teamAssignments);
    const submitted = assignments.filter((a) => scores?.[round]?.[a.id ?? a.teamId]?.[judgeUid]);
    const outstanding = assignments.filter((a) => !scores?.[round]?.[a.id ?? a.teamId]?.[judgeUid]);

    rows.push([
      judgeName(judge),
      judgeUid,
      judge?.email ?? "",
      judge?.company ?? "",
      judge?.isRound1Judge ? "yes" : "no",
      judge?.checkedIn ? "yes" : "no",
      assignments.length,
      submitted.length,
      outstanding.map((a) => a.teamName).join("; "),
    ]);
  }

  return rows;
}

/**
 * Hand the file to the browser.
 *
 * A BOM is prepended because Excel on Windows reads a BOM-less UTF-8 CSV as
 * the system codepage, which mangles any name with an accent in it.
 */
export function downloadCsv(filename, rows) {
  download(filename, "﻿" + toCsv(rows), "text/csv;charset=utf-8");
}

export function downloadJson(filename, data) {
  download(filename, JSON.stringify(data, null, 2), "application/json");
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // revoke on the next tick; Safari cancels the download if it goes immediately
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}
