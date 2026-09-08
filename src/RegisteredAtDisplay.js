// RegisteredAtDisplay.js

import { onValue, ref } from "firebase/database";
import React, { useEffect, useMemo, useState } from "react";
import { database } from "./firebase";
import { Bar, Line } from "react-chartjs-2";
import "chart.js/auto";
import { Box, Card, CardContent, Typography } from "@mui/material";
import Layout from "./user/Layout";
import { PageHeader } from "./user/admin/adminUi";
import { tokens } from "./theme";

/**
 * Registration over time.
 *
 * Two charts because there are two questions, and they want different marks: a
 * day's sign-ups is a count of separate things, so it is a bar; the running
 * total is one quantity moving, so it is a line. The old page drew both as the
 * same cornflower-blue line and left them unlabelled outside any card.
 */

function dayKey(value) {
  // epoch milliseconds now; older records hold a locale date string
  const date = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

const FONT = { family: tokens.BODY, size: 12 };

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: tokens.INK,
      padding: 10,
      cornerRadius: 6,
      titleFont: { ...FONT, weight: "600" },
      bodyFont: FONT,
      displayColors: false,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      border: { color: tokens.LINE },
      ticks: { color: tokens.MUTED, font: FONT },
    },
    y: {
      beginAtZero: true,
      grid: { color: tokens.LINE },
      border: { display: false },
      ticks: { color: tokens.MUTED, font: FONT, precision: 0 },
    },
  },
};

function Chart({ title, caption, children }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, "&:last-child": { pb: 2.5 } }}>
        <Typography variant="h5">{title}</Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {caption}
        </Typography>
        <Box sx={{ height: { xs: 220, sm: 280 } }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

function RegisteredAtDisplay() {
  const [registeredAt, setRegisteredAt] = useState([]);

  useEffect(() => {
    const unsubscribe = onValue(ref(database, "/competitors/"), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setRegisteredAt([]);
        return;
      }
      setRegisteredAt(
        Object.values(data)
          .map((entry) => entry?.registeredAt)
          .filter(Boolean)
      );
    });

    return () => unsubscribe();
  }, []);

  // One pass over the data instead of makeX/makeY recomputing on every render,
  // and counting from the first record rather than the second.
  const { labels, perDay, cumulative, busiest } = useMemo(() => {
    const counts = new Map();

    for (const value of registeredAt) {
      const key = dayKey(value);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const sorted = [...counts.keys()].sort((a, b) => {
      const [aMonth, aDay] = a.split("/").map(Number);
      const [bMonth, bDay] = b.split("/").map(Number);
      return aMonth === bMonth ? aDay - bDay : aMonth - bMonth;
    });

    let total = 0;
    const daily = sorted.map((key) => counts.get(key));
    const running = daily.map((count) => (total += count));
    const peak = daily.length ? Math.max(...daily) : 0;

    return {
      labels: sorted,
      perDay: daily,
      cumulative: running,
      busiest: peak,
    };
  }, [registeredAt]);

  const hasData = labels.length > 0;

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Registration Metrics"
        stats={[
          { label: "registered", value: registeredAt.length },
          { label: "days", singular: "day", value: labels.length },
          { label: "on the busiest day", value: busiest },
        ]}
      />

      {!hasData ? (
        <Card sx={{ p: 4 }}>
          <Typography variant="body2" align="center">
            No registrations yet. Sign-ups appear here as they come in.
          </Typography>
        </Card>
      ) : (
        <>
          <Chart title="Sign-ups per day" caption="How many people registered on each day.">
            <Bar
              options={baseOptions}
              data={{
                labels,
                datasets: [
                  {
                    label: "Sign-ups",
                    data: perDay,
                    backgroundColor: tokens.ACCENT,
                    borderRadius: 4,
                    maxBarThickness: 44,
                  },
                ],
              }}
            />
          </Chart>

          <Chart title="Running total" caption="Everyone registered up to that day.">
            <Line
              options={{
                ...baseOptions,
                elements: { point: { radius: 3, hoverRadius: 6 } },
              }}
              data={{
                labels,
                datasets: [
                  {
                    label: "Total",
                    data: cumulative,
                    fill: true,
                    tension: 0.25,
                    borderWidth: 2,
                    borderColor: tokens.ACCENT,
                    backgroundColor: "rgba(214, 39, 73, 0.08)",
                    pointBackgroundColor: tokens.ACCENT,
                    pointBorderColor: tokens.SURFACE,
                  },
                ],
              }}
            />
          </Chart>
        </>
      )}
    </Layout>
  );
}

export default RegisteredAtDisplay;
