/**
 * Cube Protocol Ontology System
 *
 * Deterministic entity extraction and classification for task descriptions.
 * This creates the semantic structure that powers the skill graph.
 */

// ============================================
// ONTOLOGY DEFINITIONS
// ============================================

export const DOMAINS = {
  finance: ["financial", "finance", "accounting", "revenue", "profit", "budget", "invoice", "payment", "tax", "audit", "quarterly", "earnings", "stock", "investment", "portfolio"],
  legal: ["legal", "contract", "compliance", "regulation", "law", "attorney", "clause", "agreement", "liability", "patent", "trademark", "litigation"],
  research: ["research", "study", "analysis", "investigate", "survey", "academic", "paper", "journal", "hypothesis", "experiment", "data"],
  engineering: ["code", "software", "programming", "develop", "build", "engineer", "api", "database", "system", "architecture", "deploy", "debug", "test"],
  healthcare: ["medical", "health", "patient", "clinical", "diagnosis", "treatment", "pharmaceutical", "drug", "hospital", "doctor"],
  marketing: ["marketing", "campaign", "brand", "advertise", "social media", "seo", "content", "audience", "engagement", "conversion"],
  operations: ["operations", "logistics", "supply chain", "inventory", "process", "workflow", "efficiency", "automation"],
  general: [] // Fallback
} as const;

export const TASK_TYPES = {
  extraction: ["extract", "parse", "pull", "retrieve", "scrape", "gather", "collect", "obtain", "get"],
  analysis: ["analyze", "analyse", "examine", "evaluate", "assess", "review", "investigate", "study", "compare"],
  summarization: ["summarize", "summarise", "condense", "digest", "brief", "overview", "synopsis", "abstract", "tldr"],
  generation: ["generate", "create", "write", "compose", "produce", "draft", "author", "make"],
  transformation: ["transform", "convert", "translate", "format", "restructure", "reformat", "migrate"],
  validation: ["validate", "verify", "check", "confirm", "audit", "ensure", "test"],
  classification: ["classify", "categorize", "sort", "organize", "label", "tag", "group"],
  prediction: ["predict", "forecast", "estimate", "project", "anticipate"]
} as const;

export const ARTIFACT_TYPES = {
  pdf: ["pdf", "document", "report", "paper"],
  spreadsheet: ["spreadsheet", "excel", "csv", "sheet", "table", "xlsx"],
  code: ["code", "script", "program", "repository", "github", "codebase"],
  image: ["image", "photo", "picture", "screenshot", "diagram", "chart"],
  video: ["video", "recording", "footage", "clip"],
  audio: ["audio", "recording", "podcast", "transcript"],
  text: ["text", "article", "blog", "post", "email", "message"],
  data: ["data", "json", "xml", "api", "dataset", "database"]
} as const;

export const COMPLEXITY_INDICATORS = {
  high: ["complex", "comprehensive", "detailed", "thorough", "extensive", "deep", "advanced", "multiple", "all", "entire"],
  low: ["simple", "basic", "quick", "brief", "single", "one", "easy"],
  medium: [] // Default
} as const;

// ============================================
// TYPES
// ============================================

export interface ExtractedOntology {
  domain: string;
  taskType: string;
  artifactType: string | null;
  complexity: "low" | "medium" | "high";
  entities: string[];
  confidence: number;
  keywords: {
    domain: string[];
    taskType: string[];
    artifactType: string[];
  };
}

// ============================================
// EXTRACTION FUNCTIONS
// ============================================

/**
 * Tokenize and normalize text for matching
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Find matching keywords from a category
 */
function findMatches(tokens: string[], keywords: readonly string[]): string[] {
  const matches: string[] = [];
  const text = tokens.join(" ");

  for (const keyword of keywords) {
    if (keyword.includes(" ")) {
      // Multi-word keyword
      if (text.includes(keyword)) {
        matches.push(keyword);
      }
    } else {
      // Single word
      if (tokens.includes(keyword)) {
        matches.push(keyword);
      }
    }
  }

  return matches;
}

/**
 * Extract domain from task description
 */
function extractDomain(tokens: string[], text: string): { domain: string; matches: string[]; score: number } {
  let bestDomain = "general";
  let bestMatches: string[] = [];
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAINS)) {
    if (domain === "general") continue;

    const matches = findMatches(tokens, keywords);
    const score = matches.length;

    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
      bestMatches = matches;
    }
  }

  return { domain: bestDomain, matches: bestMatches, score: bestScore };
}

/**
 * Extract task type from description
 */
function extractTaskType(tokens: string[], text: string): { taskType: string; matches: string[]; score: number } {
  let bestType = "analysis"; // Default
  let bestMatches: string[] = [];
  let bestScore = 0;

  for (const [taskType, keywords] of Object.entries(TASK_TYPES)) {
    const matches = findMatches(tokens, keywords);
    const score = matches.length;

    if (score > bestScore) {
      bestScore = score;
      bestType = taskType;
      bestMatches = matches;
    }
  }

  return { taskType: bestType, matches: bestMatches, score: bestScore };
}

/**
 * Extract artifact type from description
 */
