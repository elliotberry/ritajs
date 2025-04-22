import type { Options } from 'tsup';
import { defineConfig } from 'tsup';
import { esbuildPluginVersionInjector } from 'esbuild-plugin-version-injector';

const base: Partial<Options> = {
  entry: { rita: 'src/rita.js' },
  outDir: 'dist',
  clean: true,
  target: 'esnext',
  bundle: true,
  treeshake: true,
  minifySyntax: true,
  esbuildPlugins: [esbuildPluginVersionInjector()],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
};

const esm: Options = {
  ...base,
  format: ['esm'],
};

const cjs: Options = {
  ...base,
  format: ['cjs'],
  platform: 'node',
  cjsInterop: true,
};

const iife: Options = {
  ...base,
  format: ['iife'],
  minify: true,
  platform: 'browser',
  globalName: 'iife',
  footer: { js: 'RiTa = iife.RiTa' },
  outExtension() {
    return { js: '.min.js' };
  },
};

const testEsm: Options = {
  format: ['esm'],
  platform: 'node',
  name: 'test',
  entry: ['test/[^i]*.js'],
  outDir: 'test/dist',
  clean: false,
  minify: false,
  bundle: false,
};

export default defineConfig([esm, cjs, iife, testEsm]);