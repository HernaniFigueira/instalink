import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, COOKIE_NAME, hashPassword, verifyPassword } from '@/lib/auth';
import { requireUser } from '@/lib/access';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';

const PASSWORD_MIN_LENGTH = 8;

/** Altera a senha do usuário autenticado, sem depender de unidade/tenant. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  try {
    const body = await req.json();
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!verifyPassword(currentPassword, auth.user.passwordHash)) {
      return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 401 });
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'As senhas não coincidem' }, { status: 400 });
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return NextResponse.json({ error: `A nova senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.` }, { status: 400 });
    }

    const currentSessionId = req.cookies.get(COOKIE_NAME)?.value || getBearerToken(req) || '';
    const result = await updateDB((db) => {
      const user = db.users.find((candidate) => candidate.id === auth.user.id);
      if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
        return { ok: false as const, reason: 'current_password' as const };
      }

      // Somente o hash scrypt entra no documento. Nenhuma senha entra na auditoria.
      user.passwordHash = hashPassword(newPassword);
      db.sessions = db.sessions.filter((session) => session.userId !== user.id || session.id === currentSessionId);
      pushAudit(db, {
        action: 'user.password_changed' as any,
        actor: { id: user.id, email: user.email, role: user.role || 'owner' },
        meta: { via: 'account', otherSessionsInvalidated: true },
      });
      return { ok: true as const };
    });

    if (!result.ok) return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 401 });
    return NextResponse.json({ ok: true, message: 'Senha alterada com sucesso' });
  } catch {
    return NextResponse.json({ error: 'Não foi possível alterar a senha.' }, { status: 400 });
  }
}
