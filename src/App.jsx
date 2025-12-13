import Routing from './Routing';
import ReactGA from 'react-ga4';
import Loader from './pages/Loader';
import Login from './pages/Login';
import lazyLoad from './lazyWrapper';
import NotFound from './pages/NotFound';
import { useEffect, useMemo, memo } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { OptionsProvider, useOptions } from './utils/optionsContext';
import { initPreload } from './utils/preload';
import { designConfig as bgDesign } from './utils/config';
import api from './utils/api';
import './index.css';
import 'nprogress/nprogress.css';

const importSettings = () => import('./pages/Settings');

const Settings = lazyLoad(importSettings);
const Player = lazyLoad(() => import('./pages/Player'));
const New = lazyLoad(() => import('./pages/New'));

initPreload('/settings', importSettings);
initPreload('/indev', () => Promise.resolve({ default: Loader }));

function ProtectedRoute({ children }) {
  const isAuth = api.isAuthenticated();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function useTracking() {
  const location = useLocation();

  useEffect(() => {
    ReactGA.send({ hitType: 'pageview', page: location.pathname });
  }, [location]);
}

const ThemedApp = memo(() => {
  const { options } = useOptions();
  useTracking();

  const pages = useMemo(
    () => [
      { path: '/', element: <Navigate to="/indev" replace /> },
      { path: '/login', element: <Login /> },
      { path: '/docs/r', element: <Player /> },
      { path: '/indev', element: <ProtectedRoute><Loader /></ProtectedRoute> },
      { path: '/settings', element: <ProtectedRoute><Settings /></ProtectedRoute> },
      { path: '/new', element: <New /> },
      { path: '*', element: <NotFound /> },
    ],
    [],
  );

  const backgroundStyle = useMemo(() => {
    const bgDesignConfig =
      options.bgDesign === 'None'
        ? 'none'
        : (
            bgDesign.find((d) => d.value.bgDesign === options.bgDesign) || bgDesign[0]
          ).value.getCSS?.(options.bgDesignColor || '209, 213, 219') || 'none';

    return `
      body {
        color: ${options.siteTextColor || '#374151'};
        background-image: ${bgDesignConfig};
        background-color: ${options.bgColor || '#f9fafb'};
      }
    `;
  }, [options.siteTextColor, options.bgDesign, options.bgDesignColor, options.bgColor]);

  return (
    <>
      <Routing pages={pages} />
      <style>{backgroundStyle}</style>
    </>
  );
});

ThemedApp.displayName = 'ThemedApp';

const App = () => (
  <OptionsProvider>
    <ThemedApp />
  </OptionsProvider>
);

export default App;
