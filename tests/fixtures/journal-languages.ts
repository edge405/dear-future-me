import type { AiEntry, JournalLanguage } from '../../src/ai/validation.ts';

export interface JournalFixture {
  name: string;
  language: JournalLanguage;
  notes: string[];
  edited: AiEntry;
  facts: RegExp[];
  disallowedInferences: RegExp[];
  revision?: string;
}

// Synthetic samples only. These are not the owner's journal or biography.
export const languageFixtures: JournalFixture[] = [
  {
    name: 'English', language: 'english',
    notes: [
      'I finished the inventory report at 4 PM today. I was tired after work.',
      'I took the jeep home with my sister Ana. The fare was ₱15.',
      "I felt relieved about finishing the report, but I'm still worried about next week's meeting."
    ],
    edited: { language: 'english', title: 'Finishing the Report and Heading Home', entry_date: '2026-01-01',
      story: "I finished the inventory report at 4 PM today and was tired after work. I took the jeep home with my sister Ana, and the fare was ₱15. I felt relieved about finishing the report, but I'm still worried about next week's meeting." },
    facts: [/Ana/u, /(?:4\s*(?:PM|p\.?m\.?)|four.*afternoon)/iu, /(?:₱\s*15|15\s*pesos|fifteen\s*pesos)/iu, /relie[fv]/iu, /worried|worry|concern/iu],
    disallowedInferences: [/tired[^.!?]*(?:because|due to)[^.!?]*report/iu, /(?:total|each)\s+(?:fare|of\s*₱|₱)/iu]
  },
  {
    name: 'Tagalog', language: 'tagalog',
    notes: [
      'Maaga akong pumasok sa trabaho. Natapos ko ang ulat bago mag-alas-kuwatro ng hapon.',
      'Kasama kong umuwi ang kapatid kong si Ana. Labinlimang piso ang pamasahe sa dyip.',
      'Nakahinga ako nang maluwag nang matapos ang ulat, pero nag-aalala pa rin ako sa pulong sa susunod na linggo.'
    ],
    edited: { language: 'tagalog', title: 'Natapos na Ulat at Pag-uwi Kasama si Ana', entry_date: '2026-01-01',
      story: 'Maaga akong pumasok sa trabaho at natapos ko ang ulat bago mag-alas-kuwatro ng hapon. Kasama kong umuwi ang kapatid kong si Ana, at labinlimang piso ang pamasahe sa dyip. Nakahinga ako nang maluwag nang matapos ang ulat, pero nag-aalala pa rin ako sa pulong sa susunod na linggo.' },
    facts: [/Ana/u, /(?:kuwatro|kwatro|ikaapat|4)/iu, /(?:labinlimang\s*piso|₱\s*15|15\s*piso)/iu, /maluwag/iu, /nag-aalala|pag-aalala/iu],
    disallowedInferences: [/maagang\s+natapos/iu, /ngunit/iu, /pamasahe\s+namin|namin\s+sa\s+dyip/iu],
    revision: 'Improve the sentence flow while keeping my natural wording and every important detail.'
  },
  {
    name: 'Taglish', language: 'taglish',
    notes: [
      'Super pagod ako today after work. Natapos ko yung inventory report at 4 PM.',
      'Nag-jeep kami ni Ana, kapatid ko, pauwi. ₱15 yung fare.',
      'Relieved ako na done na yung report, pero worried pa rin sa meeting next week.'
    ],
    edited: { language: 'taglish', title: 'Pagod After Work, Pero Tapos na ang Report', entry_date: '2026-01-01',
      story: 'Super pagod ako today after work, pero natapos ko yung inventory report at 4 PM. Nag-jeep kami ng kapatid kong si Ana pauwi, at ₱15 yung fare. Relieved ako na done na yung report, pero worried pa rin ako sa meeting next week.' },
    facts: [/Ana/u, /(?:4\s*(?:PM|p\.?m\.?)|four.*afternoon)/iu, /(?:₱\s*15|15\s*(?:pesos|piso))/iu, /relieved/iu, /worried/iu],
    disallowedInferences: [/pagod[^.!?]*(?:dahil|kasi)\s+(?:nga\s+)?natapos/iu, /(?:total|each)\s+(?:fare|of\s*₱|₱)/iu]
  }
];
