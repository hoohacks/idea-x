import { onValue, ref, update } from "firebase/database";
import { database } from "../../firebase";

import React, { useEffect, useMemo, useState } from "react";

import { Alert, Button, Chip, MenuItem, Snackbar, Stack, TextField, Typography } from "@mui/material";
import Layout from "../Layout";
import { assignmentList } from "../judge/assignmentList";
import { PageHeader, FilterBar, SearchField, RowList, Row } from "./adminUi";
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

        const matchesRoundOne =
          roundOneFilter === "" ||
          String(judge.isRound1Judge === true) === roundOneFilter;

        return matchesQuery && matchesCheckedIn && matchesRoundOne;
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
        <TextField
          select
          label="Check-in"
          value={checkedInFilter}
          onChange={(e) => setCheckedInFilter(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Everyone</MenuItem>
          <MenuItem value="true">Checked in</MenuItem>
          <MenuItem value="false">Not checked in</MenuItem>
        </TextField>
        <TextField
          select
          label="Round"
          value={roundOneFilter}
          onChange={(e) => setRoundOneFilter(e.target.value)}
          sx={{ minWidth: 175 }}
        >
          <MenuItem value="">Any</MenuItem>
          <MenuItem value="true">First round</MenuItem>
          <MenuItem value="false">Not first round</MenuItem>
        </TextField>
      </FilterBar>

      <RowList empty="No judges match those filters.">
        {results.map((judge) => {
          const fullName =
            `${judge.firstName ?? ""} ${judge.lastName ?? ""}`.trim() || "Unnamed judge";
          const isCheckedIn = Boolean(judge.checkedIn);
          const isRoundOne = judge.isRound1Judge === true;
          const assignments = assignmentList(judge.teamAssignments);

          return (
            <Row key={judge.id} accent={isCheckedIn}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={1}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Stack sx={{ gap: 1 }} direction="row" alignItems="center" flexWrap="wrap">
                    <Typography sx={{ fontWeight: 600 }}>{fullName}</Typography>
                    {isRoundOne && <Chip label="first round" size="small" color="primary" />}
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

                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={() => setEditing(judge)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant={isRoundOne ? "contained" : "outlined"}
                    onClick={() => handleToggleRoundOne(judge)}
                    sx={{ minWidth: 130 }}
                  >
                    {isRoundOne ? "First round" : "Mark first round"}
                  </Button>
                  <Button
                    size="small"
                    variant={isCheckedIn ? "contained" : "outlined"}
                    onClick={() => handleCheckIn(judge)}
                    sx={{ minWidth: 116 }}
                  >
                    {isCheckedIn ? "Checked in" : "Check in"}
                  </Button>
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
