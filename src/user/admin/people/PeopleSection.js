import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Divider, FormControlLabel, MenuItem, Stack,
  Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  listPeople, matchesQuery, setSoleRole, setOrganizer, describeSwitch, deletePerson,
  createPerson, attachRecord, sendReset, bulkSet, ROLE_LABELS, listArchived, restoreArchived,
} from "./peopleService";

/**
 * Roles, accounts and the bulk edits, in one place.
 *
 * Before this, /admins was the only role reachable from the app: making someone
 * a judge after they had registered as a competitor meant opening the Firebase
 * console and hand-writing a record.
 *
 * A person holds exactly one role, and it is picked from a dropdown. It used to
 * be a +/− button per role, which made two clicks look like one action: −
 * Competitor deletes the record, + Competitor writes a blank one back, and an
 * account appears to have wiped itself. One dropdown, one confirmation naming
 * what is about to be lost, one write.
 *
 * The two things this cannot do are stated in the UI rather than hidden, because
 * both surprise people: a browser cannot delete a Firebase Auth account, and it
 * cannot set someone's password.
 */

const ROLE_COLORS = { admin: "error", judge: "primary", competitor: "default" };

/**
 * What the dropdown shows: their one role, or that they still hold several.
 *
 * Organizer is not in here. It is a flag at /admins/{uid} that sits on top of
 * the role, because an organizer who judges needs the judge record — without it
 * they cannot be scheduled, cannot see their cards, and cannot file a score
 * under their own name.
 */
function roleValue(person) {
  const roles = person.roles.filter((role) => role !== "admin");
  if (roles.length > 1) return "multiple";
  return roles[0] ?? "none";
}

