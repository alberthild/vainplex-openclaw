# Architecture: @vainplex/openclaw-knowledge-engine

## 1. Overview and Scope

`@vainplex/openclaw-knowledge-engine` is a TypeScript-based OpenClaw plugin for real-time and batch knowledge extraction from conversational data. It replaces a collection of legacy Python scripts with a unified, modern, and tightly integrated solution.

The primary goal of this plugin is to identify, extract, and store key information (entities and facts) from user and agent messages. This knowledge is then made available for long-term memory, context enrichment, and improved agent performance. It operates directly within the OpenClaw event pipeline, eliminating the need for external NATS consumers and schedulers.

### 1.1. Core Features

- **Hybrid Entity Extraction:** Combines high-speed, low-cost regex extraction with optional, high-fidelity LLM-based extraction.
- **Structured Fact Store:** Manages a durable store of facts with metadata, relevance scoring, and a temporal decay mechanism.
- **Seamless Integration:** Hooks directly into OpenClaw's lifecycle events (`message_received`, `message_sent`, `session_start`).
- **Configurable & Maintainable:** All features are configurable via a JSON schema, and the TypeScript codebase ensures type safety and maintainability.
- **Zero Runtime Dependencies:** Relies only on Node.js built-in APIs, mirroring the pattern of `@vainplex/openclaw-cortex`.
- **Optional Embeddings:** Can integrate with ChromaDB for semantic search over extracted facts.

### 1.2. Out of Scope

- **TypeDB Integration:** The legacy TypeDB dependency is explicitly removed and will not be supported.
- **Direct NATS Consumption:** The plugin relies on OpenClaw hooks, not direct interaction with NATS streams.
- **UI/Frontend:** This plugin is purely a backend data processing engine.

---

## 2. Module Breakdown

The plugin will be structured similarly to `@vainplex/openclaw-cortex`, with a clear separation of concerns between modules. All source code will reside in the `src/` directory.

| File                  | Responsibility                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | Plugin entry point. Registers hooks, commands, and performs initial configuration validation.                  |
| `src/hooks.ts`        | Main integration logic. Registers and orchestrates all OpenClaw hook handlers. Manages shared state.           |
| `src/types.ts`        | Centralized TypeScript type definitions for configuration, entities, facts, and API interfaces.                  |
| `src/config.ts`       | Provides functions for resolving and validating the plugin's configuration from `openclaw.plugin.json`.        |
| `src/storage.ts`      | Low-level file I/O utilities for reading/writing JSON files, ensuring atomic writes and handling debouncing.     |
| `src/entity-extractor.ts`| Implements the entity extraction pipeline. Contains the `EntityExtractor` class.                               |
| `src/fact-store.ts`   | Implements the fact storage and retrieval logic. Contains the `FactStore` class, including decay logic.        |
| `src/llm-enhancer.ts` | Handles communication with an external LLM (e.g., Ollama) for batched, deep extraction of entities and facts. |
| `src/embeddings.ts`   | Manages optional integration with ChromaDB, including batching and syncing embeddings.                       |
| `src/maintenance.ts`  | Encapsulates background tasks like fact decay and embeddings sync, triggered by an internal timer.           |
| `src/patterns.ts`     | Stores default regex patterns for common entities (dates, names, locations, etc.).                             |

---

## 3. Type Definitions

Located in `src/types.ts`.

