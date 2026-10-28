import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.ts', 'apps/**/*.test.tsx', 'config/**/*.test.ts'], setupFiles: ['./test/no-network.ts'], testTimeout: 15000, exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'] } });
