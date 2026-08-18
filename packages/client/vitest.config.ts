import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * La racine du paquet est injectée à la compilation : sous jsdom, `import.meta.url`
 * devient une URL http:// et `process.cwd()` dépend du répertoire d'appel, donc
 * aucun des deux ne permet de retrouver le gabarit de façon fiable.
 */
export default defineConfig({
  define: {
    __CLIENT_ROOT__: JSON.stringify(fileURLToPath(new URL('.', import.meta.url))),
  },
  test: {
    environment: 'jsdom',
  },
});
