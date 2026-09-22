// ═══════════════════════════════════════════════════════════════
// BLOQUEIO EXPLÍCITO de módulos ainda NÃO migrados (modo relacional).
// ═══════════════════════════════════════════════════════════════
// Proteção TEMPORÁRIA contra retorno silencioso ao motor legado (Neon): um
// módulo não migrado NÃO lê nem grava no documento — responde indisponível.
// A migração continua módulo a módulo (matriz em docs/GODOUTOR-MATRIZ-MIGRACAO.md);
// ao migrar um módulo, remova o bloqueio da lista.
import { NextResponse } from 'next/server';
import { relationalActive } from './config';

export function relationalBlockedResponse(module: string): NextResponse {
  return NextResponse.json({
    error: `“${module}” está temporariamente indisponível no modo de persistência relacional. Este módulo ainda não foi migrado do motor legado — o acesso está bloqueado de propósito para nunca ler nem gravar no banco antigo.`,
    code: 'module_not_migrated',
    module,
  }, { status: 503, headers: { 'x-godoutor-persistence': 'relational', 'x-godoutor-blocked': module } });
}

/**
 * Guarda de módulo: devolve resposta 503 quando o módulo NÃO foi migrado e o
 * modo relacional está ativo; `null` = seguir (legado ou já migrado).
 */
export function blockIfRelational(module: string): NextResponse | null {
  return relationalActive() ? relationalBlockedResponse(module) : null;
}
