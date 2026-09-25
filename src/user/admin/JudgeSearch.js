import { onValue, ref, update } from "firebase/database";
import { database } from "../../firebase";

import React, { useEffect, useMemo, useState } from "react";

import { Alert, Button, Chip, Snackbar, Stack, Typography } from "@mui/material";
import Layout from "../Layout";
import { assignmentList } from "../judge/assignmentList";
import { PageHeader, FilterBar, FilterChips, FilterGroups, SearchField, RowList, Row, StateToggle } from "./adminUi";
import JudgeEditDrawer from "./records/JudgeEditDrawer";

function JudgeSearch() {
  const [query, setQuery] = useState("");
  const [checkedInFilter, setCheckedInFilter] = useState("");
  const [roundOneFilter, setRoundOneFilter] = useState("");
  const [judges, setJudges] = useState([]);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const unsubscribe = onValue(ref(database, "/judges/"), (snapshot) => {
      const data = snapshot.val();
      setJudges(
        data ? Object.entries(data).map(([id, details]) => ({ id, ...details })) : []
      );
    });

    return () => unsubscribe();
  }, []);

  const checkedInCount = judges.filter((judge) => judge.checkedIn).length;
  // the scheduler only assigns judges carrying this flag, so the count belongs
  // where an admin will see it before building a plan
  const roundOneCount = judges.filter((judge) => judge.isRound1Judge === true).length;
  const finalRoundCount = judges.filter((judge) => judge.isFinalRoundJudge === true).length;
  const percentCheckedIn = judges.length ? (checkedInCount / judges.length) * 100 : 0;

  const handleCheckIn = (judge) => {
    // a targeted update rather than read-modify-write, so this cannot clobber a
    // check-in happening at the scanner at the same moment
    update(ref(database, `/judges/${judge.id}`), { checkedIn: !judge.checkedIn });
  };

  const handleToggleRoundOne = (judge) => {
    update(ref(database, `/judges/${judge.id}`), {
      isRound1Judge: judge.isRound1Judge !== true,
    });
  };

  // Deliberately independent of the round-one mark rather than exclusive with
  // it. The two roles answer different questions -- who the generator may
  // assign, and who is in the room for the final -- and somebody can be both.
  const handleToggleFinalRound = (judge) => {
    update(ref(database, `/judges/${judge.id}`), {
      isFinalRoundJudge: judge.isFinalRoundJudge !== true,
    });
  };

  const results = useMemo(() => {
    const needle = query.toLowerCase();
    return judges
      .filter((judge) => {
        const fullName = `${judge.firstName ?? ""} ${judge.lastName ?? ""}`.trim();
        const matchesQuery =
          fullName.toLowerCase().includes(needle) ||
          (judge.email ?? "").toLowerCase().includes(needle);

        const matchesCheckedIn =
          checkedInFilter === "" ||
          String(Boolean(judge.checkedIn)) === checkedInFilter;

        const roundOne = judge.isRound1Judge === true;
        const finalRound = judge.isFinalRoundJudge === true;
        const matchesRole =
          roundOneFilter === "" ||
          (roundOneFilter === "round1" && roundOne) ||
          (roundOneFilter === "final" && finalRound) ||
          (roundOneFilter === "none" && !roundOne && !finalRound);

        return matchesQuery && matchesCheckedIn && matchesRole;
      })
      .sort((a, b) =>
        `${a.firstName ?? ""} ${a.lastName ?? ""}`.localeCompare(
          `${b.firstName ?? ""} ${b.lastName ?? ""}`
        )
      );
  }, [judges, query, checkedInFilter, roundOneFilter]);

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Judges"
        progress={percentCheckedIn}
        stats={[
          { label: "signed up", value: judges.length },
          { label: "checked in", value: checkedInCount },
          { label: "first round", value: roundOneCount },
          { label: "final round", value: finalRoundCount },
        ]}
      />

      {roundOneCount === 0 && judges.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No judges are marked for the first round yet. Only judges marked here are
          given team assignments when a schedule is generated.
        </Alert>
      )}

      <FilterBar>
        <SearchField
          placeholder="Search name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FilterGroups>
          <FilterChips
            label="Check-in"
            value={checkedInFilter}
            onChange={setCheckedInFilter}
            options={[
              { value: "", label: "Everyone" },
              { value: "true", label: "Checked in" },
              { value: "false", label: "Not checked in" },
            ]}
          />
          <FilterChips
            label="Round"
            value={roundOneFilter}
            onChange={setRoundOneFilter}
            options={[
              { value: "", label: "Any" },
              { value: "round1", label: "First round" },
              { value: "final", label: "Final round" },
              { value: "none", label: "Neither" },
            ]}
          />
        </FilterGroups>
      </FilterBar>

      <RowList empty="No judges match those filters.">
        {results.map((judge) => {
          const fullName =
            `${judge.firstName ?? ""} ${judge.lastName ?? ""}`.trim() || "Unnamed judge";
          const isCheckedIn = Boolean(judge.checkedIn);
          const isRoundOne = judge.isRound1Judge === true;
          const isFinalRound = judge.isFinalRoundJudge === true;
          const assignments = assignmentList(judge.teamAssignments);

          return (
            // the accent marks the row that still needs something doing to
            // it, the same as it does on the judging page -- see the note on
            // Row in adminUi. Flagging the settled rows instead put a bar on
            // every line of a well-run event, which is the state nobody has to
            // go looking for.
            <Row key={judge.id} accent={!isCheckedIn}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={1}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Stack sx={{ gap: 1 }} direction="row" alignItems="center" flexWrap="wrap">
                    <Typography sx={{ fontWeight: 600 }}>{fullName}</Typography>
                    {judge.wantsToMentor && (
                      <Chip label="mentor" size="small" variant="outlined" />
                    )}
                  </Stack>

                  <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                    {judge.email}
                    {judge.withCompany && judge.company ? ` · ${judge.company}` : ""}
                  </Typography>

                  {assignments.length > 0 && (
                    <Typography variant="body2" sx={{ mt: 0.25 }}>
                      {assignments
                        .map((a) => `${a.teamName} (${a.time}, ${a.room})`)
                        .join(" · ")}
                    </Typography>
                  )}

                  {Array.isArray(judge.timeslots) && judge.timeslots.length > 0 && (
                    <Typography variant="body2">
                      Mentoring: {judge.timeslots.join(", ")}
                    </Typography>
                  )}
                </Stack>

                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                  <Button size="small" variant="outlined" onClick={() => setEditing(judge)}>
                    Edit
                  </Button>
                  {/* the buttons carry the round and check-in state, so the row
                      does not also repeat it as chips beside the name */}
                  <StateToggle
                    on={isRoundOne}
                    onLabel="First round"
                    offLabel="Mark first round"
                    onClick={() => handleToggleRoundOne(judge)}
                    minWidth={140}
                  />
                  <StateToggle
                    on={isFinalRound}
                    onLabel="Final round"
                    offLabel="Mark final round"
                    onClick={() => handleToggleFinalRound(judge)}
                    minWidth={140}
                  />
                  <StateToggle
                    on={isCheckedIn}
                    onLabel="Checked in"
                    offLabel="Check in"
                    onClick={() => handleCheckIn(judge)}
                    minWidth={124}
                  />
                </Stack>
              </Stack>
            </Row>
          );
        })}
      </RowList>

      {editing && (
        <JudgeEditDrawer
          judge={editing}
          onClose={() => setEditing(null)}
          onResult={(result, message) =>
            setToast(result?.ok
              ? { severity: "success", message }
              : { severity: "error", message: result?.error ?? "Something went wrong." })}
        />
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={6000} onClose={() => setToast(null)}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </Layout>
  );
}

export default JudgeSearch;
