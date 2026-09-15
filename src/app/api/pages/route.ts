import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { slugify, isValidSlug } from '@/lib/utils';
import { featuresForActivatedBlocks } from '@/lib/features';
import { VALID_NAV } from '@/lib/nav';
import type { NavItemConfig } from '@/lib/types';

const pageStr = (v: unknown, max: number): string => String((v as string) || '').slice(0, max);

/**
 * Navegação v2 (âncoras + links externos): saneamento defensivo.
 * - âncora: id do catálogo (NAV_ANCHORS), sem URL;
 * - link: rede conhecida (URL resolvida na leitura) OU URL absoluta válida;
 * - máximo de 16 itens, rótulos curtos, ordem = ordem do array.
 */
function sanitizeNavItems(raw: unknown): NavItemConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: NavItemConfig[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, any>;
    const type = it.type === 'link' ? 'link' : 'anchor';
    const label = String(it.label || '').trim().slice(0, 40);
    const target = String(it.target || '').trim().slice(0, 500);
    const id = String(it.id || '').trim().slice(0, 60);
    if (!id) continue;
    if (type === 'link' && target && !/^https?:\/\//i.test(target) && !isValidSlug(id)) continue;
    out.push({
      id,
      label: label || id,
      type,
      target: type === 'anchor' ? '' : target,
      active: it.active !== false,
    });
  }
  return out;
}

// GET ?businessId= — página + tema + blocos (dono)
// PUT — salvar blocos/tema/publicação/slug (dono)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId);
  if (!guard.ok) return guard.res;
  const page = guard.db.pages.find((p) => p.businessId === businessId);
  return NextResponse.json({ business: guard.ctx.business, page });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId } = body;
    const guard = await requireBusiness(req, businessId, 'pagina');
    if (!guard.ok) return guard.res;
    const db = guard.db;

    if (body.slug !== undefined) {
      const slug = slugify(body.slug);
      if (!isValidSlug(slug)) return NextResponse.json({ error: 'Endereço inválido.' }, { status: 400 });
      if (db.businesses.some((b) => b.slug === slug && b.id !== businessId)) {
        return NextResponse.json({ error: 'Este endereço já está em uso.' }, { status: 400 });
      }
      await updateDB((d) => { d.businesses.find((b) => b.id === businessId)!.slug = slug; });
    }
    if (body.published !== undefined) {
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === businessId)!;
        b.published = !!body.published;
        b.updatedAt = new Date().toISOString();
      });
    }
    // ── Navegação pública + seção "Sobre" — vivem no EDITOR DA PÁGINA ──
    // O estado continua sendo o MESMO (Business.nav/navCustom/navItems/about —
    // única fonte usada pela página pública); apenas o lugar de editar mudou.
    //
    // CORREÇÃO (Sobre não aparecia): salvar "Sobre" COM CONTEÚDO e VISÍVEL
    // também LIGA o módulo 'about' (features) — o editor é a fonte única;
    // o lojista nunca precisa caçar o toggle em Recursos para ver a seção no ar.
    if (body.nav !== undefined || body.navCustom !== undefined || body.about !== undefined || body.navItems !== undefined) {
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === businessId)!;
        if (body.nav !== undefined) {
          const nav = Array.isArray(body.nav) ? body.nav.filter((n: unknown) => VALID_NAV.includes(n as string)) : [];
          b.nav = [...new Set(nav as string[])];
        }
        if (body.navCustom !== undefined) b.navCustom = !!body.navCustom;
        if (body.navItems !== undefined) {
          b.navItems = sanitizeNavItems(body.navItems);
        }
        if (body.about !== undefined && body.about && typeof body.about === 'object') {
          const a = body.about as Record<string, any>;
          b.about = {
            title: pageStr(a.title, 80),
            text: pageStr(a.text, 1200),
            image: pageStr(a.image, 500),
            enabled: a.enabled !== false && !!a.enabled,
          };
          // Sincroniza o módulo: visível + conteúdo ⇒ features.about ligado.
          const hasContent = !!(b.about.title.trim() || b.about.text.trim() || b.about.image.trim());
          if (b.about.enabled && hasContent) {
            const features = { ...(b.features || {}) } as Record<string, boolean>;
            features.about = true;
            b.features = features as typeof b.features;
          }
        }
        b.updatedAt = new Date().toISOString();
      });
    }
    if (body.theme || body.blocks || body.presetId !== undefined) {
      await updateDB((d) => {
        const page = d.pages.find((p) => p.businessId === businessId);
        if (!page) return;
        const previousBlocks = page.blocks;
        if (body.theme) page.theme = { ...page.theme, ...body.theme };
        if (body.presetId !== undefined) page.presetId = String(body.presetId || '');
        if (Array.isArray(body.blocks)) {
          page.blocks = body.blocks.map((bl: any, i: number) => ({
            id: String(bl.id), type: bl.type, order: i,
            // `enabled` é APRESENTAÇÃO: o módulo da empresa (lib/features)
            // continua sendo quem decide se o recurso existe no ar.
            enabled: bl.enabled !== false,
            settings: (bl.settings && typeof bl.settings === 'object') ? bl.settings : {},
          }));
          // Coerência editor→módulo (correção do "salvei a galeria e nada
          // apareceu"): adicionar/reativar um bloco de conteúdo aqui liga o
          // módulo OPCIONAL correspondente. Só a ação do usuário conta —
          // salvar por cima não reativa módulo desligado de propósito.
          const b = d.businesses.find((x) => x.id === businessId);
          if (b) {
            const patch = featuresForActivatedBlocks(b, previousBlocks, page.blocks);
            if (patch) {
              b.features = patch as NonNullable<typeof b.features>;
              b.updatedAt = new Date().toISOString();
            }
          }
        }
        page.updatedAt = new Date().toISOString();
      });
    }
    // O editor revalida a persistência a partir do ESTADO CANÔNICO do banco
    // (nunca do eco do que foi enviado): nada de "Alterações salvas" sobre
    // estado que o servidor não gravou.
    const fresh = await readDB();
    const freshBiz = fresh.businesses.find((b) => b.id === businessId);
    const freshPage = fresh.pages.find((p) => p.businessId === businessId);
    return NextResponse.json({
      ok: true,
      business: freshBiz,
      page: freshPage,
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
  }
}
