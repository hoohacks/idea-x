import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// firebase
import { createUserWithEmailAndPassword } from "firebase/auth";
import { database, storage, auth } from "./firebase";
import { ref, update, serverTimestamp } from "firebase/database";
import { uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { ref as storageRef } from "firebase/storage";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  LinearProgress,
  Link,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { EVENT, GRADUATION_YEARS } from "./eventInfo";
import { REGISTRATION_OPEN } from "./registrationWindow";
import ClosedNotice from "./ClosedNotice";
import {
  cleanName,
  focusField,
  isEmail,
  isFilled,
  outstandingMessage,
  MIN_PASSWORD,
  useSyncedForm,
} from "./formKit";
import {
  Hero,
  MobileSubmitBar,
  RegistrationShell,
  ResultDialog,
  Section,
  SubmitRail,
} from "./registrationUi";

const SCHOOLS = [
  ["college", "College of Arts and Sciences"],
  ["engineering", "School of Engineering and Applied Science"],
  ["commerce", "McIntire School of Commerce"],
  ["architecture", "School of Architecture"],
  ["wise", "UVA's College at Wise"],
  ["medicine", "School of Medicine"],
  ["law", "School of Law"],
  ["business", "Darden School of Business"],
  ["education", "School of Education and Human Development"],
  ["professional", "School of Continuing & Professional Studies"],
  ["other", "I don't go to UVA"],
];

const GENDERS = [
  ["female", "Female"],
  ["male", "Male"],
  ["other", "Other"],
  ["prefer-not-to-say", "Prefer not to say"],
];

const DIETARY = [
  ["none", "No restrictions"],
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["gluten-free", "Gluten free"],
];

// The storage rules cap uploads at 5 MB and accept Word and PDF only. Checking
// here means an oversized file is refused with a sentence rather than an
// opaque permission failure two minutes later at submit.
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const RESUME_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const INITIAL = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  major: "",
  gender: "",
  schoolYear: String(GRADUATION_YEARS[0]),
  uvaSchool: "college",
  dietaryRestriction: "none",
};

/**
 * The fields that stop a submission, each with the message shown under the
 * field and the noun the rail uses when it lists what is outstanding.
 *
 * Selects that ship with a sensible default -- school, graduation year,
 * dietary restrictions -- are answered from the moment the page loads, so they
 * are not counted here. Counting them would open the form at "3 of 11" and
 * teach people to distrust the number.
 */
const SECTIONS = [
  {
    id: "account",
    label: "Account",
    required: ["firstName", "lastName", "email", "password"],
  },
  { id: "studies", label: "Studies", required: ["major"] },
  { id: "details", label: "Additional details", required: ["gender"] },
];

const REQUIRED = SECTIONS.flatMap((section) => section.required);

function problemsFor(values) {
  const problems = {};
  const fail = (name, message, noun) => {
    problems[name] = { message, noun };
  };

  if (!isFilled(values.firstName)) fail("firstName", "Enter your first name", "your first name");
  if (!isFilled(values.lastName)) fail("lastName", "Enter your last name", "your last name");

  if (!isFilled(values.email)) {
    fail("email", "Enter your email address", "your email address");
  } else if (!isEmail(values.email)) {
    fail("email", "Enter a complete address, like you@virginia.edu", "a valid email address");
  }

  if (!isFilled(values.password)) {
    fail("password", "Choose a password", "a password");
  } else if (values.password.length < MIN_PASSWORD) {
    fail("password", `Use at least ${MIN_PASSWORD} characters`, "a longer password");
  }

  if (!isFilled(values.major)) {
    fail("major", "Enter your major, or the one you plan to declare", "your major");
  }
  if (!isFilled(values.gender)) fail("gender", "Choose an option", "your gender");

  return problems;
}

const Registration = () => {
  // the site is live weeks before sign-ups are; see registrationWindow.js
  if (!REGISTRATION_OPEN) return <ClosedNotice />;

  return <RegistrationForm />;
};

