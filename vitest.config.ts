import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Point the SQLite singleton at an in-memory database so pure-logic tests
    // that transitively touch the DatabaseManager (link-rewriter / shortcode
    // site rules) never create or read a real file. The relevant code paths
    // are wrapped in try/catch and only ever read empty tables here.
    env: {
      WP_ASTRO_DB: ':memory:',
      WP_ASTRO_LOG_LEVEL: 'error',
    },
    include: ['test/**/*.test.ts'],
  },
});
