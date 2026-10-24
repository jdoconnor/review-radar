# Holdout tests

Acceptance tests that grade factory work. The coding agent must not read or edit
this directory; `factory/guards.ts` and the holdout-wall workflow reject changes
to it.

## Add a scenario

1. Create `<name>.heldout.ts` or `<name>.heldout.tsx` here.
2. Write a normal vitest test. Import app code from `../src/`.
3. Prefix the file with `p0-`, `p1-` or `p2-` to set the priority. The default
   is `P1`; a failing `P0` always fails the gate.
4. Run it:

   ```bash
   npm run factory -- holdout   # list what will run
   npm run factory -- eval      # run the gate
   ```

The evaluator copies each file into `test/` for the run and removes the copy
afterwards. These files are excluded from `npm test` and `tsconfig.json`.

Example: `p0-cache-survives-offline.heldout.tsx`.
