import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/next-env.d.ts'] }, js.configs.recommended, ...ts.configs.recommended, { files: ['**/*.{ts,tsx}'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } });
