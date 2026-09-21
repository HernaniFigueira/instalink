import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EncounterSheet, type EncounterRow } from '../dashboard/EncounterSheet';

it('an existing encounter has its text on the first render, before hydration/effects or printing', () => {
  const row: EncounterRow = { id:'synthetic', businessId:'demo', status:'draft', version:1,
    customerName:'Pessoa sintética', date:'2026-09-21', time:'09:00', tags:[],
    complaint:'Motivo sintético', evolution:'CONTEUDO-INICIAL-PRESENTE', guidance:'MARCADOR-PUBLICO-FINAL',
    internalNote:'NOTA-INTERNA', followUp:'', createdAt:'2026-09-21T12:00:00Z', updatedAt:'2026-09-21T12:00:00Z',
    bookingId:'', queueId:'', serviceId:'', professionalId:'', customerId:'', contactId:'',
    createdBy:'demo', updatedBy:'demo', finalizedAt:'', finalizedBy:'', signedBy:'',
    professionalName:'', serviceName:'', bookingStatus:'', customerPhone:'',
  };
  const html=renderToStaticMarkup(createElement(EncounterSheet,{businessId:'demo',existing:row,onClose:()=>{}}));
  expect(html).toContain('CONTEUDO-INICIAL-PRESENTE');
  expect(html).toContain('MARCADOR-PUBLICO-FINAL');
  // This is the authorized editing form, not the patient print allowlist.
  // The latter is verified independently by the real multipage PDF journey.
  expect(html).toContain('NOTA-INTERNA');
});
