import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import '@mpd/ui-tokens/tokens.css';
import './styles/app.css';
import './styles/additions.css';
import { ApiFailure } from './lib/api';
import { SessionProvider } from './lib/session';
import { TipProvider, ToastProvider } from './components/ui';
import { App } from './App';

const qc = new QueryClient({
  queryCache: new QueryCache({
    // An expired session anywhere sends the user back to sign-in (never shows stale numbers as current).
    onError: (e) => { if (e instanceof ApiFailure && e.status === 401) void qc.invalidateQueries({ queryKey: ['me'] }); },
  }),
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiFailure && e.status >= 400 && e.status < 500) && n < 2, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <ToastProvider>
          <TipProvider>
            <App />
          </TipProvider>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
