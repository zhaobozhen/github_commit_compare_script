'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_PRESETS,
  CHANGELOG_SECTION_ORDER,
  detectBrowserLanguage,
  resolveOutputLanguage,
  parseGitHubRepoUrl,
  buildCompareApiUrl,
  buildRefsApiUrls,
  buildWebRefsUrls,
  parseGitHubRefsPayload,
  isNoiseFile,
  buildChangelogPromptContext,
  normalizeSectionKey,
  extractJsonObjectText,
  parseAndValidateChangelog,
  extractStreamingChangelogPreview,
  compileCanonicalChangelog,
  normalizeEndpoint,
  buildAiRequest,
  parseAiResponseChunk,
  sanitizeSafeHttpUrl,
  parseMarkdownAst,
  buildCacheKey,
  pruneCacheEntries,
  parseRateLimitHeaders,
  formatGitHubError
} = require('./github-ai-changelog.user.js');

test('parseGitHubRepoUrl detects repo pages, compare refs, and excludes non-repo routes', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/zhaobozhen/LibChecker'), {
    owner: 'zhaobozhen',
    repo: 'LibChecker',
    repoFullName: 'zhaobozhen/LibChecker',
    compareBase: '',
    compareHead: ''
  });

  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/owner/repo/compare/v1.0.0...v1.2.0?expand=1'),
    {
      owner: 'owner',
      repo: 'repo',
      repoFullName: 'owner/repo',
      compareBase: 'v1.0.0',
      compareHead: 'v1.2.0'
    }
  );

  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/owner/repo/compare/release/v1.0...feature%2Fai-notes'),
    {
      owner: 'owner',
      repo: 'repo',
      repoFullName: 'owner/repo',
      compareBase: 'release/v1.0',
      compareHead: 'feature/ai-notes'
    }
  );

  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/owner/repo/compare/abc1234..def5678'),
    {
      owner: 'owner',
      repo: 'repo',
      repoFullName: 'owner/repo',
      compareBase: 'abc1234',
      compareHead: 'def5678'
    }
  );

  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/owner/repo/compare/v2.0.0'),
    {
      owner: 'owner',
      repo: 'repo',
      repoFullName: 'owner/repo',
      compareBase: '',
      compareHead: 'v2.0.0'
    }
  );

  assert.equal(parseGitHubRepoUrl('https://github.com/zhaobozhen'), null);
  assert.equal(parseGitHubRepoUrl('https://github.com/settings/tokens'), null);
  assert.equal(parseGitHubRepoUrl('https://github.com/topics/android'), null);
  assert.equal(parseGitHubRepoUrl('https://github.com/orgs/openai'), null);
  assert.equal(parseGitHubRepoUrl('https://gitlab.com/owner/repo'), null);
  assert.equal(parseGitHubRepoUrl('https://github.com/owner/repo', { isNotFoundPage: true }), null);
});

test('buildCompareApiUrl and buildRefsApiUrls encode slash-containing refs safely', () => {
  assert.equal(
    buildCompareApiUrl('acme', 'app', 'release/v1.0', 'feat/ai#1'),
    'https://api.github.com/repos/acme/app/compare/release%2Fv1.0...feat%2Fai%231'
  );

  assert.deepEqual(buildRefsApiUrls('acme', 'app'), {
    tagsUrl: 'https://api.github.com/repos/acme/app/tags?per_page=100',
    branchesUrl: 'https://api.github.com/repos/acme/app/branches?per_page=40'
  });

  assert.deepEqual(buildWebRefsUrls('acme', 'app'), {
    tagsUrl: 'https://github.com/acme/app/refs?type=tag',
    branchesUrl: 'https://github.com/acme/app/refs?type=branch'
  });

  assert.deepEqual(parseGitHubRefsPayload('{"refs":["2.5.5.1","2.5.5"]}'), ['2.5.5.1', '2.5.5']);
  assert.deepEqual(parseGitHubRefsPayload('[{"name":"v1.0"}]'), ['v1.0']);
  assert.equal(parseGitHubRefsPayload('<html>not json</html>'), null);
});

