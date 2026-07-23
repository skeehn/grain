# grain Architecture

> **Historical narrative — do not treat as current.** Storage, provider, and
> qualification descriptions below predate schema-v3 run journals, per-session
> storage, subscription-CLI providers, and the durable work record.
>
> For how the system works today, read [`AGENTS.md`](./AGENTS.md) (the working
> contract), [`docs/wiki/architecture.md`](./docs/wiki/architecture.md)
> (generated from the code, with provenance), [`docs/DURABILITY.md`](./docs/DURABILITY.md),
> and [`docs/GRAIN-1.0-ROADMAP.md`](./docs/GRAIN-1.0-ROADMAP.md).

**Technical deep-dive into grain's self-improving AI agent system**

---

## 1. System Overview

grain is a self-improving coding agent built on five core subsystems:

```
┌─────────────────────────────────────────────────────────┐
│                     grain Agent                          │
├─────────────────────────────────────────────────────────┤
│  Agent Loop  │  Tools  │  Skills  │  Knowledge  │  LLMs │
│  (src/agent) │ (tools) │(skills) │  (engram)   │ (API) │
└─────────────────────────────────────────────────────────┘
```

**Core Flow:**
1. User prompt → Skills matcher (find relevant patterns)
2. Context tracker → Inject session + cross-session context
3. Agent loop → Plan → Execute → Verify → Learn
4. Knowledge graph → Extract entities + relationships
5. Skills manager → Save successful patterns

---

## 2. Key Components

### **src/agent/**
- **loop.ts** (438 LOC): Main execution loop with phases
  - UNDERSTAND: Load context, match skills, inject memory
  - PLAN: Generate step-by-step execution plan  
  - EXECUTE: Run tools, track results
  - VERIFY: Check outcomes
  - LEARN: Save to engram + skills

- **context-tracker.ts** (470 LOC): Session state management
  - Last modified/read files
  - Operation history
  - Project type detection
  - Cross-session context via engram

- **context.ts**: engram integration
  - Semantic search for relevant past learnings
  - Auto-store successful executions

### **src/tools/**
- **knowledge-graph.ts** (687 LOC): Deep codebase analysis
  - Entity extraction (functions, classes, types)
  - Relationship detection (calls, imports, extends, implements)
  - Multi-language (Rust, TypeScript, Go, Python)
  - Mermaid diagram generation

- **project-explainer.ts**: High-level architecture analysis
- **bash.ts**, **read.ts**, **write.ts**, **patch.ts**: File/shell operations
- **engram.ts**: Knowledge base integration
- **delegate.ts**: Sub-agent spawning

### **src/skills/**
- **types.ts** (119 LOC): Skill data structures
- **manager.ts** (352 LOC): Load, match, execute, track skills
  - Pattern matching (keywords, regex, semantic)
  - Confidence scoring
  - Success rate tracking
  - Auto-suggest on match

### **src/providers/**
- Multi-provider LLM support:
  - Bedrock (Claude Sonnet 4)
  - Anthropic (direct API)
  - OpenRouter (multi-model)
  - Ollama (local models)
- **router/index.ts**: Smart model selection by task complexity

---

## 3. Knowledge Graphs

### Entity Extraction

Supported entities:
- **Functions** (Rust, TypeScript, Go, Python)
- **Classes/Structs** (OOP + Rust)
- **Types/Interfaces** (TypeScript, Rust traits)
- **Modules** (crates, packages)
- **Enums/Constants**

### Relationship Detection (4 Types)

1. **imports** — Module dependencies (use, import statements)
2. **calls** — Function call graph (who calls whom)
3. **extends** — Class inheritance
4. **implements** — Interface/trait implementation

### Visualization

Two output formats:
- **ASCII**: Hierarchical text tree
- **Mermaid**: Interactive flowcharts
  - Color-coded nodes (functions=blue, classes=green, types=yellow)
  - Styled edges (calls=solid, imports=dashed, extends=thick)
  - Module subgraphs

### Real Project Results

| Project | Type | Entities | Relationships | Modules |
|---------|------|----------|---------------|---------|
| **engram** | Rust workspace | 196 | 0* | 10 crates |
| **ironrun** | Go CLI | 63 | 89 | 2 |
| **grain** | TypeScript | 124 | 233 | 8 |

\*Relationships are runtime data in engram (stored in sled KV)

---

## 4. Skills System

### Skill Structure

```json
{
  "id": "unique-id",
  "name": "Fix TypeScript Detection Bug",
  "description": "...",
  "pattern": {
    "keywords": ["typescript", "not detected"],
    "regex": ["typescript.*not (detected|found)"],
    "semantic": "TypeScript files not being recognized"
  },
  "approach": "1. Check detection logic\n2. Add .ts check...",
  "code": ["// Fix pattern:", "if (files.some(f => f.endsWith('.ts')))..."],
  "examples": [{
    "problem": "...",
    "execution": "...",
    "outcome": "Fixed! 2→5 entities"
  }],
  "metadata": {
    "success_rate": 1.0,
    "times_used": 1,
    "avg_execution_time_seconds": 180
  }
}
```

### Pattern Matching

Three match strategies:
1. **Keywords**: Simple keyword presence scoring
2. **Regex**: Pattern matching on user input
3. **Semantic**: (Future) Embedding similarity

**Confidence threshold:** 0.6 (60% match required)

### Lifecycle

