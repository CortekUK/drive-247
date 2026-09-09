import { defineConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import path from "node:path";

/**
 * The 01..05 numbering on disk IS the spec the team lead drew, so the runner
 * must honour it. Vitest's default sequencer orders files by size to fill
 * workers evenly, which would run `05-provision` first.
 */
class SpineOrderSequencer extends BaseSequencer {
  async sort(files: any[]) {
    const key = (f: any) => String(f?.moduleId ?? f?.[1] ?? f);
    return [...files].sort((a, b) => key(a).localeCompare(key(b)));
  }
  // Sharding would split the chain across processes. There is nothing here
  // slow enough to need it.
  async shard(files: any[]) {
    return files;
  }
}

export default defineConfig({
  test: {
    // Node, not jsdom. There is no DOM in this suite by design — the team lead
    // ruled browser tests out ("wo test carry nahi ho payenge"). These assert
    // payloads and API responses, nothing that renders.
    environment: "node",
    globals: true,
    root: path.resolve(__dirname),
    include: ["spine/**/*.test.ts", "integrations/**/*.test.ts"],

    // One process, one order, one shared chain.
    //
    // helpers/chain.ts keeps the "stop at the first non-200" state in module
    // scope. Module scope is per-worker, so the moment Vitest forks a second
    // worker the chain silently forgets that step 02 failed and steps 03-05 run
    // anyway. All three settings below are load-bearing for that, not tidiness.
    pool: "forks",
    // Vitest 4 flattened the old `poolOptions.forks.*` onto `test`.
    singleFork: true,
    fileParallelism: false,
    // The one that actually matters. `singleFork` gets every file into the same
    // PROCESS, but Vitest still gives each file a fresh module registry unless
    // isolation is off — and a fresh registry means a fresh, empty chain.
    isolate: false,
    sequence: {
      shuffle: false,
      concurrent: false,
      sequencer: SpineOrderSequencer,
    },

    // Layer 2 makes real HTTP calls to a cold-startable edge function. The
    // default 5s is not enough for a Deno cold start; Layer 1 never gets near it.
    testTimeout: 30_000,

    reporters: ["default"],
  },
  resolve: {
    alias: {
      // The two plan catalogues the spine is priced against. Aliased rather
      // than reached at with `../../../..` so a move shows up in one place.
      "@web": path.resolve(__dirname, "../apps/web/src"),
      "@fn": path.resolve(__dirname, "../supabase/functions"),
    },
  },
});