```typescript
// src/types.ts

/**
 * The public API exposed by the OpenClaw host to the plugin.
 */
export interface OpenClawPluginApi {
  pluginConfig: Record<string, unknown>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  on: (event: string, handler: (event: HookEvent, ctx: HookContext) => void, options?: { priority: number }) => void;
}

export interface HookEvent {
  content?: string;
  message?: string;
  text?: string;
  from?: string;
  sender?: string;
  role?: "user" | "assistant";
  [key: string]: unknown;
}

export interface HookContext {
  workspace: string; // Absolute path to the OpenClaw workspace
}

/**
 * Plugin configuration schema, validated from openclaw.plugin.json.
 */
export interface KnowledgeConfig {
  enabled: boolean;
  workspace: string;
  extraction: {
    regex: {
      enabled: boolean;
    };
    llm: {
      enabled: boolean;
      model: string;
      endpoint: string;
      batchSize: number;
      cooldownMs: number;
    };
  };
  decay: {
    enabled: boolean;
    intervalHours: number;
    rate: number; // e.g., 0.05 for 5% decay per interval
  };
  embeddings: {
    enabled: boolean;
    endpoint: string;
    syncIntervalMinutes: number;
    collectionName: string;
  };
  storage: {
    maxEntities: number;
    maxFacts: number;
    writeDebounceMs: number;
  };
}

/**
 * Represents an extracted entity.
 */
export interface Entity {
  id: string; // e.g., "person:claude"
  type: "person" | "location" | "organization" | "date" | "product" | "concept" | "unknown";
  value: string; // The canonical value, e.g., "Claude"
  mentions: string[]; // Different ways it was mentioned, e.g., ["claude", "Claude's"]
  count: number;
  importance: number; // 0.0 to 1.0
  lastSeen: string; // ISO 8601 timestamp
  source: ("regex" | "llm")[];
}

/**
 * Represents a structured fact.
 */
export interface Fact {
  id: string; // UUID v4
  subject: string; // Entity ID
  predicate: string; // e.g., "is-a", "has-property", "works-at"
  object: string; // Entity ID or literal value
  relevance: number; // 0.0 to 1.0, subject to decay
  createdAt: string; // ISO 8601 timestamp
  lastAccessed: string; // ISO 8601 timestamp
  source: "ingested" | "extracted-regex" | "extracted-llm";
}

/**
 * Data structure for entities.json
 */
export interface EntitiesData {
  updated: string;
  entities: Entity[];
}

/**
 * Data structure for facts.json
 */
export interface FactsData {
  updated: string;
  facts: Fact[];
}
```

---

## 4. Hook Integration Points

The plugin will register handlers for the following OpenClaw core events:

| Hook Event         | Priority | Handler Logic                                                                                                                                                             |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message_received` | 100      | - Triggers the real-time entity extraction pipeline. <br> - Extracts content and sender. <br> - Adds the message to the `LlmEnhancer` batch if LLM is enabled.               |
| `message_sent`     | 100      | - Same as `message_received`. Ensures the agent's own messages are processed for knowledge.                                                                               |
| `session_start`    | 200      | - Initializes the `Maintenance` service. <br> - Starts the internal timers for fact decay and embeddings sync. <br> - Ensures workspace directories exist.                |

---

## 5. Entity Extraction Pipeline

The extraction process runs on every message and is designed to be fast and efficient.

### 5.1. Regex Extraction

- **Always On (if enabled):** Runs first on every message.
- **Patterns:** A configurable set of regular expressions will be defined in `src/patterns.ts`. These will cover common entities like dates (`YYYY-MM-DD`), email addresses, URLs, and potentially user-defined patterns.
- **Performance:** This step is extremely fast and has negligible overhead.
- **Output:** Produces a preliminary list of potential entities.

### 5.2. LLM Enhancement (Batched)

- **Optional:** Enabled via configuration.
- **Batching:** The `LlmEnhancer` class collects messages up to `batchSize` or until `cooldownMs` has passed since the last message. This avoids overwhelming the LLM with single requests.
- **Process:**
    1. A batch of messages is formatted into a single prompt.
    2. The prompt instructs the LLM to identify entities (person, location, etc.) and structured facts (triples like `Subject-Predicate-Object`).
    3. The request is sent to the configured LLM endpoint (`extraction.llm.endpoint`).
    4. The LLM's JSON response is parsed.
- **Merging:** LLM-extracted entities are merged with the regex-based results. The `source` array on the `Entity` object is updated to reflect that it was identified by both methods. LLM results are generally given a higher initial `importance` score.

---

## 6. Fact Store Design

The `FactStore` class manages the `facts.json` file, providing an in-memory cache and methods for interacting with facts.

### 6.1. Data Structure (`facts.json`)

The file will contain a `FactsData` object:

```json
{
  "updated": "2026-02-17T15:30:00Z",
  "facts": [
    {
      "id": "f0a4c1b0-9b1e-4b7b-8f3a-0e9c8d7b6a5a",
      "subject": "person:atlas",
      "predicate": "is-a",
      "object": "sub-agent",
      "relevance": 0.95,
      "createdAt": "2026-02-17T14:00:00Z",
      "lastAccessed": "2026-02-17T15:20:00Z",
      "source": "extracted-llm"
    }
  ]
}
```

### 6.2. `FactStore` Class API

```typescript
// src/fact-store.ts
class FactStore {
  constructor(workspace: string, config: KnowledgeConfig['storage'], logger: Logger);

