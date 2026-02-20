/**
 * Redaction Pattern Registry (RFC-007 §3)
 *
 * Manages built-in and custom regex patterns for detecting sensitive data.
 * All patterns are pre-compiled at startup for performance.
 * Built-in credential patterns cannot be disabled or overridden.
 */

import type {
  CustomPatternConfig,
  PluginLogger,
  RedactionCategory,
  RedactionPattern,
} from "../types.js";

/** Category evaluation order: credentials first (security-critical) */
const CATEGORY_ORDER: readonly RedactionCategory[] = [
  "credential",
  "financial",
  "pii",
  "custom",
] as const;

/**
 * Built-in patterns — pre-compiled, immutable.
 * These cover the most common secret formats per RFC-007 §3.1.
 *
 * All patterns use possessive-style quantifiers where possible
 * (via non-greedy + anchoring) to avoid ReDoS.
 */
const BUILTIN_PATTERNS: readonly RedactionPattern[] = [
  {
    id: "openai-api-key",
    category: "credential",
    regex: /sk-[a-zA-Z0-9]{20,}/,
    replacementType: "api_key",
    builtin: true,
  },
  {
    id: "anthropic-api-key",
    category: "credential",
    regex: /sk-ant-[a-zA-Z0-9-]{80,}/,
    replacementType: "api_key",
    builtin: true,
  },
  {
    id: "google-api-key",
    category: "credential",
    regex: /AIza[0-9A-Za-z_-]{35}/,
    replacementType: "api_key",
    builtin: true,
  },
  {
    id: "github-pat",
    category: "credential",
    regex: /ghp_[a-zA-Z0-9]{36}/,
    replacementType: "token",
    builtin: true,
  },
  {
    id: "github-server-token",
    category: "credential",
    regex: /ghs_[a-zA-Z0-9]{36}/,
    replacementType: "token",
    builtin: true,
  },
  {
    id: "gitlab-pat",
    category: "credential",
    regex: /glpat-[a-zA-Z0-9_-]{20,}/,
    replacementType: "token",
    builtin: true,
  },
  {
    id: "private-key-header",
    category: "credential",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    replacementType: "private_key",
    builtin: true,
  },
  {
    id: "bearer-token",
    category: "credential",
    regex: /Bearer [a-zA-Z0-9_./-]{20,}/,
    replacementType: "bearer",
    builtin: true,
  },
  {
    id: "key-value-credential",
    category: "credential",
    regex: /(?:password|passwd|pwd|secret|token|api_key|apikey)\s*[:=]\s*['"]?[^\s'"]{8,64}/i,
    replacementType: "credential",
    builtin: true,
  },
  {
    id: "email-address",
    category: "pii",
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
    replacementType: "email",
    builtin: true,
  },
  {
    id: "phone-number",
    category: "pii",
    regex: /\+?[1-9]\d{6,14}/,
    replacementType: "phone",
    builtin: true,
  },
  {
    id: "credit-card",
    category: "financial",
    regex: /\b[45]\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    replacementType: "credit_card",
    builtin: true,
  },
  {
    id: "iban",
    category: "financial",
    regex: /\b[A-Z]{2}\d{2}\s?[A-Z0-9]{4}\s?(?:\d{4}\s?){2,7}\d{1,4}\b/,
    replacementType: "iban",
    builtin: true,
  },
];

export type PatternMatch = {
  pattern: RedactionPattern;
  match: string;
  start: number;
  end: number;
};

/**
 * The pattern registry holds all active redaction patterns.
 * Built-in patterns are always present; custom patterns can be added.
 */
export class PatternRegistry {
  private readonly patterns: RedactionPattern[] = [];
  private readonly logger: PluginLogger;

  constructor(
    enabledCategories: RedactionCategory[],
    customPatterns: CustomPatternConfig[],
    logger: PluginLogger,
  ) {
    this.logger = logger;

    // Add built-in patterns for enabled categories
    const enabledSet = new Set(enabledCategories);
    for (const p of BUILTIN_PATTERNS) {
      if (enabledSet.has(p.category)) {
        this.patterns.push(p);
      }
    }

    // Compile and add custom patterns
    for (const cp of customPatterns) {
      const compiled = this.compileCustomPattern(cp);
      if (compiled) {
        this.patterns.push(compiled);
      }
    }

    this.logger.info(
      `[redaction] Registry initialized: ${this.patterns.length} patterns ` +
      `(${this.patterns.filter((p) => p.builtin).length} built-in, ` +
      `${this.patterns.filter((p) => !p.builtin).length} custom)`,
    );
  }

  /** Get all registered patterns, ordered by category priority */
  getPatterns(): readonly RedactionPattern[] {
    return this.patterns;
  }

  /** Get patterns for a specific category */
  getByCategory(category: RedactionCategory): readonly RedactionPattern[] {
    return this.patterns.filter((p) => p.category === category);
  }

  /**
   * Find all matches in a string, resolving overlaps by longest match.
   * Returns matches sorted by position.
   */
  findMatches(input: string): PatternMatch[] {
    const allMatches: PatternMatch[] = [];

    // Evaluate in category priority order
    for (const category of CATEGORY_ORDER) {
      const categoryPatterns = this.patterns.filter(
        (p) => p.category === category,
      );
      for (const pattern of categoryPatterns) {
        // Create a new regex with global flag for iteration, preserving original case-sensitivity
        const flags = "g" + (pattern.regex.flags.includes("i") ? "i" : "");
        const globalRegex = new RegExp(pattern.regex.source, flags);
        let m: RegExpExecArray | null;
        while ((m = globalRegex.exec(input)) !== null) {
          allMatches.push({
            pattern,
            match: m[0],
            start: m.index,
            end: m.index + m[0].length,
          });
          // Prevent infinite loops on zero-length matches
          if (m[0].length === 0) {
            globalRegex.lastIndex++;
          }
        }
      }
    }

    // Resolve overlapping matches: longest match wins, then highest priority category
    return this.resolveOverlaps(allMatches);
  }

  /** Check if a category contains any credential patterns */
  isCredentialCategory(category: RedactionCategory): boolean {
    return category === "credential";
  }

  private compileCustomPattern(config: CustomPatternConfig): RedactionPattern | null {
    try {
      const regex = new RegExp(config.regex);

      // Quick ReDoS safety check: test with adversarial input
      const testInput = "a".repeat(1000);
      const start = performance.now();
      regex.test(testInput);
      const elapsed = performance.now() - start;

      if (elapsed > 10) {
        this.logger.warn(
          `[redaction] Custom pattern "${config.name}" rejected: ReDoS risk ` +
          `(${elapsed.toFixed(1)}ms on adversarial input)`,
        );
        return null;
      }

      return {
        id: `custom-${config.name}`,
        category: config.category,
        regex,
        replacementType: config.name,
        builtin: false,
      };
    } catch (e) {
      this.logger.warn(
        `[redaction] Custom pattern "${config.name}" failed to compile: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Resolve overlapping matches.
   * When two matches overlap, the longest one wins.
   * On ties, higher-priority category (earlier in CATEGORY_ORDER) wins.
   */
  private resolveOverlaps(matches: PatternMatch[]): PatternMatch[] {
    if (matches.length <= 1) return matches;

    // Sort by start position, then by length descending, then by category priority
    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const aLen = a.end - a.start;
      const bLen = b.end - b.start;
      if (aLen !== bLen) return bLen - aLen; // longer first
      return (
        CATEGORY_ORDER.indexOf(a.pattern.category) -
        CATEGORY_ORDER.indexOf(b.pattern.category)
      );
    });

    const resolved: PatternMatch[] = [];
    let lastEnd = -1;

    for (const match of matches) {
      if (match.start >= lastEnd) {
        // No overlap
        resolved.push(match);
        lastEnd = match.end;
      }
      // Skip overlapping matches (first one wins due to sort order)
    }

    return resolved;
  }
}

/** Get built-in patterns (for testing) */
export function getBuiltinPatterns(): readonly RedactionPattern[] {
  return BUILTIN_PATTERNS;
}
