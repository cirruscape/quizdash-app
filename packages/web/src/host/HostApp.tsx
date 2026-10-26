// The Host's area: sign in (Amplify Authenticator, against the Cognito pool), then the Host's
// home and Game control.
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { Route, Routes } from 'react-router';
import { appConfig } from '../config.js';
import { HostGame } from './HostGame.js';
import { HostHistoryDetail, HostHistoryList } from './HostHistory.js';
import { HostHome } from './HostHome.js';

// Configured here, not in main.tsx, so Amplify stays out of the Players' bundle.
const { userPoolId, userPoolClientId } = appConfig();
Amplify.configure({ Auth: { Cognito: { userPoolId, userPoolClientId } } });

export function HostApp() {
  return (
    <Authenticator loginMechanisms={['email']} signUpAttributes={['email']}>
      {({ signOut, user }) => (
        <>
          <nav className="hostbar">
            <span className="muted">{user?.signInDetails?.loginId}</span>
            <button type="button" className="link" onClick={signOut}>
              Sign out
            </button>
          </nav>
          <Routes>
            <Route index element={<HostHome />} />
            <Route path="games/:gameId" element={<HostGame />} />
            <Route path="history" element={<HostHistoryList />} />
            <Route path="history/:gameId" element={<HostHistoryDetail />} />
          </Routes>
        </>
      )}
    </Authenticator>
  );
}
