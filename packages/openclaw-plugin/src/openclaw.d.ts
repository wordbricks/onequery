declare module "openclaw/plugin-sdk/plugin-entry" {
  interface PluginEntry {
    id: string;
    name: string;
    description: string;
    register(ctx: unknown): void | Promise<void>;
  }
  export function definePluginEntry(options: PluginEntry): PluginEntry;
}
