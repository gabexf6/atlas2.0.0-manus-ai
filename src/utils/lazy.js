import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Carrega uma dependência CommonJS só na primeira vez que ela é usada,
// em vez de no startup do bot. Mantém a chamada síncrona.
export function lazyRequire(name) {
  let mod;
  return () => (mod ??= require(name));
}
