import type { Command } from 'commander';
import {
  bold,
  danger,
  dim,
  jsonOut,
  printKeyValue,
  printSection,
  printTable,
  success,
  truncate,
  warning,
} from '../output.js';
import {
  getPluginCommands,
  getPluginInfo,
  getPluginMcpServers,
  getPluginSkills,
  getPluginTools,
  installPlugin,
  loadPlugins,
  removePlugin,
} from '../../core/plugins/index.js';

function formatScope(scope: string): string {
  return scope === 'project' ? warning('project') : dim('user');
}

export function registerPluginCommand(program: Command): void {
  const plugin = program.command('plugin').description('Install and manage ComiCode plugins');

  plugin
    .command('list')
    .alias('ls')
    .description('List discovered plugins (user and project)')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const warnings: string[] = [];
        const plugins = loadPlugins({ cwd: process.cwd(), onWarning: (m) => warnings.push(m) });
        if (options.json) {
          jsonOut({
            plugins: plugins.map((p) => ({
              id: p.id,
              version: p.manifest.version,
              description: p.manifest.description ?? null,
              scope: p.scope,
              root: p.root,
              manifestPath: p.manifestPath,
              commands: p.manifest.commands?.length ?? 0,
              skills: p.manifest.skills?.length ?? 0,
              tools: p.manifest.tools?.length ?? 0,
              mcpServers: p.manifest.mcpServers?.length ?? 0,
            })),
            warnings,
          });
          return;
        }
        for (const message of warnings) console.log(`${warning('!')} ${message}`);
        printSection(`Plugins (${plugins.length})`);
        if (plugins.length === 0) {
          console.log(dim('No plugins found. Install with: comicode plugin install <path-or-git-url>'));
          console.log(dim('User plugins directory: <comicode home>/plugins  •  Project: .comicode/plugins'));
          return;
        }
        printTable(
          ['Name', 'Version', 'Scope', 'Provides', 'Description'],
          plugins.map((p) => [
            p.id,
            p.manifest.version,
            formatScope(p.scope),
            `${p.manifest.commands?.length ?? 0} cmd / ${p.manifest.skills?.length ?? 0} skill / ${p.manifest.tools?.length ?? 0} tool / ${p.manifest.mcpServers?.length ?? 0} mcp`,
            truncate(p.manifest.description ?? '', 50),
          ]),
        );
      } catch (error) {
        console.error(danger(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  plugin
    .command('install <source>')
    .description('Install a plugin from a local directory or git/https URL')
    .option('--json', 'Output as JSON')
    .action(async (source: string, options: { json?: boolean }) => {
      try {
        const result = await installPlugin(source);
        if (options.json) {
          jsonOut({ ok: true, ...result });
        } else {
          console.log(`${success('✔')} Installed plugin ${bold(result.name)}@${result.version}`);
          console.log(dim(`  Path: ${result.path}`));
          console.log(dim(`  Source: ${result.source}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) jsonOut({ ok: false, error: message });
        else console.error(danger(`Install failed: ${message}`));
        process.exitCode = 1;
      }
    });

  plugin
    .command('remove <name>')
    .alias('rm')
    .description('Remove an installed user-scope plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      try {
        const result = await removePlugin(name);
        if (options.json) {
          jsonOut({ ok: result.removed, ...result });
        } else if (result.removed) {
          console.log(`${success('✔')} Removed plugin ${bold(result.name)}${result.path ? dim(` (${result.path})`) : ''}`);
        } else {
          console.error(danger(`Plugin not found in user plugins: ${name}`));
          process.exitCode = 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) jsonOut({ ok: false, error: message });
        else console.error(danger(message));
        process.exitCode = 1;
      }
    });

  plugin
    .command('info <name>')
    .description('Show details for a discovered plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      try {
        const p = getPluginInfo(name, process.cwd());
        if (!p) {
          if (options.json) jsonOut({ ok: false, error: `Plugin not found: ${name}` });
          else console.error(danger(`Plugin not found: ${name}`));
          process.exitCode = 1;
          return;
        }
        const commands = getPluginCommands([p]);
        const skills = getPluginSkills([p]);
        const tools = getPluginTools([p]);
        const servers = getPluginMcpServers([p]);
        if (options.json) {
          jsonOut({ ok: true, plugin: p, commands, skills: skills.map((s) => ({ name: s.name, description: s.description })), tools, mcpServers: servers });
          return;
        }
        printSection(`Plugin: ${p.id}`);
        printKeyValue([
          ['Name', p.manifest.name],
          ['Version', p.manifest.version],
          ['Scope', p.scope],
          ['Root', p.root],
          ['Manifest', p.manifestPath],
          ['Author', p.manifest.author ?? '—'],
          ['License', p.manifest.license ?? '—'],
          ['Description', p.manifest.description ?? '—'],
        ]);
        if (commands.length) {
          printSection('Commands');
          for (const c of commands) console.log(`  /${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''} ${dim(`- ${c.description}`)}`);
        }
        if (skills.length) {
          printSection('Skills');
          for (const s of skills) console.log(`  ${s.name} ${dim(`- ${s.description}`)}`);
        }
        if (tools.length) {
          printSection('Tools (declarative)');
          for (const t of tools) console.log(`  ${t.name} ${dim(`- ${t.description}`)}`);
        }
        if (servers.length) {
          printSection('MCP servers (config only)');
          for (const s of servers) console.log(`  ${s.name} ${dim(s.url ? s.url : s.command ?? '')}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) jsonOut({ ok: false, error: message });
        else console.error(danger(message));
        process.exitCode = 1;
      }
    });
}
