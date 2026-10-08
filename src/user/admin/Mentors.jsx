import { onValue, ref } from "firebase/database";
import { database } from "../../firebase";

import React, { useEffect, useMemo, useState } from "react";

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Layout from "../Layout";
import { SHIFTS, heatOf, shiftRoster, timeslotsOf } from "../../mentorShifts";
import { PageHeader, FilterBar, FilterChips, SearchField, RowList, Row } from "./adminUi";
import usePageTitle from "../../usePageTitle";

// The heat strip's opacity, from a shift with barely anyone to the busiest one.
// It starts above zero so one mentor still shows green, and stops short of
// solid so the busiest hour does not outweigh the crimson of an empty one.
const MIN_BAR = 0.15;
const MAX_BAR = 0.7;
// The strip sits in the page gutter, which is 16px on a phone: 6 + 6 leaves it
// clear of the screen edge without moving the card off the column.
const STRIP_WIDTH = 6;
const STRIP_GAP = 6;

const nameOf = (person) =>
  `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "Unnamed";

const skillsOf = (person) => (Array.isArray(person.skills) ? person.skills : []);

// "Not answered" rather than "No": a record made from the control panel, or
// from before the form asked, never said no to anything
const yesNo = (value) => (value === true ? "Yes" : value === false ? "No" : "Not answered");

const signedUp = (value) =>
  typeof value === "number"
    ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Not recorded";

/**
 * What the judge and mentor sign-up form collected, for organizers.
 *
 * The Judges page is about the judging pools and who has arrived, and says of
 * mentoring only that somebody offered. This turns the same records round to
 * answer the question that page cannot: who is covering each hour, and which
 * hours nobody is. It only reads -- changing a record is still the Judges
 * page's Edit.
 */
function Mentors() {
  const [judges, setJudges] = useState({});
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [open, setOpen] = useState({});

  usePageTitle("Mentors");

  useEffect(() => {
    const unsubscribe = onValue(ref(database, "/judges/"), (snapshot) => {
      setJudges(snapshot.val() ?? {});
    });

    return () => unsubscribe();
  }, []);

  const roster = useMemo(() => shiftRoster(judges), [judges]);

  const people = useMemo(
    () =>
      Object.entries(judges)
        .map(([id, details]) => ({ id, ...details }))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [judges]
  );

  const mentorCount = people.filter((person) => person.wantsToMentor === true).length;
  const judgeCount = people.filter((person) => person.wantsToJudge === true).length;
  const covered = roster.shifts.filter((entry) => entry.mentors.length > 0).length;
  const busiest = Math.max(0, ...[...roster.shifts, ...roster.other].map((entry) => entry.mentors.length));

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((person) => {
      const mentoring = person.wantsToMentor === true;
      const judging = person.wantsToJudge === true;
      const matchesRole =
        roleFilter === "" ||
        (roleFilter === "mentor" && mentoring) ||
        (roleFilter === "judge" && judging) ||
        (roleFilter === "both" && mentoring && judging);

      const haystack = [nameOf(person), person.email ?? "", ...skillsOf(person)].join(" ").toLowerCase();

      return matchesRole && haystack.includes(needle);
    });
  }, [people, query, roleFilter]);

  // the form's shifts, then any time it does not offer -- from an older list,
  // or a record edited by hand
  const shiftEntries = [
    ...roster.shifts.map((entry) => ({ ...entry, flagEmpty: true })),
    ...roster.other.map((entry) => ({ ...entry, flagEmpty: false })),
  ];

  const shiftRow = ({ shift, mentors, flagEmpty }, index) => {
    const first = index === 0;
    const last = index === shiftEntries.length - 1;
    // the row under this one draws no hairline for the segment to cover
    const endsTheCard = last && roster.unscheduled.length === 0;

    return (
    // the accent is "this still needs something doing", as on every other
    // admin list: here, an hour of the day with no mentor in the room
    <Row key={shift} accent={flagEmpty && mentors.length === 0}>
      {/* One segment of the heat strip that runs down the outside of the card:
          the success green, stronger the more mentors the hour has, so the
          thin hours read down the edge before any count is. An empty hour
          keeps its place as a grey segment, so the strip is unbroken. Each
          one reaches over the hairline beneath its row to meet the next. */}
      <Box
        aria-hidden="true"
        sx={{
          position: "absolute",
          left: -(STRIP_WIDTH + STRIP_GAP),
          top: 0,
          bottom: endsTheCard ? 0 : -1,
          width: STRIP_WIDTH,
          borderTopLeftRadius: first ? STRIP_WIDTH / 2 : 0,
          borderTopRightRadius: first ? STRIP_WIDTH / 2 : 0,
          borderBottomLeftRadius: last ? STRIP_WIDTH / 2 : 0,
          borderBottomRightRadius: last ? STRIP_WIDTH / 2 : 0,
          bgcolor: (theme) =>
            mentors.length === 0
              ? theme.palette.divider
              : alpha(
                  theme.palette.success.main,
                  MIN_BAR + (MAX_BAR - MIN_BAR) * heatOf(mentors.length, busiest)
                ),
        }}
      />
      <Stack
        role="group"
        aria-label={`${shift} shift`}
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.75, sm: 3 }}
      >
        <Box sx={{ width: { sm: 132 }, flexShrink: 0 }}>
          <Typography variant="data" component="p" sx={{ fontSize: "1rem", color: "text.primary" }}>
            {shift}
          </Typography>
          {mentors.length > 0 && (
            <Typography variant="caption" component="p">
              {mentors.length === 1 ? "1 mentor" : `${mentors.length} mentors`}
            </Typography>
          )}
        </Box>
        <MentorList mentors={mentors} />
      </Stack>
    </Row>
    );
  };

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Mentors"
        stats={[
          { label: "responses", singular: "response", value: people.length },
          { label: "want to mentor", value: mentorCount },
          { label: "want to judge", value: judgeCount },
          { label: "shifts covered", value: `${covered}/${SHIFTS.length}` },
        ]}
      />

      <Stack spacing={4}>
        <Box component="section" aria-labelledby="mentor-shifts-title">
          <Typography variant="sectionTitle" id="mentor-shifts-title">
            Shifts
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, mb: 1.5, maxWidth: "68ch" }}>
            Who offered each hour on the sign-up form. This is what people said they
            could do, not a schedule anyone has been sent.
          </Typography>

          {/* a Card clips what leaves it, and the heat strip hangs outside */}
          <Box sx={{ "& > .MuiCard-root": { overflow: "visible" } }}>
          <RowList>
            {[
              ...shiftEntries.map(shiftRow),
              roster.unscheduled.length > 0 && (
                <Row key="unscheduled" accent>
                  <Stack
                    role="group"
                    aria-label="No shifts picked"
                    direction={{ xs: "column", sm: "row" }}
                    spacing={{ xs: 0.75, sm: 3 }}
                  >
                    <Box sx={{ width: { sm: 132 }, flexShrink: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
                        No shifts picked
                      </Typography>
                      <Typography variant="caption" component="p">
                        Mentoring, but on no hour above
                      </Typography>
                    </Box>
                    <MentorList mentors={roster.unscheduled} />
                  </Stack>
                </Row>
              ),
            ]}
          </RowList>
          </Box>
        </Box>

        <Box component="section" aria-labelledby="mentor-responses-title">
          <Typography variant="sectionTitle" id="mentor-responses-title" sx={{ mb: 1.5 }}>
            Responses
          </Typography>

          <FilterBar>
            <SearchField
              placeholder="Search name, email or skill"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <FilterChips
              label="Signed up to"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "", label: "Everyone" },
                { value: "mentor", label: "Mentor" },
                { value: "judge", label: "Judge" },
                { value: "both", label: "Both" },
              ]}
            />
          </FilterBar>

          <RowList
            empty={
              people.length === 0
                ? "Nobody has filled in the sign-up form yet."
                : "No responses match those filters."
            }
          >
            {results.map((person) => {
              const fullName = nameOf(person);
              const isOpen = Boolean(open[person.id]);
              const shifts = timeslotsOf(person);
              const skills = skillsOf(person);

              return (
                <Row key={person.id}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Stack sx={{ gap: 1 }} direction="row" alignItems="center" flexWrap="wrap">
                        <Typography sx={{ fontWeight: 600 }}>{fullName}</Typography>
                        {person.wantsToMentor === true && (
                          <Chip label="mentor" size="small" variant="outlined" />
                        )}
                        {person.wantsToJudge === true && (
                          <Chip label="judge" size="small" variant="outlined" />
                        )}
                      </Stack>

                      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                        {person.email}
                        {person.company ? ` · ${person.company}` : ""}
                      </Typography>
                    </Stack>

                    <Button
                      size="small"
                      variant="outlined"
                      aria-expanded={isOpen}
                      aria-label={`Answers from ${fullName}`}
                      onClick={() => setOpen((prev) => ({ ...prev, [person.id]: !isOpen }))}
                    >
                      {isOpen ? "Hide answers" : "Answers"}
                    </Button>
                  </Stack>

                  {isOpen && (
                    <Box
                      component="dl"
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "200px 1fr" },
                        columnGap: 3,
                        rowGap: { xs: 0, sm: 0.75 },
                        mt: 1.5,
                        mb: 0,
                        "& dt": { typography: "body2", fontWeight: 600, color: "text.primary" },
                        "& dd": {
                          typography: "body2",
                          m: 0,
                          mb: { xs: 1, sm: 0 },
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        },
                      }}
                    >
                      <dt>Mentoring</dt>
                      <dd>{yesNo(person.wantsToMentor)}</dd>
                      <dt>Shifts</dt>
                      <dd>{shifts.length ? shifts.join(", ") : "None"}</dd>
                      <dt>Skills</dt>
                      <dd>{skills.length ? skills.join(", ") : "None given"}</dd>
                      <dt>Judging</dt>
                      <dd>{yesNo(person.wantsToJudge)}</dd>
                      <dt>Question for organizers</dt>
                      <dd>{person.questionsAndConcerns || "None"}</dd>
                      <dt>Signed up</dt>
                      <dd>{signedUp(person.registeredAt)}</dd>
                    </Box>
                  )}
                </Row>
              );
            })}
          </RowList>
        </Box>
      </Stack>
    </Layout>
  );
}

/** The people on one shift: a name, and under it who they are with and what they know. */
function MentorList({ mentors }) {
  if (mentors.length === 0) {
    return <Typography variant="body2">Nobody yet</Typography>;
  }

  return (
    <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
      {mentors.map((mentor) => {
        const detail = [mentor.company, skillsOf(mentor).join(", ")].filter(Boolean).join(" · ");
        return (
          <Box key={mentor.id}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
              {nameOf(mentor)}
            </Typography>
            {detail && <Typography variant="body2">{detail}</Typography>}
          </Box>
        );
      })}
    </Stack>
  );
}

export default Mentors;