test('isNoiseFile filters lockfiles, minified assets, and binaries without dropping source files', () => {
  assert.equal(isNoiseFile('package-lock.json'), true);
  assert.equal(isNoiseFile('frontend/pnpm-lock.yaml'), true);
  assert.equal(isNoiseFile('rust/Cargo.lock'), true);
  assert.equal(isNoiseFile('dist/bundle.min.js'), true);
  assert.equal(isNoiseFile('assets/logo.png'), true);
  assert.equal(isNoiseFile('src/changelog.ts'), false);
  assert.equal(isNoiseFile('app/src/main/kotlin/MainActivity.kt'), false);
  assert.equal(isNoiseFile('README.md'), false);
});

test('buildChangelogPromptContext protects small source diffs from large files and reports API truncation', () => {
  const hugePatch = `+${'x'.repeat(8000)}`;
  const smallPatch = '@@ -1,2 +1,3 @@\n+const enabled = true;';
  const files = [
    { filename: 'package-lock.json', status: 'modified', additions: 500, deletions: 400, patch: hugePatch },
    { filename: 'fixtures/big.json', status: 'modified', additions: 400, deletions: 0, patch: hugePatch },
    { filename: 'src/core.js', status: 'modified', additions: 1, deletions: 0, patch: smallPatch }
  ];
  for (let index = 0; index < 297; index += 1) {
    files.push({ filename: `src/file_${index}.js`, status: 'modified', additions: 1, deletions: 0 });
  }

  const context = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 280,
      commits: [
        {
          sha: '1234567890abcdef',
          commit: {
            message: 'feat: add cache layer\n\ndetails here',
            author: { name: 'Alice', date: '2026-11-10T10:00:00Z' }
          }
        }
      ],
      files
    },
    {
      owner: 'acme',
      repo: 'widget',
      base: 'v1.0.0',
      head: 'v1.1.0',
      language: 'zh-CN',
      maxPatchChars: 2400,
      customPrompt: '强调破坏性更新'
    }
  );

  assert.equal(context.stats.commitsTruncated, true);
  assert.equal(context.stats.filesTruncated, true);
  assert.equal(context.stats.filteredNoiseCount, 1);
  assert.equal(context.stats.includedPatchCount, 2);
  assert.match(context.userPrompt, /src\/core\.js/);
  assert.match(context.userPrompt, /const enabled = true;/);
  assert.match(context.userPrompt, /diff truncated/);
  assert.match(context.userPrompt, /250|280/);
  assert.match(context.systemPrompt, /强调破坏性更新/);
});

test('buildChangelogPromptContext commitsOnly mode omits patches and includes commit body previews', () => {
  const context = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 1,
      commits: [
        {
          sha: 'abcdef1234567',
          commit: {
            message: 'fix: handle empty tags\n\nPrevent crash when repository has zero tags.',
            author: { name: 'Bob', date: '2026-11-11T08:00:00Z' }
          }
        }
      ],
      files: [{ filename: 'src/app.js', status: 'modified', additions: 5, deletions: 1, patch: '+fix' }]
    },
    {
      owner: 'acme',
      repo: 'widget',
      base: 'v1.0.0',
      head: 'v1.1.0',
      language: 'en',
      commitsOnly: true
    }
  );

  assert.equal(context.stats.includedPatchCount, 0);
  assert.equal(context.stats.commitsOnly, true);
  assert.match(context.userPrompt, /Prevent crash when repository has zero tags/);
  assert.doesNotMatch(context.userPrompt, /Diffs \(/);
  assert.match(context.systemPrompt, /English/);
  assert.doesNotMatch(context.userPrompt, /Bob/);
});