function extractArtifactType(tokens: string[], text: string): { artifactType: string | null; matches: string[] } {
  for (const [artifactType, keywords] of Object.entries(ARTIFACT_TYPES)) {
    const matches = findMatches(tokens, keywords);
    if (matches.length > 0) {
      return { artifactType, matches };
    }
  }

  return { artifactType: null, matches: [] };
}

/**
 * Determine task complexity
 */
function extractComplexity(tokens: string[]): "low" | "medium" | "high" {
  const highMatches = findMatches(tokens, COMPLEXITY_INDICATORS.high);
  const lowMatches = findMatches(tokens, COMPLEXITY_INDICATORS.low);

  if (highMatches.length > lowMatches.length) return "high";
  if (lowMatches.length > highMatches.length) return "low";
  return "medium";
}

/**
 * Extract named entities (simple noun extraction)
 */
function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // Extract quoted terms
  const quoted = text.match(/"([^"]+)"/g) || [];
  entities.push(...quoted.map(q => q.replace(/"/g, "")));

  // Extract capitalized terms (likely proper nouns)
  const capitalized = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  entities.push(...capitalized.filter(e => e.length > 2));

  // Extract terms with numbers (like Q4, 2024, etc)
  const numbered = text.match(/\b[A-Z]?\d+[A-Za-z]*\b/g) || [];
  entities.push(...numbered);

  // Dedupe
  return [...new Set(entities)].slice(0, 10);
}

/**
 * Calculate confidence score based on match quality
 */
function calculateConfidence(domainScore: number, taskScore: number, hasArtifact: boolean): number {
  const domainConf = Math.min(domainScore / 3, 1) * 0.4;
  const taskConf = Math.min(taskScore / 2, 1) * 0.4;
  const artifactConf = hasArtifact ? 0.2 : 0.1;

  return Math.round((domainConf + taskConf + artifactConf) * 100) / 100;
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extract ontology from task description
 *
 * This is DETERMINISTIC - same input always produces same output.
 * No LLM, no embeddings, just keyword matching.
 */
export function extractOntology(title: string, description: string): ExtractedOntology {
  const fullText = `${title} ${description}`;
  const tokens = tokenize(fullText);

  const domainResult = extractDomain(tokens, fullText);
  const taskResult = extractTaskType(tokens, fullText);
  const artifactResult = extractArtifactType(tokens, fullText);
  const complexity = extractComplexity(tokens);
  const entities = extractEntities(fullText);

  const confidence = calculateConfidence(
    domainResult.score,
    taskResult.score,
    artifactResult.artifactType !== null
  );

  return {
    domain: domainResult.domain,
    taskType: taskResult.taskType,
    artifactType: artifactResult.artifactType,
    complexity,
    entities,
    confidence,
    keywords: {
      domain: domainResult.matches,
      taskType: taskResult.matches,
      artifactType: artifactResult.matches,
    },
  };
}

// ============================================
// SIMILARITY CALCULATION
// ============================================

/**
 * Calculate ontology similarity between two tasks
 * Returns 0-1 score
 */
export function calculateOntologySimilarity(
  ontology1: ExtractedOntology,
  ontology2: ExtractedOntology
): number {
  let score = 0;

  // Domain match (40% weight)
  if (ontology1.domain === ontology2.domain) {
    score += 0.4;
  } else if (ontology1.domain === "general" || ontology2.domain === "general") {
    score += 0.1; // Partial credit for general
  }

  // Task type match (35% weight)
  if (ontology1.taskType === ontology2.taskType) {
    score += 0.35;
  }

  // Artifact type match (15% weight)
  if (ontology1.artifactType && ontology2.artifactType) {
    if (ontology1.artifactType === ontology2.artifactType) {
      score += 0.15;
    }
  } else if (!ontology1.artifactType && !ontology2.artifactType) {
    score += 0.075; // Both unspecified
  }

  // Entity overlap (10% weight)
  const entities1 = new Set(ontology1.entities.map(e => e.toLowerCase()));
  const entities2 = new Set(ontology2.entities.map(e => e.toLowerCase()));
  const intersection = [...entities1].filter(e => entities2.has(e));
  const union = new Set([...entities1, ...entities2]);

  if (union.size > 0) {
    const jaccard = intersection.length / union.size;
    score += jaccard * 0.1;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Check if an ontology matches required criteria
 */
export function ontologyMatches(
  agentOntology: { domain: string; taskType: string; artifactType?: string | null },
  taskOntology: ExtractedOntology
): { matches: boolean; score: number } {
  let score = 0;

  // Domain must match or be general
  if (agentOntology.domain === taskOntology.domain) {
    score += 1.0;
  } else if (agentOntology.domain === "general") {
    score += 0.3;
  } else {
    return { matches: false, score: 0 };
  }

  // Task type match
  if (agentOntology.taskType === taskOntology.taskType) {
    score += 0.5;
  } else {
    score += 0.1; // Some credit for domain match
  }

  // Artifact type bonus
  if (agentOntology.artifactType && taskOntology.artifactType) {
    if (agentOntology.artifactType === taskOntology.artifactType) {
      score += 0.3;
    }
  }

  return { matches: score >= 1.0, score: Math.min(score, 1.8) };
}
