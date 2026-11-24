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

/** Sections of the home page reachable from the menu. */
const SECTIONS = [
  ['ra-rowery', 'Rowery'],
  ['ra-korzysci', 'Jak to działa'],
  ['ra-pytania', 'Pytania'],
] as const;

function Header(props: { view: ViewId; overlay: boolean }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const count = app.cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const links = NAV.filter((view) => view !== 'start' && canView(app.role, view));

  useEffect(() => setOpen(false), [props.view, app.role]);

  const toSection = (id: string): void => {
    setOpen(false);
    const scroll = (): void => {
      const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(id)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    };
    if (props.view === 'start') scroll();
    else {
      app.go('start');
      setTimeout(scroll, 80);
    }
  };

  const items = (
    <>
      {links.length === 0 ? (
        SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className="ra-navlink" onClick={() => toSection(id)}>{label}</button>
        ))
      ) : (
        <a href="#start" aria-current={props.view === 'start' ? 'page' : undefined}>Sklep</a>
      )}
      {links.map((view) => (
        <a key={view} href={`#${view}`} aria-current={props.view === view ? 'page' : undefined}>{VIEWS[view].label}</a>
      ))}
    </>
  );

  return (
    <header className="ra-header" data-overlay={props.overlay && !open}>
      <div className="ra-wrap">
        <a className="ra-logo" href="#start">{app.catalog.tenant.name}</a>
        <nav className="ra-nav" aria-label="Główna">
          {items}
          {canView(app.role, 'koszyk') ? (
            <a className="ra-cartlink" href="#koszyk" data-testid="cartlink" aria-current={props.view === 'koszyk' ? 'page' : undefined}>
              <Icon name="cart" />
              Koszyk
              <span className="ra-count" aria-label={`sztuk w koszyku: ${count}`}>{count}</span>
            </a>
          ) : null}
          <button type="button" className="ra-menubtn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'x' : 'menu'} size={24} />
          </button>
        </nav>
        {open ? <div className="ra-menu" data-testid="menu">{items}</div> : null}
      </div>
    </header>
  );
}

/** True while the page is scrolled near the top, where the header sits on the hero photo. */
function useAtTop(): boolean {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const onScroll = (): void => setAtTop((globalThis.scrollY ?? 0) < 24);
    onScroll();
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    return () => globalThis.removeEventListener('scroll', onScroll);
  }, []);
  return atTop;
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
  const atTop = useAtTop();
  const hasHero = app.catalog.content.some((c) => c.kind === 'hero' && c.active);
  return (
    <>
      <DemoBar />
      <Header view={view} overlay={view === 'start' && allowed && hasHero && atTop} />
      <main data-hero={view === 'start' && hasHero}>
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
