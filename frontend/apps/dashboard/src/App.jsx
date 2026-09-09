import React, { useEffect, useState } from 'react';
import { LangProvider, staffAuth } from '@youty/shared';
import LoginPage from './LoginPage.jsx';
import { DashboardProvider } from './ctx.jsx';
import Shell from './shell/Shell.jsx';

export default function App() {
  const [session, setSession] = useState(staffAuth.getSession());
  useEffect(() => staffAuth.subscribe(setSession), []);

  return (
    <LangProvider>
      {session
        ? <DashboardProvider key={`${session.user?.id}:${session.salon?.id}`}><Shell /></DashboardProvider>
        : <LoginPage />}
    </LangProvider>
  );
}