1. **Match**: User prompt → SkillManager.matchSkills()
2. **Suggest**: Display 💡 icon + top 3 matches
3. **Inject**: Add to system prompt before planning
4. **Execute**: Agent uses skill approach + code
5. **Track**: Update success rate, usage count

---

## 5. Self-Improvement Mechanism

### The Loop

```
grain solves problem
  ↓
Success detected (tool output, tests pass)
  ↓
Extract approach + code patterns
  ↓
Save as skill to ~/.grain/skills/
  ↓
Future similar problem
  ↓
Match skill (75%+ confidence)
  ↓
Suggest skill to agent
  ↓
Agent applies proven approach
  ↓
Faster, more accurate solution
  ↓
Update skill metadata (success_rate, times_used)
  ↓
REPEAT (compounds exponentially)
```

### Proven 4X Today

| # | Improvement | Input → Output |
|---|-------------|----------------|
| **1** | Import tracking | 0 → 25 relationships |
| **2** | Function calls | 25 → 233 relationships |
| **3** | Bug fix + cleanup | 2 → 5 entities |
| **4** | Inheritance detection | 0 → 6 extends/implements |

**Each improvement made the next easier and faster.**

### Why It Works

1. **Concrete Patterns**: Skills encode actual code, not just instructions
2. **Real Examples**: Each skill includes successful execution history
3. **Confidence Scoring**: Only suggest high-confidence matches
4. **Metadata Tracking**: Success rate improves skill ranking over time
5. **Cross-Session**: Skills persist across all grain runs

---

## 6. Data Flow

### Write Path (Learning)

```
User Prompt
  ↓
Skills Matcher → Find relevant skills (0.6+ confidence)
  ↓
Context Tracker → Inject session state + file history
  ↓
engram Retrieve → Search past learnings
  ↓
Agent Loop → PLAN phase
  ↓
Tool Execution → bash, read, write, KG extraction
  ↓
Verify Results → Check outcomes
  ↓
engram Store → Save successful execution
  ↓
(If novel solution) → SkillManager.createSkill()
  ↓
~/.grain/skills/*.json
```

### Read Path (Retrieval)

```
User Prompt
  ↓
SkillManager.matchSkills(prompt)
  ↓
For each skill in ~/.grain/skills/:
  - Keyword scoring
  - Regex matching
  - (Future) Semantic similarity
  ↓
Return SkillMatch[] sorted by confidence
  ↓
Inject top 3 into system prompt
  ↓
Agent sees: approach, code patterns, examples
  ↓
Agent applies learned solution
```

### Context Injection

```
Session Context (context-tracker.ts):
- Last 10 files touched
- Operation history
- Project type
- Current module

Cross-Session Context (engram):
- Semantic search on user prompt
- Top 8 relevant past learnings

Skills (if matched):
- Approach (step-by-step)
- Code patterns
- Example executions

→ All injected into system prompt before planning
```

---

## 7. Future Roadmap

### Near-Term (Weeks 1-4)

- **Enhanced Learning**
  - Auto-detect success (tests pass, code compiles)
  - Auto-save skills without user prompt
  - Skill refinement (update on repeated use)

- **More Languages**
  - Full Python support
  - Java/Kotlin
  - C/C++/Rust generics

- **Performance**
  - Cache knowledge graphs (git hash keyed)
  - Parallel tool execution
  - Streaming knowledge graph extraction

### Medium-Term (Months 2-3)

- **cilow Integration**
  - Use Cilow's DualEdgeVamana for skill matching
  - 1472D composite embeddings for semantic similarity
  - Lane Equivalence for skill clustering

- **Advanced Skills**
  - Skill composition (combine multiple skills)
  - Skill parameters (templated approaches)
  - Skill conflict detection

- **Multi-Agent**
  - Skill-specific sub-agents
  - Parallel execution with skill distribution
  - Cross-agent skill sharing

### Long-Term (Months 4-6)

- **Self-Curation**
  - Automatically merge similar skills
  - Deprecate low-success-rate skills
  - Discover skill prerequisites

- **Continuous Learning**
  - Online learning from every execution
  - A/B test skill variations
  - Feedback loop from user corrections

- **Community Skills**
  - Public skill registry
  - Skill marketplace
  - Upvoting/rating system

---

## Technical Stack

- **Runtime**: Bun (TypeScript)
- **LLMs**: Claude Sonnet 4, multi-provider support
- **Knowledge Base**: engram (Rust, sled KV, Tantivy FTS)
- **Session Store**: SQLite
- **Analysis**: Regex + heuristic parsing (tree-sitter future)
- **Visualization**: Mermaid, ASCII art

---

## Key Innovations

1. **Self-Improvement That Works**
   - 4x proven improvements in one day
   - Concrete skills with code patterns
   - Cross-session persistence

2. **Knowledge Graphs for Code**
   - 196 entities from real Rust workspace
   - 4 relationship types
   - Multi-language support

3. **Context-Aware Suggestions**
   - Pattern matching finds relevant skills
   - Confidence scoring prevents false positives
   - Real examples guide execution

4. **Exponential Compounding**
   - Each skill makes future work faster
   - Skills improve with use
   - Learning accelerates over time

---

## Architecture Principles

1. **Modular**: Clean separation (agent, tools, skills, providers)
2. **Extensible**: New tools/skills/languages plug in easily
3. **Observable**: Track everything (context, skills, success rates)
4. **Persistent**: Sessions + skills survive restarts
5. **Self-Improving**: Every execution is a learning opportunity

---

**grain isn't just a coding agent—it's a learning system that compounds its capabilities exponentially.** 🌾🚀
