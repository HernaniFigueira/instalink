// Identidade canônica usada pelo Cliente 360.
//
// Um CustomerId, um telefone normalizado e o id do BusinessCustomer são
// aliases da mesma pessoa dentro de uma unidade. O índice é somente de
// leitura: ele resolve documentos legados sem reescrever bookings, leads ou
// conversas no banco.

export interface People360Identity {
  customerId?: string;
  phone?: string;
  contactId?: string;
}

function clean(value: unknown): string {
  return String(value || '').trim();
}

export function people360Phone(value: unknown): string {
  return clean(value).replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
}

function aliasesOf(identity: People360Identity): string[] {
  const aliases: string[] = [];
  const customerId = clean(identity.customerId);
  const phone = people360Phone(identity.phone);
  const contactId = clean(identity.contactId);
  if (customerId) aliases.push(`customer:${customerId}`);
  if (phone) aliases.push(`phone:${phone}`);
  if (contactId) aliases.push(`contact:${contactId}`);
  return aliases;
}

export interface People360IdentityIndex {
  /** Chave estável para agrupar um documento no mapa do Cliente 360. */
  key(identity: People360Identity, fallbackName?: string): string;
}

/**
 * Cria um índice de componentes conexos de identidade.
 *
 * A união lexicográfica dos representantes torna a chave determinística e
 * impede a fragmentação quando um contato legado troca `p:telefone` por
 * `c:customerId`. O escopo é definido pelo chamador: só passe documentos da
 * mesma unidade para preservar tenant isolation.
 */
export function buildPeople360IdentityIndex(records: People360Identity[]): People360IdentityIndex {
  const parent = new Map<string, string>();

  const ensure = (alias: string): string => {
    if (!parent.has(alias)) parent.set(alias, alias);
    return alias;
  };
  const root = (alias: string): string => {
    ensure(alias);
    let current = alias;
    while (parent.get(current) !== current) {
      current = parent.get(current)!;
    }
    // Compressão de caminho.
    let node = alias;
    while (parent.get(node) !== node) {
      const next = parent.get(node)!;
      parent.set(node, current);
      node = next;
    }
    return current;
  };
  const union = (left: string, right: string): void => {
    const a = root(left);
    const b = root(right);
    if (a === b) return;
    // Representante estável, independente da ordem em que os registros foram
    // lidos do JSON.
    if (a < b) parent.set(b, a);
    else parent.set(a, b);
  };

  for (const record of records) {
    const aliases = aliasesOf(record);
    if (aliases.length === 0) continue;
    aliases.forEach(ensure);
    for (let i = 1; i < aliases.length; i += 1) union(aliases[0], aliases[i]);
  }

  return {
    key(identity, fallbackName = ''): string {
      const aliases = aliasesOf(identity);
      if (aliases.length > 0) return root(aliases[0]);
      const name = clean(fallbackName).toLowerCase();
      return name ? `name:${name}` : '';
    },
  };
}
