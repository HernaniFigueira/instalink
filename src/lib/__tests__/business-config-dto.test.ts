import { describe, it, expect } from 'vitest';
import { BUSINESS_CONFIG_DTO_FIELDS, toBusinessConfigDTO } from '@/lib/business-config-dto';
import fs from 'node:fs';
import path from 'node:path';

describe('Business Config DTO — segurança (blocker 1)', () => {
  it('whitelist contém apenas campos institucionais e nunca segredos', () => {
    const forbidden = [
      'googleApiKey',
      'pixKey',
      'ownerId',
      'organizationId',
      'whatsappIntegration',
      'instagramIntegration',
      'encryptedAccessToken',
      'credentialRef',
      'hours',
      'paymentMethods',
      'deliveryFee',
      'minOrder',
      'googleUrl',
      'googlePlaceId',
      'niche',
      'modes',
      'features',
      'productsOff',
      'nav',
      'navCustom',
      'navItems',
      'about',
      'published',
      'createdAt',
      'updatedAt',
      'subscription',
      'capacityFlags',
    ];
    for (const f of forbidden) {
      expect(BUSINESS_CONFIG_DTO_FIELDS as readonly string[]).not.toContain(f);
    }
    const expected = [
      'id',
      'name',
      'fantasyName',
      'document',
      'description',
      'logo',
      'phone',
      'whatsapp',
      'email',
      'address',
      'city',
      'state',
      'zip',
      'mapsUrl',
      'responsibleName',
      'responsibleDocument',
      'responsibleRegistry',
      'responsibleRole',
      'instagram',
      'tiktok',
      'socials',
      'booking',
      'appearance',
      'businessTimezone',
    ];
    for (const e of expected) {
      expect(BUSINESS_CONFIG_DTO_FIELDS as readonly string[]).toContain(e);
    }
  });

  it('toBusinessConfigDTO nunca expõe segredos mesmo quando Business tem todos os segredos', () => {
    const fakeBusiness: any = {
      id: 'b1',
      name: 'Clínica Vet',
      fantasyName: 'Fantasia',
      document: '12.345.678/0001-99',
      description: 'desc',
      logo: 'logo.png',
      phone: '11 3333',
      whatsapp: '11 9999',
      email: 'a@b.com',
      address: 'Rua A',
      city: 'SP',
      state: 'SP',
      zip: '00000-000',
      mapsUrl: 'https://maps',
      responsibleName: 'Dr X',
      responsibleDocument: '123',
      responsibleRegistry: 'CRMV 123',
      responsibleRole: 'RT',
      instagram: '@clinica',
      tiktok: '@clinica',
      socials: { facebook: 'https://fb.com' },
      booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
      appearance: { navColor: '#000' },
      businessTimezone: 'America/Sao_Paulo',
      // segredos que NÃO devem vazar
      googleApiKey: 'SECRET_GOOGLE_KEY',
      pixKey: 'SECRET_PIX',
      ownerId: 'u_owner_secret',
      whatsappIntegration: { encryptedAccessToken: 'ENCRYPTED_WA', credentialRef: 'ref_secret', status: 'connected' },
      instagramIntegration: { encryptedAccessToken: 'ENCRYPTED_IG', status: 'connected' },
      niche: 'pet',
      modes: ['services', 'bookings'],
      hours: {},
      paymentMethods: ['pix'],
      deliveryFee: 100,
      googleUrl: 'https://google',
      googlePlaceId: 'place123',
      // outros
      about: { title: 'x', text: 'y', image: '', enabled: true },
      nav: ['services'],
      navCustom: true,
    };
    const dto = toBusinessConfigDTO(fakeBusiness);
    // Segredos ausentes
    expect(dto.googleApiKey).toBeUndefined();
    expect(dto.pixKey).toBeUndefined();
    expect(dto.ownerId).toBeUndefined();
    expect(dto.whatsappIntegration).toBeUndefined();
    expect(dto.instagramIntegration).toBeUndefined();
    expect(dto.niche).toBeUndefined();
    expect(dto.modes).toBeUndefined();
    expect(dto.hours).toBeUndefined();
    expect(dto.about).toBeUndefined();
    expect(dto.nav).toBeUndefined();
    // Campos permitidos presentes
    expect(dto.id).toBe('b1');
    expect(dto.name).toBe('Clínica Vet');
    expect(dto.fantasyName).toBe('Fantasia');
    expect(dto.document).toBe('12.345.678/0001-99');
    expect(dto.logo).toBe('logo.png');
    expect(dto.booking).toEqual(fakeBusiness.booking);
    expect(dto.socials).toEqual(fakeBusiness.socials);
    expect(dto.businessTimezone).toBe('America/Sao_Paulo');
  });

  it('GET handler usa DTO (não retorna business bruto) — verificação estática', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/businesses/[id]/route.ts'), 'utf8');
    const dtoSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/business-config-dto.ts'), 'utf8');
    expect(src).toContain('toBusinessConfigDTO');
    expect(dtoSrc).toContain('BUSINESS_CONFIG_DTO_FIELDS');
    // Não deve conter retorno bruto direto sem DTO
    expect(src).not.toMatch(/return NextResponse\.json\(\{ business: guard\.ctx\.business \}\)/);
    // Deve conter never retornar segredos por conveniência
    expect(src).toContain('DTO');
  });
});