  // Load facts from facts.json into memory
  load(): Promise<void>;

  // Add a new fact or update an existing one
  addFact(fact: Omit<Fact, 'id' | 'createdAt' | 'lastAccessed'>): Fact;

  // Retrieve a fact by its ID
  getFact(id: string): Fact | undefined;

  // Query facts based on subject, predicate, or object
  query(query: { subject?: string; predicate?: string; object?: string }): Fact[];

  // Run the decay algorithm on all facts
  decayFacts(rate: number): { decayedCount: number };

  // Persist the in-memory store to disk (debounced)
  commit(): Promise<void>;
}
```

### 6.3. Storage and Persistence

- **Debounced Writes:** All modifications to the fact store will trigger a debounced `commit()` call. This ensures that rapid, successive writes (e.g., during a fast-paced conversation) are batched into a single file I/O operation, configured by `storage.writeDebounceMs`.
- **Atomic Writes:** The `storage.ts` module will use a "write to temp file then rename" strategy to prevent data corruption if the application terminates mid-write.

---

## 7. Decay Algorithm

The decay algorithm prevents the fact store from becoming cluttered with stale, irrelevant information. It is managed by the `Maintenance` service.

- **Trigger:** Runs on a schedule defined by `decay.intervalHours`.
- **Logic:** For each fact, the relevance score is reduced by the `decay.rate`.
  ```
  newRelevance = currentRelevance * (1 - decayRate)
  ```
- **Floor:** Relevance will not decay below a certain floor (e.g., 0.1) to keep it in the system.
- **Promotion:** When a fact is "accessed" (e.g., used to answer a question or mentioned again), its `relevance` score is boosted, and its `lastAccessed` timestamp is updated. A simple boost could be `newRelevance = currentRelevance + (1 - currentRelevance) * 0.5`, pushing it halfway to 1.0.
- **Pruning:** Facts with a relevance score below a configurable threshold (e.g., 0.05) after decay might be pruned from the store entirely if `storage.maxFacts` is exceeded.

---

## 8. Embeddings Integration

This feature allows for semantic querying of facts and is entirely optional.

### 8.1. `Embeddings` Service

- **Trigger:** Runs on a schedule defined by `embeddings.syncIntervalMinutes`.
- **Process:**
    1. The service scans `facts.json` for any facts that have not yet been embedded.
    2. It formats each fact into a natural language string, e.g., "Atlas is a sub-agent."
    3. It sends a batch of these strings to a ChromaDB-compatible vector database via its HTTP API.
    4. The fact's ID is stored as metadata alongside the vector in ChromaDB.
- **Configuration:** The `embeddings.endpoint` must be a valid URL to the ChromaDB `/api/v1/collections/{name}/add` endpoint.
- **Decoupling:** The plugin does **not** query ChromaDB. Its only responsibility is to push embeddings. Other plugins or services would be responsible for leveraging the vector store for retrieval-augmented generation (RAG).

---

## 9. Config Schema

The full `openclaw.plugin.json` schema for this plugin.

```json
{
  "id": "@vainplex/openclaw-knowledge-engine",
  "config": {
    "enabled": true,
    "workspace": "~/.clawd/plugins/knowledge-engine",
    "extraction": {
      "regex": {
        "enabled": true
      },
      "llm": {
        "enabled": true,
        "model": "mistral:7b",
        "endpoint": "http://localhost:11434/api/generate",
        "batchSize": 10,
        "cooldownMs": 30000
      }
    },
    "decay": {
      "enabled": true,
      "intervalHours": 24,
      "rate": 0.02
    },
    "embeddings": {
      "enabled": false,
      "endpoint": "http://localhost:8000/api/v1/collections/facts/add",
      "collectionName": "openclaw-facts",
      "syncIntervalMinutes": 15
    },
    "storage": {
      "maxEntities": 5000,
      "maxFacts": 10000,
      "writeDebounceMs": 15000
    }
  }
}
```

---

## 10. Test Strategy

Testing will be comprehensive and follow the patterns of `@vainplex/openclaw-cortex`, using Node.js's built-in test runner.

- **Unit Tests:** Each class (`EntityExtractor`, `FactStore`, `LlmEnhancer`, etc.) will have its own test file (e.g., `fact-store.test.ts`). Tests will use mock objects for dependencies like the logger and file system.
- **Integration Tests:** `hooks.test.ts` will test the end-to-end flow by simulating OpenClaw hook events and asserting that the correct file system changes occur.
- **Configuration Tests:** `config.test.ts` will verify that default values are applied correctly and that invalid configurations are handled gracefully.
- **CI/CD:** Tests will be run automatically in a CI pipeline on every commit.

---

## 11. Migration Guide

This section outlines the process for decommissioning the old Python scripts and migrating to the new plugin.

1.  **Disable Old Services:** Stop and disable the `systemd` services and timers for `entity-extractor-stream.py`, `smart-extractor.py`, `knowledge-engine.py`, and `cortex-loops-stream.py`.
    ```bash
    systemctl stop entity-extractor-stream.service smart-extractor.timer knowledge-engine.service cortex-loops.timer
    systemctl disable entity-extractor-stream.service smart-extractor.timer knowledge-engine.service cortex-loops.timer
    ```

2.  **Install the Plugin:** Install the `@vainplex/openclaw-knowledge-engine` plugin into OpenClaw according to standard procedures.

3.  **Configure the Plugin:** Create a configuration file at `~/.clawd/plugins/openclaw-knowledge-engine.json` (or the equivalent path) using the schema from section 9. Ensure the `workspace` directory is set to the desired location.

4.  **Data Migration (Optional):**
    - **Entities:** A one-time script (`./scripts/migrate-entities.js`) will be provided to convert the old `~/.cortex/knowledge/entities.json` format to the new `Entity` format defined in `src/types.ts`.
    - **Facts:** As the old `knowledge-engine.py` had a different structure and no durable fact store equivalent to `facts.json`, facts will not be migrated. The system will start with a fresh fact store.
    - **TypeDB:** No migration from TypeDB will be provided.

5.  **Enable and Restart:** Enable the plugin in OpenClaw's main configuration and restart the OpenClaw instance. Monitor the logs for successful initialization.

---

## 12. Performance Requirements

- **Message Hook Overhead:** The synchronous part of the message hook (regex extraction) must complete in under **5ms** on average to avoid delaying the message processing pipeline.
- **LLM Latency:** LLM processing is asynchronous and batched, so it does not block the main thread. However, the total time to analyze a batch should be logged and monitored.
- **Memory Usage:** The plugin's heap size should not exceed **100MB** under normal load, assuming the configured `maxEntities` and `maxFacts` limits.
- **CPU Usage:** Background maintenance tasks (decay, embeddings sync) should be staggered and have low CPU impact, consuming less than 5% of a single core while running.
