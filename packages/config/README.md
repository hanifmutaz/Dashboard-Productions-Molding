Shared tool presets. Runtime configuration is NOT stored here: it is read from environment variables
by `apps/api/src/config.ts` and validated with Zod at startup (secrets never in source control).
