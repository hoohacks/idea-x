import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// firebase
import { createUserWithEmailAndPassword } from "firebase/auth";
import { database, auth } from "./firebase";
import { ref, update, serverTimestamp } from "firebase/database";

import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Link,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { EVENT } from "./eventInfo";
import { REGISTRATION_OPEN, isStaffEntrance } from "./registrationWindow";
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
import { ThemeProvider } from "@mui/material/styles";
import { judgeTheme } from "./theme";
import {
  Hero,
  MobileSubmitBar,
  Question,
  RegistrationShell,
  ResultDialog,
  Section,
  SubmitRail,
} from "./registrationUi";

const SHIFTS = ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

const MIN_SHIFTS = 2;

const SKILLS = [
  "Android Studio",
  "Angular",
  "AWS",
  "Azure",
  "C",
  "CSS",
  "C++",
  "C#/ASP.NET",
  "Django",
  "echoAR",
  "Firebase",
  "Flutter",
  "GCP",
  "Git",
  "Google Maps API",
  "HTML",
  "Idea Generation",
  "iOS Mobile App Development",
  "Java",
  "JavaScript",
  "jQuery",
  "Machine Learning",
  "MaxMSP",
  "Node.js",
  "Perl",
  "Pitching",
  "Python",
  "React",
  "Ruby/Rails",
  "SQL",
  "Unity",
  "Other VR technology",
  "Vue.js",
];

const INITIAL = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  company: "",
  questionsAndConcerns: "",
  // radios and checkbox groups are ours alone: no browser autofills them, so
  // useSyncedForm leaves anything that is not a string well enough alone
  withCompany: null,
  wantsToMentor: null,
  wantsToJudge: null,
  shifts: [],
  skills: [],
};

/**
 * Saying yes to a question adds the question that follows it, so each section
 * reports what it is asking for right now rather than a fixed list. A company
 * name is not outstanding for someone who is not here with a company, and
 * counting it would leave the meter permanently short of full.
 */
const SECTIONS = [
  {
    id: "account",
    label: "Account",
    required: () => ["firstName", "lastName", "email", "password"],
  },
  {
    id: "company",
    label: "Affiliation",
    required: (values) => (values.withCompany ? ["withCompany", "company"] : ["withCompany"]),
  },
  {
    id: "mentoring",
    label: "Mentoring",
    required: (values) => (values.wantsToMentor ? ["wantsToMentor", "shifts"] : ["wantsToMentor"]),
  },
  { id: "judging", label: "Judging", required: () => ["wantsToJudge"] },
];

const requiredFields = (values) => SECTIONS.flatMap((section) => section.required(values));

/**
 * A legend here is a question, not a floating label, so it keeps its colour.
 * MuiFormLabel otherwise turns primary the moment anything inside the group
 * takes focus, which reads as an error the person has just caused.
 */
const QUESTION = {
  typography: "h5",
  color: "text.primary",
  "&.Mui-focused": { color: "text.primary" },
  "&.Mui-error": { color: "text.primary" },
};

/**
 * Yes/no with no third state. It lives out here because a component declared
 * inside another one is a new type on every render, which unmounts whatever it
 * drew -- taking the caret with it the moment anything else on the page changes.
 */
function YesNo({ name, legend, hint, value, error, onChange }) {
  return (
    <FormControl error={Boolean(error)} component="fieldset" variant="standard">
      {/* the group needs its own label: a screen reader reading the radios
          inside does not pick up the fieldset legend on its own */}
      <FormLabel
        component="legend"
        id={`${name}-label`}
        sx={QUESTION}
      >
        {legend}
      </FormLabel>
      {hint && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      )}
      <RadioGroup
        row
        id={name}
        name={name}
        aria-labelledby={`${name}-label`}
        value={value}
        onChange={onChange}
        sx={{ mt: 1 }}
      >
        <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes" />
        <FormControlLabel value="no" control={<Radio size="small" />} label="No" />
      </RadioGroup>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}

/**
 * Both "yes" answers open follow-up questions, so what counts as outstanding
 * depends on the answers so far. A conditional field that has not been asked
 * yet is not counted -- the rail would otherwise ask for a company name from
 * someone who has just said they are not with one.
 */
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
    fail("email", "Enter a complete address, like you@company.com", "a valid email address");
  }

  if (!isFilled(values.password)) {
    fail("password", "Choose a password", "a password");
  } else if (values.password.length < MIN_PASSWORD) {
    fail("password", `Use at least ${MIN_PASSWORD} characters`, "a longer password");
  }

  if (values.withCompany === null) {
    fail("withCompany", "Choose yes or no", "whether you are here with a sponsor");
  } else if (values.withCompany && !isFilled(values.company)) {
    fail("company", "Enter the company you are here with", "your company");
  }

  if (values.wantsToMentor === null) {
    fail("wantsToMentor", "Choose yes or no", "whether you can mentor");
  } else if (values.wantsToMentor && values.shifts.length < MIN_SHIFTS) {
    fail(
      "shifts",
      `Pick at least ${MIN_SHIFTS} shifts`,
      `${MIN_SHIFTS} mentoring shifts`
    );
  }

  if (values.wantsToJudge === null) {
    fail("wantsToJudge", "Choose yes or no", "whether you can judge");
  }

  return problems;
}

