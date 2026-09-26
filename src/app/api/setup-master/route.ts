import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { hashPassword } from '@/lib/auth';
import { pushAudit } from '@/lib/audit';
import { readDB, updateDB } from '@/lib/db';

const PASSWORD_MIN_LENGTH = 8;
const SETUP_LOCKED_STATUS = 410;

type SetupResult =
  | { ok: true; email: string }
  | { ok: false; code: 'locked' | 'email_exists' };

function isOwnerOrAdmin(role: string | undefined): boolean {
  return (role || 'owner') === 'owner' || role === 'admin';
}

function lockedResponse() {
  return NextResponse.json(
    { available: false, error: 'O bootstrap do primeiro Master já foi concluído.' },
    { status: SETUP_LOCKED_STATUS },
  );
}

async function authorizedSetupUser(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth;
  if (!isOwnerOrAdmin(auth.user.role)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: 'Somente Owner ou Admin pode executar este bootstrap.' }, { status: 403 }),
    };
  }
  return auth;
}

/** Informa se o bootstrap ainda está disponível, sem expor dados de usuários. */
export async function GET(req: NextRequest) {
  const auth = await authorizedSetupUser(req);
  if (!auth.ok) return auth.res;
  const db = await readDB();
  if (db.users.some((user) => user.role === 'master')) return lockedResponse();
  return NextResponse.json({ available: true });
}

/** Cria exatamente o primeiro User Master, sem criar qualquer vínculo de tenant. */
export async function POST(req: NextRequest) {
  const auth = await authorizedSetupUser(req);
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Informe o nome do Master.' }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: 'A senha precisa de ao menos 8 caracteres.' }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'As senhas não coincidem.' }, { status: 400 });
  }

  // O lock e a checagem de e-mail ficam dentro da mesma transação/mutex da
  // gravação. Assim, duas submissões simultâneas não criam dois Masters.
  const result = await updateDB<SetupResult>((db) => {
    if (db.users.some((user) => user.role === 'master')) return { ok: false, code: 'locked' };
    if (db.users.some((user) => user.email.toLowerCase() === email)) {
      return { ok: false, code: 'email_exists' };
    }

    const master = {
      id: randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      role: 'master' as const,
      lastLoginAt: '',
    };
    db.users.push(master);
    pushAudit(db, {
      action: 'master.created',
      actor: { id: auth.user.id, email: auth.user.email, role: auth.user.role || 'owner' },
      meta: { via: 'setup-master', userId: master.id, email: master.email },
    });

    // Deliberadamente não cria organization, business, member, sessão ou
    // qualquer fluxo de onboarding: este usuário é somente da plataforma.
    return { ok: true, email: master.email };
  });

  if (!result.ok) {
    if (result.code === 'locked') return lockedResponse();
    return NextResponse.json({ error: 'Este e-mail já está cadastrado.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, message: 'Master criado com sucesso.', email: result.email });
}
