// Who may open which view. Enforced here, not by hiding buttons.

export type Role = 'client' | 'team' | 'driver' | 'admin';

export const ROLE_LABELS: Record<Role, string> = {
  client: 'Klient',
  team: 'Zespół',
  driver: 'Kierowca',
  admin: 'Administrator',
};

export const VIEWS = {
  start: { label: 'Rowery', roles: ['client', 'team', 'driver', 'admin'] },
  koszyk: { label: 'Koszyk', roles: ['client', 'team', 'admin'] },
  potwierdzenie: { label: 'Potwierdzenie', roles: ['client', 'team', 'admin'] },
  zgloszenia: { label: 'Zgłoszenia', roles: ['team', 'admin'] },
  oferta: { label: 'Oferta', roles: ['admin'] },
  cennik: { label: 'Cennik', roles: ['admin'] },
  tresci: { label: 'Treści', roles: ['admin'] },
  ustawienia: { label: 'Ustawienia', roles: ['admin'] },
  'o-pokazie': { label: 'O pokazie', roles: ['client', 'team', 'driver', 'admin'] },
} as const satisfies Record<string, { label: string; roles: readonly Role[] }>;

export type ViewId = keyof typeof VIEWS;

export function isView(value: string): value is ViewId {
  return Object.hasOwn(VIEWS, value);
}

export function canView(role: Role, view: ViewId): boolean {
  return (VIEWS[view].roles as readonly Role[]).includes(role);
}

export function viewsFor(role: Role): ViewId[] {
  return (Object.keys(VIEWS) as ViewId[]).filter((v) => canView(role, v));
}