const RegistrationForm = () => {
  const navigate = useNavigate();
  const { formRef, values, handleChange, collect } = useSyncedForm(INITIAL);

  const [touched, setTouched] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [failure, setFailure] = useState("");

  // resume upload
  const [resumeName, setResumeName] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resumeTask, setResumeTask] = useState(null);
  const [progress, setProgress] = useState(null);
  const [skipResume, setSkipResume] = useState(false);

  const problems = useMemo(() => problemsFor(values), [values]);

  const sections = SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    remaining: section.required.filter((name) => problems[name]).length,
  }));
  const answered = REQUIRED.length - Object.keys(problems).length;

  const markTouched = (event) =>
    setTouched((prev) => ({ ...prev, [event.target.name]: true }));

  // A field shows its message once it has been left, or once submit has been
  // pressed. An untouched form does not open covered in red.
  const errorFor = (name) =>
    showErrors || touched[name] ? problems[name]?.message : undefined;

  const fieldProps = (name) => ({
    name,
    id: name,
    value: values[name],
    onChange: handleChange,
    onBlur: markTouched,
    error: Boolean(errorFor(name)),
    helperText: errorFor(name),
  });

  const chooseResume = (event) => {
    const file = event.target.files?.[0];
    // reset so picking the same file twice still fires a change
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_RESUME_BYTES) {
      setResumeError("That file is over 5 MB. Upload a smaller PDF or Word file.");
      return;
    }

    // a shared filename would overwrite someone else's resume, and nothing
    // about the upload path is private
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task = uploadBytesResumable(
      storageRef(
        storage,
        `ideathon-resumes/${EVENT.year}/${values.schoolYear}/${unique}-${file.name}`
      ),
      file
    );

    task.on(
      "state_changed",
      (snapshot) => setProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
      (error) => {
        console.error("Resume upload failed:", error);
        setProgress(null);
        setResumeError("That upload did not finish. Try again, or submit without it.");
      }
    );

    // set synchronously: waiting for the first progress event meant a quick
    // submit saw no upload task at all
    setResumeTask(task);
    setResumeName(file.name);
    setResumeError("");
    setSkipResume(false);
    setProgress(0);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    // The DOM gets the last word. If Chrome filled these in before React was
    // listening, `values` is still empty and everything below would refuse a
    // form the person can see is complete.
    const current = collect();
    const found = problemsFor(current);
    const outstanding = REQUIRED.filter((name) => found[name]);

    if (outstanding.length) {
      setShowErrors(true);
      setFormError(outstandingMessage(outstanding.map((name) => found[name].noun)));
      focusField(formRef, outstanding[0]);
      return;
    }

    setFormError("");
    setSubmitting(true);
    try {
      // Wait for the resume upload to finish rather than checking whether a
      // progress counter happened to reach 100 by now. Submitting quickly used
      // to fall through to the no-resume branch and silently store "none".
      let resumeUrl = "none";
      if (resumeTask && !skipResume) {
        try {
          await resumeTask;
          resumeUrl = await getDownloadURL(resumeTask.snapshot.ref);
        } catch (error) {
          // the resume is optional, so a failed upload must not block signing
          // up -- but it must not vanish without a word either. Say so once,
          // then let a second press go through without it.
          console.error("Resume upload failed:", error);
          setSkipResume(true);
          setResumeError(
            "Your resume did not upload. Press Register again to sign up without it, or choose a different file first."
          );
          return;
        }
      }

      let user = null;
      try {
        const credential = await createUserWithEmailAndPassword(
          auth,
          current.email.trim(),
          current.password
        );
        user = credential.user;
      } catch (error) {
        console.error("Could not create the account:", error);
        setFormError(
          error?.code === "auth/email-already-in-use"
            ? "An account already uses that email address. Sign in instead, or reset the password."
            : "That account could not be created. Check the email address and try again."
        );
        focusField(formRef, "email");
        return;
      }

      const applicant = {
        firstName: cleanName(current.firstName),
        lastName: cleanName(current.lastName),
        email: current.email.trim(),
        schoolYear: Number(current.schoolYear),
        uvaSchool: current.uvaSchool,
        resume: resumeUrl,
        gender: current.gender,
        major: current.major.trim(),
        registeredAt: serverTimestamp(),
        checkedIn: false,
        foodCheckIn: false,
        dietaryRestriction: current.dietaryRestriction || "none",
      };

      try {
        await update(ref(database), { ["/competitors/" + user.uid]: applicant });
        setRegistered(true);
      } catch (error) {
        // the account exists at this point, so failing quietly here left people
        // able to sign in with no profile and no idea why
        console.error("Could not save registration:", error);
        setFailure(
          "Your account was created but your registration could not be saved. Email hackathon.virginia@gmail.com before trying again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const rail = {
    sections,
    answered,
    total: REQUIRED.length,
    error: formError,
    busy: submitting,
    submitLabel: "Register",
    busyLabel: "Registering…",
  };

  return (
    <RegistrationShell
      hero={
        <Hero
          eyebrow="Student registration"
          title={`${EVENT.name} ${EVENT.year}`}
          facts={[EVENT.dateLabel, EVENT.hours, EVENT.venue]}
        >
          A one-day event for students from technical and business backgrounds, working in
          teams on a single idea. The day includes workshops on pitching, valuation and
          prototyping, one-to-one time with industry mentors, and a two-hour judged pitch
          event with funding awarded at the end.
        </Hero>
      }
    >
      <ResultDialog
        open={registered}
        title="Registration complete"
        actions={
          <>
            <Button href={EVENT.siteUrl} variant="outlined">
              View the schedule
            </Button>
            <Button variant="contained" onClick={() => navigate("/user/home")}>
              Go to dashboard
            </Button>
          </>
        }
      >
        {`Your place is confirmed and you are signed in. Join or create a team before ${EVENT.dayLabel}.`}
      </ResultDialog>

      <ResultDialog
        open={Boolean(failure)}
        title="Registration not saved"
        onClose={() => setFailure("")}
        actions={
          <Button variant="contained" onClick={() => setFailure("")}>
            Close
          </Button>
        }
      >
        {failure}
      </ResultDialog>

      <Box component="form" ref={formRef} onSubmit={handleSubmit} noValidate>
        <Grid container spacing={{ xs: 4, md: 6 }}>
          <Grid item xs={12} md={7} lg={8}>
            <Stack spacing={5}>
              <Section id="account" label="Account">
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    {...fieldProps("firstName")}
                    label="First name"
                    autoComplete="given-name"
                    required
                    fullWidth
                  />
                  <TextField
                    {...fieldProps("lastName")}
                    label="Last name"
                    autoComplete="family-name"
                    required
                    fullWidth
                  />
                </Stack>

                <TextField
                  {...fieldProps("email")}
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  fullWidth
                  helperText={errorFor("email") ?? "You will sign in with this address."}
                />

                <TextField
                  {...fieldProps("password")}
                  label="Password"
                  type="password"
                  // "new-password" is what tells a password manager to offer a
                  // generated one and to save what you type. The old form said
                  // "current-password", so managers filled an existing password
                  // from another site instead.
                  autoComplete="new-password"
                  required
                  fullWidth
                  helperText={errorFor("password") ?? `At least ${MIN_PASSWORD} characters.`}
                />
              </Section>

              <Section id="studies" label="Studies">
                <FormControl fullWidth>
                  <InputLabel id="uvaSchool-label">School</InputLabel>
                  <Select
                    labelId="uvaSchool-label"
                    id="uvaSchool"
                    name="uvaSchool"
                    label="School"
                    value={values.uvaSchool}
                    onChange={handleChange}
                  >
                    {SCHOOLS.map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel id="schoolYear-label">Expected graduation year</InputLabel>
                  <Select
                    labelId="schoolYear-label"
                    id="schoolYear"
                    name="schoolYear"
                    label="Expected graduation year"
                    value={values.schoolYear}
                    onChange={handleChange}
                  >
                    {GRADUATION_YEARS.map((year) => (
                      <MenuItem key={year} value={String(year)}>
                        {year}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  {...fieldProps("major")}
                  label="Major or intended major"
                  autoComplete="off"
                  required
                  fullWidth
                />
              </Section>

              <Section id="details" label="Additional details">
                <FormControl fullWidth error={Boolean(errorFor("gender"))}>
                  {/*
                    Gender is the one select that opens with nothing chosen, so
                    it shows a placeholder rather than looking answered. That
                    needs the label pinned up and the outline notched by hand:
                    left to itself the label sat down on the placeholder and the
                    border ran straight through the word.
                  */}
                  <InputLabel id="gender-label" shrink>
                    Gender
                  </InputLabel>
                  <Select
                    labelId="gender-label"
                    id="gender"
                    name="gender"
                    value={values.gender}
                    onChange={handleChange}
                    onBlur={markTouched}
                    displayEmpty
                    input={<OutlinedInput notched label="Gender" />}
                    renderValue={(value) =>
                      value
                        ? GENDERS.find(([key]) => key === value)?.[1]
                        : <Box component="span" sx={{ color: "text.secondary" }}>Choose an option</Box>
                    }
                  >
                    {GENDERS.map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>
                    {errorFor("gender") ?? "Reported to sponsors only as a total."}
                  </FormHelperText>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel id="dietaryRestriction-label">Dietary restrictions</InputLabel>
                  <Select
                    labelId="dietaryRestriction-label"
                    id="dietaryRestriction"
                    name="dietaryRestriction"
                    label="Dietary restrictions"
                    value={values.dietaryRestriction}
                    onChange={handleChange}
                  >
                    {DIETARY.map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box>
                  <Typography variant="h5" sx={{ mb: 0.5 }}>
                    Résumé
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1.25 }}>
                    Optional. Sponsors ask for these when they are hiring. PDF or Word, up to
                    5 MB.
                  </Typography>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Button variant="outlined" component="label">
                      {resumeName ? "Replace file" : "Choose a file"}
                      <input
                        type="file"
                        hidden
                        accept={RESUME_ACCEPT}
                        onChange={chooseResume}
                      />
                    </Button>
                    {resumeName && (
                      <Typography variant="body2" sx={{ minWidth: 0, wordBreak: "break-all" }}>
                        {resumeName}
                      </Typography>
                    )}
                  </Stack>
                  {progress !== null && progress < 100 && (
                    <LinearProgress
                      variant="determinate"
                      value={progress}
                      sx={{ mt: 1.5, height: 4, borderRadius: 2 }}
                    />
                  )}
                  {resumeError && (
                    <Alert severity="warning" sx={{ mt: 1.5 }}>
                      {resumeError}
                    </Alert>
                  )}
                </Box>
              </Section>

              <Typography variant="body2" color="text.secondary">
                We do not discriminate in membership or participation in events on the basis
                of age, color, disability, gender identity or expression, marital status,
                military status (including active-duty service members, reserve service
                members, and dependents), national or ethnic origin, political affiliation,
                pregnancy, race, religion, sex, sexual orientation, veteran status, and
                family medical or genetic information.
              </Typography>
            </Stack>

            <MobileSubmitBar {...rail} />
          </Grid>

          <Grid item xs={12} md={5} lg={4} sx={{ display: { xs: "none", md: "block" } }}>
            <SubmitRail
              {...rail}
              footer={
                <>
                  Already registered? <Link href="#/login">Sign in</Link>
                </>
              }
            />
          </Grid>
        </Grid>
      </Box>
    </RegistrationShell>
  );
};

export default Registration;
