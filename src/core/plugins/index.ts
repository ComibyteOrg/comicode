export {
  findManifestPath,
  loadManifestFile,
  MANIFEST_FILENAMES,
  parseManifest,
  PluginManifestError,
  PluginManifestSchema,
  type PluginCommand,
  type PluginManifest,
  type PluginMcpServer,
  type PluginSkill,
  type PluginToolDescriptor,
} from './manifest.js';

export {
  findLoadedPlugin,
  getPluginCommands,
  getPluginMcpServers,
  getPluginSkills,
  getPluginTools,
  loadPlugins,
  type LoadedPlugin,
  type LoadPluginsOptions,
  type PluginSlashCommand,
  type PluginSourceScope,
} from './loader.js';

export {
  getPluginInfo,
  installPlugin,
  listPlugins,
  removePlugin,
  type InstallResult,
} from './install.js';
