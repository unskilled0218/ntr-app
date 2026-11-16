import { defineConfig } from "vitest/config";

// jsdom gives the caret/DOM tests a real document; the pure-logic tests need no environment but
// share the same runner. Only unit tests under src/**/__tests__ are picked up.
export default defineConfig({
  test: {
    environment: "jsdom",
    css: { include: [/style\.css\?raw(?:&|$)/] },
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
