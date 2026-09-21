import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { requireBusiness } from '@/lib/access';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import {
  uploadClinicImage, uploadPatientFile, validateUpload, authorizePatientUpload, registerPatientFile,
  CLINIC_MAX_BYTES, PATIENT_MAX_BYTES,
} from '@/lib/storage';
import { storageConfig } from '@/lib/relational/config';

// POST multipart — upload de arquivos.
//   kind=clinic (padrão) — imagem da clínica (logo, capa, catálogo, página).
//     Autorização: sessão de dono/equipe + posse + permissão de página,
//     catálogo ou configuração. Contrato preservado: { ok, url }.
//   kind=patient — arquivo PRIVADO de paciente (anexo do atendimento).
//     Autorização: permissão 'atendimento' da unidade + contato obrigatório.
//     Resposta: { ok, url (TEMPORÁRIA), path, expiresAt }.
//
// Backend: Supabase Storage (buckets clinic-media/patient-files, migração
// 0002). Durante a transição, kind=clinic ainda funciona com o Vercel Blob
// antigo quando só BLOB_READ_WRITE_TOKEN existir — URLs já publicadas não
// mudam (nenhuma migração de imagem é necessária).
// O tipo REAL do arquivo é confirmado por MAGIC BYTES: executável, HTML ou
// qualquer coisa que não seja o formato declarado é recusado.

const REASON_MESSAGE: Record<string, string> = {
  empty: 'Envie um arquivo.',
  too_large: '', // preenchido por kind abaixo
  unknown_type: 'Formato não suportado (verificamos o conteúdo real do arquivo).',
  type_not_allowed: 'Formato não suportado. Use JPG, PNG, WebP ou GIF.',
};

export async function POST(req: NextRequest) {
  const rl = rateLimit(`upload:${ipFrom(req)}`, 40, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitos uploads. Aguarde um instante.' }, { status: 429 });
  try {
    const form = await req.formData();
    const businessId = String(form.get('businessId') || '');
    const kind = String(form.get('kind') || 'clinic') === 'patient' ? 'patient' : 'clinic';
    const contactId = String(form.get('contactId') || '');
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie um arquivo.' }, { status: 400 });

    const guard = await requireBusiness(req, businessId, kind === 'patient' ? 'atendimento' : ['pagina', 'catalogo', 'config']);
    if (!guard.ok) return guard.res;

    const buffer = Buffer.from(await file.arrayBuffer());
    const verdict = validateUpload(buffer, kind, { declaredType: file.type });
    if (!verdict.ok) {
      if (verdict.reason === 'too_large') {
        const max = kind === 'patient' ? PATIENT_MAX_BYTES : CLINIC_MAX_BYTES;
        return NextResponse.json({ error: `Arquivo muito grande (máx. ${Math.round(max / 1024 / 1024)} MB).` }, { status: 400 });
      }
      return NextResponse.json(
        { error: REASON_MESSAGE[verdict.reason || 'unknown_type'] || REASON_MESSAGE.unknown_type },
        { status: 400 },
      );
    }
    const contentType = verdict.contentType!;
    const ext = verdict.ext!;

    if (kind === 'patient') {
      if (!contactId) {
        return NextResponse.json({ error: 'Informe o contato (paciente) dono do arquivo.' }, { status: 400 });
      }
      if (!storageConfig()) {
        return NextResponse.json(
          { error: 'Armazenamento privado ainda não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente do servidor.' },
          { status: 503 },
        );
      }
      // AUTORIZAÇÃO NO SERVIDOR (antes de enviar qualquer byte ao bucket):
      // o contato precisa EXISTIR e pertencer à UNIDADE; operador com escopo
      // de profissional só anexa em contatos que ATENDE.
      const authz = await authorizePatientUpload(businessId, contactId, {
        professionalScope: guard.ctx.professionalScope || '',
      });
      if (!authz.ok) {
        return NextResponse.json(
          authz.reason === 'not_found'
            ? { error: 'Contato não encontrado nesta unidade.' }
            : { error: 'Este arquivo pertence a um paciente que você não atende.' },
          { status: authz.reason === 'not_found' ? 404 : 403 },
        );
      }
      const stored = await uploadPatientFile(businessId, contactId, buffer, contentType, ext);
      // Referência PERMANENTE (a URL assinada acima EXPIRA; a leitura futura
      // é reautorizada por /api/files/[id] e re-assinada na hora).
      let fileId = '';
      try {
        fileId = await registerPatientFile({
          businessId, contactId, bucket: stored.bucket, path: stored.path,
          contentType, sizeBytes: buffer.length,
          uploadedBy: guard.ctx.user?.id || '', originalName: file.name || '',
        });
      } catch (e) {
        console.error('[upload] falha ao registrar referência permanente:', e);
        return NextResponse.json({ error: 'Arquivo enviado, mas o registro falhou. Refaça o envio.' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, url: stored.url, fileId, path: stored.path, expiresAt: stored.expiresAt });
    }

    // kind=clinic — Supabase Storage primeiro; Blob legado como transição.
    if (storageConfig()) {
      const stored = await uploadClinicImage(businessId, buffer, contentType, ext);
      return NextResponse.json({ ok: true, url: stored.url });
    }
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const pathname = `instalink/${businessId}/${randomUUID()}.${ext}`;
      const blob = await put(pathname, buffer, { access: 'public', contentType });
      return NextResponse.json({ ok: true, url: blob.url });
    }
    return NextResponse.json(
      { error: 'Upload de imagens ainda não configurado. Adicione SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Supabase Storage) e tente de novo.' },
      { status: 503 },
    );
  } catch (e: any) {
    console.error('[upload] falhou:', e);
    return NextResponse.json({ error: 'Não foi possível enviar o arquivo. Tente novamente.' }, { status: 500 });
  }
}