export default function PeopleSection({ onResult }) {
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [alsoScores, setAlsoScores] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(null);
  const [archiveFor, setArchiveFor] = useState(null);
  const [archived, setArchived] = useState([]);

  const refresh = useCallback(() => {
    listPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  useEffect(refresh, [refresh]);

  const run = async (work, message) => {
    setBusy(true);
    try {
      const result = await work();
      onResult(result, message);
      refresh();
      return result;
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(
    () =>
      people
        .filter((person) => matchesQuery(person, query))
        .filter((person) => roleFilter === "all" || person.roles.includes(roleFilter)),
    [people, query, roleFilter]
  );

  const selectedJudges = selected.filter((uid) =>
    people.find((p) => p.uid === uid)?.roles.includes("judge")
  );
  const selectedCompetitors = selected.filter((uid) =>
    people.find((p) => p.uid === uid)?.roles.includes("competitor")
  );

  const toggle = (uid) =>
    setSelected((current) =>
      current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid]
    );

  const counts = useMemo(() => ({
    admin: people.filter((p) => p.roles.includes("admin")).length,
    judge: people.filter((p) => p.roles.includes("judge")).length,
    competitor: people.filter((p) => p.roles.includes("competitor")).length,
  }), [people]);

  return (
    <section>
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1 }}>
        People and roles
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        One account, one role. Changing it deletes the record for the role they are leaving — a
        copy is archived first — and creates one for the new role, carrying their name and email
        across. Fill in the rest from the dashboards. <strong>Admin sits on top of the role</strong>,
        so an admin who is also a judge can be scheduled and score like anyone else.
      </Alert>

      <Card sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              size="small"
              label="Search name, email or uid"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              select size="small" label="Role" value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">All ({people.length})</MenuItem>
              <MenuItem value="admin">Admins ({counts.admin})</MenuItem>
              <MenuItem value="judge">Judges ({counts.judge})</MenuItem>
              <MenuItem value="competitor">Competitors ({counts.competitor})</MenuItem>
            </TextField>
            <Button variant="contained" onClick={() => setCreating(true)} sx={{ flexShrink: 0 }}>
              Add person
            </Button>
          </Stack>

          {selected.length > 0 && (
            <Alert severity="info" action={<Button size="small" onClick={() => setSelected([])}>Clear</Button>}>
              <Stack spacing={1}>
                <Typography variant="body2">{selected.length} selected</Typography>
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                  {selectedJudges.length > 0 && (
                    <>
                      <Button size="small" variant="outlined" disabled={busy}
                        onClick={() => run(() => bulkSet({ uids: selectedJudges, role: "judge", field: "checkedIn", value: true }), "Judges checked in")}>
                        Check in {selectedJudges.length} judge(s)
                      </Button>
                      <Button size="small" variant="outlined" disabled={busy}
                        onClick={() => run(() => bulkSet({ uids: selectedJudges, role: "judge", field: "isRound1Judge", value: true }), "Marked for round one")}>
                        Mark round one
                      </Button>
                      <Button size="small" variant="outlined" disabled={busy}
                        onClick={() => run(() => bulkSet({ uids: selectedJudges, role: "judge", field: "isRound1Judge", value: false }), "Removed from round one")}>
                        Unmark round one
                      </Button>
                    </>
                  )}
                  {selectedCompetitors.length > 0 && (
                    <Button size="small" variant="outlined" disabled={busy}
                      onClick={() => run(() => bulkSet({ uids: selectedCompetitors, role: "competitor", field: "checkedIn", value: true }), "Competitors checked in")}>
                      Check in {selectedCompetitors.length} competitor(s)
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Alert>
          )}

          <Typography variant="caption" color="text.secondary">
            Showing {visible.length} of {people.length}
          </Typography>

          <Stack divider={<Divider />}>
            {visible.slice(0, 200).map((person) => (
              <Stack
                key={person.uid}
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ md: "center" }}
                justifyContent="space-between"
                sx={{ py: 1.25 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <Checkbox
                    size="small"
                    checked={selected.includes(person.uid)}
                    onChange={() => toggle(person.uid)}
                    sx={{ flexShrink: 0 }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {person.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {person.email || "no email on file"} · {person.uid.slice(0, 10)}…
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {person.roles.map((role) => (
                        <Chip key={role} size="small" label={ROLE_LABELS[role]} color={ROLE_COLORS[role]} />
                      ))}
                    </Stack>
                  </Box>
                </Stack>

                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, flexShrink: 0 }}>
                  <TextField
                    select
                    size="small"
                    label="Role"
                    sx={{ minWidth: 150 }}
                    disabled={busy}
                    value={roleValue(person)}
                    onChange={(event) => setConfirmSwitch({ person, role: event.target.value })}
                  >
                    {roleValue(person) === "multiple" && (
                      // they predate one-role-per-account; the value has to be
                      // selectable or the field renders blank and looks broken
                      <MenuItem value="multiple">Multiple — pick one</MenuItem>
                    )}
                    <MenuItem value="judge">Judge</MenuItem>
                    <MenuItem value="competitor">Competitor</MenuItem>
                    <MenuItem value="none">No role</MenuItem>
                  </TextField>

                  <Tooltip title="Admin access. Sits on top of the role, so an admin can judge.">
                    <FormControlLabel
                      sx={{ mr: 0 }}
                      label="Admin"
                      control={
                        <Switch
                          size="small"
                          checked={person.roles.includes("admin")}
                          disabled={busy}
                          onChange={(event) =>
                            run(
                              () =>
                                setOrganizer({
                                  uid: person.uid,
                                  name: person.name,
                                  enabled: event.target.checked,
                                }),
                              event.target.checked
                                ? `${person.name} is now an admin`
                                : `${person.name} is no longer an admin`
                            )
                          }
                        />
                      }
                    />
                  </Tooltip>
                  <Tooltip title={person.email ? "Email them a password reset link" : "No email on file"}>
                    <span>
                      <Button size="small" disabled={busy || !person.email}
                        onClick={() => run(() => sendReset(person.email), `Reset link sent to ${person.email}`)}>
                        Reset
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="Records deleted by a role change">
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={async () => {
                        setArchiveFor(person);
                        setArchived(await listArchived(person.uid));
                      }}
                    >
                      History
                    </Button>
                  </Tooltip>
                  <Button size="small" color="error" disabled={busy}
                    onClick={() => { setAlsoScores(false); setConfirmDelete(person); }}>
                    Delete
                  </Button>
                </Stack>
              </Stack>
            ))}
            {visible.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Nobody matches that.
              </Typography>
            )}
          </Stack>

          {visible.length > 200 && (
            <Typography variant="caption" color="text.secondary">
              Showing the first 200. Narrow the search to see the rest.
            </Typography>
          )}
        </Stack>
      </Card>

      <CreatePersonDialog
        open={creating}
        onClose={() => setCreating(false)}
        onDone={(result, message) => { onResult(result, message); refresh(); }}
      />

      <Dialog open={Boolean(archiveFor)} onClose={() => setArchiveFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>Archived records for {archiveFor?.name}</DialogTitle>
        <DialogContent>
          {archived.length === 0 ? (
            <DialogContentText>
              Nothing archived. A record is copied here whenever a role change deletes one.
            </DialogContentText>
          ) : (
            <Stack divider={<Divider />}>
              {archived.map((entry) => (
                <Stack
                  key={entry.key}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ py: 1.25 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ color: "text.primary" }}>
                      {ROLE_LABELS[entry.role] ?? entry.role} record
                    </Typography>
                    <Typography variant="caption" component="div">
                      {[entry.record?.firstName, entry.record?.lastName].filter(Boolean).join(" ") ||
                        "no name on it"}
                      {entry.record?.email ? ` · ${entry.record.email}` : ""}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={async () => {
                      const target = archiveFor;
                      setArchiveFor(null);
                      await run(
                        () => restoreArchived({ uid: target.uid, key: entry.key }),
                        `Restored the ${entry.role} record for ${target.name}`
                      );
                    }}
                  >
                    Restore
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveFor(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmSwitch)} onClose={() => setConfirmSwitch(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {confirmSwitch?.role === "none"
            ? `Remove ${confirmSwitch?.person?.name}'s role?`
            : `Make ${confirmSwitch?.person?.name} a ${ROLE_LABELS[confirmSwitch?.role]?.toLowerCase()}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {(() => {
              const lines = confirmSwitch
                ? describeSwitch({ person: confirmSwitch.person, role: confirmSwitch.role })
                : [];
              if (!lines.length) {
                return <p>They hold no other role, so nothing is removed.</p>;
              }
              return (
                <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </Box>
              );
            })()}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSwitch(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              const target = confirmSwitch;
              setConfirmSwitch(null);
              await run(
                () => setSoleRole({ uid: target.person.uid, name: target.person.name, role: target.role }),
                target.role === "none"
                  ? `${target.person.name} now has no role`
                  : `${target.person.name} is now a ${ROLE_LABELS[target.role].toLowerCase()}`
              );
            }}
          >
            {confirmSwitch?.role === "none" ? "Remove role" : "Change role"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <p>
              This removes their admin, judge and competitor records, takes them off every
              team roster and schedule card, and clears them from the final round exclusions.
            </p>
            <Alert severity="warning" sx={{ my: 1 }}>
              <strong>Their login will still work.</strong> A browser cannot delete a Firebase
              Auth account. They can sign in and will see an account with no role. Remove the
              account in the Firebase console if that matters.
            </Alert>
            <FormControlLabel
              control={<Checkbox checked={alsoScores} onChange={(e) => setAlsoScores(e.target.checked)} />}
              label="Also delete every score they filed"
            />
            <Typography variant="caption" color="text.secondary" component="div">
              Scores are kept by default — they still count toward the averages the final round is
              picked from, and Judging progress shows them as coming from an unassigned judge.
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              const target = confirmDelete;
              setConfirmDelete(null);
              const result = await run(
                () => deletePerson({ uid: target.uid, name: target.name, includeScores: alsoScores }),
                `Deleted every record for ${target.name}`
              );
              if (result?.warning) onResult({ ok: true }, result.warning);
            }}
          >
            Delete records
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}

/**
 * Adding someone who is not registered.
 *
 * Two paths, because they solve different problems: a judge who turns up
 * unannounced needs an account creating, and someone who already signed in but
 * whose record was deleted needs a record attaching to the uid they have.
 */
function CreatePersonDialog({ open, onClose, onDone }) {
  const [mode, setMode] = useState("account");
  const [role, setRoleValue] = useState("judge");
  const [fields, setFields] = useState({
    firstName: "", lastName: "", email: "", company: "", password: "", uid: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setFields((f) => ({ ...f, [key]: event.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "account"
          ? await createPerson({ role, ...fields })
          : await attachRecord({ uid: fields.uid, role, ...fields });

      if (!result.ok) { setError(result.error); return; }
      onDone(result, `Added ${fields.firstName} ${fields.lastName}`.trim());
      setFields({ firstName: "", lastName: "", email: "", company: "", password: "", uid: "" });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add a person</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select size="small" label="What to do" value={mode}
            onChange={(event) => setMode(event.target.value)}>
            <MenuItem value="account">Create a new login and record</MenuItem>
            <MenuItem value="attach">Add a record to an existing login</MenuItem>
          </TextField>

          <TextField select size="small" label="Role" value={role}
            onChange={(event) => setRoleValue(event.target.value)}>
            <MenuItem value="judge">Judge</MenuItem>
            <MenuItem value="competitor">Competitor</MenuItem>
          </TextField>

          {mode === "attach" && (
            <>
              <Alert severity="info">
                For someone who can already sign in but has no record — usually because it was
                deleted. Their uid is on the Authentication tab in the Firebase console.
              </Alert>
              <TextField size="small" label="Account uid" value={fields.uid} onChange={set("uid")} />
            </>
          )}

          <Stack direction="row" spacing={1}>
            <TextField size="small" label="First name" value={fields.firstName} onChange={set("firstName")} fullWidth />
            <TextField size="small" label="Last name" value={fields.lastName} onChange={set("lastName")} fullWidth />
          </Stack>

          <TextField size="small" label="Email" value={fields.email} onChange={set("email")} />

          {role === "judge" && (
            <TextField size="small" label="Company" value={fields.company} onChange={set("company")} />
          )}

          {mode === "account" && (
            <>
              <TextField
                size="small" label="Temporary password" value={fields.password} onChange={set("password")}
                helperText="At least 6 characters. Tell them to change it, or send a reset from the list."
              />
              <Alert severity="info">
                Creating the account will not sign you out — it runs on a separate connection.
              </Alert>
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
