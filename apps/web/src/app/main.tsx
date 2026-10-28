import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusPage } from '@/routes/status';
import './styles.css';
const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Routes>
    <Route path="/" element={<StatusPage />} />
    <Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/">Infrastructure status</Link></main>} />
  </Routes></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
