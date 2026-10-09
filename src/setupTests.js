// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// The public forms are gated by a build-time flag that defaults to CLOSED, so a
// production build that forgets it keeps strangers out. Tests are development,
// not production: they render the forms, so the doors are open here for the
// same reason `npm start` opens them.
//
// `registrationWindow.test.js` overrides this deliberately, with resetModules,
// to prove which way the flag fails.
vi.stubEnv("VITE_REGISTRATION_OPEN", "true");
