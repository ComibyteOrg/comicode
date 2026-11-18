import type { Command } from 'commander';
import { bold, dim, success } from '../output.js';
import { openAppContext } from '../../core/app.js';
import { startServer } from '../../core/server/index.js';

interface ServeFlags {
  port?: string;
  host?: string;
  open?: boolean;
  dev?: boolean;
}

/** `comicode serve` — launch the local web dashboard backed by the real engine. */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the local web dashboard for ComiCode')
    .option('--port <port>', 'port to listen on', '8787')
    .option('--host <host>', 'host to bind', '127.0.0.1')
    .option('--no-open', 'do not open a browser automatically')
    .option('--dev', 'print the Vite dev command for the frontend')
    .action(async (flags: ServeFlags) => {
      const port = Number(flags.port ?? 8787);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer between 1 and 65535.');
      }
      const context = openAppContext(process.cwd());
      if (flags.dev) {
        console.log(dim('Frontend dev server: npm run web:dev (from the project root)'));
      }
      const server = await startServer({
        port,
        host: flags.host ?? '127.0.0.1',
        open: flags.open !== false,
        store: context.store,
        cwd: context.cwd,
        onLog: (message) => console.log(success(`✔ ${message}`)),
      });
      console.log(bold('ComiCode dashboard'));
      console.log(dim(`  ${context.cwd}`));
      console.log(dim('  ctrl+c to stop'));
      const shutdown = (): void => {
        void server.close().then(() => {
          context.close();
          process.exit(0);
        });
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
}
