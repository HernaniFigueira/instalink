// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — IMPORTAR A BASE DE CLIENTES (prévia + gravação)
// ═══════════════════════════════════════════════════════════════
// Duas fases na MESMA rota, de propósito:
//
//   POST { mode: 'preview' }  → devolve o PLANO (o que cada linha faria)
//   POST { mode: 'commit' }   → aplica o plano
//
// Aceita CSV (texto) e .xlsx (base64) — os dois passam pelo MESMO planejador
// puro. O mapeamento de colunas pode vir da tela e é VALIDADO aqui: o navegador
// não é autoridade sobre o que entra na base.
//
// Contratos que esta rota garante:
//   • cadastro existente **não é sobrescrito**: o padrão é `skip_existing`
//     ("Já existe — não será alterado") e a opção explícita é `fill_empty`
//     (completa só o que está vazio, campo por campo);
//   • telefone de um cadastro + e-mail de outro = **erro** (`identity_conflict`),
//     nunca merge automático;
//   • CPF passa pelo dígito verificador e nascimento pelo calendário real;
//   • consentimento de marketing só LIGA com "sim" explícito — nunca desliga;
//   • a gravação RECALCULA o plano dentro da transação (o arquivo não é fonte
//     de verdade sobre a base).
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { addContactNote, upsertContact } from '@/lib/contacts';
import { normalizeContactProfile, profileOf } from '@/lib/contact-profile';
import {
  IMPORT_MAX_CHARS, IMPORT_MAX_ROWS, buildImportPlan, fillEmptyUpdates, importSummary, parseImportFile,
  parseMatrix, rowLimitMessage,
  type ExistingMode, type ImportMappingInput, type ParsedFile,
} from '@/lib/client-import';
import { xlsxBase64ToMatrixInfo } from '@/lib/xlsx-lite';
import type { DB } from '@/lib/types';

