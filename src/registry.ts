export type CommandEffect = "read" | "write" | "network" | "local";

export type FlagType = "boolean" | "string" | "number";

export interface FlagSpec {
  name: string;
  type: FlagType;
  summary: string;
  default?: boolean | string | number;
}

export interface CommandSpec {
  path: string[];
  summary: string;
  effect: CommandEffect;
  input: {
    positionals: string[];
    flags: FlagSpec[];
  };
  output: {
    documented: boolean;
    schema?: string;
  };
  examples: string[];
}

export const commandSpecs: CommandSpec[] = [
  {
    path: ["doctor"],
    summary: "Verify environment and configuration.",
    effect: "read",
    input: {
      positionals: [],
      flags: [
        {
          name: "--json",
          type: "boolean",
          summary: "Emit machine-readable JSON instead of human output.",
        },
      ],
    },
    output: {
      documented: true,
      schema: "HealthCheckResult[]",
    },
    examples: ["doctor --json"],
  },
  {
    path: ["schema"],
    summary: "Emit the machine-readable command catalog.",
    effect: "read",
    input: {
      positionals: ["path"],
      flags: [
        {
          name: "--summary",
          type: "boolean",
          summary: "Return only version, command count, and command paths.",
        },
      ],
    },
    output: {
      documented: true,
      schema: "CommandCatalog",
    },
    examples: ["schema", "schema doctor --summary"],
  },
  {
    path: ["update"],
    summary: "Self-update this grits checkout with git pull, npm install, and rebuild.",
    effect: "write",
    input: {
      positionals: [],
      flags: [
        {
          name: "--json",
          type: "boolean",
          summary: "Emit machine-readable JSON instead of human output.",
        },
      ],
    },
    output: {
      documented: true,
      schema: "UpdateResult",
    },
    examples: ["update --json"],
  },
];

function pathMatchesPrefix(path: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => path[index] === part);
}

export function buildSchema(cliVersion: string, pathPrefix: string[] = [], summary = false) {
  const commands = commandSpecs.filter((command) => pathMatchesPrefix(command.path, pathPrefix));
  if (summary) {
    return {
      schemaVersion: 1,
      cliVersion,
      commandCount: commands.length,
      commandPaths: commands.map((command) => command.path),
    };
  }

  return {
    schemaVersion: 1,
    cliVersion,
    envelope: {
      stdout: "JSON only for non-interactive commands when --json or schema is used",
      stderr: "progress, diagnostics, and human narration",
      successEnvelope: ["ok", "command", "data", "warnings"],
      errorEnvelope: ["ok", "command", "error", "hint"],
    },
    globalFlags: [
      {
        name: "--help",
        type: "boolean",
        summary: "Show command help.",
      },
      {
        name: "--version",
        type: "boolean",
        summary: "Show CLI version.",
      },
    ],
    commands,
    errorCodes: [],
    exitCodes: [
      {
        code: 0,
        meaning: "Success.",
      },
      {
        code: 1,
        meaning: "Command failed.",
      },
    ],
  };
}
