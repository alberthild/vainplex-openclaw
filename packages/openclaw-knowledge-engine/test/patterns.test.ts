// test/patterns.test.ts

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { REGEX_PATTERNS } from '../src/patterns.js';

type TestCase = [string, string | null | string[]];

const runTestCases = (regex: RegExp, testCases: TestCase[]) => {
  for (const [input, expected] of testCases) {
    // Reset regex state for each test case
    regex.lastIndex = 0;
    const matches = input.match(regex);
    if (expected === null) {
      assert.strictEqual(matches, null, `Expected no match for: "${input}"`);
    } else if (Array.isArray(expected)) {
      assert.deepStrictEqual(matches, expected, `Mismatch for: "${input}"`);
    } else {
      assert.deepStrictEqual(matches, [expected], `Mismatch for: "${input}"`);
    }
  }
};

describe('REGEX_PATTERNS', () => {

  it('should match valid email addresses', () => {
    const testCases: TestCase[] = [
      ['contact support at support@example.com', 'support@example.com'],
      ['my email is john.doe123@sub.domain.co.uk.', 'john.doe123@sub.domain.co.uk'],
      ['invalid-email@', null],
      ['user@localhost', null],
      ['test@.com', null],
      ['multiple emails: a@b.com and c@d.org', ['a@b.com', 'c@d.org']],
    ];
    runTestCases(REGEX_PATTERNS.email, testCases);
  });

  it('should match valid URLs', () => {
    const testCases: TestCase[] = [
      ['visit https://www.example.com for more info', 'https://www.example.com'],
      ['check http://sub.domain.org/path?query=1', 'http://sub.domain.org/path?query=1'],
      ['ftp://invalid.com', null],
      ['www.example.com', null],
      ['a link: https://a.co and another http://b.com/end.', ['https://a.co', 'http://b.com/end']],
    ];
    runTestCases(REGEX_PATTERNS.url, testCases);
  });

  it('should match ISO 8601 dates', () => {
    const testCases: TestCase[] = [
      ['The date is 2026-02-17.', '2026-02-17'],
      ['Timestamp: 2026-02-17T15:30:00Z', '2026-02-17T15:30:00Z'],
      ['With milliseconds: 2026-02-17T15:30:00.123Z', '2026-02-17T15:30:00.123Z'],
      ['Not a date: 2026-02-17T', null],
      ['Invalid format 2026/02/17', null],
    ];
    runTestCases(REGEX_PATTERNS.iso_date, testCases);
  });

  it('should match common date formats (US & EU)', () => {
    const testCases: TestCase[] = [
        ['US date: 02/17/2026.', '02/17/2026'],
        ['EU date: 17.02.2026,', '17.02.2026'],
        ['Short year: 1.1.99', '1.1.99'],
        ['Two dates: 12/25/2024 and 24.12.2024', ['12/25/2024', '24.12.2024']],
    ];
    runTestCases(REGEX_PATTERNS.common_date, testCases);
  });

  it('should match German date formats', () => {
    const testCases: TestCase[] = [
      ['Datum: 17. Februar 2026', '17. Februar 2026'],
      ['Am 1. Januar 2025 war es kalt.', '1. Januar 2025'],
      ['No match: 17 Februar 2026', null],
    ];
    runTestCases(REGEX_PATTERNS.german_date, testCases);
  });

  it('should match English date formats', () => {
    const testCases: TestCase[] = [
      ['Date: February 17, 2026', 'February 17, 2026'],
      ['On March 1st, 2025, we launched.', 'March 1st, 2025'],
      ['Also August 2nd, 2024 and May 3rd, 2023.', ['August 2nd, 2024', 'May 3rd, 2023']],
      ['No match: February 17 2026', null],
    ];
    runTestCases(REGEX_PATTERNS.english_date, testCases);
  });

  it('should match proper nouns (names, places)', () => {
    const testCases: TestCase[] = [
      ['Hello, my name is Claude Keller.', ['Claude Keller']],
      ['This is Jean-Luc Picard of the USS Enterprise.', ['Jean-Luc Picard', 'USS Enterprise']],
      ['Talk to O\'Malley about it.', ['O\'Malley']],
      ['OpenClaw is a project.', ['OpenClaw']],
      ['Not a name: lower case', null],
      ['Multiple: Forge and Atlas are agents.', ['Forge', 'Atlas']],
    ];
    runTestCases(REGEX_PATTERNS.proper_noun, testCases);
  });

  it('should match product-like names', () => {
    const testCases: TestCase[] = [
        ['I have an iPhone 15.', 'iPhone 15'],
        ['We are using Windows 11.', 'Windows 11'],
        ['The latest model is GPT-4.', 'GPT-4'],
        ['Also look at ProductX.', 'ProductX'],
        ['The Roman Empire used IV.', 'Roman Empire used IV'], // Imperfect but acceptable
    ];
    runTestCases(REGEX_PATTERNS.product_name, testCases);
  });
  
  it('should match organization names with suffixes', () => {
    const testCases: TestCase[] = [
        ['He works at Acme GmbH.', 'Acme GmbH'],
        ['The owner of Stark Industries, LLC is Tony Stark.', 'Stark Industries, LLC'],
        ['Globex Corp. is another example.', 'Globex Corp.'],
        ['This also catches Acme Inc. and Cyberdyne Systems Ltd.', ['Acme Inc.', 'Cyberdyne Systems Ltd.']],
        ['No match for Acme alone', null],
    ];
    runTestCases(REGEX_PATTERNS.organization_suffix, testCases);
  });

});
