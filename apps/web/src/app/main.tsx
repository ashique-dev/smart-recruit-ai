import { bindAuthorizationCache } from '@/services/authorization-cache';
import { PublicAuth, WorkspacePage } from '@/features/auth-workspace';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusPage } from '@/routes/status';
import './styles.css';
const queryClient = new QueryClient();
bindAuthorizationCache(queryClient);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><nav className="flex gap-4 border-b p-4"><Link to="/">Service status</Link><Link to="/login">Sign in</Link><Link to="/register">Register</Link><Link to="/workspace">Workspaces</Link></nav><Routes>
    {(['login','register','reset-request','reset','accept'] as const).map(mode=><Route key={mode} path={`/${mode}`} element={<PublicAuth mode={mode}/>}/>)}
    <Route path="/workspace" element={<WorkspacePage/>}/>
    <Route path="/workspace/:companyId" element={<WorkspacePage/>}/>
    <Route path="/" element={<StatusPage />} />
    <Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/">Infrastructure status</Link></main>} />
  </Routes></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
