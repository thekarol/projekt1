import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { canView, isView, ROLE_LABELS, VIEWS } from '../app/permissions.ts';
import type { Role, ViewId } from '../app/permissions.ts';
import { AboutPage } from './about.tsx';
import { ContentPage, OfferPage, PricingPage, RequestsPage, SettingsPage } from './admin.tsx';
import { CartPage, ConfirmationPage } from './cart.tsx';
import { Home } from './shop.tsx';
import { useApp } from './store.tsx';
import { Icon, Notice } from './widgets.tsx';

function currentView(): ViewId {
  const hash = globalThis.location.hash.replace(/^#/, '');
  return isView(hash) ? hash : 'start';
}

function useView(): ViewId {
  const [view, setView] = useState<ViewId>(currentView);
  useEffect(() => {
    const onChange = (): void => {
      setView(currentView());
      globalThis.scrollTo?.(0, 0);
    };
    globalThis.addEventListener('hashchange', onChange);
    return () => globalThis.removeEventListener('hashchange', onChange);
  }, []);
  return view;
}

const NAV: ViewId[] = ['start', 'zgloszenia', 'oferta', 'cennik', 'tresci', 'ustawienia'];

function DemoBar() {
  const app = useApp();
  return (
    <div className="ra-demo">
      <div className="ra-wrap">
        <span>
          <strong>Pokaz</strong><span className="ra-wide-only"> na przykładowych danych</span> · <a href="#o-pokazie"><span className="ra-wide-only">co działa, a co jest szkicem</span><span className="ra-narrow-only">o pokazie</span></a>
        </span>
        <span className="ra-row" style={{ gap: 8 }}>
          <label className="ra-row" style={{ gap: 6 }}>
            <span className="ra-wide-only">Widok jako</span>
            <select data-testid="role" aria-label="Widok jako" value={app.role} onChange={(e) => app.setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </label>
          <button type="button" data-testid="reset" onClick={() => void app.reset()} title="Przywróć dane startowe"><span className="ra-wide-only">Przywróć dane startowe</span><span className="ra-narrow-only">Przywróć dane</span></button>
        </span>
      </div>
    </div>
  );
}

function Header(props: { view: ViewId }) {
  const app = useApp();
  const count = app.cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const links = NAV.filter((view) => canView(app.role, view));
  return (
    <header className="ra-header">
      <div className="ra-wrap">
        <a className="ra-logo" href="#start">{app.catalog.tenant.name}</a>
        <nav className="ra-nav" aria-label="Główna">
          {links.length > 1
            ? links.map((view) => (
                <a key={view} href={`#${view}`} aria-current={props.view === view ? 'page' : undefined}>{VIEWS[view].label}</a>
              ))
            : null}
          {canView(app.role, 'koszyk') ? (
            <a className="ra-cartlink" href="#koszyk" data-testid="cartlink" aria-current={props.view === 'koszyk' ? 'page' : undefined}>
              <Icon name="cart" />
              Koszyk
              <span className="ra-count" aria-label={`sztuk w koszyku: ${count}`}>{count}</span>
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function page(view: ViewId): ReactNode {
  switch (view) {
    case 'koszyk': return <CartPage />;
    case 'potwierdzenie': return <ConfirmationPage />;
    case 'zgloszenia': return <RequestsPage />;
    case 'oferta': return <OfferPage />;
    case 'cennik': return <PricingPage />;
    case 'tresci': return <ContentPage />;
    case 'ustawienia': return <SettingsPage />;
    case 'o-pokazie': return <AboutPage />;
    default: return <Home />;
  }
}

export function Shell() {
  const app = useApp();
  const view = useView();
  const allowed = canView(app.role, view);
  return (
    <>
      <DemoBar />
      <Header view={view} />
      <main>
        {app.role === 'driver' && view === 'start' ? (
          <div className="ra-wrap" style={{ paddingTop: 16 }}>
            <Notice kind="note">Panel kierowcy z listą dowozów powstanie w Fazie 2. Na razie kierowca widzi tylko ofertę.</Notice>
          </div>
        ) : null}
        {allowed ? page(view) : (
          <div className="ra-wrap ra-panel">
            <h1>{VIEWS[view].label}</h1>
            <Notice kind="warn">Rola „{ROLE_LABELS[app.role]}” nie ma dostępu do tego widoku. Zmień rolę w pasku u góry albo wróć do oferty.</Notice>
            <a className="ra-btn" href="#start" style={{ alignSelf: 'flex-start' }}>Wróć do oferty</a>
          </div>
        )}
      </main>
    </>
  );
}