test('buildChangelogPromptContext prioritizes source diffs over tests and trims duplicate file noise', () => {
  const largeTestPatch = `+${'t'.repeat(1600)}`;
  const sourcePatch = '@@ -1,2 +1,3 @@\n+export const fast = true;   \n \n \n \n';
  const context = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 1,
      commits: [
        {
          sha: '1234567890abcdef',
          commit: {
            message: 'feat: speed up compare\n\nSigned-off-by: Bot <bot@example.com>',
            author: { name: 'SampleAuthor', date: '2026-11-12T00:00:00Z' }
          }
        }
      ],
      files: [
        { filename: 'tests/heavy.test.js', status: 'modified', additions: 50, deletions: 0, patch: largeTestPatch },
        { filename: 'src/engine.js', status: 'modified', additions: 1, deletions: 0, patch: sourcePatch },
        { filename: 'package-lock.json', status: 'modified', additions: 99, deletions: 99, patch: '+lock' }
      ]
    },
    {
      owner: 'acme',
      repo: 'widget',
      base: 'v1',
      head: 'v2',
      language: 'zh-CN',
      maxPatchChars: 220
    }
  );

  assert.equal(context.stats.includedPatchCount, 1);
  assert.match(context.userPrompt, /src\/engine\.js/);
  assert.match(context.userPrompt, /Other Changed Files \(1\):\n- \[modified\] tests\/heavy\.test\.js/);
  assert.match(context.userPrompt, /Filtered noise: 1/);
  assert.doesNotMatch(context.userPrompt, /SampleAuthor/);
  assert.doesNotMatch(context.userPrompt, /Signed-off-by/);
  assert.doesNotMatch(context.userPrompt, /package-lock\.json/);
});

