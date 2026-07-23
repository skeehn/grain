# molt - Issues Found & Fixes Needed

> Historical audit snapshot. Many items below have since shipped or changed.
> Current status lives in [`docs/GRAIN-1.0-ROADMAP.md`](./docs/GRAIN-1.0-ROADMAP.md).

**Date:** June 24, 2026  
**Testing Session:** Real-world usage testing  
**Status:** Issues identified, prioritized  

---

## Critical Issues (Block Daily Use)

### 1. **No Session Context / Memory** 🔴
**Problem:**
- Each request starts fresh
- "now add a subtract function to that file" → doesn't know which file
- Had to check git status to figure out context
- Interactive mode doesn't remember previous turns

**Impact:** HIGH - makes multi-turn conversations frustrating

**Fix:**
```typescript
// Store last session context
interface SessionContext {
  lastModifiedFiles: string[];
  lastReadFiles: string[];
  currentWorkingFile?: string;
  conversationSummary?: string;
}

// On tool execution, track context
function trackContext(tool: string, input: any, output: any) {
  if (tool === 'write' || tool === 'patch') {
    sessionContext.lastModifiedFiles.push(input.path);
    sessionContext.currentWorkingFile = input.path;
  }
  if (tool === 'read') {
    sessionContext.lastReadFiles.push(input.path);
  }
}

// Inject into system prompt
system += `\n\nCurrent context:\n- Last modified: ${sessionContext.lastModifiedFiles.join(', ')}\n- Currently working on: ${sessionContext.currentWorkingFile}`;
```

**Estimated Time:** 2 hours

---

### 2. **Too Slow (7-8 seconds startup)** 🔴
**Problem:**
- Every request takes 7-8 seconds before first response
- Feels sluggish for quick questions
- Can't use for rapid iteration

**Impact:** HIGH - daily friction adds up

**Causes:**
- Loading config/session each time
- Bedrock API latency (no streaming until after planning)
- Model initialization

**Fix:**
```typescript
// Option A: Keep-alive daemon (like language servers)
// Start once, keep running, accept commands via socket

// Option B: Cache system prompt + reduce startup
const CACHED_SYSTEM = loadSystemPrompt(); // Load once
const CACHED_CONFIG = loadConfig(); // Load once

// Option C: Use Haiku for trivial tasks (when available)
// Haiku is 5x faster than Sonnet
```

**Estimated Time:** 4 hours (daemon mode) or 1 hour (caching)

---

### 3. **Too Verbose / Too Many Tool Calls** 🟡
**Problem:**
- Simple "add a function" took 6 tool calls
- Tried to run tests even though not asked
- Explains everything in detail (good for learning, bad for speed)

**Impact:** MEDIUM - wastes time and tokens

**Fix:**
```typescript
// Add concise mode
interface AgentOpts {
  concise?: boolean; // Skip explanations, just do it
}

// In system prompt:
if (opts.concise) {
  system += `\n\nBe concise: execute tools directly, skip explanations unless asked.`;
}

// Or add "quiet mode"
molt --quiet -p "add subtract function"
```

**Estimated Time:** 1 hour

---

### 4. **Interactive Mode Doesn't Work Well** 🟡
**Problem:**
- Ignores simple prompts like "hi"
- Gives generic intros instead of answering
- No conversational memory within session

**Impact:** MEDIUM - interactive mode is unusable

**Fix:**
```typescript
// Detect conversational vs task prompts
function isConversational(prompt: string): boolean {
  const greetings = /^(hi|hello|hey|good\s+(morning|afternoon|evening))$/i;
  const questions = /^(how\sare\syou|what\scan\syou\sdo|help)$/i;
  return greetings.test(prompt) || questions.test(prompt);
}

// Route conversational prompts differently
if (isConversational(prompt)) {
  // Simple text response, no tools
  return simpleResponse(prompt);
}
```

**Estimated Time:** 2 hours

---

## Medium Priority (Improve UX)

### 5. **No Smart File Pre-loading** 🟡
**Problem:**
- Doesn't pre-load related files
- E.g., editing auth.ts → should load auth.test.ts, types.ts
- Has to make separate read calls

