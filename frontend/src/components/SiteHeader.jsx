import { KusakariHeader } from '@kusakari/site-header';
import '@kusakari/site-header/style.css';
import { useEcCart } from '../hooks/useCommerce';
import { ecUrl } from '../domain/shopping';
import { canvasUrl } from '../domain/urls';

export function SiteHeader({ onNavigate = undefined, disabled = false }) {
  const cart = useEcCart();
  return (
    <KusakariHeader
      ecUrl={ecUrl}
      cartCount={cart.data?.itemCount ?? null}
      canvasUrl={new URL(canvasUrl('/'), window.location.origin).href}
      logoUrl={canvasUrl('/icons/kusakari_ico.png')}
      activeSection="canvas"
      onNavigate={onNavigate}
      disabled={disabled}
    />
  );
}
