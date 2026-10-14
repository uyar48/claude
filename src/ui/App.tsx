import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Runtime } from '../data/runtime';
import { ensureSubscription, permission } from '../push/push';
import { RuntimeContext } from './hooks';
import { AdminReview } from './screens/AdminReview';
import { DeviceLinkScreen } from './screens/DeviceLink';
import { LessonScreen } from './screens/Lesson';
import { Login } from './screens/Login';
import { SettingsScreen } from './screens/Settings';
import { Today } from './screens/Today';

export function App({ runtime }: { runtime: Runtime }) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <BrowserRouter>
        <PushBridge runtime={runtime} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/review" element={<AdminReview />} />
          <Route
            path="/*"
            element={
              <AuthGate runtime={runtime}>
                <Routes>
                  <Route path="/" element={<Today />} />
                  <Route path="/lesson" element={<LessonScreen />} />
                  <Route path="/settings" element={<SettingsScreen />} />
                  <Route path="/baglan" element={<DeviceLinkScreen />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </RuntimeContext.Provider>
  );
}

/** With Supabase configured the app needs a signed-in session; otherwise it runs locally. */
function AuthGate({ runtime, children }: { runtime: Runtime; children: React.ReactNode }) {
  const loc = useLocation();
  if (runtime.supabase && !runtime.session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

/** Notification clicks, engagement tracking and keeping the push subscription fresh. */
function PushBridge({ runtime }: { runtime: Runtime }) {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get('n');
    if (n && runtime.sync) void runtime.sync.markNotificationOpened(n);
    if (permission() === 'granted' && runtime.session) void ensureSubscription(runtime).catch(() => {});

    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'notification-click') return;
      if (e.data.id && runtime.sync) void runtime.sync.markNotificationOpened(e.data.id);
      if (typeof e.data.url === 'string') navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [runtime, navigate]);

  return null;
}
