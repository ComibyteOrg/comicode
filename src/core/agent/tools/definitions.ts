import type { ToolDefinition } from '../../types.js';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_files',
    description:
      'List files in the project, honoring .gitignore. Use this to understand structure without reading every file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional subdirectory relative to the project root.',
        },
        limit: { type: 'integer', description: 'Maximum files to return (default 200, max 1000).' },
      },
      required: [],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a text file. Supports line ranges for large files. Secret files are protected and require explicit approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        start_line: { type: 'integer', description: '1-based first line (optional).' },
        end_line: { type: 'integer', description: '1-based last line inclusive (optional).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search project text files with a JavaScript regular expression. Returns matching paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: { type: 'string', description: 'Optional subdirectory to search.' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false).' },
        max_results: { type: 'integer', description: 'Maximum matches (default 60, max 200).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or replace a file with complete content. Prefer edit_file for existing files. Shows a diff and asks for approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        content: { type: 'string', description: 'Complete new file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact text block in a file. old_text must match exactly; use replace_all for repeated occurrences. Shows a diff and asks for approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        old_text: { type: 'string', description: 'Exact text to replace.' },
        new_text: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'apply_patch',
    description:
      'Apply a unified diff to a file. The patch must include ---/+++ and @@ hunk headers. Fails safely without partial writes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        patch: { type: 'string', description: 'Unified diff patch text.' },
      },
      required: ['path', 'patch'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file. Requires explicit confirmation and never deletes directories.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        reason: { type: 'string', description: 'Why deletion is necessary.' },
      },
      required: ['path', 'reason'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run an approved shell command in the project directory with a timeout. Output is truncated. Dangerous commands require extra approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute.' },
        cwd: { type: 'string', description: 'Optional working directory inside the project.' },
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 120000).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_tests',
    description: 'Run the project test command detected from package scripts or the ecosystem.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional command override.' },
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds.' },
      },
      required: [],
    },
  },
  {
    name: 'run_lint',
    description: 'Run the configured or detected linter/typecheck command.',
    parameters: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds.' },
      },
      required: [],
    },
  },
  {
    name: 'run_build',
    description: 'Run the configured or detected build command.',
    parameters: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds.' },
      },
      required: [],
    },
  },
  {
    name: 'git_status',
    description: 'Show git branch, working-tree status, and untracked files. Read-only.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'git_diff',
    description: 'Show a git diff for the working tree or staged changes. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional path to limit the diff.' },
        staged: { type: 'boolean', description: 'Show staged changes instead of unstaged.' },
        max_chars: { type: 'integer', description: 'Maximum diff characters (default 30000).' },
      },
      required: [],
    },
  },
  {
    name: 'update_plan',
    description:
      'Create or update the task plan. Use concise steps and keep statuses accurate. This is visible in the UI and saved with checkpoints.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-sentence plan summary.' },
        steps: {
          type: 'array',
          description: 'Ordered plan steps.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'skipped'],
              },
            },
            required: ['title'],
          },
        },
      },
      required: ['summary', 'steps'],
    },
  },
  {
    name: 'task_complete',
    description:
      'Mark the task complete with a concise summary of changes, tests run, and any remaining caveats.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Final task summary for the user.' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'environment_info',
    description: 'Show OS, Node version, git state, and detected test/lint/build commands.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
