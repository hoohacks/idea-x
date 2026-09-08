import { useState } from "react";
import { Button, Card } from "@mui/material";
import { Section, SettingList, SettingRow } from "./adminUi";
import {
  loadEventData, scheduleRows, scoreRows, standingsRows, judgeRows,
  downloadCsv, downloadJson, stamp,
} from "./exportData";
import { FIRST_ROUND, FINAL_ROUND } from "../judge/getTeamInfo";

/**
 * Getting the event onto something that is not the database.
 *
 * There was no export of any kind. Print the schedule before doors open and it
 * still works when the wifi does not; download the scores before touching the
 * danger zone and the wipe stops being the end of the story.
 */
export default function ExportSection({ onResult }) {
  const [busy, setBusy] = useState(false);

  const run = async (work, message) => {
    setBusy(true);
    try {
      const data = await loadEventData();
      work(data);
      onResult({ ok: true }, message);
    } catch (error) {
      onResult({ ok: false, error: error.message ?? "Could not build the export." });
    } finally {
      setBusy(false);
    }
  };

  const exports = [
    {
      label: "Schedule",
      hint: "Every team with its batch, time, room and judges. Print this one.",
      run: () => run(
        (data) => downloadCsv(`ideathon-schedule-${stamp()}.csv`, scheduleRows(data)),
        "Schedule downloaded"
      ),
    },
    {
      label: "Scores — first round",
      hint: "One row per score card, with the judge and who entered it.",
      run: () => run(
        (data) => downloadCsv(`ideathon-scores-first-${stamp()}.csv`, scoreRows(data, FIRST_ROUND)),
        "First round scores downloaded"
      ),
    },
    {
      label: "Scores — final round",
      hint: "The same, for the final.",
      run: () => run(
        (data) => downloadCsv(`ideathon-scores-final-${stamp()}.csv`, scoreRows(data, FINAL_ROUND)),
        "Final round scores downloaded"
      ),
    },
    {
      label: "Standings — first round",
      hint: "Ranked by average, with judge counts and fundable votes.",
      run: () => run(
        (data) => downloadCsv(`ideathon-standings-first-${stamp()}.csv`, standingsRows(data, FIRST_ROUND)),
        "First round standings downloaded"
      ),
    },
    {
      label: "Standings — final round",
      hint: "The result, ranked the same way. Matches the Results page.",
      run: () => run(
        (data) => downloadCsv(`ideathon-standings-final-${stamp()}.csv`, standingsRows(data, FINAL_ROUND)),
        "Final round standings downloaded"
      ),
    },
    {
      label: "Judges",
      hint: "Who is assigned what, and what they still owe.",
      run: () => run(
        (data) => downloadCsv(`ideathon-judges-${stamp()}.csv`, judgeRows(data)),
        "Judge list downloaded"
      ),
    },
    {
      label: "Everything (JSON)",
      hint: "The raw teams, judges, scores and config. The one to keep as a backup.",
      run: () => run(
        (data) => downloadJson(`ideathon-backup-${stamp()}.json`, data),
        "Backup downloaded"
      ),
    },
  ];

  return (
    <Section
      title="Export"
      note="Download the schedule before judging starts and the scores before you touch anything in
            the danger zone. A file on a laptop is the only part of this that keeps working when
            nothing else does."
    >
      <Card sx={{ p: 2.5 }}>
        <SettingList>
          {exports.map((item) => (
            <SettingRow key={item.label} label={item.label} hint={item.hint}>
              <Button variant="outlined" onClick={item.run} disabled={busy}>
                Download
              </Button>
            </SettingRow>
          ))}
        </SettingList>
      </Card>
    </Section>
  );
}
