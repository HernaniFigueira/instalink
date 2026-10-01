// DTO seguro para Configurações — cadastro institucional
// Expõe apenas campos realmente consumidos pela tela; nunca segredos.

export const BUSINESS_CONFIG_DTO_FIELDS = [
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
] as const;

export type BusinessConfigDTOKey = typeof BUSINESS_CONFIG_DTO_FIELDS[number];

export function toBusinessConfigDTO(business: Record<string, any>): Record<string, any> {
  const dto: Record<string, any> = {};
  for (const key of BUSINESS_CONFIG_DTO_FIELDS) {
    dto[key] = business[key] ?? (key === 'socials' ? {} : key === 'booking' ? undefined : '');
    if (dto[key] === undefined && key !== 'booking' && key !== 'appearance' && key !== 'businessTimezone') {
      dto[key] = '';
    }
    if (key === 'socials' && !dto[key]) dto[key] = {};
  }
  return dto;
}
