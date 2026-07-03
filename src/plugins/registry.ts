/**
 * Plugin Registry
 * 
 * Discovers, registers, and routes tasks to agent plugins.
 */

import type {
  AgentPlugin,
  AgentCapability,
  AgentTask,
  AgentResult,
  PluginsConfig,
  RoutingStrategy,
} from "./types.ts";

export class PluginRegistry {
  private plugins = new Map<string, AgentPlugin>();
  private config: PluginsConfig;

  constructor(config: PluginsConfig) {
    this.config = config;
  }

  /**
   * Register an agent plugin
   */
  register(plugin: AgentPlugin): void {
    const pluginConfig = this.config.plugins[plugin.name];
    if (!pluginConfig || !pluginConfig.enabled) {
      return; // Plugin disabled in config
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Discover all installed agents
   */
  async discoverInstalled(): Promise<AgentPlugin[]> {
    const available: AgentPlugin[] = [];
    
    for (const plugin of this.plugins.values()) {
      try {
        if (await plugin.isInstalled()) {
          available.push(plugin);
        }
      } catch (err) {
        console.error(`Failed to check ${plugin.name}:`, err);
      }
    }
    
    return available;
  }

  /**
   * Get a specific plugin by name
   */
  getPlugin(name: string): AgentPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Route a task to the best available agent
   */
  async routeTask(task: AgentTask): Promise<{ plugin: AgentPlugin; reason: string }> {
    const routing = this.config.routing;
    const installed = await this.discoverInstalled();

    if (installed.length === 0) {
      throw new Error("No agent plugins installed");
    }

    // 1. Check custom routing rules (sort a copy — never mutate shared config)
    if (routing.rules) {
      const sortedRules = [...routing.rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
      for (const rule of sortedRules) {
        let matches = false;
        try {
          matches = new RegExp(rule.pattern, "i").test(task.prompt);
        } catch {
          continue; // skip rules with invalid regex patterns
        }
        if (matches) {
          const plugin = this.plugins.get(rule.agent);
          if (plugin && installed.includes(plugin)) {
            return { plugin, reason: `matched rule: ${rule.pattern}` };
          }
        }
      }
    }

    // 2. Try preferred agent
    if (routing.prefer) {
      const preferred = this.plugins.get(routing.prefer);
      if (preferred && installed.includes(preferred)) {
        return { plugin: preferred, reason: "preferred agent" };
      }
    }

    // 3. Route by capability
    if (routing.routeByCapability) {
      const capabilities = this.inferCapabilities(task.prompt);
      if (capabilities.length > 0) {
        const match = this.findBestByCapability(capabilities, installed);
        if (match) {
          return { plugin: match, reason: `best for: ${capabilities.join(", ")}` };
        }
      }
    }

    // 4. Fallback chain
    if (routing.fallback) {
      for (const name of routing.fallback) {
        const plugin = this.plugins.get(name);
        if (plugin && installed.includes(plugin)) {
          return { plugin, reason: "fallback" };
        }
      }
    }

    // 5. Use first available
    return { plugin: installed[0], reason: "first available" };
  }

  /**
   * Infer task capabilities from prompt text
   */
  private inferCapabilities(prompt: string): AgentCapability[] {
    const capabilities: AgentCapability[] = [];
    const lower = prompt.toLowerCase();

    if (/review|audit|check|analyze/.test(lower)) {
      capabilities.push("code-review");
    }
    if (/refactor|restructure|reorganize/.test(lower)) {
      capabilities.push("refactoring");
    }
    if (/fix|bug|issue|error/.test(lower)) {
      capabilities.push("bug-fixing");
    }
    if (/test|spec|coverage/.test(lower)) {
      capabilities.push("testing");
    }
    if (/feature|add|build|create/.test(lower)) {
      capabilities.push("feature-dev");
    }
    if (/document|readme|comment|explain/.test(lower)) {
      capabilities.push("documentation");
    }
    if (/debug|trace|diagnose/.test(lower)) {
      capabilities.push("debugging");
    }
    if (/optimize|performance|speed|memory/.test(lower)) {
      capabilities.push("optimization");
    }

    return capabilities;
  }

  /**
   * Find agent with best capability match
   */
  private findBestByCapability(
    capabilities: AgentCapability[],
    available: AgentPlugin[]
  ): AgentPlugin | undefined {
    let bestMatch: AgentPlugin | undefined;
    let bestScore = 0;

    for (const plugin of available) {
      const pluginConfig = this.config.plugins[plugin.name];
      
      // Calculate score based on capability overlap
      let score = capabilities.filter(cap => plugin.capabilities.includes(cap)).length;
      
      // Bonus for plugins configured as "preferred for" these capabilities
      if (pluginConfig.preferredFor) {
        const preferredOverlap = capabilities.filter(cap => 
          pluginConfig.preferredFor?.includes(cap)
        ).length;
        score += preferredOverlap * 2; // Double weight for explicit preferences
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = plugin;
      }
    }

    return bestMatch;
  }

  /**
   * Execute a task with automatic routing
   */
  async execute(task: AgentTask): Promise<AgentResult & { agent: string; routingReason: string }> {
    const { plugin, reason } = await this.routeTask(task);
    const result = await plugin.execute(task);
    
    return {
      ...result,
      agent: plugin.name,
      routingReason: reason,
    };
  }

  /**
   * Get plugin statistics
   */
  getStats(): Record<string, any> {
    return {
      registered: this.plugins.size,
      plugins: Array.from(this.plugins.values()).map(p => ({
        name: p.name,
        version: p.version,
        capabilities: p.capabilities,
        enabled: this.config.plugins[p.name]?.enabled ?? false,
      })),
    };
  }
}