test('normalizeEndpoint and buildAiRequest support OpenAI-compatible, Anthropic, and keyless localhost', () => {
  assert.equal(normalizeEndpoint('openai', 'https://api.openai.com'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(normalizeEndpoint('openai', 'https://open.bigmodel.cn/api/paas/v4/'), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(normalizeEndpoint('openai', 'https://api.deepseek.com/beta'), 'https://api.deepseek.com/beta/chat/completions');
  assert.equal(
    normalizeEndpoint('openai', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  );
  assert.equal(normalizeEndpoint('anthropic', 'https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');

  const localReq = buildAiRequest(
    {
      name: 'Ollama',
      type: 'openai',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder',
      apiKey: ''
    },
    'sys',
    'usr'
  );
  assert.equal(localReq.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(localReq.headers.Authorization, undefined);
  assert.equal(JSON.parse(localReq.body).max_tokens, undefined);
  assert.equal(JSON.parse(localReq.body).temperature, undefined);

  const lanReq = buildAiRequest(
    {
      name: 'LAN vLLM',
      type: 'openai',
      endpoint: 'http://192.168.1.50:8000/v1',
      model: 'qwen2.5',
      apiKey: ''
    },
    'sys',
    'usr'
  );
  assert.equal(lanReq.url, 'http://192.168.1.50:8000/v1/chat/completions');

  assert.throws(
    () => buildAiRequest({ type: 'openai', endpoint: 'api.openai.com', model: 'gpt-4o-mini', apiKey: 'sample' }, 's', 'u'),
    /http:\/\//
  );

  const claudeReq = buildAiRequest(
    {
      name: 'Claude',
      type: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      apiKey: 'test-token-value'
    },
    'sys prompt',
    'user prompt'
  );
  assert.equal(claudeReq.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(claudeReq.headers['x-api-key'], 'test-token-value');
  assert.equal(JSON.parse(claudeReq.body).system, 'sys prompt');

  assert.throws(
    () => buildAiRequest({ type: 'openai', endpoint: 'https://api.openai.com', model: 'gpt-4o-mini', apiKey: '' }, 's', 'u'),
    /API Key/
  );

  const remoteOpenAiReq = buildAiRequest(
    {
      name: 'OpenAI',
      type: 'openai',
      endpoint: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      apiKey: 'Bearer sample-remote-bearer'
    },
    'sys msg',
    'usr msg'
  );
  assert.equal(remoteOpenAiReq.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(remoteOpenAiReq.headers.Authorization, 'Bearer sample-remote-bearer');
  assert.equal(JSON.parse(remoteOpenAiReq.body).messages.length, 2);
  assert.equal(JSON.parse(remoteOpenAiReq.body).chat_template_kwargs, undefined);

  const nvidiaV4Req = buildAiRequest(
    {
      name: 'NVIDIA',
      type: 'openai',
      endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: 'deepseek-ai/deepseek-v4.1-flash',
      apiKey: 'nvapi-sample'
    },
    'sys',
    'usr'
  );
  assert.deepEqual(JSON.parse(nvidiaV4Req.body).chat_template_kwargs, {
    enable_thinking: true,
    thinking: true
  });

  for (const [presetKey, preset] of Object.entries(PROVIDER_PRESETS)) {
    const sampleKey = presetKey === 'ollama' ? '' : 'sample-preset-token';
    const req = buildAiRequest({ ...preset, apiKey: sampleKey }, 'sys', 'usr');
    assert.equal(req.url, preset.endpoint);
    assert.equal(JSON.parse(req.body).model, preset.model);
  }
});

test('parseAiResponseChunk handles incremental OpenAI SSE, Anthropic SSE, and non-stream JSON', () => {
  const part1 = 'data: {"choices":[{"delta":{"reasoning_content":"plan"}}]}\n'
    + 'data: {"choices":[{"delta":{"content":"## 变更"}}]}\n'
    + 'data: {"choices":[{"delta":{"cont';
  const step1 = parseAiResponseChunk('openai', part1, 0, false);
  assert.equal(step1.textDelta, '## 变更');
  assert.equal(step1.reasoningDelta, 'plan');
  assert.equal(step1.done, false);

  const part2 = `${part1}ent":"日志"}}]}\n` + 'data: [DONE]\n';
  const step2 = parseAiResponseChunk('openai', part2, step1.cursor, false);
  assert.equal(step2.textDelta, '日志');
  assert.equal(step2.done, true);

  const anthropicStream = 'event: content_block_delta\n'
    + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n'
    + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"World"}}\n'
    + 'data: {"type":"message_stop"}\n';
  const claudeParsed = parseAiResponseChunk('anthropic', anthropicStream, 0, true);
  assert.equal(claudeParsed.textDelta, 'Hello World');
  assert.equal(claudeParsed.done, true);

  const nonStreamError = parseAiResponseChunk('openai', '{"error":{"message":"Invalid model"}}', 0, true);
  assert.equal(nonStreamError.errorMessage, 'Invalid model');
  assert.equal(nonStreamError.done, true);

  const nonStreamAnthropic = parseAiResponseChunk(
    'anthropic',
    '{"content":[{"type":"text","text":"Plain reply"}]}',
    0,
    true
  );
  assert.equal(nonStreamAnthropic.textDelta, 'Plain reply');
});

test('sanitizeSafeHttpUrl and parseMarkdownAst prevent unsafe links and parse blocks accurately', () => {
  assert.equal(sanitizeSafeHttpUrl('https://github.com/a/b'), 'https://github.com/a/b');
  assert.equal(sanitizeSafeHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSafeHttpUrl('data:text/html,<script>'), null);

  const ast = parseMarkdownAst([
    '## Highlights',
    '- Added `safeParser` and **bold** [link](https://example.com) and [xss](javascript:alert(1))',
    '```js',
    'const sum = 1 + 2;',
    '```'
  ].join('\n'));

  assert.equal(ast[0].type, 'heading');
  assert.equal(ast[0].level, 2);
  assert.equal(ast[1].type, 'ul');
  const listTokens = ast[1].items[0];
  assert.equal(listTokens.some((tok) => tok.type === 'code' && tok.text === 'safeParser'), true);
  assert.equal(listTokens.some((tok) => tok.type === 'link' && tok.href === 'https://example.com/'), true);
  assert.equal(listTokens.some((tok) => tok.type === 'link' && tok.href.startsWith('javascript:')), false);
  assert.equal(ast[2].type, 'codeblock');
  assert.equal(ast[2].text, 'const sum = 1 + 2;');
});

test('pruneCacheEntries, parseRateLimitHeaders, and formatGitHubError behave as expected', () => {
  const key = buildCacheKey('acme', 'app', 'v1', 'v2', 'p1', 'zh-CN', false);
  assert.equal(key, 'acme::app::v1::v2::p1::zh-CN::diff');

  const pruned = pruneCacheEntries(
    {
      oldest: { markdown: '1', updatedAt: 100 },
      middle: { markdown: '2', updatedAt: 200 },
      newest: { markdown: '3', updatedAt: 300 }
    },
    2
  );
  assert.deepEqual(Object.keys(pruned), ['newest', 'middle']);

  const headers = 'x-ratelimit-remaining: 0\r\nx-ratelimit-reset: 1700000000\r\n';
  assert.deepEqual(parseRateLimitHeaders(headers), { remaining: 0, resetEpochSeconds: 1700000000 });
  assert.match(formatGitHubError(403, '{"message":"rate limit"}', headers), /5000/);
  assert.match(formatGitHubError(404, '{"message":"Not Found"}', ''), /私有仓库/);
});

test('normalizeSectionKey and extractJsonObjectText handle aliases, fences, and embedded JSON', () => {
  assert.equal(normalizeSectionKey('feat'), 'features');
  assert.equal(normalizeSectionKey('Bug Fixes'), 'fixes');
  assert.equal(normalizeSectionKey('BREAKING CHANGE'), 'breaking');
  assert.equal(normalizeSectionKey('性能优化'), 'performance');
  assert.equal(normalizeSectionKey('Code Cleanup'), 'refactoring');
  assert.equal(normalizeSectionKey('unknown-bucket'), 'chore');

  const embedded = 'Here is the result:\n```json\n{"summary":"ok {braces}","sections":{"features":[]}}\n```\nThanks!';
  assert.equal(extractJsonObjectText(embedded), '{"summary":"ok {braces}","sections":{"features":[]}}');
});

test('parseAndValidateChangelog enforces grounding, strips trailing commas, and falls back cleanly', () => {
  const grounding = {
    owner: 'acme',
    repo: 'widget',
    base: 'v1.0.0',
    head: 'v1.1.0',
    language: 'zh-CN',
    validShas: ['1234567890abcdef1234567890abcdef12345678', 'abcdef1234567890abcdef1234567890abcdef12']
  };

  const fencedWithHallucination = [
    '```json',
    '{',
    '  "summary": "新增缓存支持并修复空标签崩溃。",',
    '  "sections": {',
    '    "chore": [{ "title": "更新依赖", "detail": "升级构建工具", "commits": ["abcdef12"], }],',
    '    "breaking": [{ "title": "移除旧 API", "detail": "删除 legacyInit", "commits": ["1234567", "deadbeef"], "modules": ["src/core.js", "src/core.js"] }],',
    '    "bugFixes": ["处理空列表边界"],',
    '  }',
    '}',
    '```'
  ].join('\n');

  const validated = parseAndValidateChangelog(fencedWithHallucination, grounding);
  assert.equal(validated.isStructured, true);
  assert.equal(validated.meta.droppedShasCount, 1);
  assert.deepEqual(validated.sections.breaking[0].commits, ['1234567']);
  assert.deepEqual(validated.sections.breaking[0].modules, ['src/core.js']);
  assert.deepEqual(validated.sections.chore[0].commits, ['abcdef1']);
  assert.equal(validated.sections.fixes[0].detail, '处理空列表边界');

  const compiled = compileCanonicalChangelog(validated, {
    grounding,
    stats: {
      totalCommits: 280,
      returnedCommits: 250,
      commitsTruncated: true,
      listedFiles: 12,
      filesTruncated: false,
      totalAdditions: 40,
      totalDeletions: 10,
      includedPatchCount: 8,
      omittedPatchCount: 1,
      partiallyTruncatedPatchCount: 2,
      commitsOnly: false
    }
  });

  // Fixed section ordering: breaking appears before fixes and chore regardless of input order
  const breakingPos = compiled.indexOf('## 破坏性变更（Breaking Changes）');
  const fixesPos = compiled.indexOf('## 问题修复（Bug Fixes）');
  const chorePos = compiled.indexOf('## 文档、构建与依赖（Docs & Chore）');
  assert.ok(breakingPos > 0 && fixesPos > breakingPos && chorePos > fixesPos);
  assert.equal(compiled.includes('deadbeef'), false);
  assert.equal(compiled.includes('src/core.js'), false);
  assert.match(compiled, /GitHub Compare API 单次仅返回前 250 \/ 280 条提交/);
  assert.ok(CHANGELOG_SECTION_ORDER.length === 6);

  const ast = parseMarkdownAst(compiled);
  assert.equal(ast[0].type, 'heading');
  assert.equal(ast[0].level, 1);
  assert.ok(ast.some((block) => block.type === 'hr'));

  // Non-JSON plain prose fallback
  const fallbackParsed = parseAndValidateChangelog('## Release\n- Something changed', grounding);
  assert.equal(fallbackParsed.isStructured, false);
  const fallbackCompiled = compileCanonicalChangelog(fallbackParsed, {
    grounding: { ...grounding, language: 'en' },
    stats: { returnedCommits: 2, listedFiles: 3, totalAdditions: 5, totalDeletions: 1, includedPatchCount: 3 }
  });
  assert.match(fallbackCompiled, /# Changelog: acme\/widget \(v1\.0\.0 -> v1\.1\.0\)/);
  assert.match(fallbackCompiled, /Format Note: Model output did not match strict JSON/);
  assert.match(fallbackCompiled, /Something changed/);
});

test('extractStreamingChangelogPreview converts partial JSON into formatted Markdown without raw braces', () => {
  const context = {
    grounding: {
      owner: 'acme',
      repo: 'widget',
      base: 'v1.0',
      head: 'v2.0',
      language: 'zh-CN',
      validShas: ['1234567890abcdef']
    },
    stats: {
      returnedCommits: 3,
      listedFiles: 4,
      totalAdditions: 18,
      totalDeletions: 5
    }
  };

  const partialJson = '{"summary":"本次升级包含新能力\\n以及关键修复","sections":{"features":[{"title":"支持导出","detail":"新增复制完整框架","commits":["1234567"]},{"title":"未闭合条目';
  const preview = extractStreamingChangelogPreview(partialJson, context);
  assert.match(preview, /# 变更日志：acme\/widget \(v1\.0 → v2\.0\)/);
  assert.match(preview, /本次升级包含新能力/);
  assert.match(preview, /## 新增功能（Features）/);
  assert.match(preview, /\*\*支持导出\*\*：新增复制完整框架（`1234567`）/);
  assert.equal(preview.includes('未闭合条目'), false);
  assert.equal(preview.includes('{"summary"'), false);
});

test('resolveOutputLanguage follows browser locale when auto and preserves explicit overrides', () => {
  assert.equal(typeof detectBrowserLanguage(''), 'string');
  assert.equal(resolveOutputLanguage('auto', 'zh-CN').templateLocale, 'zh-CN');
  assert.equal(resolveOutputLanguage('auto', 'zh-TW').templateLocale, 'zh-TW');
  assert.equal(resolveOutputLanguage('auto', 'zh-HK').templateLocale, 'zh-TW');
  assert.equal(resolveOutputLanguage('auto', 'en-US').templateLocale, 'en');
  const japanese = resolveOutputLanguage('auto', 'ja-JP');
  assert.equal(japanese.templateLocale, 'en');
  assert.equal(japanese.aiLanguageName, 'ja-JP');
  assert.equal(resolveOutputLanguage('en', 'zh-CN').templateLocale, 'en');

  const jaContext = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 1,
      commits: [{ sha: '1234567', commit: { message: 'feat: init', author: { name: 'Dev', date: '2026-11-12T00:00:00Z' } } }],
      files: []
    },
    { owner: 'acme', repo: 'widget', base: 'v1', head: 'v2', language: 'auto', browserLanguage: 'ja-JP' }
  );
  assert.match(jaContext.systemPrompt, /strictly in ja-JP/);
  assert.match(jaContext.userPrompt, /strictly in ja-JP/);

  const zhContext = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 1,
      commits: [{ sha: '1234567', commit: { message: 'feat: init', author: { name: 'Dev', date: '2026-11-12T00:00:00Z' } } }],
      files: []
    },
    { owner: 'acme', repo: 'widget', base: 'v1', head: 'v2', language: 'auto', browserLanguage: 'zh-CN' }
  );
  assert.match(zhContext.systemPrompt, /用 2 到 3 句简体中文概括/);
  assert.match(zhContext.systemPrompt, /sections 严禁全部留空/);
  assert.match(zhContext.systemPrompt, /必须全部使用【简体中文】/);
  assert.match(zhContext.userPrompt, /必须全部使用简体中文/);

  const twContext = buildChangelogPromptContext(
    {
      status: 'ahead',
      total_commits: 1,
      commits: [{ sha: '1234567', commit: { message: 'feat: init', author: { name: 'Dev', date: '2026-11-12T00:00:00Z' } } }],
      files: []
    },
    { owner: 'acme', repo: 'widget', base: 'v1', head: 'v2', language: 'auto', browserLanguage: 'zh-TW' }
  );
  const twOutput = compileCanonicalChangelog(
    { isStructured: true, summary: '新增測試摘要', sections: { breaking: [], features: [{ title: '功能', detail: '詳情', commits: ['1234567'], modules: [] }], fixes: [], performance: [], refactoring: [], chore: [] } },
    twContext
  );
  assert.match(twOutput, /# 變更日誌：acme\/widget/);
  assert.match(twOutput, /## 概覽/);
  assert.match(twOutput, /## 新增功能（Features）/);
  assert.match(twOutput, /## 概覽[\s\S]*資料範圍說明/);
});

test('parseAndValidateChangelog handles array of categories, nested items, and bullet string values', () => {
  const grounding = {
    owner: 'tw93',
    repo: 'Pake',
    validShas: ['be35fa3']
  };

  // Variant 1: sections as array of category objects
  const variantArr = JSON.stringify({
    summary: 'Pake 项目版本更新',
    sections: [
      { category: 'features', items: [{ title: '窗口尺寸', detail: '记住全屏尺寸', commits: ['be35fa3'] }] },
      { category: 'fixes', items: [{ desc: '修复拖拽问题' }] }
    ]
  });
  const resArr = parseAndValidateChangelog(variantArr, grounding);
  assert.equal(resArr.isStructured, true);
  assert.equal(resArr.sections.features.length, 1);
  assert.equal(resArr.sections.fixes.length, 1);
  assert.equal(resArr.sections.fixes[0].detail, '修复拖拽问题');

  // Variant 2: sections as object with multiline string bullets
  const variantBullets = JSON.stringify({
    summary: 'Pake 项目版本更新',
    sections: {
      features: '- 支持全屏尺寸保持\n- 优化拖拽交互',
      fixes: '- 修复拖拽问题'
    }
  });
  const resBullets = parseAndValidateChangelog(variantBullets, grounding);
  assert.equal(resBullets.isStructured, true);
  assert.equal(resBullets.sections.features.length, 2);
  assert.equal(resBullets.sections.fixes.length, 1);

  // Variant 3: empty sections with summary compiles explanatory notice instead of empty whitespace
  const emptySectionsDoc = { isStructured: true, summary: '只有概览', sections: { breaking: [], features: [], fixes: [], performance: [], refactoring: [], chore: [] } };
  const emptyCompiled = compileCanonicalChangelog(emptySectionsDoc, { grounding: { owner: 'a', repo: 'b', language: 'zh-CN' } });
  assert.match(emptyCompiled, /未提炼出分类变更条目/);
});
