'use client';

import { useId, useState } from 'react';
import type { FaqItem } from '@/lib/faq';

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const questionId = `${baseId}-question-${index}`;
        const answerId = `${baseId}-answer-${index}`;

        return (
          <div key={index} className="il-card overflow-hidden">
            <h3>
              <button
                id={questionId}
                type="button"
                className="w-full flex items-center justify-between gap-4 p-4 text-left font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--il-primary)]"
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
                className="px-4 pb-4"
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
