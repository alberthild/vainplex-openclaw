// src/patterns.ts

/**
 * Common words that look like proper nouns (start of sentence) but are not.
 */
const EXCLUDED_WORDS = [
  'A', 'An', 'The', 'Hello', 'My', 'This', 'Contact', 'He', 'She',
  'It', 'We', 'They', 'I', 'You', 'His', 'Her', 'Our', 'Your',
  'Their', 'Its', 'That', 'These', 'Those', 'What', 'Which', 'Who',
  'How', 'When', 'Where', 'Why', 'But', 'And', 'Or', 'So', 'Not',
  'No', 'Yes', 'Also', 'Just', 'For', 'From', 'With', 'About',
  'After', 'Before', 'Between', 'During', 'Into', 'Through',
  'Event', 'Talk', 'Project', 'Multiple', 'German',
  'Am', 'Are', 'Is', 'Was', 'Were', 'Has', 'Have',
  'Had', 'Do', 'Does', 'Did', 'Will', 'Would', 'Could', 'Should',
  'May', 'Might', 'Must', 'Can', 'Shall', 'If', 'Then',
];

const EXCL = EXCLUDED_WORDS.map(w => `${w}\\b`).join('|');

/** Capitalized word: handles O'Malley, McDonald's, acronyms like USS */
const CAP = `(?:[A-Z][a-z']*(?:[A-Z][a-z']+)*|[A-Z]{2,})`;

const DE_MONTHS =
  'Januar|Februar|März|Mar|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';

const EN_MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/** Proper noun: one or more cap-words with exclusion list applied per word. */
function properNounFactory(): RegExp {
  return new RegExp(
    `\\b(?!${EXCL})${CAP}(?:(?:-|\\s)(?!${EXCL})${CAP})*\\b`, 'g'
  );
}

/** Product name: three branches for multi-word+Roman, word+version, camelCase. */
function productNameFactory(): RegExp {
  return new RegExp(
    `\\b(?:(?!${EXCL})[A-Z][a-zA-Z0-9]{2,}(?:\\s[a-zA-Z]+)*\\s[IVXLCDM]+` +
    `|[a-zA-Z][a-zA-Z0-9-]{2,}[\\s-]v?\\d+(?:\\.\\d+)?` +
    `|[a-zA-Z][a-zA-Z0-9]+[IVXLCDM]+)\\b`, 'g'
  );
}

/** Creates a fresh RegExp factory for each pattern key. */
function buildPatterns(): Record<string, () => RegExp> {
  return {
    email:       () => /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    url:         () => /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/g,
    iso_date:    () => /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\b/g,
    common_date: () => /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4})|(?:\d{1,2}\.\d{1,2}\.\d{2,4})\b/g,
    german_date: () => new RegExp(`\\b\\d{1,2}\\.\\s(?:${DE_MONTHS})\\s+\\d{4}\\b`, 'gi'),
    english_date: () => new RegExp(`\\b(?:${EN_MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,\\s+\\d{4}\\b`, 'gi'),
    proper_noun: properNounFactory,
    product_name: productNameFactory,
    organization_suffix: () => new RegExp(
      '\\b(?:[A-Z][A-Za-z0-9]+(?:\\s[A-Z][A-Za-z0-9]+)*),?\\s?' +
      '(?:Inc\\.|LLC|Corp\\.|GmbH|AG|Ltd\\.)', 'g'
    ),
  };
}

const PATTERN_FACTORIES = buildPatterns();

/**
 * A collection of regular expression factories for extracting entities.
 * Each property access creates a fresh RegExp to avoid /g state-bleed.
 */
export const REGEX_PATTERNS: Record<string, RegExp> = new Proxy(
  {} as Record<string, RegExp>,
  {
    get(_target, prop: string): RegExp | undefined {
      const factory = PATTERN_FACTORIES[prop];
      return factory ? factory() : undefined;
    },
    ownKeys(): string[] {
      return Object.keys(PATTERN_FACTORIES);
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (prop in PATTERN_FACTORIES) {
        return { configurable: true, enumerable: true, writable: false };
      }
      return undefined;
    },
    has(_target, prop: string): boolean {
      return prop in PATTERN_FACTORIES;
    },
  }
);
