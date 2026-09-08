import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Snackbar, Stack, Tab, Tabs } from "@mui/material";
import { onValue, ref, query, limitToLast } from "firebase/database";
import { database } from "../../firebase";
import Layout from "../Layout";
import { PageHeader } from "./adminUi";
import RoomsSection from "./rooms/RoomsSection";
import ScheduleSection from "./event/ScheduleSection";
import EventSection from "./event/EventSection";
import PeopleSection from "./people/PeopleSection";
import AdvancedSection from "./AdvancedSection";
import ActivityFeed from "./activity/ActivityFeed";
import DangerSection from "./danger/DangerSection";
import RestorePointsSection from "./danger/RestorePointsSection";
import ExportSection from "./ExportSection";

/**
 * Everything that had no home before: the judging rooms, the batch shape, the
 * event date, who counts as an admin, and the actions you reach for when
 * something has gone wrong.
 *
 * Those are four different jobs, and they used to be one scroll. Setting up the
 * rooms before the event and restoring a snapshot after a bad publish have
 * nothing to do with each other except that neither had anywhere else to live,
 * and putting them on the same page meant the danger zone was always three
 * flicks below whatever you came for.
 *
 * They are tabs now, and the tab is in the URL -- so the dashboard's readiness
 * checks can send someone to the exact section that fixes them, and one
 * organizer can tell another where to look.
 *
 * One subscription lives here and the data goes down as props. Sections call
 * services and never write directly -- the services put each change and its
 * audit entry into one atomic update, and the change comes back up through
 * these same subscriptions, so nothing here holds a mirror copy of state.
 */

const TABS = [
  { id: "setup", label: "Event setup" },
  { id: "people", label: "People" },
  { id: "data", label: "Data and activity" },
  { id: "recovery", label: "Recovery" },
];

function Control() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((t) => t.id === requested) ? requested : "setup";

  const [config, setConfig] = useState({});
  const [admins, setAdmins] = useState([]);
  const [teamsData, setTeamsData] = useState({});
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const stop = [
      onValue(ref(database, "config"), (snap) => setConfig(snap.val() ?? {})),
      onValue(ref(database, "admins"), (snap) => setAdmins(Object.keys(snap.val() ?? {}))),
      onValue(ref(database, "teams"), (snap) => setTeamsData(snap.val() ?? {})),
      onValue(query(ref(database, "adminLog"), limitToLast(100)), (snap) => {
        const entries = Object.entries(snap.val() ?? {}).map(([id, entry]) => ({ id, ...entry }));
        // push keys are chronological, so newest-first is a reverse of key order
        setLog(entries.reverse());
      }),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  /** Every section reports through here, so success and failure look the same. */
  const report = (result, successMessage) => {
    if (result?.ok) setToast({ severity: "success", message: successMessage });
    else setToast({ severity: "error", message: result?.error ?? "Something went wrong." });
    return result;
  };

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Control panel"
        stats={[
          { label: "rooms", singular: "room", value: (config.judgingRooms ?? []).length },
          { label: "admins", singular: "admin", value: admins.length },
          { label: "recent changes", singular: "recent change", value: log.length },
        ]}
      />

      <Tabs
        value={tab}
        onChange={(_, next) => setParams(next === "setup" ? {} : { tab: next }, { replace: true })}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}
      >
        {TABS.map((entry) => (
          <Tab key={entry.id} value={entry.id} label={entry.label} />
        ))}
      </Tabs>

      {tab === "setup" && (
        <Stack spacing={3}>
          <RoomsSection rooms={config.judgingRooms ?? []} teamsData={teamsData} onResult={report} />
          <ScheduleSection config={config} onResult={report} />
          <EventSection config={config} onResult={report} />
          <AdvancedSection config={config} onResult={report} />
        </Stack>
      )}

      {tab === "people" && (
        <Stack spacing={3}>
          <PeopleSection onResult={report} />
        </Stack>
      )}

      {tab === "data" && (
        <Stack spacing={3}>
          <ExportSection onResult={report} />
          <ActivityFeed log={log} onResult={report} />
        </Stack>
      )}

      {tab === "recovery" && (
        <Stack spacing={3}>
          <RestorePointsSection onResult={report} />
          <DangerSection onResult={report} />
        </Stack>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Layout>
  );
}

export { Control, TABS };
export default Control;
