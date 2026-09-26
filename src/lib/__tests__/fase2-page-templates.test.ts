import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_PRESETS, clinicPresetId, presetById } from '../themes';
import { CLINIC_PRESETS } from '../clinic-presets';
import { defaultTheme } from '../templates';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('FASE 2 · P9 — modelos de página por tipo de clínica (mesmos blocos)', () => {
  it('existem presets para os 4 tipos + profissional individual + geral', () => {
    for (const ct of ['medica', 'odontologica', 'veterinaria', 'estetica', 'particular', 'geral'] as const) {
      const found = THEME_PRESETS.find((p) => p.clinicType === ct);
      expect(found, `preset ${ct}`).toBeTruthy();
      expect(found!.theme.primary).toMatch(/^#/);
      expect(['solid', 'outline', 'soft']).toContain(found!.theme.buttonStyle);
    }
    // ids batem com CLINIC_PRESETS.pagePresetId (P5 × P9 coerentes)
    for (const key of ['medica', 'odontologica', 'veterinaria', 'estetica'] as const) {
      const id = CLINIC_PRESETS[key].pagePresetId;
      expect(THEME_PRESETS.some((p) => p.id === id), `${id} existe`).toBe(true);
    }
  });

  it('clinicPresetId resolve o tipo e cai em "" para desconhecido', () => {
    expect(clinicPresetId('veterinaria')).toBe('clinica-veterinaria');
    expect(clinicPresetId('particular')).toBe('clinica-particular');
    expect(clinicPresetId(undefined)).toBe('');
    expect(clinicPresetId('invented')).toBe('');
    expect(presetById('clinica-medica').name).toBe('Modelo Médico');
    // fallback legado do presetById continua o mesmo (índice 3 intacto)
    expect(presetById('nao-existe').id).toBe(THEME_PRESETS[3].id);
  });

  it('aplicar preset é SÓ aparência: Theme completo, sem tocar em blocos/engine', () => {
    const t = presetById('clinica-veterinaria').theme;
    const keys = Object.keys(t).sort();
    expect(keys).toEqual(['background', 'buttonStyle', 'font', 'muted', 'primary', 'radius', 'secondary', 'surface', 'text'].sort());
    // defaultTheme legado continua funcionando por nicho
    expect(defaultTheme('saude').primary).toMatch(/^#/);
  });

  it('editor da aba Modelo destaca o modelo do tipo; unidade nova nasce com ele', () => {
    const page = read('src/app/(dashboard)/pagina/page.tsx');
    expect(page).toContain('clinicPresetId');
    expect(page).toContain('clinicType={business.clinicType}');
    expect(page).toContain('Sugerido para clínica');
    const api = read('src/app/api/businesses/route.ts');
    expect(api).toContain('clinicPresetId(clinicType)');
    expect(api).toContain('presetById(clinicPreset).theme');
    // o editor continua usando THEME_PRESETS (um único catálogo, sem lista paralela)
    expect(page).toContain('ordered.map');
  });
});
