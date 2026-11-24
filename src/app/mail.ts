// Confirmation e-mail content. In the demo it is only previewed; the text itself is real.

import type { Catalog, Reservation } from '../core/types.ts';
import { amountDue } from '../core/pricing.ts';
import { formatTerm, money, serviceName, statusName, toBeAgreedText, variantName } from './labels.ts';

export interface Mail {
  to: string;
  copyTo: string;
  subject: string;
  lines: string[];
}

export function confirmationMail(catalog: Catalog, reservation: Reservation): Mail {
  const term = formatTerm(reservation);
  const lines: string[] = [
    `Dzień dobry, ${reservation.customer.name},`,
    '',
    `przyjęliśmy rezerwację ${reservation.number}.`,
    `Termin: ${term}`,
    `Status: ${statusName(catalog, reservation.statusId)}`,
    '',
    'Pozycje:',
  ];
  for (const item of reservation.items) {
    const name = item.kind === 'rental' ? variantName(catalog, item.refId) : serviceName(catalog, item.refId);
    const amount = item.lineTotal === null ? 'do ustalenia' : money(item.lineTotal);
    lines.push(`- ${name} × ${item.quantity}: ${amount}`);
  }
  lines.push('');
  if (reservation.priceStatus === 'final') {
    lines.push(`Do zapłaty: ${money(amountDue(reservation.total, reservation.manualAmount))}`);
  } else {
    lines.push(`Kwota wstępna: ${money(amountDue(reservation.total, reservation.manualAmount))}`);
    lines.push('Do ustalenia:');
    for (const entry of reservation.toBeAgreed) {
      const [code, refId] = entry.split(':');
      lines.push(`- ${toBeAgreedText(catalog, code ?? '', refId ?? null)}`);
    }
    lines.push('Skontaktujemy się, żeby potwierdzić ostateczną cenę.');
  }
  lines.push('', `${catalog.tenant.name}, ${catalog.tenant.address}`);
  return {
    to: reservation.customer.email,
    copyTo: catalog.users.filter((u) => u.active && u.role !== 'driver').map((u) => u.email).join(', '),
    subject: `Rezerwacja ${reservation.number}: ${term}`,
    lines,
  };
}
