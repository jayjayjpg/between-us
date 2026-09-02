import { defineConfig } from 'vite';
import { extensions, classicEmberSupport, ember } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Vite only exposes `VITE_`-prefixed vars on `import.meta.env` by default;
  // this app's Supabase credentials use a `CHAT_BOT_` prefix instead (see
  // .env / .env.development), so opt that prefix in too.
  envPrefix: ['VITE_', 'CHAT_BOT_'],
  plugins: [
    tailwindcss(),
    classicEmberSupport(),
    ember(),
    // extra plugins here
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
});