const JudgeRegistration = () => {
  // Organizers need accounts of their own before the doors open, and nothing
  // in the app can make one for them: creating a person from the control panel
  // requires an organizer already signed in, which is the very thing being
  // bootstrapped. `#/judge-registration?staff` is the same entrance the
  // sign-in page uses, for the same reason -- an organizer is a judge record
  // with the admin flag set on top, so this is the form they need.
  //
  // The competitor form deliberately does NOT have this. Every door left open
  // while the doors are shut is another record a guessed URL can create, and
  // an organizer has no use for a competitor record.
  //
  // Obscurity, not security: somebody who guesses the parameter can create a
  // judge record and nothing else. They cannot score -- isRound1Judge is
  // admin-set -- and the rules show them no team they are not assigned to.
  const { search } = useLocation();
  if (!REGISTRATION_OPEN && !isStaffEntrance(search)) {
    return <ClosedNotice what="Judge and mentor sign-up" />;
  }

  return <JudgeRegistrationForm />;
};

const JudgeRegistrationForm = () => {
  const navigate = useNavigate();
  const { formRef, values, setValue, handleChange, collect } = useSyncedForm(INITIAL);

  const [touched, setTouched] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [failure, setFailure] = useState("");

  const problems = useMemo(() => problemsFor(values), [values]);

  const required = requiredFields(values);
  const sections = SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    remaining: section.required(values).filter((name) => problems[name]).length,
  }));
  const answered = required.filter((name) => !problems[name]).length;

  const markTouched = (event) =>
    setTouched((prev) => ({ ...prev, [event.target.name]: true }));

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

  const toggleIn = (name, item) =>
    setValue(
      name,
      values[name].includes(item)
        ? values[name].filter((existing) => existing !== item)
        : [...values[name], item]
    );

  // "Yes"/"No" arrives from the DOM as a string; the record stores a boolean
  const setChoice = (name) => (event) => setValue(name, event.target.value === "yes");

  const choiceValue = (name) =>
    values[name] === null ? "" : values[name] ? "yes" : "no";

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    // the DOM is the source of truth here: Chrome may have filled the name,
    // email and password before React attached a single listener
    const current = collect();
    const found = problemsFor(current);
    const outstanding = requiredFields(current).filter((name) => found[name]);

    if (outstanding.length) {
      setShowErrors(true);
      setFormError(outstandingMessage(outstanding.map((name) => found[name].noun)));
      focusField(formRef, outstanding[0]);
      return;
    }

    setFormError("");
    setSubmitting(true);
    try {
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

      const judge = {
        firstName: cleanName(current.firstName),
        lastName: cleanName(current.lastName),
        email: current.email.trim(),
        withCompany: current.withCompany,
        company: current.withCompany ? current.company.trim() : "",
        wantsToMentor: current.wantsToMentor,
        // shifts and skills only mean anything for a mentor
        timeslots: current.wantsToMentor ? SHIFTS.filter((s) => current.shifts.includes(s)) : [],
        skills: current.wantsToMentor ? SKILLS.filter((s) => current.skills.includes(s)) : [],
        wantsToJudge: current.wantsToJudge,
        questionsAndConcerns: current.questionsAndConcerns.trim(),
        registeredAt: serverTimestamp(),
        checkedIn: false,
        foodCheckIn: false,
      };

      try {
        await update(ref(database), { ["/judges/" + user.uid]: judge });
        setRegistered(true);
      } catch (error) {
        // the account exists by now, so failing quietly here left judges able to
        // sign in with no profile and no idea why
        console.error("Could not save judge registration:", error);
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
    total: required.length,
    error: formError,
    busy: submitting,
    submitLabel: "Create account",
    busyLabel: "Creating account…",
  };

  // the tab is a label too, and "Ideathon Registration" on both public pages
  // is the same problem as two forms that look alike
  useEffect(() => {
    const was = document.title;
    document.title = "Judge and mentor sign-up · Ideathon";
    return () => {
      document.title = was;
    };
  }, []);

  // everything YesNo needs, gathered in one place
  const choiceProps = (name) => ({
    name,
    value: choiceValue(name),
    error: errorFor(name),
    onChange: setChoice(name),
  });

  return (
    <ThemeProvider theme={judgeTheme}>
    <RegistrationShell
      hero={
        <Hero
          eyebrow="Judge and mentor sign-up"
          title={`${EVENT.name} ${EVENT.year}`}
          facts={[EVENT.dateLabel, `Judging ${EVENT.judgingHours}`, EVENT.venue]}
        >
          Student teams spend the day developing an idea into a pitch. Mentors take one-hour
          shifts helping teams shape their work; judges score the pitches in the evening and
          decide which teams receive funding. You can sign up for either or both, and there
          is no expectation of staying for the full day.
        </Hero>
      }
    >
      <ResultDialog
        open={registered}
        title="Sign-up complete"
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
        {`You are signed in. Your ${EVENT.dayLabel} assignments will be emailed once the schedule is published.`}
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
                  autoComplete="new-password"
                  required
                  fullWidth
                  helperText={errorFor("password") ?? `At least ${MIN_PASSWORD} characters.`}
                />
              </Section>

              <Section id="company" label="Affiliation">
                <YesNo
                  {...choiceProps("withCompany")}
                  legend={`Are you here on behalf of a company sponsoring the ${EVENT.name}?`}
                />
                {values.withCompany && (
                  <TextField
                    {...fieldProps("company")}
                    label="Company"
                    autoComplete="organization"
                    required
                    fullWidth
                  />
                )}
              </Section>

              <Section id="mentoring" label="Mentoring">
                <YesNo
                  {...choiceProps("wantsToMentor")}
                  legend="Would you like to mentor?"
                  hint="Mentors help teams shape an idea and build a pitch, in one-hour shifts through the day."
                />

                {values.wantsToMentor && (
                  <>
                    <FormControl
                      component="fieldset"
                      variant="standard"
                      error={Boolean(errorFor("shifts"))}
                    >
                      <FormLabel
                        component="legend"
                        id="shifts-label"
                        sx={QUESTION}
                      >
                        Which shifts can you take?
                      </FormLabel>
                      <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>
                        Pick at least {MIN_SHIFTS}. Each one is an hour.
                      </Typography>
                      <Stack
                        direction="row"
                        role="group"
                        aria-labelledby="shifts-label"
                        sx={{ flexWrap: "wrap" }}
                      >
                        {SHIFTS.map((shift) => (
                          <FormControlLabel
                            key={shift}
                            sx={{ minWidth: 130 }}
                            control={
                              <Checkbox
                                size="small"
                                name="shifts"
                                checked={values.shifts.includes(shift)}
                                onChange={() => toggleIn("shifts", shift)}
                              />
                            }
                            label={shift}
                          />
                        ))}
                      </Stack>
                      {errorFor("shifts") && (
                        <FormHelperText>{errorFor("shifts")}</FormHelperText>
                      )}
                    </FormControl>

                    <FormControl component="fieldset" variant="standard">
                      <FormLabel
                        component="legend"
                        sx={QUESTION}
                      >
                        What are you comfortable mentoring in?
                      </FormLabel>
                      <Typography variant="body2" sx={{ mt: 0.5, mb: 1 }}>
                        Optional, and it is how teams get matched to you.
                      </Typography>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "repeat(2, 1fr)",
                            sm: "repeat(3, 1fr)",
                          },
                          columnGap: 1,
                        }}
                      >
                        {SKILLS.map((skill) => (
                          <FormControlLabel
                            key={skill}
                            sx={{ mr: 0, "& .MuiTypography-root": { fontSize: "0.875rem" } }}
                            control={
                              <Checkbox
                                size="small"
                                name="skills"
                                checked={values.skills.includes(skill)}
                                onChange={() => toggleIn("skills", skill)}
                              />
                            }
                            label={skill}
                          />
                        ))}
                      </Box>
                    </FormControl>
                  </>
                )}
              </Section>

              <Section id="judging" label="Judging">
                <YesNo
                  {...choiceProps("wantsToJudge")}
                  legend="Would you like to judge?"
                  hint={`Judges score the pitches from ${EVENT.judgingHours} and decide which teams get funded.`}
                />

                <Question
                  htmlFor="questionsAndConcerns"
                  prompt="Anything you want to ask before the day?"
                  hint={
                    <>
                      Optional. You can also email{" "}
                      <Link href="mailto:hackathon.virginia@gmail.com">
                        hackathon.virginia@gmail.com
                      </Link>
                      .
                    </>
                  }
                >
                  <TextField
                    {...fieldProps("questionsAndConcerns")}
                    autoComplete="off"
                    multiline
                    minRows={3}
                    fullWidth
                  />
                </Question>
              </Section>
            </Stack>

            <MobileSubmitBar {...rail} />
          </Grid>

          <Grid item xs={12} md={5} lg={4} sx={{ display: { xs: "none", md: "block" } }}>
            <SubmitRail
              {...rail}
              footer={
                <>
                  Already signed up? <Link href="#/login">Sign in</Link>
                </>
              }
            />
          </Grid>
        </Grid>
      </Box>
    </RegistrationShell>
    </ThemeProvider>
  );
};

export default JudgeRegistration;