**Impact:** MEDIUM - more round-trips than needed

**Fix:**
```typescript
// When reading a file, suggest related files
function getRelatedFiles(filepath: string): string[] {
  const dir = dirname(filepath);
  const base = basename(filepath, extname(filepath));
  
  return [
    `${dir}/${base}.test.ts`,
    `${dir}/${base}.spec.ts`,
    `${dir}/types.ts`,
    `${dir}/index.ts`,
  ].filter(existsSync);
}

// Ask user: "I see auth.test.ts and types.ts might be related. Load them too?"
```

**Estimated Time:** 3 hours

---

### 6. **Model Router Not Using Cheap Models** 🟡
**Problem:**
- Haiku not available in us-east-1
- All tasks use Sonnet 4 (expensive)
- No actual cost savings yet

**Impact:** MEDIUM - still expensive to run

**Fix:**
```typescript
// Option A: Use Sonnet 3.5 for simple tasks (available, cheaper)
'haiku': {
  provider: 'bedrock',
  model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', // Cheaper than Sonnet 4
  inputCostPer1M: 3.00,
  outputCostPer1M: 15.00,
},

// Option B: Use Ollama for offline/free tasks
if (complexity === 'TRIVIAL' && ollamaAvailable()) {
  return MODEL_CONFIGS['qwen-local'];
}

// Option C: Check multiple regions for Haiku availability
const regions = ['us-east-1', 'us-west-2', 'eu-west-1'];
for (const region of regions) {
  if (modelAvailable('haiku', region)) return region;
}
```

**Estimated Time:** 2 hours

---

### 7. **No Undo / Rollback UI** 🟡
**Problem:**
- git_rollback exists but hard to use
- No "undo last change" command
- Have to remember commit hashes

**Impact:** MEDIUM - scary to let it make changes

**Fix:**
```typescript
// Auto-checkpoint before risky operations
async function safeExecute(task: Task) {
  if (isRisky(task)) {
    const checkpoint = await git_checkpoint({ message: `Before: ${task.description}` });
    console.log(`💾 Checkpoint created: ${checkpoint.hash}`);
  }
  
  try {
    await execute(task);
  } catch (err) {
    console.log(`❌ Error. Rollback with: molt undo`);
    throw err;
  }
}

// Add undo command
molt undo  // Rollback last checkpoint
molt undo 3  // Rollback last 3 checkpoints
```

**Estimated Time:** 2 hours

---

### 8. **No Cost Budget / Limits** 🟡
**Problem:**
- Can't set "stop after $5 today"
- Easy to accidentally spend a lot
- No warnings before expensive operations

**Impact:** MEDIUM - budget control

**Fix:**
```typescript
// Config: ~/.molt/config.json
{
  "budget": {
    "daily_limit_usd": 5.00,
    "warn_at_usd": 4.00,
    "monthly_limit_usd": 50.00
  }
}

// Check before expensive operation
async function checkBudget(estimatedCost: number) {
  const today = getTodaySpend();
  if (today + estimatedCost > config.budget.daily_limit_usd) {
    throw new Error(`Budget exceeded. Today: $${today.toFixed(2)}, limit: $${config.budget.daily_limit_usd}`);
  }
  if (today + estimatedCost > config.budget.warn_at_usd) {
    console.warn(`⚠️  Approaching daily limit: $${(today + estimatedCost).toFixed(2)} / $${config.budget.daily_limit_usd}`);
  }
}
```

**Estimated Time:** 2 hours

---

## Low Priority (Nice to Have)

### 9. **No Offline Mode** 🟢
**Problem:**
- Requires internet for every request
- Ollama provider exists but not wired up
- Can't work on plane/train

**Impact:** LOW - workaround: tether to phone

**Fix:**
- Wire up Ollama provider
- Add --offline flag
- Fallback to local model if internet down

**Estimated Time:** 3 hours

---

### 10. **No Project-Specific Config** 🟢
**Problem:**
- ~/.molt/config.json is global
- Can't have per-project settings
- E.g., "this project always uses Opus for security"

