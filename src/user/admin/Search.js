import { onValue, ref, update } from "firebase/database";
import { database } from "../../firebase";

import React, { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Button,
  Chip,
  Link,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Layout from "../Layout";
import { PageHeader, FilterBar, SearchField, RowList, Row } from "./adminUi";
import CompetitorEditDrawer from "./records/CompetitorEditDrawer";

// dietary values are meant to be the small fixed lowercase set Registration.js
// writes ("none", "vegetarian", ...), but peopleService.blankCompetitor used
// to default new walk-in records to "None" -- a capital N -- and that
// capitalized copy does not repair itself once it is in the database.
// Comparing case-insensitively here means a legacy "None" record reads
// exactly like "none" instead of showing catering a bogus dietary flag and
// splitting the filter into two buckets for what is really one.
const isNoDietaryRestriction = (value) => !value || String(value).trim().toLowerCase() === "none";

function Search() {
  const [query, setQuery] = useState("");
  const [checkedInFilter, setCheckedInFilter] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [teams, setTeams] = useState({});
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  const checkedInCount = competitors.filter((person) => person.checkedIn).length;
  const percentCheckedIn = competitors.length
    ? (checkedInCount / competitors.length) * 100
    : 0;

  useEffect(() => {
    const unsubscribe = onValue(ref(database, "/competitors/"), (snapshot) => {
      const data = snapshot.val();
      setCompetitors(
        data ? Object.entries(data).map(([id, details]) => ({ id, ...details })) : []
      );
    });

    return () => unsubscribe();
  }, []);

  // the edit drawer offers a team move, which needs the list of teams to move to
  useEffect(() => {
    const unsubscribe = onValue(ref(database, "/teams/"), (snapshot) =>
      setTeams(snapshot.val() ?? {})
    );
    return () => unsubscribe();
  }, []);

  const handleCheckIn = (person) => {
    // a targeted update rather than writing the whole record back, which would
    // clobber anything the competitor changed since this page loaded
    update(ref(database, `/competitors/${person.id}`), {
      checkedIn: !person.checkedIn,
    });
  };

  const dietaryOptions = useMemo(() => {
    const values = new Set(
      competitors
        .map((person) => person.dietaryRestriction)
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase())
    );
    return [...values].sort();
  }, [competitors]);

  const results = useMemo(() => {
    const needle = query.toLowerCase();
    return competitors
      .filter((person) => {
        const fullName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
        const matchesQuery =
          fullName.toLowerCase().includes(needle) ||
          (person.email ?? "").toLowerCase().includes(needle);

        const matchesCheckedIn =
          checkedInFilter === "" ||
          String(Boolean(person.checkedIn)) === checkedInFilter;

        const matchesDietary =
          dietaryFilter === "" ||
          String(person.dietaryRestriction ?? "").trim().toLowerCase() === dietaryFilter;

        return matchesQuery && matchesCheckedIn && matchesDietary;
      })
      .sort((a, b) =>
        `${a.firstName ?? ""} ${a.lastName ?? ""}`.localeCompare(
          `${b.firstName ?? ""} ${b.lastName ?? ""}`
        )
      );
  }, [competitors, query, checkedInFilter, dietaryFilter]);

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Competitors"
        progress={percentCheckedIn}
        stats={[
          { label: "registered", value: competitors.length },
          { label: "checked in", value: checkedInCount },
          { label: "of registrants", value: `${percentCheckedIn.toFixed(0)}%` },
        ]}
      />

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
          label="Dietary"
          value={dietaryFilter}
          onChange={(e) => setDietaryFilter(e.target.value)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">Any</MenuItem>
          {dietaryOptions.map((option) => (
            <MenuItem key={option} value={option} sx={{ textTransform: "capitalize" }}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      </FilterBar>

      <RowList empty="No competitors match those filters.">
        {results.map((person) => {
          const fullName =
            `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() ||
            "Unnamed competitor";
          const isCheckedIn = Boolean(person.checkedIn);

          return (
            // the accent marks the row that still needs something doing to
            // it, the same as it does on the judging page -- see the note on
            // Row in adminUi. Flagging the settled rows instead put a bar on
            // every line of a well-run event, which is the state nobody has to
            // go looking for.
            <Row key={person.id} accent={!isCheckedIn}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Stack sx={{ gap: 1 }} direction="row" alignItems="center" flexWrap="wrap">
                    <Typography sx={{ fontWeight: 600 }}>{fullName}</Typography>
                    {!isNoDietaryRestriction(person.dietaryRestriction) && (
                      <Chip
                        label={person.dietaryRestriction}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: "capitalize" }}
                      />
                    )}
                    {person.foodCheckIn && (
                      <Chip label="got food" size="small" variant="outlined" />
                    )}
                  </Stack>
                  <Stack sx={{ gap: 1.5 }} direction="row" alignItems="baseline" flexWrap="wrap">
                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                      {person.email}
                    </Typography>
                    {person.resume && person.resume !== "none" && (
                      <Link
                        href={person.resume}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="body2"
                      >
                        Resume
                      </Link>
                    )}
                  </Stack>
                </Stack>

                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={() => setEditing(person)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant={isCheckedIn ? "contained" : "outlined"}
                    onClick={() => handleCheckIn(person)}
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
        <CompetitorEditDrawer
          person={editing}
          teams={teams}
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

export default Search;
