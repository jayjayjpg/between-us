// Shared content width for every route except the auth forms (login,
// forgot-password, reset-password), which intentionally stay narrower — see
// CLAUDE.md. `...attributes` lets a caller add e.g. `class="text-center"`;
// Glimmer merges multiple `class` sources rather than one replacing the
// other.
<template>
  <div class="mx-auto max-w-5xl px-4 py-12" ...attributes>
    {{yield}}
  </div>
</template>