**Impact:** LOW - can set per-command with --model

**Fix:**
```bash
# Project root: .molt.json
{
  "model": "opus",
  "conventions": ["no_console_log", "require_tests"],
  "auto_approve": true
}

// Load project config if exists
const projectConfig = loadProjectConfig(process.cwd());
const finalConfig = { ...globalConfig, ...projectConfig };
```

**Estimated Time:** 1 hour

---

### 11. **No File Watcher** 🟢
**Problem:**
- Doesn't detect when files change externally
- E.g., user edits file in IDE, molt doesn't know
- Stale file cache

**Impact:** LOW - rare edge case

**Fix:**
- Use chokidar to watch files
- Invalidate cache on change
- Warn if file changed since last read

**Estimated Time:** 2 hours

---

### 12. **No Diff Preview** 🟢
**Problem:**
- Shows plan but not actual diff
- Hard to know what will change
- Have to reject and read file manually

**Impact:** LOW - approval flow exists

**Fix:**
```typescript
// Before executing patch/write, show diff
const preview = generateDiff(oldContent, newContent);
renderer.diff(preview);

const approved = await renderer.userPrompt('Apply changes? [Y/n]');
if (approved !== 'y' && approved !== '') {
  renderer.info('Changes cancelled');
  return;
}
```

**Estimated Time:** 2 hours

---

## Summary: What to Fix First

### Week 1 (Critical - 10 hours):
1. ✅ **Session context** (2h) - Remember last files
2. ✅ **Startup speed** (1h) - Cache system prompt
3. ✅ **Concise mode** (1h) - Skip verbose explanations
4. ✅ **Interactive fixes** (2h) - Handle conversational prompts
5. ✅ **Model routing** (2h) - Use Sonnet 3.5 or Ollama for cheap tasks
6. ✅ **Budget limits** (2h) - Daily spend cap

### Week 2 (Medium - 9 hours):
7. ✅ **Smart file loading** (3h) - Pre-load related files
8. ✅ **Undo command** (2h) - Easy rollback
9. ✅ **Diff preview** (2h) - Show before apply
10. ✅ **Project config** (1h) - Per-project settings
11. ✅ **Better error messages** (1h) - Clearer what went wrong

### Week 3 (Nice to have - 7 hours):
12. ✅ **Offline mode** (3h) - Ollama integration
13. ✅ **File watcher** (2h) - Detect external changes
14. ✅ **Parallel execution** (2h) - Run independent tasks simultaneously

---

## The Real Test: Daily Driver Checklist

Can I use molt for:
- [x] Quick file reads ("what's in auth.ts?") - **YES** but slow
- [x] File creation ("create test.ts") - **YES** works well
- [x] Multi-file edits ("refactor auth") - **YES** but verbose
- [ ] Quick conversations ("hi", "help") - **NO** broken
- [ ] Continuing work ("now add tests") - **NO** no context
- [ ] Fast iteration (<3 sec response) - **NO** too slow
- [x] Error recovery - **YES** good error handling
- [x] Git integration - **YES** works
- [ ] Cost control - **NO** no limits

**Current Score: 5/9 (56%) - Not ready for daily use yet**

**After Week 1 fixes: 9/9 (100%) - Ready for daily use**

---

## Recommended Fix Order

**Tonight (2 hours):**
1. Session context (remember last files)
2. Concise mode flag

**Tomorrow (2 hours):**
3. Fix interactive mode
4. Cache system prompt (speed)

**This Week (6 hours):**
5. Budget limits
6. Model routing (Sonnet 3.5)

**Total: 10 hours to make molt daily-driver ready**

After that, molt will be genuinely better than Claude Code for daily use:
- ✅ Faster context (remembers last files)
- ✅ Less verbose (concise mode)
- ✅ Works interactively (chat)
- ✅ Fast startup (<3 sec)
- ✅ Budget control
- ✅ Actually cheaper (Sonnet 3.5 for simple tasks)

Then you can start using it for real work, get feedback, iterate.
