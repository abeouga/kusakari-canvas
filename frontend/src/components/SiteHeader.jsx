import { KusakariHeader } from '@kusakari/site-header';
import { useContext } from 'react';
import '@kusakari/site-header/style.css';
import { useEcCart } from '../hooks/useCommerce';
import { ecUrl } from '../domain/shopping';
import { canvasUrl } from '../domain/urls';
import { AuthContext } from './AuthContext';

export function SiteHeader({ onNavigate = undefined, disabled = false }) {
  const cart = useEcCart();
  const session = useContext(AuthContext);
  return (
    <KusakariHeader
      ecUrl={ecUrl}
      cartCount={cart.data?.itemCount ?? null}
      canvasUrl={new URL(canvasUrl('/'), window.location.origin).href}
      logoUrl={canvasUrl('/icons/kusakari_ico.png')}
      activeSection="canvas"
      authenticated={session?.authenticated ?? false}
      showAdmin={session?.authenticated && session.email === 'test.admin@example.com' && session.role === 'ADMIN'}
      showSeller={session?.authenticated && ['SELLER', 'ADMIN'].includes(session.role || '')}
      onNavigate={onNavigate}
      disabled={disabled}
    />
  );
}
