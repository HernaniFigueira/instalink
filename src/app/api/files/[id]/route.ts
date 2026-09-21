import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { getPatientFileRecord, signPatientFile } from '@/lib/storage';
import { relationalActive } from '@/lib/relational/config';

// GET /api/files/[id] — leitura AUTORIZADA de arquivo de paciente DEPOIS que a
// URL temporária expirou. A referência permanente vive no banco
// (app.patient_files, migração 0003); a autorização é refeita AQUI, no
// servidor, a cada leitura: permissão 'atendimento' da unidade dona do arquivo
// + escopo do profissional (quando ativo, só enxerga anexos de quem atende).
// Resposta: 302 para uma NOVA URL assinada de curta duração (o conteúdo nunca
// passa por este servidor; o bucket privado continua inacessível sem assinatura).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = relationalActive() || process.env.SUPABASE_DB_URL
    ? await getPatientFileRecord(id)
    : null;
  if (!record) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });

  const guard = await requireBusiness(req, record.businessId, 'atendimento');
  if (!guard.ok) return guard.res;
  if (guard.ctx.professionalScope) {
    // Escopo do profissional: conferir se o contato é atendido por ele.
    const { authorizePatientUpload } = await import('@/lib/storage');
    const check = await authorizePatientUpload(record.businessId, record.contactId, {
      professionalScope: guard.ctx.professionalScope,
    });
    if (!check.ok) return NextResponse.json({ error: 'Este arquivo pertence a outro paciente.' }, { status: 403 });
  }
  try {
    const signed = await signPatientFile(record.path, 300);
    return NextResponse.redirect(signed.url, { status: 302 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível abrir o arquivo agora. Tente novamente.' }, { status: 502 });
  }
}
