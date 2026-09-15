'use client';

import { useId, useState } from 'react';
import type { FaqItem } from '@/lib/faq';

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();

  // FAQ como lista com divisores (não cards empilhados): tipografia e
  // espaço carregam a hierarquia — mais leve e mais editorial.
  return (
    <div>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const questionId = `${baseId}-question-${index}`;
        const answerId = `${baseId}-answer-${index}`;

        return (
          <div key={index} className="border-b last:border-b-0" style={{ borderColor: 'color-mix(in srgb, var(--il-muted) 16%, transparent)' }}>
            <h3>
              <button
                id={questionId}
                type="button"
                className="w-full flex items-center justify-between gap-4 py-3.5 text-left font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--il-primary)] rounded-md"
                aria-expanded={isOpen}
                aria-controls={answerId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span>{item.q}</span>
                <span
                  aria-hidden="true"
                  className="il-accent shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xl font-medium leading-none"
                  style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)' }}
                >
                  {isOpen ? '−' : '+'}
                </span>
                <span className="sr-only">{isOpen ? 'Recolher resposta' : 'Expandir resposta'}</span>
              </button>
            </h3>
            {isOpen && (
              <div
                id={answerId}
                role="region"
                aria-labelledby={questionId}
                className="pb-4"
              >
                <p className="il-muted text-sm whitespace-pre-line">{item.a}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
