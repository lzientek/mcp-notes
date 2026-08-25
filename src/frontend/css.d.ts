// esbuild resolves side-effect CSS imports at bundle time; TypeScript needs a declaration.
declare module '*.css';
