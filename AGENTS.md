# Project Instructions — GitHub AI Changelog

## Architecture & Boundaries

- Single-file, zero-build Tampermonkey script: `github-ai-changelog.user.js` (`// ==UserScript==` metadata block must remain at line 1).
- Keep pure logic (`parseGitHubRepoUrl`, prompt budgeting, structured output parsing/compilation/streaming preview, endpoint normalization, SSE/JSON parsing, Markdown AST/URL sanitization, error/cache helpers) independent of browser globals and exported via `module.exports` when `module` exists; guard browser/GM initialization behind `typeof window !== 'undefined' && typeof document !== 'undefined'`.
- UI lives inside `Shadow DOM` using `adoptedStyleSheets` (`<style>` fallback) and programmatic DOM construction (`createEl`, `renderMarkdownSafely`). Do not use `innerHTML` or inline `style="..."` attributes so GitHub CSP / Trusted Types and untrusted commit/AI output stay safe.
- All external requests (GitHub REST API and AI providers) must use `GM_xmlhttpRequest` rather than page `fetch` to avoid GitHub `connect-src` CSP and CORS failures.
- Store AI keys and optional GitHub PAT only in `GM_setValue` (`githubAiChangelogPrefsV1`); never log credentials or embed tokens. Bump `CACHE_STORE_NAME` (`githubAiChangelogCacheV3`) if canonical output formatting changes.

## Validation

- Syntax check: `node -c github-ai-changelog.user.js`
- Unit tests (Node built-in runner, no `npm install` needed): `node --test github-ai-changelog.test.js`
- Any change to DOM selectors (`ul[data-testid="repo-header-actions"]`, `ul.pagehead-actions`, `#repository-container-header`, Turbo events), `GM_xmlhttpRequest` streaming, or `@connect` headers requires manual verification inside a real browser Tampermonkey extension on GitHub.

## Conventions

- Avoid single-letter variable names.
- Bump `@version` inside `// ==UserScript==` when shipping user-facing script changes.
