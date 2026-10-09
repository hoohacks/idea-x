import { onValue, ref, update } from "firebase/database";
import { database } from "../../firebase";

import React, { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { PiArrowSquareOut, PiGraduationCap, PiUsersThree } from "react-icons/pi";
import Layout from "../Layout";
import { schoolLabel } from "../../eventInfo";
import { PageHeader, FilterBar, FilterChips, FilterGroups, SearchField, StateToggle } from "./adminUi";
import CompetitorEditDrawer from "./records/CompetitorEditDrawer";
import usePageTitle from "../../usePageTitle";

// dietary values are meant to be the small fixed lowercase set Registration.jsx
// writes ("none", "vegetarian", ...), but peopleService.blankCompetitor used
// to default new walk-in records to "None" -- a capital N -- and that
// capitalized copy does not repair itself once it is in the database.
// Comparing case-insensitively here means a legacy "None" record reads
// exactly like "none" instead of showing catering a bogus dietary flag and
// splitting the filter into two buckets for what is really one.
const isNoDietaryRestriction = (value) => !value || String(value).trim().toLowerCase() === "none";

function initialsOf(person) {
  return `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

function CompetitorCard({ person, teamName, onEdit, onCheckIn }) {
  const fullName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "Unnamed competitor";
  const isCheckedIn = Boolean(person.checkedIn);
  const school = schoolLabel(person.uvaSchool);
  // the form stores a graduation year; older records hold "Fourth Year" and
  // the like, which read wrong after "Class of"
  const year = person.schoolYear
    ? /^\d{4}$/.test(String(person.schoolYear)) ? `Class of ${person.schoolYear}` : String(person.schoolYear)
    : null;
  const studies = [person.major, year]
    .filter(Boolean)
    .join(", ");
  const hasResume = person.resume && person.resume !== "none";

  return (
    <Card sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
        <Avatar sx={{ width: 44, height: 44, fontSize: "0.9375rem", bgcolor: "background.paper", color: "text.primary" }}>
          {initialsOf(person)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, color: "text.primary" }} noWrap>
            {fullName}
          </Typography>
          <Typography variant="body2" noWrap title={person.email}>
            {person.email}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={0.75}>
        <Detail icon={<PiUsersThree />}>
          {teamName ? (
            <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>{teamName}</Box>
          ) : (
            "No team yet"
          )}
        </Detail>
        {(school || studies) && (
          <Detail icon={<PiGraduationCap />}>
            {[studies, school].filter(Boolean).join(" \u00b7 ")}
          </Detail>
        )}
      </Stack>

      {(!isNoDietaryRestriction(person.dietaryRestriction) || person.foodCheckIn) && (
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
          {!isNoDietaryRestriction(person.dietaryRestriction) && (
            <Chip
              label={person.dietaryRestriction}
              size="small"
              color="warning"
              sx={{ textTransform: "capitalize" }}
            />
          )}
          {person.foodCheckIn && <Chip label="Got food" size="small" color="success" />}
        </Stack>
      )}

      <Stack direction="row" alignItems="center" sx={{ gap: 1, mt: "auto", pt: 0.5 }}>
        {hasResume && (
          <Button
            size="small"
            variant="text"
            href={person.resume}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<PiArrowSquareOut />}
            sx={{ px: 1 }}
          >
            Resume
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={onEdit} sx={{ bgcolor: "background.paper" }}>
          Edit
        </Button>
        <StateToggle
          on={isCheckedIn}
          onLabel="Checked in"
          offLabel="Check in"
          onClick={onCheckIn}
          minWidth={118}
        />
      </Stack>
    </Card>
  );
}

/** One line of a card: a small icon and what it labels. */
function Detail({ icon, children }) {
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ minWidth: 0 }}>
      <Box aria-hidden sx={{ fontSize: 18, lineHeight: 0, mt: "1px", color: "text.secondary", flexShrink: 0 }}>
        {icon}
      </Box>
      <Typography variant="body2" sx={{ minWidth: 0 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function Search() {
  const [query, setQuery] = useState("");
  const [checkedInFilter, setCheckedInFilter] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [teams, setTeams] = useState({});
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  usePageTitle("Competitors");

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
            label="Dietary"
            value={dietaryFilter}
            onChange={setDietaryFilter}
            options={[
              { value: "", label: "Any" },
              ...dietaryOptions.map((option) => ({
                value: option,
                label: option.charAt(0).toUpperCase() + option.slice(1),
              })),
            ]}
          />
        </FilterGroups>
      </FilterBar>

      {results.length === 0 ? (
        <Card sx={{ p: 4 }}>
          <Typography variant="body2" align="center">
            No competitors match those filters.
          </Typography>
        </Card>
      ) : (
        // A card each, in a grid: the page is a roster of people, and a card
        // keeps who someone is, their team, what they study and where they are
        // on the day together. The old rows had a name and an email and two
        // buttons, with the rest of the record only reachable through Edit.
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          }}
        >
          {results.map((person) => (
            <CompetitorCard
              key={person.id}
              person={person}
              teamName={person.teamId ? teams[person.teamId]?.name : null}
              onEdit={() => setEditing(person)}
              onCheckIn={() => handleCheckIn(person)}
            />
          ))}
        </Box>
      )}

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