function existingModeOf(body: Record<string, any>): ExistingMode {
  // Padrão do produto: NÃO mexer em quem já existe.
  return String(body.existingMode || body.existing || '') === 'fill_empty' ? 'fill_empty' : 'skip';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'clientes');
    if (!guard.ok) return guard.res;

    const mode = String(body.mode || 'preview') === 'commit' ? 'commit' : 'preview';
    const existingMode = existingModeOf(body);
    const mapping = (body.mapping && typeof body.mapping === 'object' ? body.mapping : undefined) as ImportMappingInput | undefined;
    const fileName = String(body.fileName || '');
    const base64 = String(body.fileBase64 || '');
    const csv = String(body.csv || '');

    // ── Ler o arquivo (CSV ou planilha) ─────────────────────────
    let parsed: ParsedFile;
    if (base64) {
      if (base64.length > IMPORT_MAX_CHARS * 2) {
        return NextResponse.json({ error: 'Arquivo grande demais. Divida a planilha em partes.' }, { status: 400 });
      }
      let matrix: string[][];
      let totalRows: number | undefined;
      try {
        const read = xlsxBase64ToMatrixInfo(base64);
        matrix = read.table;
        totalRows = read.totalRows;
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Não consegui ler esta planilha.' }, { status: 400 });
      }
      parsed = parseMatrix(matrix, { mapping, delimiter: 'xlsx', totalRows });
    } else {
      if (!csv.trim()) return NextResponse.json({ error: 'Cole ou escolha um arquivo com a base (CSV ou .xlsx).' }, { status: 400 });
      if (csv.length > IMPORT_MAX_CHARS) {
        return NextResponse.json({ error: 'Arquivo grande demais (máximo ~2 MB). Divida em partes.' }, { status: 400 });
      }
      parsed = parseImportFile(csv, mapping);
    }
    // ── Limite de linhas (o MESMO para CSV e XLSX, prévia e gravação) ──
    // Acima do limite NADA é lido nem gravado: cortar em silêncio faria o
    // usuário achar que importou tudo.
    if (parsed.rowLimit.exceeded) {
      return NextResponse.json({
        error: rowLimitMessage(parsed.rowLimit.total, parsed.rowLimit.limit),
        code: 'row_limit_exceeded',
        totalRows: parsed.rowLimit.total,
        limit: parsed.rowLimit.limit,
        columns: parsed.columns,
      }, { status: 400 });
    }
    if (parsed.headerError) {
      // Mesmo sem coluna de nome/telefone, devolvemos as colunas lidas para a
      // tela montar o mapeamento manual — e o usuário resolve sem editar o arquivo.
      return NextResponse.json({
        error: parsed.headerError,
        columns: parsed.columns,
        mappingErrors: parsed.mappingErrors,
      }, { status: 400 });
    }
    if (parsed.mappingErrors.length > 0) {
      return NextResponse.json({ error: parsed.mappingErrors[0], columns: parsed.columns }, { status: 400 });
    }

    const existing = guard.db.contacts.filter((c) => c.businessId === businessId);
    const plan = buildImportPlan(parsed, existing, { existingMode });

    if (mode === 'preview') {
      return NextResponse.json({
        ok: true,
        mode,
        summary: importSummary(plan),
        plan,
        rowsRead: plan.rowLimit.total,
        limit: IMPORT_MAX_ROWS,
        source: { fileName, kind: base64 ? 'xlsx' : 'csv' },
      });
    }

    // ── Gravação ────────────────────────────────────────────────
    const result = await updateDB((db: DB) => {
      const current = db.contacts.filter((c) => c.businessId === businessId);
      const fresh = buildImportPlan(parsed, current, { existingMode });
      const now = new Date().toISOString();
      let created = 0;
      let filled = 0;
      let notes = 0;

      for (const row of fresh.rows) {
        if (row.action === 'skip' || row.action === 'error') continue;

        if (row.action === 'create') {
          const contact = upsertContact(db, {
            businessId, customerId: '', name: row.name, phone: row.phone, email: row.email,
            // Consentimento só entra quando o arquivo diz "sim" — nunca presumido.
            marketingOptIn: row.marketingOptIn === true,
            source: 'importacao', now,
          });
          if (!contact) continue;
          created += 1;
          // Perfil completo (CPF/nascimento/endereço/responsável/etiquetas) e a
          // observação administrativa usam as MESMAS funções do cadastro normal.
          contact.profile = normalizeContactProfile({
            cpf: row.cpf || undefined,
            birthDate: row.birthDate || undefined,
            adminNote: row.note || undefined,
            tags: row.tags.length > 0 ? row.tags : undefined,
            address: addressPatchOf(row),
            guardian: guardianPatchOf(row),
          }, profileOf(contact));
          continue;
        }

        // ── fill_empty: SÓ campo vazio recebe valor ──
        const target = db.contacts.find((c) => c.id === row.contactId && c.businessId === businessId);
        if (!target) continue;
        const updates = fillEmptyUpdates(row, target);
        if (updates.contact.name) target.name = updates.contact.name;
        if (updates.contact.email) target.email = updates.contact.email;
        if (Object.keys(updates.profile).length > 0) {
          target.profile = normalizeContactProfile(updates.profile, profileOf(target));
        }
        // Observação: campo canônico quando vazio; senão HISTÓRICO auditável
        // (nada é sobrescrito e nada desaparece).
        if (updates.adminNote) {
          target.profile = normalizeContactProfile({ adminNote: updates.adminNote }, profileOf(target));
        }
        if (updates.historyNote) {
          const note = addContactNote(target, {
            text: updates.historyNote, by: guard.ctx.user.id, byName: guard.ctx.user.name, at: now,
          });
          if (note) {
            notes += 1;
            pushAudit(db, {
              action: 'contact.note_added', actor: guard.ctx.user, businessId,
              meta: { contactId: target.id, noteId: note.id, origin: 'importacao' },
            }, now);
          }
        }
        if (updates.marketingOptIn) target.marketingOptIn = true; // nunca desliga
        target.updatedAt = now;
        filled += 1;
      }

      pushAudit(db, {
        action: 'contact.imported',
        actor: guard.ctx.user,
        businessId,
        meta: {
          created, filled, notes, skipped: fresh.skip, errors: fresh.error,
          total: fresh.total, existingMode, source: base64 ? 'xlsx' : 'csv', fileName,
        },
      });

      return { created, filled, notes, skipped: fresh.skip, errors: fresh.error, total: fresh.total, rows: fresh.rows };
    });

    return NextResponse.json({
      ok: true,
      mode,
      summary: importSummary({ ...plan, rows: result.rows } as any),
      result: {
        created: result.created, filled: result.filled, notes: result.notes,
        skipped: result.skipped, errors: result.errors, total: result.total,
      },
      plan: { ...plan, rows: result.rows },
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status === 500) console.error('[contacts/import] falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível importar a base agora.' : e.message }, { status });
  }
}

/** Endereço do arquivo → patch parcial (só o que veio). */
function addressPatchOf(row: { cep?: string; street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string }) {
  const address = {
    cep: row.cep || undefined, street: row.street || undefined, number: row.number || undefined,
    complement: row.complement || undefined, district: row.district || undefined,
    city: row.city || undefined, state: row.state || undefined,
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

/** Responsável do arquivo → patch parcial. */
function guardianPatchOf(row: { guardianName?: string; guardianPhone?: string; guardianCpf?: string }) {
  const guardian = {
    name: row.guardianName || undefined,
    phone: row.guardianPhone || undefined,
    cpf: row.guardianCpf || undefined,
  };
  return Object.values(guardian).some(Boolean) ? guardian : undefined;
}
