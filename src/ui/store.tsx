// App state shared by all views. Data comes from the repository only.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Role } from '../app/permissions.ts';
import { ROLE_LABELS } from '../app/permissions.ts';
import type { AvailabilityContext } from '../core/availability.ts';
import { toZoned } from '../core/time.ts';
import type { Actor, AuditEntry, Catalog, Id, ISODate, LostDemand, Minutes, OrderInput, Reservation, Zoned } from '../core/types.ts';
import type { Repository } from '../data/repository.ts';

export interface Cart {
  mode: 'days' | 'hours';
  /** False until the customer picks a term (or adds a bike, which takes the nearest free date). */
  termChosen: boolean;
  startDate: ISODate | null;
  endDate: ISODate | null;
  startMinute: Minutes;
  endMinute: Minutes;
  items: Array<{ variantId: Id; quantity: number }>;
  services: Array<{ serviceId: Id; quantity: number }>;
}

export const emptyCart = (): Cart => ({
  mode: 'days',
  termChosen: false,
  startDate: null,
  endDate: null,
  startMinute: 600,
  endMinute: 840,
  items: [],
  services: [],
});

export function cartOrder(cart: Cart): OrderInput | null {
  if (!cart.startDate || !cart.endDate) return null;
  return {
    mode: cart.mode,
    startDate: cart.startDate,
    endDate: cart.mode === 'hours' ? cart.startDate : cart.endDate,
    ...(cart.mode === 'hours' ? { startMinute: cart.startMinute, endMinute: cart.endMinute } : {}),
    items: cart.items,
    services: cart.services,
  };
}

export interface App {
  repo: Repository;
  assets: string;
  vectors: any;
  catalog: Catalog;
  reservations: Reservation[];
  lost: LostDemand[];
  audit: AuditEntry[];
  now: Zoned;
  ctx: AvailabilityContext;
  role: Role;
  actor: Actor;
  setRole: (role: Role) => void;
  cart: Cart;
  setCart: (update: (cart: Cart) => Cart) => void;
  lastReservation: Reservation | null;
  setLastReservation: (reservation: Reservation | null) => void;
  sessionKey: string;
  reload: () => Promise<void>;
  reset: () => Promise<void>;
  toast: (text: string) => void;
  go: (view: string) => void;
}

const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('App context missing');
  return app;
}

function storedRole(): Role {
  try {
    const value = globalThis.localStorage?.getItem('rental-app-role');
    if (value === 'client' || value === 'team' || value === 'driver' || value === 'admin') return value;
  } catch {
    // Storage can be unavailable; the role then simply starts as "client".
  }
  return 'client';
}

export function AppProvider(props: { repo: Repository; assets: string; vectors: any; children: ReactNode }) {
  const { repo } = props;
  const [data, setData] = useState<{ catalog: Catalog; reservations: Reservation[]; lost: LostDemand[]; audit: AuditEntry[] } | null>(null);
  const [role, setRoleState] = useState<Role>(storedRole);
  const [cart, setCartState] = useState<Cart>(emptyCart);
  const [lastReservation, setLastReservation] = useState<Reservation | null>(null);
  const [toastText, setToastText] = useState('');
  const [tick, setTick] = useState(0);
  const sessionKey = useRef('s-' + Math.random().toString(36).slice(2)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const [catalog, reservations, lost, audit] = await Promise.all([
      repo.getCatalog(),
      repo.listReservations(),
      repo.listLostDemand(),
      repo.listAudit(),
    ]);
    setData({ catalog, reservations, lost, audit });
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Keeps "now" fresh for same-day rules without re-rendering constantly.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const toast = useCallback((text: string) => {
    setToastText(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastText(''), 5000);
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      globalThis.localStorage?.setItem('rental-app-role', next);
    } catch {
      // Not essential.
    }
  }, []);

  const go = useCallback((view: string) => {
    globalThis.location.hash = view;
    globalThis.scrollTo?.(0, 0);
  }, []);

  const app = useMemo<App | null>(() => {
    if (!data) return null;
    const now = toZoned(Date.now(), data.catalog.tenant.timeZone);
    return {
      repo,
      assets: props.assets,
      vectors: props.vectors,
      ...data,
      now,
      ctx: { catalog: data.catalog, reservations: data.reservations },
      role,
      actor: { role, name: ROLE_LABELS[role] },
      setRole,
      cart,
      setCart: (update) => setCartState((current) => update(current)),
      lastReservation,
      setLastReservation,
      sessionKey,
      reload,
      reset: async () => {
        await repo.reset();
        setCartState(emptyCart());
        setLastReservation(null);
        await reload();
        toast('Przywrócono dane startowe.');
      },
      toast,
      go,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, role, cart, lastReservation, tick]);

  if (!app) return <p style={{ padding: 24 }}>Wczytywanie…</p>;
  return (
    <AppContext.Provider value={app}>
      {props.children}
      {toastText ? (
        <div className="ra-toast" role="status">
          {toastText}
        </div>
      ) : null}
    </AppContext.Provider>
  );
}
