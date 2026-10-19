import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './pages/App';
import './styles.css';
import './editor.css';
import './photo.css';
import './dialogs.css';
import './projects.css';
import './plan.css';
import './responsive.css';
import './site-header.css';
import './commerce.css';
import './product-browser.css';
const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false },
        mutations: { retry: false },
    },
});
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>);
