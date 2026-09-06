import { Navigate, Routes, Route } from "react-router-dom"
import { createContext, useContext, useMemo, useState, useEffect, useCallback } from "react"
import Registration from "./Registration"
import Search from "./user/admin/Search.js"
import RegisteredAtDisplay from "./RegisteredAtDisplay"
import { auth } from "./firebase";
import { browserLocalPersistence, signInWithEmailAndPassword } from "firebase/auth"
import JudgeRegistration from "./JudgeRegistration"
import Login from "./Login"
import UserHome from "./user/Home"
import NewJoinTeam from "./user/team/NewJoinTeam.js"
import CreateTeam from "./user/team/CreateTeam.js"
import Team from "./user/team/Team.js"
import UserProfile from "./user/Profile"
import CheckIn from "./user/CheckIn"
import AdminScan from "./user/admin/Scan"
import JudgeDashboard from "./user/admin/JudgeSearch.js"
import ForgotPassword from "./ForgotPassword.js"
import Assignments from "./user/judge/Assignments.js"
import { ref, get } from "firebase/database"
import { database } from "./firebase"
import { onAuthStateChanged } from "firebase/auth"
import Layout from "./user/Layout.js"
import TeamDashboard from "./user/admin/TeamSearch.js"
import JudgingProgress from "./user/admin/JudgingProgress.js"
import Control from "./user/admin/Control.js"
import SchedulePlanner from "./user/admin/schedule/SchedulePlanner.js"
import Results from "./user/admin/results/Results.js"
import PrintableSchedule from "./user/admin/schedule/PrintableSchedule.js"
import { ROLES, hasRole, mergeRoleProfiles } from "./roles.js"

const AuthContext = createContext(null);

/**
 * Whether the phone drawer is open, held above the route rather than inside the
 * nav.
 *
 * `ProtectedRoute` renders `<Layout>Loading...</Layout>` while it waits for a
 * role, and the page it then renders brings its own `Layout`. React sees a
 * different element in that position, so it throws the first one away -- nav
 * included. Anyone who tapped the menu in that window watched it open and
 * vanish, or never open at all, and the second tap worked. On a phone on
 * conference wifi that window is long enough to hit every time.
 *
 * Keeping the flag above the swap means whichever nav mounts reads the state
 * the person actually set.
 */
const NavDrawerContext = createContext(null);

function NavDrawerProvider({ children }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

function ProtectedRoute({ children, requiredRoles }) {
  const { userCredential, userTypes, loadingAuth, loadingUserData } = useAuth();

  if (loadingAuth || loadingUserData) {
    return (
      <Layout>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
          Loading...
        </div>
      </Layout>
    );
  }

  if (!userCredential) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRoles && !requiredRoles.some(role => hasRole(userTypes, role))) {
    return <Navigate to="/user/home" replace />;
  }

  return children;
}

function AuthProvider({ children }) {
  const [userCredential, setUserCredential] = useState(null);
  const [token, setToken] = useState(null);
  const [userData, setUserData] = useState(null);
  const [userTypes, setUserTypes] = useState([]);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingUserData, setLoadingUserData] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // keep the same object identity when the signed-in uid has not changed so
      // downstream effects do not re-run for every token refresh
      setUserCredential((prev) =>
        prev?.user?.uid === user?.uid ? prev : (user ? { user } : null)
      );
      setLoadingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  const refreshUserData = useCallback(async () => {
    if (!userCredential) {
      // signed out: clear every trace of the previous user so roles cannot leak
      // into the next session on this tab
      setToken(null);
      setUserData(null);
      setUserTypes([]);
      setLoadingUserData(false);
      return;
    }

    setLoadingUserData(true);

    try {
      const idToken = await userCredential.user.getIdToken();
      setToken(idToken);

      const foundRoles = [];
      const records = [];

      for (const role of ROLES) {
        try {
          const userRef = ref(database, `/${role}s/${userCredential.user.uid}`);
          const snapshot = await get(userRef);
          if (snapshot.exists()) {
            foundRoles.push(role);
            records.push(snapshot.val());
          }
        } catch (error) {
          console.warn(`Could not read ${role} data:`, error);
        }
      }

      // merged rather than spread, so the record for a role granted later does
      // not blank the name and email on the one they registered with
      // replace rather than append, otherwise roles accumulate across logins
      setUserData(mergeRoleProfiles(records));
      setUserTypes(foundRoles);
    } finally {
      setLoadingUserData(false);
    }
  }, [userCredential]);

  useEffect(() => {
    // wait for firebase to report the initial auth state, otherwise a signed-in
    // user is briefly treated as signed out and bounced to /login
    if (loadingAuth) return;
    refreshUserData();
  }, [loadingAuth, refreshUserData]);

  const handleLogin = async (email, password, remember = false) => {
    try {
      if (remember)
        await auth.setPersistence(browserLocalPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      setUserCredential({ user: credential.user });
      return true;
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ userCredential, handleLogin, refreshUserData, token, userData, userTypes, loadingAuth, loadingUserData }}>
      {children}
    </AuthContext.Provider>
  )
}

