export interface EncounterWorkspaceTarget {
  businessId: string;
  id?: string;
  bookingId?: string;
  queueId?: string;
  returnTo?: string;
}

/** Build a permission-protected full-page URL without copying patient PII into the query string. */
export function encounterWorkspaceHref(target: EncounterWorkspaceTarget): string {
  const params = new URLSearchParams();
  params.set('b', target.businessId);
  if (target.id) params.set('id', target.id);
  if (target.bookingId) params.set('bookingId', target.bookingId);
  if (target.queueId) params.set('queueId', target.queueId);
  if (target.returnTo && isSafeInternalHref(target.returnTo)) params.set('returnTo', target.returnTo);
  return `/atendimento?${params.toString()}`;
}

export function isSafeInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\') && !/[\r\n]/.test(href);
}

export function encounterReturnHref(value: string | null, businessId: string): string {
  return value && isSafeInternalHref(value) ? value : `/agenda?b=${encodeURIComponent(businessId)}`;
}