function App() {
  return (
    <AuthProvider>
      <NavDrawerProvider>
      <Routes>
        <Route path="/" element={<Registration />} />
        <Route path="/ideathon-registration" element={<Registration />} />
        <Route path="/judge-registration" element={<JudgeRegistration />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/login" element={<Login />} />
        <Route path="/user">
          <Route path="home" element={<ProtectedRoute><UserHome /></ProtectedRoute>} />
          <Route path="profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
          <Route path="judging" element={<ProtectedRoute requiredRoles={["judge", "admin"]}><Assignments /></ProtectedRoute>} />
          <Route path="checkin" element={<ProtectedRoute requiredRoles={["competitor", "judge"]}><CheckIn /></ProtectedRoute>} />
          <Route path="team">
            <Route index element={<ProtectedRoute requiredRoles={["competitor"]}><Team /></ProtectedRoute>} />
            <Route path="join" element={<ProtectedRoute requiredRoles={["competitor"]}><NewJoinTeam /></ProtectedRoute>} />
            <Route path="create" element={<ProtectedRoute requiredRoles={["competitor"]}><CreateTeam /></ProtectedRoute>} />
          </Route>
          <Route path="admin">
            <Route path="metrics" element={<ProtectedRoute requiredRoles={["admin"]}><RegisteredAtDisplay /></ProtectedRoute>} />
            <Route path="scan" element={<ProtectedRoute requiredRoles={["admin"]}><AdminScan /></ProtectedRoute>} />
            <Route path="search" element={<ProtectedRoute requiredRoles={["admin"]}><Search /></ProtectedRoute>} />
            <Route path="judges" element={<ProtectedRoute requiredRoles={["admin"]}><JudgeDashboard /></ProtectedRoute>} />
            <Route path="teams" element={<ProtectedRoute requiredRoles={["admin"]}><TeamDashboard /></ProtectedRoute>} />
            <Route path="judging" element={<ProtectedRoute requiredRoles={["admin"]}><JudgingProgress /></ProtectedRoute>} />
            <Route path="schedule" element={<ProtectedRoute requiredRoles={["admin"]}><SchedulePlanner /></ProtectedRoute>} />
            <Route path="print" element={<ProtectedRoute requiredRoles={["admin"]}><PrintableSchedule /></ProtectedRoute>} />
            <Route path="results" element={<ProtectedRoute requiredRoles={["admin"]}><Results /></ProtectedRoute>} />
            <Route path="control" element={<ProtectedRoute requiredRoles={["admin"]}><Control /></ProtectedRoute>} />
          </Route>
        </Route>

        {/* an unmatched hash route rendered nothing at all, which reads as the
            app being broken rather than the address being wrong */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </NavDrawerProvider>
    </AuthProvider>
  )
}

export { AuthContext, NavDrawerContext, NavDrawerProvider, useAuth, ProtectedRoute };

export default App
