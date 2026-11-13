// ==UserScript==
// @name         GitHub AI Changelog
// @namespace    https://github.com/zhaobozhen/github_commit_compare_script
// @version      0.2.7
// @description  在 GitHub 仓库页提供入口，对比任意两个 Commit 或 Tag 并通过自定义 AI 服务生成人类可读的变更日志
// @author       zhaobozhen
// @match        https://github.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      api.github.com
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      api.anthropic.com
// @connect      openrouter.ai
// @connect      generativelanguage.googleapis.com
// @connect      integrate.api.nvidia.com
// @connect      api.siliconflow.cn
// @connect      dashscope.aliyuncs.com
// @connect      ark.cn-beijing.volces.com
// @connect      open.bigmodel.cn
// @connect      api.moonshot.cn
// @connect      api.groq.com
// @connect      api.mistral.ai
// @connect      api.x.ai
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const PREFS_STORE_NAME = 'githubAiChangelogPrefsV1';
  const CACHE_STORE_NAME = 'githubAiChangelogCacheV4';
  const MAX_CACHE_ENTRIES = 20;
  const DEFAULT_MAX_PATCH_CHARS = 36000;
  const TRIGGER_HOST_ID = 'gh-ai-changelog-trigger-host';
  const FLOATING_HOST_ID = 'gh-ai-changelog-floating-host';
  const DRAWER_HOST_ID = 'gh-ai-changelog-drawer-host';

  const NON_REPO_TOP_SEGMENTS = new Set([
    'about',
    'account',
    'advisories',
    'apps',
    'assets',
    'codespaces',
    'collections',
    'contact',
    'copilot',
    'customer-stories',
    'dashboard',
    'edu',
    'enterprise',
    'events',
    'explore',
    'features',
    'fluidicon.svg',
    'gist',
    'images',
    'import',
    'issues',
    'join',
    'login',
    'logout',
    'marketplace',
    'mobile',
    'new',
    'notifications',
    'organizations',
    'orgs',
    'packages',
    'password_reset',
    'pricing',
    'pulls',
    'readme',
    'resources',
    'search',
    'security',
    'sessions',
    'settings',
    'signup',
    'site',
    'solutions',
    'sponsors',
    'stars',
    'team',
    'topics',
    'trending',
    'users',
    'watching'
  ]);

  const NOISE_BASENAMES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    'cargo.lock',
    'podfile.lock',
    'gemfile.lock',
    'composer.lock',
    'poetry.lock',
    'uv.lock',
    'go.sum',
    'flake.lock',
    'mix.lock',
    'packages.lock.json',
    'pipfile.lock'
  ]);

  const NOISE_SUFFIXES = [
    '.min.js',
    '.min.css',
    '.js.map',
    '.css.map',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.otf',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
    '.jar',
    '.apk',
    '.ipa',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.wasm',
    '.mp4',
    '.mp3',
    '.wav',
    '.mov'
  ];

  const CHANGELOG_SECTION_ORDER = [
    'breaking',
    'features',
    'fixes',
    'performance',
    'refactoring',
    'chore'
  ];

  const CHANGELOG_SECTION_LABELS = {
    'zh-CN': {
      breaking: '破坏性变更（Breaking Changes）',
      features: '新增功能（Features）',
      fixes: '问题修复（Bug Fixes）',
      performance: '性能优化（Performance）',
      refactoring: '重构与代码整理（Refactoring）',
      chore: '文档、构建与依赖（Docs & Chore）'
    },
    'zh-TW': {
      breaking: '破壞性變更（Breaking Changes）',
      features: '新增功能（Features）',
      fixes: '問題修復（Bug Fixes）',
      performance: '效能優化（Performance）',
      refactoring: '重構與程式碼整理（Refactoring）',
      chore: '文件、建置與相依性（Docs & Chore）'
    },
    en: {
      breaking: 'Breaking Changes',
      features: 'Features',
      fixes: 'Bug Fixes',
      performance: 'Performance',
      refactoring: 'Refactoring',
      chore: 'Docs & Chore'
    }
  };

  const SECTION_KEY_ALIASES = {
    breaking: 'breaking',
    breakingchange: 'breaking',
    breakingchanges: 'breaking',
    incompatible: 'breaking',
    破坏性变更: 'breaking',
    重大变更: 'breaking',
    破坏性: 'breaking',
    不兼容: 'breaking',
    feature: 'features',
    features: 'features',
    feat: 'features',
    newfeature: 'features',
    newfeatures: 'features',
    enhancement: 'features',
    enhancements: 'features',
    新增功能: 'features',
    新功能: 'features',
    功能: 'features',
    特性: 'features',
    新增: 'features',
    新特性: 'features',
    功能更新: 'features',
    fix: 'fixes',
    fixes: 'fixes',
    bugfix: 'fixes',
    bugfixes: 'fixes',
    bug: 'fixes',
    bugs: 'fixes',
    hotfix: 'fixes',
    问题修复: 'fixes',
    修复: 'fixes',
    缺陷修复: 'fixes',
    缺陷: 'fixes',
    bug修复: 'fixes',
    perf: 'performance',
    performance: 'performance',
    optimization: 'performance',
    optimizations: 'performance',
    speed: 'performance',
    性能优化: 'performance',
    性能: 'performance',
    优化: 'performance',
    refactor: 'refactoring',
    refactoring: 'refactoring',
    cleanup: 'refactoring',
    codecleanup: 'refactoring',
    重构: 'refactoring',
    重构与代码整理: 'refactoring',
    整理: 'refactoring',
    代码重构: 'refactoring',
    chore: 'chore',
    chores: 'chore',
    docs: 'chore',
    doc: 'chore',
    documentation: 'chore',
    build: 'chore',
    ci: 'chore',
    deps: 'chore',
    dependencies: 'chore',
    dependency: 'chore',
    tool: 'chore',
    tools: 'chore',
    docschore: 'chore',
    other: 'chore',
    misc: 'chore',
    文档: 'chore',
    构建: 'chore',
    依赖: 'chore',
    其他: 'chore',
    杂项: 'chore',
    文档构建与依赖: 'chore',
    文档与构建: 'chore'
  };

  const PROVIDER_PRESETS = {
    openrouterFree: {
      name: 'OpenRouter (Free)',
      type: 'openai',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openrouter/free',
      hint: '免费层预设：在 openrouter.ai 免费创建 API Key 后填入即可使用。'
    },
    gemini: {
      name: 'Google Gemini',
      type: 'openai',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-3.8-flash',
      hint: '免费层预设：在 aistudio.google.com 免费获取 Gemini API Key 后填入。'
    },
    groq: {
      name: 'Groq',
      type: 'openai',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
      hint: '免费层预设：在 console.groq.com 免费注册并创建 API Key 后填入。'
    },
    siliconflowFree: {
      name: '硅基流动 (Free)',
      type: 'openai',
      endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      hint: '免费层预设：在 siliconflow.cn 创建 API Key 后可使用免费模型（如 Qwen/Qwen2.5-7B-Instruct）。'
    },
    openai: {
      name: 'OpenAI',
      type: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini'
    },
    deepseek: {
      name: 'DeepSeek',
      type: 'openai',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat'
    },
    anthropic: {
      name: 'Anthropic Claude',
      type: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-4-5'
    },
    ollama: {
      name: 'Ollama (Local)',
      type: 'openai',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'qwen2.5-coder:14b',
      hint: '本地运行无需 API Key，需先在本机启动 Ollama 服务。'
    }
  };

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_err) {
      return value;
    }
  }

  function parseGitHubRepoUrl(urlString, options = {}) {
    let parsed;
    try {
      parsed = new URL(urlString, 'https://github.com');
    } catch (_err) {
      return null;
    }

    if (parsed.hostname !== 'github.com') {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const owner = safeDecodeURIComponent(segments[0]);
    const repo = safeDecodeURIComponent(segments[1]);
    const slugPattern = /^[A-Za-z0-9._-]+$/;

    if (NON_REPO_TOP_SEGMENTS.has(owner.toLowerCase())) {
      return null;
    }
    if (!slugPattern.test(owner) || !slugPattern.test(repo) || owner.startsWith('.')) {
      return null;
    }
    if (options.isNotFoundPage) {
      return null;
    }

    let compareBase = '';
    let compareHead = '';
    if (segments[2] === 'compare' && segments.length >= 4) {
      const rawCompareSpec = segments.slice(3).join('/');
      const dotSeparator = rawCompareSpec.includes('...') ? '...' : rawCompareSpec.includes('..') ? '..' : null;
      if (dotSeparator) {
        const sepIndex = rawCompareSpec.indexOf(dotSeparator);
        compareBase = safeDecodeURIComponent(rawCompareSpec.slice(0, sepIndex));
        compareHead = safeDecodeURIComponent(rawCompareSpec.slice(sepIndex + dotSeparator.length));
      } else {
        compareHead = safeDecodeURIComponent(rawCompareSpec);
      }
    }

    return {
      owner,
      repo,
      repoFullName: `${owner}/${repo}`,
      compareBase,
      compareHead
    };
  }

  function buildCompareApiUrl(owner, repo, base, head) {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);
    const encBase = encodeURIComponent(base.trim());
    const encHead = encodeURIComponent(head.trim());
    return `https://api.github.com/repos/${encOwner}/${encRepo}/compare/${encBase}...${encHead}`;
  }

  function buildRefsApiUrls(owner, repo) {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);
    return {
      tagsUrl: `https://api.github.com/repos/${encOwner}/${encRepo}/tags?per_page=100`,
      branchesUrl: `https://api.github.com/repos/${encOwner}/${encRepo}/branches?per_page=40`
    };
  }

  function buildWebRefsUrls(owner, repo) {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);
    return {
      tagsUrl: `https://github.com/${encOwner}/${encRepo}/refs?type=tag`,
      branchesUrl: `https://github.com/${encOwner}/${encRepo}/refs?type=branch`
    };
  }

  function parseGitHubRefsPayload(rawText) {
    try {
      const parsed = JSON.parse(rawText || '');
      if (parsed && Array.isArray(parsed.refs)) {
        return parsed.refs.filter((name) => typeof name === 'string' && name.length > 0);
      }
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (entry && typeof entry.name === 'string' ? entry.name : ''))
          .filter(Boolean);
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  function isNoiseFile(filename) {
    if (!filename || typeof filename !== 'string') {
      return false;
    }
    const normalized = filename.trim().toLowerCase();
    const lastSlash = normalized.lastIndexOf('/');
    const basename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    if (NOISE_BASENAMES.has(basename)) {
      return true;
    }
    return NOISE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
  }

  function detectBrowserLanguage(overrideLocale) {
    if (typeof overrideLocale === 'string' && overrideLocale.trim()) {
      return overrideLocale.trim();
    }
    if (typeof navigator !== 'undefined') {
      const navLang = navigator.language || (Array.isArray(navigator.languages) && navigator.languages[0]) || '';
      if (typeof navLang === 'string' && navLang.trim()) {
        return navLang.trim();
      }
    }
    return 'en';
  }

  function resolveOutputLanguage(languageSetting = 'auto', browserLangOverride = '') {
    if (languageSetting === 'zh-CN') {
      return {
        setting: 'zh-CN',
        templateLocale: 'zh-CN',
        localeCode: 'zh-CN',
        aiLanguageName: 'Simplified Chinese (简体中文)'
      };
    }
    if (languageSetting === 'zh-TW') {
      return {
        setting: 'zh-TW',
        templateLocale: 'zh-TW',
        localeCode: 'zh-TW',
        aiLanguageName: 'Traditional Chinese (繁體中文)'
      };
    }
    if (languageSetting === 'en') {
      return {
        setting: 'en',
        templateLocale: 'en',
        localeCode: 'en',
        aiLanguageName: 'English'
      };
    }

    const rawBrowser = detectBrowserLanguage(browserLangOverride);
    const lower = rawBrowser.toLowerCase();
    if (/^zh(?:[-_](?:tw|hk|mo|hant))\b/.test(lower)) {
      return {
        setting: 'auto',
        templateLocale: 'zh-TW',
        localeCode: rawBrowser,
        aiLanguageName: 'Traditional Chinese (繁體中文)'
      };
    }
    if (/^zh\b/.test(lower)) {
      return {
        setting: 'auto',
        templateLocale: 'zh-CN',
        localeCode: rawBrowser,
        aiLanguageName: 'Simplified Chinese (简体中文)'
      };
    }
    if (/^en\b/.test(lower)) {
      return {
        setting: 'auto',
        templateLocale: 'en',
        localeCode: rawBrowser,
        aiLanguageName: 'English'
      };
    }
    return {
      setting: 'auto',
      templateLocale: 'en',
      localeCode: rawBrowser,
      aiLanguageName: rawBrowser
    };
  }

  function fileDiffPriority(filename) {
    const lower = String(filename || '').trim().toLowerCase();
    if (/(?:^|\/)(?:test|tests|__tests__|spec|specs|fixtures?|__snapshots__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(lower)) {
      return 2;
    }
    if (/(?:^|\/)(?:docs?|\.github)(?:\/|$)|\.(?:md|mdx|txt|yml|yaml|toml|properties)$/i.test(lower) || /gradle|package\.json$/i.test(lower)) {
      return 1;
    }
    return 0;
  }

  function compactPatchText(patch) {
    return String(patch || '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n \n(?: \n)+/g, '\n \n');
  }

  function buildChangelogPromptContext(compareData, options = {}) {
    const owner = options.owner || '';
    const repo = options.repo || '';
    const base = options.base || '';
    const head = options.head || '';
    const resolvedLanguage = resolveOutputLanguage(options.language || 'auto', options.browserLanguage);
    const language = resolvedLanguage.templateLocale;
    const customPrompt = (options.customPrompt || '').trim();
    const commitsOnly = Boolean(options.commitsOnly);
    const maxPatchChars = Number.isFinite(Number(options.maxPatchChars)) && Number(options.maxPatchChars) > 0
      ? Math.floor(Number(options.maxPatchChars))
      : DEFAULT_MAX_PATCH_CHARS;

    const commits = Array.isArray(compareData && compareData.commits) ? compareData.commits : [];
    const files = Array.isArray(compareData && compareData.files) ? compareData.files : [];
    const totalCommits = Number.isFinite(compareData && compareData.total_commits)
      ? compareData.total_commits
      : commits.length;

    const commitsTruncated = totalCommits > commits.length;
    const filesTruncated = files.length >= 300;

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const fileItem of files) {
      totalAdditions += Number(fileItem.additions || 0);
      totalDeletions += Number(fileItem.deletions || 0);
    }

    const commitLines = commits.map((commitEntry) => {
      const sha = String(commitEntry.sha || '').slice(0, 7) || 'unknown';
      const rawMessage = String((commitEntry.commit && commitEntry.commit.message) || '').trim();
      const lines = rawMessage.split(/\r?\n/);
      const subject = lines[0] || '(no message)';
      if (commitsOnly && lines.length > 1) {
        const bodyLines = lines
          .slice(1)
          .filter((line) => !/^(?:Signed-off-by|Co-authored-by|Reviewed-by|Acked-by|Change-Id):/i.test(line.trim()));
        const bodyPreview = bodyLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (bodyPreview) {
          return `- ${sha} ${subject} — ${bodyPreview}`;
        }
      }
      return `- ${sha} ${subject}`;
    });

    const filteredNoiseFiles = [];
    const noPatchFiles = [];
    const patchCandidates = [];
    const fileMetaByName = new Map();

    for (const fileItem of files) {
      const filename = String(fileItem.filename || '');
      const status = String(fileItem.status || 'modified');
      const additions = Number(fileItem.additions || 0);
      const deletions = Number(fileItem.deletions || 0);
      const noise = isNoiseFile(filename);
      const hasPatch = typeof fileItem.patch === 'string' && fileItem.patch.length > 0;

      if (noise) {
        filteredNoiseFiles.push(filename);
      } else if (!hasPatch) {
        noPatchFiles.push(filename);
        const renameSuffix = fileItem.previous_filename ? ` <- ${fileItem.previous_filename}` : '';
        fileMetaByName.set(filename, `- [${status}] ${filename}${renameSuffix} (+${additions}/-${deletions})`);
      } else if (!commitsOnly) {
        const compactedPatch = compactPatchText(fileItem.patch);
        patchCandidates.push({
          filename,
          status,
          additions,
          deletions,
          priority: fileDiffPriority(filename),
          patch: compactedPatch
        });
      } else {
        const renameSuffix = fileItem.previous_filename ? ` <- ${fileItem.previous_filename}` : '';
        fileMetaByName.set(filename, `- [${status}] ${filename}${renameSuffix} (+${additions}/-${deletions})`);
      }
    }

    const includedPatches = [];
    const omittedPatchFiles = [];
    let usedPatchChars = 0;

    if (!commitsOnly && patchCandidates.length > 0) {
      // Allocate diff budget to source files first, then shorter patches within each priority tier.
      const sorted = [...patchCandidates].sort(
        (left, right) => (left.priority - right.priority) || (left.patch.length - right.patch.length)
      );
      let remainingBudget = maxPatchChars;
      for (let index = 0; index < sorted.length; index += 1) {
        const candidate = sorted[index];
        const remainingCount = sorted.length - index;
        if (remainingBudget < 200) {
          omittedPatchFiles.push(candidate.filename);
          fileMetaByName.set(
            candidate.filename,
            `- [${candidate.status}] ${candidate.filename} (+${candidate.additions}/-${candidate.deletions})`
          );
          continue;
        }
        const fairShare = Math.max(1800, Math.floor(remainingBudget / remainingCount));
        const limit = Math.min(remainingBudget, fairShare);
        let snippet = candidate.patch;
        let truncatedPatch = false;
        if (snippet.length > limit) {
          snippet = `${snippet.slice(0, limit)}\n... [diff truncated at ${limit} chars]`;
          truncatedPatch = true;
        }
        usedPatchChars += snippet.length;
        remainingBudget = Math.max(0, remainingBudget - snippet.length);
        includedPatches.push({
          filename: candidate.filename,
          status: candidate.status,
          truncated: truncatedPatch,
          patch: snippet
        });
      }
    }

    let systemLines;
    if (resolvedLanguage.templateLocale === 'zh-CN') {
      systemLines = [
        '你是资深发布经理。依据提供的提交与 Diff 生成面向用户的【简体中文】变更日志。',
        '语言约束：summary、title、detail 必须全部使用【简体中文】，即使原始提交为英文也须意译为自然中文。',
        '仅输出单个合法 JSON 对象（禁用 Markdown 围栏与多余文字），Schema：'
          + '{"summary":"用 2 到 3 句简体中文概括本次核心变更","sections":{"breaking":[],"features":[{"title":"简短标题(<=12字)","detail":"1句说明行为变化与影响","commits":["abc1234"]}],"fixes":[],"performance":[],"refactoring":[],"chore":[]}}',
        '归类与质量：1) sections 严禁全部留空！必须根据 Diff 至少提取 1 到 5 条条目（通常放入 features、fixes 或 chore）；2) 将关联提交合并为一条主题变更，禁止逐条复读 commit；3) 仅保留真实改变行为/构建的内容，忽略纯格式化/无意义琐碎改动；4) 禁止罗列类名、符号名、文件路径、Markdown 标题或统计信息；5) commits 仅引用输入中的真实短 SHA，严禁编造。'
      ];
    } else if (resolvedLanguage.templateLocale === 'zh-TW') {
      systemLines = [
        '你是資深發布經理。依據提供的提交與 Diff 產生面向使用者的【繁體中文】變更日誌。',
        '語言約束：summary、title、detail 必須全部使用【繁體中文】，即使原始提交為英文也須意譯為自然中文。',
        '僅輸出單個合法 JSON 物件（禁用 Markdown 圍欄與多餘文字），Schema：'
          + '{"summary":"用 2 到 3 句繁體中文概括本次核心變更","sections":{"breaking":[],"features":[{"title":"簡短標題(<=12字)","detail":"1句說明行為變化與影響","commits":["abc1234"]}],"fixes":[],"performance":[],"refactoring":[],"chore":[]}}',
        '歸類與品質：1) sections 嚴禁全部留空！必須依據 Diff 至少提取 1 到 5 條項目（通常放入 features、fixes 或 chore）；2) 將關聯提交合併為一條主題變更，禁止逐條複讀 commit；3) 僅保留真實改變行為/建置的內容，忽略無意義瑣碎改動；4) 禁止羅列類別名、符號名、檔案路徑、Markdown 標題或統計資訊；5) commits 僅引用輸入中的真實短 SHA，嚴禁編造。'
      ];
    } else {
      systemLines = [
        `Release changelog generator. Summarize the GitHub compare data strictly in ${resolvedLanguage.aiLanguageName}.`,
        `Return ONLY one valid JSON object (no code fences or prose): {"summary":"2-3 concise sentences","sections":{"breaking":[],"features":[{"title":"Short title","detail":"1 sentence on behavior and impact","commits":["abc1234"]}],"fixes":[],"performance":[],"refactoring":[],"chore":[]}}`,
        `Rules: 1) Do NOT leave all sections empty; extract at least 1-5 concrete entries into features, fixes, or chore based on diffs. 2) Merge related commits into cohesive entries instead of parroting raw commit subjects. 3) Cite only real short SHAs from Commits; never invent changes. 4) Do NOT list class names, symbol names, file paths, headings, or stats. 5) Translate all text into natural ${resolvedLanguage.aiLanguageName}.`
      ];
    }
    if (customPrompt) {
      systemLines.push(`Extra instruction: ${customPrompt}`);
    }

    const boundaryNotes = [];
    if (commitsTruncated) {
      boundaryNotes.push(`Commits capped by API: ${commits.length}/${totalCommits}`);
    }
    if (filesTruncated) {
      boundaryNotes.push(`Files capped by API: ${files.length}`);
    }
    if (commitsOnly) {
      boundaryNotes.push('Commits-only mode (diffs omitted)');
    } else if (omittedPatchFiles.length > 0 || includedPatches.some((item) => item.truncated)) {
      boundaryNotes.push(`Diff budget: ${includedPatches.filter((item) => item.truncated).length} truncated, ${omittedPatchFiles.length} omitted`);
    }

    const summaryHeader = `Repo: ${owner}/${repo} | ${base}...${head} | Commits: ${commits.length}/${totalCommits} | Files: ${files.length} (+${totalAdditions}/-${totalDeletions})${filteredNoiseFiles.length ? ` | Filtered noise: ${filteredNoiseFiles.length}` : ''}`;
    const userSections = [
      boundaryNotes.length > 0 ? `${summaryHeader}\nBoundaries: ${boundaryNotes.join('; ')}` : summaryHeader
    ];

    userSections.push(`Commits (${commitLines.length}):\n${commitLines.length ? commitLines.join('\n') : '(none)'}`);

    const unpatchedLines = [...fileMetaByName.values()];
    if (unpatchedLines.length > 0) {
      const previewLines = unpatchedLines.slice(0, 40);
      const overflowNote = unpatchedLines.length > 40 ? `\n- ... (+${unpatchedLines.length - 40} more files)` : '';
      userSections.push(`Other Changed Files (${unpatchedLines.length}):\n${previewLines.join('\n')}${overflowNote}`);
    }

    if (includedPatches.length > 0) {
      const diffBlocks = includedPatches.map((item) => `### ${item.filename} [${item.status}]${item.truncated ? ' (truncated)' : ''}\n${item.patch}`);
      userSections.push(`Diffs (${includedPatches.length}, ${usedPatchChars} chars):\n${diffBlocks.join('\n\n')}`);
    }

    if (resolvedLanguage.templateLocale === 'zh-CN') {
      userSections.push('最终输出提醒：请仅返回合法 JSON，sections 严禁全部留空，所有 summary、title、detail 必须全部使用简体中文，不要在变更描述中罗列类名或文件路径。');
    } else if (resolvedLanguage.templateLocale === 'zh-TW') {
      userSections.push('最終輸出提醒：請僅回傳合法 JSON，sections 嚴禁全部留空，所有 summary、title、detail 必須全部使用繁體中文，不要在變更描述中羅列類別名稱或檔案路徑。');
    } else {
      userSections.push(`FINAL OUTPUT REMINDER: Return only valid JSON. Do not leave all sections empty. Write all "summary", "title", and "detail" values strictly in ${resolvedLanguage.aiLanguageName}, and do not list changed class names or file paths.`);
    }

    return {
      systemPrompt: systemLines.join('\n\n'),
      userPrompt: userSections.join('\n\n'),
      grounding: {
        owner,
        repo,
        base,
        head,
        language,
        localeCode: resolvedLanguage.localeCode,
        validShas: commits.map((commitEntry) => String(commitEntry.sha || '').toLowerCase()).filter(Boolean)
      },
      stats: {
        totalCommits,
        returnedCommits: commits.length,
        commitsTruncated,
        listedFiles: files.length,
        filesTruncated,
        totalAdditions,
        totalDeletions,
        filteredNoiseCount: filteredNoiseFiles.length,
        noPatchCount: noPatchFiles.length,
        includedPatchCount: includedPatches.length,
        omittedPatchCount: omittedPatchFiles.length,
        partiallyTruncatedPatchCount: includedPatches.filter((item) => item.truncated).length,
        usedPatchChars,
        commitsOnly
      }
    };
  }

  function createEmptySections() {
    return {
      breaking: [],
      features: [],
      fixes: [],
      performance: [],
      refactoring: [],
      chore: []
    };
  }

  function normalizeSectionKey(rawKey) {
    const compact = String(rawKey || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_&-]+/g, '');
    return SECTION_KEY_ALIASES[compact] || 'chore';
  }

  function extractJsonObjectText(rawText) {
    const source = String(rawText || '').trim();
    if (!source) {
      return '';
    }
    let candidate = source;
    const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
    if (fenceMatch) {
      candidate = fenceMatch[1].trim();
    } else {
      const embeddedFenceMatch = /```json\s*([\s\S]*?)\s*```/i.exec(source);
      if (embeddedFenceMatch) {
        candidate = embeddedFenceMatch[1].trim();
      }
    }
    const firstBrace = candidate.indexOf('{');
    if (firstBrace < 0) {
      return '';
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = firstBrace; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return candidate.slice(firstBrace, index + 1);
        }
      }
    }
    return '';
  }

  function stripTrailingCommas(jsonText) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < jsonText.length; index += 1) {
      const char = jsonText[index];
      if (inString) {
        output += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        output += char;
        continue;
      }
      if (char === ',') {
        let lookahead = index + 1;
        while (lookahead < jsonText.length && /\s/.test(jsonText[lookahead])) {
          lookahead += 1;
        }
        if (jsonText[lookahead] === '}' || jsonText[lookahead] === ']') {
          continue;
        }
      }
      output += char;
    }
    return output;
  }

  function normalizeCommitRefs(rawCommits, validShas) {
    const list = Array.isArray(rawCommits)
      ? rawCommits
      : typeof rawCommits === 'string'
        ? rawCommits.split(/[\s,;]+/)
        : [];
    const hasWhitelist = Array.isArray(validShas) && validShas.length > 0;
    const normalized = [];
    const seen = new Set();
    let droppedCount = 0;

    for (const rawItem of list) {
      const cleaned = String(rawItem || '').trim().replace(/^[`#([{]+|[`)\]}]+$/g, '').toLowerCase();
      if (!cleaned) {
        continue;
      }
      const shaMatch = /\b([0-9a-f]{5,40})\b/.exec(cleaned);
      if (!shaMatch) {
        droppedCount += 1;
        continue;
      }
      const token = shaMatch[1];
      let resolved = token.slice(0, 7);
      if (hasWhitelist) {
        const matchedFull = validShas.find(
          (fullSha) => fullSha.startsWith(token) || (token.length >= 7 && token.startsWith(fullSha.slice(0, 7)))
        );
        if (!matchedFull) {
          droppedCount += 1;
          continue;
        }
        resolved = matchedFull.slice(0, 7);
      }
      if (!seen.has(resolved)) {
        seen.add(resolved);
        normalized.push(resolved);
      }
    }
    return { commits: normalized, droppedCount };
  }

  function normalizeModuleRefs(rawModules) {
    const list = Array.isArray(rawModules)
      ? rawModules
      : typeof rawModules === 'string'
        ? rawModules.split(/[,;]+/)
        : [];
    const normalized = [];
    const seen = new Set();
    for (const rawItem of list) {
      const cleaned = String(rawItem || '').trim().replace(/^`|`$/g, '');
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        normalized.push(cleaned);
        if (normalized.length >= 4) {
          break;
        }
      }
    }
    return normalized;
  }

  function normalizeSectionEntry(rawEntry, validShas) {
    if (typeof rawEntry === 'string') {
      const text = rawEntry.trim().replace(/^[-*+]\s+/, '');
      if (!text) {
        return [];
      }
      if (text.includes('\n- ') || text.includes('\n* ')) {
        const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^[-*+]\s+/, '')).filter(Boolean);
        return lines.map((line) => ({
          entry: { title: '', detail: line, commits: [], modules: [] },
          droppedShasCount: 0
        }));
      }
      return [{ entry: { title: '', detail: text, commits: [], modules: [] }, droppedShasCount: 0 }];
    }
    if (!rawEntry || typeof rawEntry !== 'object') {
      return [];
    }
    const nestedItems = rawEntry.items || rawEntry.entries || rawEntry.changes || rawEntry.list;
    if (Array.isArray(nestedItems) && nestedItems.length > 0) {
      const unrolled = [];
      for (const subItem of nestedItems) {
        unrolled.push(...normalizeSectionEntry(subItem, validShas));
      }
      return unrolled;
    }
    let title = String(rawEntry.title || rawEntry.name || '').trim();
    let detail = String(
      rawEntry.detail
      || rawEntry.description
      || rawEntry.desc
      || rawEntry.content
      || rawEntry.text
      || rawEntry.message
      || rawEntry.body
      || rawEntry.summary
      || ''
    ).trim();
    if (title && !detail) {
      detail = title;
      title = '';
    } else if (title && detail && title === detail) {
      title = '';
    }
    if (!title && !detail) {
      return [];
    }
    const shaResult = normalizeCommitRefs(rawEntry.commits || rawEntry.commit || rawEntry.shas || rawEntry.sha, validShas);
    const modules = normalizeModuleRefs(rawEntry.modules || rawEntry.files || rawEntry.scope);
    return [{
      entry: {
        title,
        detail,
        commits: shaResult.commits,
        modules
      },
      droppedShasCount: shaResult.droppedCount
    }];
  }

  function parseAndValidateChangelog(rawOutput, grounding = {}) {
    const validShas = Array.isArray(grounding.validShas) ? grounding.validShas : [];
    const jsonText = extractJsonObjectText(rawOutput);
    if (jsonText) {
      try {
        const parsed = JSON.parse(stripTrailingCommas(jsonText));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const summary = String(parsed.summary || parsed.overview || parsed.executive_summary || '').trim();
          const sections = createEmptySections();
          let droppedShasCount = 0;
          let itemCount = 0;

          const appendEntryList = (bucketKey, entryList) => {
            for (const item of entryList) {
              sections[bucketKey].push(item.entry);
              droppedShasCount += item.droppedShasCount;
              itemCount += 1;
            }
          };

          const source = parsed.sections || parsed.changes || parsed.categories || parsed.changelog || parsed;

          if (Array.isArray(source)) {
            for (const group of source) {
              if (!group || typeof group !== 'object') {
                continue;
              }
              const catName = group.category || group.name || group.section || group.type || group.group || '';
              const bucketKey = normalizeSectionKey(catName);
              const entries = normalizeSectionEntry(group, validShas);
              appendEntryList(bucketKey, entries);
            }
          } else if (source && typeof source === 'object') {
            for (const [rawKey, rawVal] of Object.entries(source)) {
              if (['summary', 'overview', 'executive_summary'].includes(rawKey)) {
                continue;
              }
              const bucketKey = normalizeSectionKey(rawKey);
              if (Array.isArray(rawVal)) {
                for (const rawItem of rawVal) {
                  appendEntryList(bucketKey, normalizeSectionEntry(rawItem, validShas));
                }
              } else if (typeof rawVal === 'string') {
                const lines = rawVal.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                for (const line of lines) {
                  appendEntryList(bucketKey, normalizeSectionEntry(line, validShas));
                }
              } else if (rawVal && typeof rawVal === 'object') {
                appendEntryList(bucketKey, normalizeSectionEntry(rawVal, validShas));
              }
            }
          }

          if (summary || itemCount > 0) {
            return {
              isStructured: true,
              summary,
              sections,
              fallbackBody: '',
              meta: {
                itemCount,
                droppedShasCount
              }
            };
          }
        }
      } catch (_err) {
        // Fall through to unstructured fallback below.
      }
    }

    const cleanedFallback = String(rawOutput || '')
      .trim()
      .replace(/^```(?:markdown|md|json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    return {
      isStructured: false,
      summary: '',
      sections: createEmptySections(),
      fallbackBody: cleanedFallback,
      meta: {
        itemCount: 0,
        droppedShasCount: 0
      }
    };
  }

  function decodePartialJsonString(source, startQuoteIndex) {
    let result = '';
    let escaped = false;
    for (let index = startQuoteIndex + 1; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        if (char === 'n') {
          result += '\n';
        } else if (char === 'r') {
          result += '\r';
        } else if (char === 't') {
          result += '\t';
        } else if (char === 'u') {
          const hex = source.slice(index + 1, index + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result += String.fromCharCode(Number.parseInt(hex, 16));
            index += 4;
          }
        } else {
          result += char;
        }
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        break;
      }
      result += char;
    }
    return result;
  }

  function extractPartialChangelogDoc(partialJsonText, validShas) {
    const sections = createEmptySections();
    let summary = '';
    const summaryMatch = /"(?:summary|overview|executive_summary)"\s*:\s*"/.exec(partialJsonText);
    if (summaryMatch) {
      summary = decodePartialJsonString(partialJsonText, summaryMatch.index + summaryMatch[0].length - 1).trim();
    }

    let inString = false;
    let escaped = false;
    let braceDepth = 0;
    let lastString = '';
    let currentStringStart = -1;
    let pendingKey = '';
    let activeSectionKey = '';
    let arrayBracketDepth = 0;
    let itemBraceDepth = 0;
    let itemStartIndex = -1;

    for (let index = 0; index < partialJsonText.length; index += 1) {
      const char = partialJsonText[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
          lastString = partialJsonText.slice(currentStringStart + 1, index);
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        currentStringStart = index;
        continue;
      }

      if (char === ':' && (braceDepth === 1 || braceDepth === 2) && arrayBracketDepth === 0) {
        pendingKey = lastString;
        continue;
      }

      if (char === '[' && pendingKey && arrayBracketDepth === 0 && (braceDepth === 1 || braceDepth === 2)) {
        if (!['summary', 'overview', 'executive_summary', 'sections'].includes(pendingKey)) {
          activeSectionKey = normalizeSectionKey(pendingKey);
          arrayBracketDepth = 1;
          itemBraceDepth = 0;
        }
        pendingKey = '';
        continue;
      }

      if (arrayBracketDepth > 0) {
        if (char === '{') {
          if (itemBraceDepth === 0) {
            itemStartIndex = index;
          }
          itemBraceDepth += 1;
        } else if (char === '}') {
          itemBraceDepth -= 1;
          if (itemBraceDepth === 0 && itemStartIndex >= 0 && activeSectionKey) {
            const itemSlice = partialJsonText.slice(itemStartIndex, index + 1);
            try {
              const parsedItem = JSON.parse(stripTrailingCommas(itemSlice));
              const normalized = normalizeSectionEntry(parsedItem, validShas);
              if (Array.isArray(normalized)) {
                for (const subItem of normalized) {
                  sections[activeSectionKey].push(subItem.entry);
                }
              }
            } catch (_err) {
              // Ignore malformed partial object while streaming.
            }
            itemStartIndex = -1;
          }
        } else if (char === '[' && itemBraceDepth === 0) {
          arrayBracketDepth += 1;
        } else if (char === ']' && itemBraceDepth === 0) {
          arrayBracketDepth -= 1;
          if (arrayBracketDepth === 0) {
            activeSectionKey = '';
          }
        }
        continue;
      }

      if (char === '{') {
        braceDepth += 1;
        pendingKey = '';
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        pendingKey = '';
      } else if (!/\s/.test(char)) {
        pendingKey = '';
      }
    }

    return {
      isStructured: true,
      summary,
      sections,
      fallbackBody: '',
      meta: { itemCount: 0, droppedShasCount: 0 }
    };
  }

  function compileCanonicalChangelog(doc, context = {}, options = {}) {
    const grounding = context.grounding || {};
    const stats = context.stats || {};
    const owner = grounding.owner || options.owner || '';
    const repo = grounding.repo || options.repo || '';
    const base = grounding.base || options.base || '';
    const head = grounding.head || options.head || '';
    const rawLang = grounding.language || options.language || 'zh-CN';
    const language = rawLang === 'zh-TW' ? 'zh-TW' : rawLang === 'en' ? 'en' : 'zh-CN';
    const isStreaming = Boolean(options.isStreaming);

    const labels = CHANGELOG_SECTION_LABELS[language];
    const lines = [];

    if (language === 'en') {
      lines.push(`# Changelog: ${owner}/${repo} (${base} -> ${head})`);
      lines.push('');
      lines.push(
        `> Range: \`${base}\` ... \`${head}\` · Commits: \`${stats.returnedCommits ?? 0}\`${stats.commitsTruncated ? ` / \`${stats.totalCommits}\`` : ''} · Files changed: \`${stats.listedFiles ?? 0}\` (\`+${stats.totalAdditions ?? 0}\` / \`-${stats.totalDeletions ?? 0}\`)`
      );
    } else if (language === 'zh-TW') {
      lines.push(`# 變更日誌：${owner}/${repo} (${base} → ${head})`);
      lines.push('');
      lines.push(
        `> 對比範圍：\`${base}\` ... \`${head}\` · 提交：\`${stats.returnedCommits ?? 0}\`${stats.commitsTruncated ? ` / \`${stats.totalCommits}\`` : ''} 次 · 變更檔案：\`${stats.listedFiles ?? 0}\` 個（\`+${stats.totalAdditions ?? 0}\` / \`-${stats.totalDeletions ?? 0}\`）`
      );
    } else {
      lines.push(`# 变更日志：${owner}/${repo} (${base} → ${head})`);
      lines.push('');
      lines.push(
        `> 对比范围：\`${base}\` ... \`${head}\` · 提交：\`${stats.returnedCommits ?? 0}\`${stats.commitsTruncated ? ` / \`${stats.totalCommits}\`` : ''} 次 · 变更文件：\`${stats.listedFiles ?? 0}\` 个（\`+${stats.totalAdditions ?? 0}\` / \`-${stats.totalDeletions ?? 0}\`）`
      );
    }

    if (doc && doc.isStructured) {
      lines.push('');
      lines.push(language === 'en' ? '## Summary' : language === 'zh-TW' ? '## 概覽' : '## 概览');
      lines.push(
        doc.summary || (
          isStreaming
            ? (language === 'en' ? 'Generating summary...' : language === 'zh-TW' ? '正在產生概覽...' : '正在生成概览...')
            : (language === 'en' ? 'No summary provided.' : language === 'zh-TW' ? '暫無概覽說明。' : '暂无概览说明。')
        )
      );

      let renderedItems = 0;
      for (const sectionKey of CHANGELOG_SECTION_ORDER) {
        const items = Array.isArray(doc.sections && doc.sections[sectionKey]) ? doc.sections[sectionKey] : [];
        if (items.length === 0) {
          continue;
        }
        lines.push('');
        lines.push(`## ${labels[sectionKey]}`);
        for (const item of items) {
          if (!item) {
            continue;
          }
          const refs = (item.commits || []).map((sha) => `\`${sha}\``);
          const suffix = refs.length > 0
            ? (language === 'en' ? ` (${refs.join(' · ')})` : `（${refs.join(' · ')}）`)
            : '';
          if (item.title && item.detail) {
            lines.push(language === 'en'
              ? `- **${item.title}**: ${item.detail}${suffix}`
              : `- **${item.title}**：${item.detail}${suffix}`);
          } else if (item.title) {
            lines.push(`- **${item.title}**${suffix}`);
          } else {
            lines.push(`- ${item.detail}${suffix}`);
          }
          renderedItems += 1;
        }
      }

      if (!isStreaming && !doc.summary && renderedItems === 0) {
        lines.push('');
        lines.push(language === 'en'
          ? '_No structured changelog entries were extracted for this range._'
          : language === 'zh-TW'
            ? '_本次對比未擷取到可歸類的有效變更項目。_'
            : '_本次对比未提取到可归类的有效变更条目。_');
      } else if (!isStreaming && renderedItems === 0) {
        lines.push('');
        lines.push(language === 'en'
          ? '_No specific category entries were extracted by the model (click "Regenerate" or try another model in Settings)._'
          : language === 'zh-TW'
            ? '_本次對比模型未提煉出分類變更項目（可點擊「重新產生」或在設定中切換模型）。_'
            : '_本次对比模型未提炼出分类变更条目（可点击「重新生成」或在设置中切换模型）。_');
      }
    } else {
      lines.push('');
      if (!isStreaming) {
        lines.push(language === 'en'
          ? '> Format Note: Model output did not match strict JSON; wrapped into the standard framework.'
          : language === 'zh-TW'
            ? '> 格式說明：模型未按嚴格 JSON 輸出，已按標準框架兜底排版。'
            : '> 格式说明：模型未按严格 JSON 输出，已按标准框架兜底排版。');
        lines.push('');
      }
      if (doc && doc.fallbackBody) {
        lines.push(doc.fallbackBody);
      }
    }

    if (!isStreaming) {
      const scopeParts = [];
      if (stats.commitsTruncated) {
        scopeParts.push(language === 'en'
          ? `GitHub Compare API capped returned commits at ${stats.returnedCommits} of ${stats.totalCommits}`
          : language === 'zh-TW'
            ? `GitHub Compare API 單次僅回傳前 ${stats.returnedCommits} / ${stats.totalCommits} 筆提交`
            : `GitHub Compare API 单次仅返回前 ${stats.returnedCommits} / ${stats.totalCommits} 条提交`);
      }
      if (stats.filesTruncated) {
        scopeParts.push(language === 'en'
          ? `file listing reached the ${stats.listedFiles}-file API limit`
          : language === 'zh-TW'
            ? `變更檔案清單達到 API ${stats.listedFiles} 個檔案上限`
            : `变更文件列表达到 API ${stats.listedFiles} 个文件上限`);
      }
      if (stats.commitsOnly) {
        scopeParts.push(language === 'en'
          ? 'generated in commits-only mode (code diffs omitted)'
          : language === 'zh-TW'
            ? '本次為僅 Commit 摘要模式（未讀取程式碼 Diff）'
            : '本次为仅 Commit 摘要模式（未读取代码 Diff）');
      } else if (stats.omittedPatchCount > 0 || stats.partiallyTruncatedPatchCount > 0) {
        scopeParts.push(language === 'en'
          ? `included ${stats.includedPatchCount} code diffs under budget (${stats.partiallyTruncatedPatchCount} truncated, ${stats.omittedPatchCount} omitted)`
          : language === 'zh-TW'
            ? `依預算納入 ${stats.includedPatchCount} 個程式碼 Diff（截斷 ${stats.partiallyTruncatedPatchCount} 個、省略 ${stats.omittedPatchCount} 個）`
            : `按预算纳入 ${stats.includedPatchCount} 个代码 Diff（截断 ${stats.partiallyTruncatedPatchCount} 个、省略 ${stats.omittedPatchCount} 个）`);
      } else {
        scopeParts.push(language === 'en'
          ? `based on all ${stats.returnedCommits ?? 0} commits and ${stats.includedPatchCount ?? 0} non-noise code diffs`
          : language === 'zh-TW'
            ? `基於介面回傳的全部 ${stats.returnedCommits ?? 0} 筆提交與 ${stats.includedPatchCount ?? 0} 個非雜訊程式碼 Diff`
            : `基于接口返回的全部 ${stats.returnedCommits ?? 0} 条提交与 ${stats.includedPatchCount ?? 0} 个非噪声代码 Diff`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push(language === 'en'
        ? `> Scope Note: ${scopeParts.join('; ')}.`
        : language === 'zh-TW'
          ? `> 資料範圍說明：${scopeParts.join('；')}。`
          : `> 数据范围说明：${scopeParts.join('；')}。`);
    }

    return lines.join('\n');
  }

  function extractStreamingChangelogPreview(rawText, context = {}) {
    const stripped = String(rawText || '').replace(/^\s*```(?:json|markdown|md)?\s*/i, '');
    if (!stripped.trim()) {
      return '';
    }
    const braceIndex = stripped.indexOf('{');
    if (braceIndex >= 0 && braceIndex <= 200 && !stripped.slice(0, braceIndex).includes('#')) {
      const validShas = context.grounding && Array.isArray(context.grounding.validShas)
        ? context.grounding.validShas
        : [];
      const partialDoc = extractPartialChangelogDoc(stripped.slice(braceIndex), validShas);
      return compileCanonicalChangelog(partialDoc, context, { isStreaming: true });
    }
    if (stripped.trim().length < 16) {
      return '';
    }
    return compileCanonicalChangelog(
      {
        isStructured: false,
        summary: '',
        sections: createEmptySections(),
        fallbackBody: stripped.replace(/\s*```\s*$/, '').trim()
      },
      context,
      { isStreaming: true }
    );
  }

  function normalizeEndpoint(type, rawEndpoint) {
    const trimmed = String(rawEndpoint || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
      return type === 'anthropic'
        ? PROVIDER_PRESETS.anthropic.endpoint
        : PROVIDER_PRESETS.openai.endpoint;
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (_err) {
      return trimmed;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (type === 'anthropic') {
      if (pathname.endsWith('/messages')) {
        return trimmed;
      }
      if (/\/v\d+$/.test(pathname)) {
        return `${trimmed}/messages`;
      }
      return `${trimmed}/v1/messages`;
    }

    if (pathname.endsWith('/chat/completions')) {
      return trimmed;
    }
    if (/\/(v\d+(?:beta\d*)?|beta|openai|openai\/v\d+)$/i.test(pathname)) {
      return `${trimmed}/chat/completions`;
    }
    return `${trimmed}/v1/chat/completions`;
  }

  function isLocalOrPrivateEndpoint(endpointUrl) {
    try {
      const host = new URL(endpointUrl).hostname.toLowerCase();
      return (
        host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host === '[::1]'
        || host.endsWith('.local')
        || /^10\./.test(host)
        || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      );
    } catch (_err) {
      return false;
    }
  }

  function normalizeProviderConfig(rawConfig) {
    const type = rawConfig && rawConfig.type === 'anthropic' ? 'anthropic' : 'openai';
    const rawKey = String((rawConfig && rawConfig.apiKey) || '').trim().replace(/^Bearer\s+/i, '').trim();
    return {
      id: String((rawConfig && rawConfig.id) || `provider_${Date.now()}`),
      name: String((rawConfig && rawConfig.name) || (type === 'anthropic' ? 'Anthropic' : 'OpenAI')).trim(),
      type,
      endpoint: normalizeEndpoint(type, rawConfig && rawConfig.endpoint),
      apiKey: rawKey,
      model: String((rawConfig && rawConfig.model) || '').trim()
    };
  }

  function buildAiRequest(rawProvider, systemPrompt, userPrompt, options = {}) {
    const provider = normalizeProviderConfig(rawProvider);
    if (!provider.endpoint) {
      throw new Error('AI 服务 Endpoint 不能为空');
    }
    if (!/^https?:\/\//i.test(provider.endpoint)) {
      throw new Error('AI 服务 Endpoint 必须以 http:// 或 https:// 开头');
    }
    if (!provider.model) {
      throw new Error('AI 模型名称不能为空');
    }
    if (!provider.apiKey && !isLocalOrPrivateEndpoint(provider.endpoint)) {
      throw new Error('请填写 AI 服务的 API Key');
    }

    const stream = options.stream !== false;
    const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 4096;

    if (provider.type === 'anthropic') {
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      };
      if (provider.apiKey) {
        headers['x-api-key'] = provider.apiKey;
      }
      return {
        url: provider.endpoint,
        headers,
        body: JSON.stringify({
          model: provider.model,
          max_tokens: maxTokens,
          stream,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      };
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    const payload = {
      model: provider.model,
      stream,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };
    if (/^https:\/\/integrate\.api\.nvidia\.com\b/i.test(provider.endpoint) && /deepseek-v4/i.test(provider.model)) {
      payload.chat_template_kwargs = { enable_thinking: true, thinking: true };
    }

    return {
      url: provider.endpoint,
      headers,
      body: JSON.stringify(payload)
    };
  }

  function extractNonStreamText(providerType, parsedJson) {
    if (!parsedJson || typeof parsedJson !== 'object') {
      return { text: '', error: '' };
    }
    if (parsedJson.error) {
      const errMsg = typeof parsedJson.error === 'string'
        ? parsedJson.error
        : parsedJson.error.message || JSON.stringify(parsedJson.error);
      return { text: '', error: errMsg };
    }
    if (providerType === 'anthropic') {
      if (Array.isArray(parsedJson.content)) {
        const text = parsedJson.content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('');
        return { text, error: '' };
      }
      return { text: '', error: '' };
    }

    const firstChoice = Array.isArray(parsedJson.choices) ? parsedJson.choices[0] : null;
    if (firstChoice && firstChoice.message && typeof firstChoice.message.content === 'string') {
      return { text: firstChoice.message.content, error: '' };
    }
    if (firstChoice && typeof firstChoice.text === 'string') {
      return { text: firstChoice.text, error: '' };
    }
    return { text: '', error: '' };
  }

  function parseAiResponseChunk(providerType, rawText, previousCursor = 0, isFinal = false) {
    const source = typeof rawText === 'string' ? rawText : '';
    const cursor = Math.max(0, Math.min(previousCursor, source.length));

    // Non-SSE JSON responses (errors or providers ignoring stream=true) are parsed once complete.
    if (cursor === 0 && source.trimStart().startsWith('{')) {
      if (!isFinal) {
        return { cursor: 0, textDelta: '', reasoningDelta: '', done: false, errorMessage: '' };
      }
      try {
        const parsed = JSON.parse(source);
        const extracted = extractNonStreamText(providerType, parsed);
        return {
          cursor: source.length,
          textDelta: extracted.text,
          reasoningDelta: '',
          done: true,
          errorMessage: extracted.error
        };
      } catch (err) {
        return {
          cursor: source.length,
          textDelta: '',
          reasoningDelta: '',
          done: true,
          errorMessage: `AI 返回了无法解析的 JSON: ${err.message}`
        };
      }
    }

    let endLimit = source.length;
    if (!isFinal) {
      const lastNewline = source.lastIndexOf('\n');
      if (lastNewline < cursor) {
        return { cursor, textDelta: '', reasoningDelta: '', done: false, errorMessage: '' };
      }
      endLimit = lastNewline + 1;
    }

    const slice = source.slice(cursor, endLimit);
    const lines = slice.split(/\r?\n/);
    let textDelta = '';
    let reasoningDelta = '';
    let done = false;
    let errorMessage = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':') || line.startsWith('event:')) {
        continue;
      }
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload) {
        continue;
      }
      if (payload === '[DONE]') {
        done = true;
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (_err) {
        continue;
      }

      if (parsed.error) {
        errorMessage = typeof parsed.error === 'string'
          ? parsed.error
          : parsed.error.message || JSON.stringify(parsed.error);
        continue;
      }

      if (providerType === 'anthropic') {
        if (parsed.type === 'content_block_delta' && parsed.delta) {
          if (parsed.delta.type === 'text_delta' && typeof parsed.delta.text === 'string') {
            textDelta += parsed.delta.text;
          } else if (parsed.delta.type === 'thinking_delta' && typeof parsed.delta.thinking === 'string') {
            reasoningDelta += parsed.delta.thinking;
          }
        } else if (parsed.type === 'message_stop') {
          done = true;
        }
        continue;
      }

      const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
      if (choice && choice.delta) {
        if (typeof choice.delta.content === 'string') {
          textDelta += choice.delta.content;
        }
        if (typeof choice.delta.reasoning_content === 'string') {
          reasoningDelta += choice.delta.reasoning_content;
        }
      } else if (choice && choice.message && typeof choice.message.content === 'string') {
        textDelta += choice.message.content;
      }
    }

    return {
      cursor: endLimit,
      textDelta,
      reasoningDelta,
      done: done || isFinal,
      errorMessage
    };
  }

  function sanitizeSafeHttpUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  function parseInlineTokens(text) {
    const tokens = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }
      const segment = match[0];
      if (segment.startsWith('`') && segment.endsWith('`')) {
        tokens.push({ type: 'code', text: segment.slice(1, -1) });
      } else if (segment.startsWith('**') && segment.endsWith('**')) {
        tokens.push({ type: 'strong', children: parseInlineTokens(segment.slice(2, -2)) });
      } else if (segment.startsWith('~~') && segment.endsWith('~~')) {
        tokens.push({ type: 'del', children: parseInlineTokens(segment.slice(2, -2)) });
      } else if (segment.startsWith('*') && segment.endsWith('*')) {
        tokens.push({ type: 'em', children: parseInlineTokens(segment.slice(1, -1)) });
      } else if (segment.startsWith('[')) {
        const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(segment);
        const safeHref = linkMatch ? sanitizeSafeHttpUrl(linkMatch[2].trim()) : null;
        if (linkMatch && safeHref) {
          tokens.push({ type: 'link', text: linkMatch[1], href: safeHref });
        } else {
          tokens.push({ type: 'text', text: segment });
        }
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      tokens.push({ type: 'text', text: text.slice(lastIndex) });
    }
    return tokens;
  }

  function parseMarkdownAst(markdownText) {
    const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          index += 1;
        }
        blocks.push({ type: 'codeblock', lang, text: codeLines.join('\n') });
        continue;
      }

      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          children: parseInlineTokens(headingMatch[2])
        });
        index += 1;
        continue;
      }

      if (/^([-*_])\1{2,}$/.test(trimmed)) {
        blocks.push({ type: 'hr' });
        index += 1;
        continue;
      }

      if (trimmed.startsWith('>')) {
        const quoteLines = [];
        while (index < lines.length && lines[index].trim().startsWith('>')) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        blocks.push({ type: 'blockquote', children: parseInlineTokens(quoteLines.join('\n')) });
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
          items.push(parseInlineTokens(lines[index].trim().replace(/^[-*+]\s+/, '')));
          index += 1;
        }
        blocks.push({ type: 'ul', items });
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          items.push(parseInlineTokens(lines[index].trim().replace(/^\d+\.\s+/, '')));
          index += 1;
        }
        blocks.push({ type: 'ol', items });
        continue;
      }

      const paraLines = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (
          !current
          || current.startsWith('```')
          || /^(#{1,6})\s+/.test(current)
          || /^([-*_])\1{2,}$/.test(current)
          || current.startsWith('>')
          || /^[-*+]\s+/.test(current)
          || /^\d+\.\s+/.test(current)
        ) {
          break;
        }
        paraLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'paragraph', children: parseInlineTokens(paraLines.join('\n')) });
    }

    return blocks;
  }

  function buildCacheKey(owner, repo, base, head, providerId, language, commitsOnly) {
    return [owner, repo, base.trim(), head.trim(), providerId, language, commitsOnly ? 'commits' : 'diff'].join('::');
  }

  function pruneCacheEntries(cacheMap, maxEntries = MAX_CACHE_ENTRIES) {
    const entries = Object.entries(cacheMap || {});
    if (entries.length <= maxEntries) {
      return Object.fromEntries(entries);
    }
    entries.sort((left, right) => (right[1].updatedAt || 0) - (left[1].updatedAt || 0));
    return Object.fromEntries(entries.slice(0, maxEntries));
  }

  function parseRateLimitHeaders(rawHeaders) {
    const headersText = String(rawHeaders || '');
    const remainingMatch = /^x-ratelimit-remaining:\s*(\d+)/im.exec(headersText);
    const resetMatch = /^x-ratelimit-reset:\s*(\d+)/im.exec(headersText);
    return {
      remaining: remainingMatch ? Number(remainingMatch[1]) : null,
      resetEpochSeconds: resetMatch ? Number(resetMatch[1]) : null
    };
  }

  function formatRateLimitTime(resetEpochSeconds) {
    if (!Number.isFinite(resetEpochSeconds)) {
      return '';
    }
    try {
      return new Date(resetEpochSeconds * 1000).toLocaleTimeString();
    } catch (_err) {
      return '';
    }
  }

  function formatGitHubError(status, responseText, rawHeaders) {
    let apiMessage = '';
    try {
      const parsed = JSON.parse(responseText || '{}');
      apiMessage = parsed.message || '';
    } catch (_err) {
      apiMessage = '';
    }
    const rate = parseRateLimitHeaders(rawHeaders);
    const resetTime = formatRateLimitTime(rate.resetEpochSeconds);

    if (status === 401) {
      return 'GitHub Token 无效或已过期，请在设置中更新 Token。';
    }
    if (status === 403 || status === 429) {
      if (rate.remaining === 0) {
        return `GitHub API 速率限制已耗尽${resetTime ? `（预计 ${resetTime} 重置）` : ''}。可在设置中添加只读 GitHub Token 将限额提升至 5000 次/小时。`;
      }
      return `GitHub 拒绝访问 (HTTP ${status})${apiMessage ? `: ${apiMessage}` : ''}`;
    }
    if (status === 404) {
      return '未找到对应仓库或对比引用（Commit / Tag / 分支）。若这是私有仓库，请在设置中配置具备只读权限的 GitHub Token。';
    }
    if (status === 422) {
      return `对比参数无效 (HTTP 422)${apiMessage ? `: ${apiMessage}` : ''}`;
    }
    return `GitHub API 请求失败 (HTTP ${status})${apiMessage ? `: ${apiMessage}` : ''}`;
  }

  function createDefaultSettings() {
    return {
      activeProviderId: '',
      providers: [],
      language: 'auto',
      languageExplicit: false,
      maxPatchChars: DEFAULT_MAX_PATCH_CHARS,
      customPrompt: '',
      githubToken: ''
    };
  }

  function loadSettings() {
    try {
      const raw = GM_getValue(PREFS_STORE_NAME, null);
      if (!raw || typeof raw !== 'object') {
        return createDefaultSettings();
      }
      const providers = Array.isArray(raw.providers)
        ? raw.providers.map((item) => ({
            id: String(item.id || ''),
            name: String(item.name || ''),
            type: item.type === 'anthropic' ? 'anthropic' : 'openai',
            endpoint: String(item.endpoint || ''),
            apiKey: String(item.apiKey || ''),
            model: String(item.model || '')
          }))
        : [];
      const activeProviderId = providers.some((item) => item.id === raw.activeProviderId)
        ? raw.activeProviderId
        : (providers[0] ? providers[0].id : '');
      const allowedLanguages = new Set(['auto', 'zh-CN', 'zh-TW', 'en']);
      const languageExplicit = raw.languageExplicit === true;
      const language = languageExplicit && allowedLanguages.has(raw.language) ? raw.language : 'auto';
      return {
        activeProviderId,
        providers,
        language,
        languageExplicit,
        maxPatchChars: Number.isFinite(Number(raw.maxPatchChars)) && Number(raw.maxPatchChars) > 0
          ? Math.floor(Number(raw.maxPatchChars))
          : DEFAULT_MAX_PATCH_CHARS,
        customPrompt: String(raw.customPrompt || ''),
        githubToken: String(raw.githubToken || '')
      };
    } catch (_err) {
      return createDefaultSettings();
    }
  }

  function saveSettings(settings) {
    GM_setValue(PREFS_STORE_NAME, settings);
  }

  function loadCache() {
    try {
      const raw = GM_getValue(CACHE_STORE_NAME, {});
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_err) {
      return {};
    }
  }

  function saveCacheEntry(cacheKey, entry) {
    const current = loadCache();
    current[cacheKey] = {
      markdown: entry.markdown,
      stats: entry.stats,
      updatedAt: Date.now()
    };
    GM_setValue(CACHE_STORE_NAME, pruneCacheEntries(current));
  }

  function gmFetchText(options) {
    let settled = false;
    let reqHandle = null;
    const promise = new Promise((resolve, reject) => {
      reqHandle = GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        timeout: options.timeout || 90000,
        onprogress(event) {
          if (!settled && options.onProgress && typeof event.responseText === 'string') {
            options.onProgress(event.responseText, event);
          }
        },
        onload(response) {
          if (settled) {
            return;
          }
          settled = true;
          resolve(response);
        },
        onerror(err) {
          if (settled) {
            return;
          }
          settled = true;
          const detail = err && (err.error || err.statusText || (err.status ? `HTTP ${err.status}` : ''));
          reject(new Error(detail
            ? `网络请求失败（${detail}），请检查 Endpoint、本地代理或 Tampermonkey 跨域授权`
            : '网络请求失败，请检查接口地址、代理网络，或确认是否允许了 Tampermonkey 跨域授权窗口'));
        },
        ontimeout() {
          if (settled) {
            return;
          }
          settled = true;
          const timeoutErr = new Error('请求超时，请检查网络连接、代理设置或减小 Diff 字符预算');
          timeoutErr.isTimeout = true;
          reject(timeoutErr);
        },
        onabort() {
          if (settled) {
            return;
          }
          settled = true;
          const abortErr = new Error('已取消生成');
          abortErr.isAbort = true;
          reject(abortErr);
        }
      });
    });
    return {
      promise,
      abort() {
        if (!settled && reqHandle && typeof reqHandle.abort === 'function') {
          reqHandle.abort();
        }
      }
    };
  }

  function isDarkThemeActive() {
    if (typeof document === 'undefined') {
      return false;
    }
    const mode = document.documentElement.dataset.colorMode;
    if (mode === 'dark') {
      return true;
    }
    if (mode === 'light') {
      return false;
    }
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyShadowStyles(shadowRoot, cssText) {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in shadowRoot) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        shadowRoot.adoptedStyleSheets = [sheet];
        return;
      } catch (_err) {
        // Fall back to <style> inside Shadow DOM if adoptedStyleSheets fails.
      }
    }
    const styleNode = document.createElement('style');
    styleNode.textContent = cssText;
    shadowRoot.appendChild(styleNode);
  }

  function createEl(tagName, props = {}, children = []) {
    const element = document.createElement(tagName);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key === 'className') {
        element.className = value;
      } else if (key === 'text') {
        element.textContent = value;
      } else if (key === 'dataset') {
        for (const [dataKey, dataVal] of Object.entries(value)) {
          element.dataset[dataKey] = dataVal;
        }
      } else if (key in element && key !== 'list') {
        element[key] = value;
      } else {
        element.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === undefined) {
        continue;
      }
      element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return element;
  }

  function renderInlineTokensToNode(parentNode, tokens) {
    for (const token of tokens) {
      if (token.type === 'text') {
        parentNode.appendChild(document.createTextNode(token.text));
      } else if (token.type === 'code') {
        const codeEl = document.createElement('code');
        codeEl.textContent = token.text;
        parentNode.appendChild(codeEl);
      } else if (token.type === 'strong') {
        const strongEl = document.createElement('strong');
        renderInlineTokensToNode(strongEl, token.children);
        parentNode.appendChild(strongEl);
      } else if (token.type === 'em') {
        const emEl = document.createElement('em');
        renderInlineTokensToNode(emEl, token.children);
        parentNode.appendChild(emEl);
      } else if (token.type === 'del') {
        const delEl = document.createElement('del');
        renderInlineTokensToNode(delEl, token.children);
        parentNode.appendChild(delEl);
      } else if (token.type === 'link') {
        const linkEl = document.createElement('a');
        linkEl.href = token.href;
        linkEl.target = '_blank';
        linkEl.rel = 'noopener noreferrer';
        linkEl.textContent = token.text;
        parentNode.appendChild(linkEl);
      }
    }
  }

  function renderMarkdownSafely(container, markdownText) {
    container.replaceChildren();
    const blocks = parseMarkdownAst(markdownText);
    if (blocks.length === 0) {
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
      if (block.type === 'heading') {
        const tagName = `h${Math.min(6, Math.max(1, block.level))}`;
        const headingEl = document.createElement(tagName);
        renderInlineTokensToNode(headingEl, block.children);
        fragment.appendChild(headingEl);
      } else if (block.type === 'codeblock') {
        const preEl = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.textContent = block.text;
        preEl.appendChild(codeEl);
        fragment.appendChild(preEl);
      } else if (block.type === 'hr') {
        fragment.appendChild(document.createElement('hr'));
      } else if (block.type === 'blockquote') {
        const quoteEl = document.createElement('blockquote');
        renderInlineTokensToNode(quoteEl, block.children);
        fragment.appendChild(quoteEl);
      } else if (block.type === 'ul' || block.type === 'ol') {
        const listEl = document.createElement(block.type);
        for (const itemTokens of block.items) {
          const liEl = document.createElement('li');
          renderInlineTokensToNode(liEl, itemTokens);
          listEl.appendChild(liEl);
        }
        fragment.appendChild(listEl);
      } else if (block.type === 'paragraph') {
        const paraEl = document.createElement('p');
        renderInlineTokensToNode(paraEl, block.children);
        fragment.appendChild(paraEl);
      }
    }
    container.appendChild(fragment);
  }

  const TRIGGER_CSS = `
    :host { display: inline-flex; align-items: center; vertical-align: middle; }
    :host(.is-floating) {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483630;
    }
    .btn-trigger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--fg);
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .btn-trigger:hover { background: var(--bg-hover); border-color: var(--border-hover); }
    .btn-trigger:active { transform: scale(0.97); }
    @media (prefers-reduced-motion: reduce) {
      .btn-trigger { transition: none; transform: none; }
    }
    .btn-trigger.floating {
      height: 36px;
      padding: 0 14px;
      border-radius: 999px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
      font-size: 13px;
    }
    .spark { color: var(--accent); font-size: 13px; line-height: 1; }
    :host([data-theme="light"]) {
      --bg: #f6f8fa;
      --bg-hover: #eff2f5;
      --fg: #1f2328;
      --border: rgba(31, 35, 40, 0.15);
      --border-hover: rgba(31, 35, 40, 0.25);
      --accent: #0969da;
    }
    :host([data-theme="dark"]) {
      --bg: #21262d;
      --bg-hover: #30363d;
      --fg: #e6edf3;
      --border: rgba(240, 246, 252, 0.14);
      --border-hover: rgba(240, 246, 252, 0.28);
      --accent: #58a6ff;
    }
  `;

  const DRAWER_CSS = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    :host([data-theme="light"]) {
      --surface: #ffffff;
      --surface-subtle: #f6f8fa;
      --surface-hover: #eef1f4;
      --fg: #1f2328;
      --fg-muted: #59636e;
      --border: #d1d9e0;
      --control-bg: #f6f8fa;
      --control-bg-hover: #eff2f5;
      --overlay-bg: #ffffff;
      --overlay-shadow: 0 0 0 1px rgba(209, 217, 224, 0.65), 0 6px 12px -3px rgba(37, 41, 46, 0.04), 0 6px 18px 0 rgba(37, 41, 46, 0.12);
      --accent: #0969da;
      --accent-fg: #ffffff;
      --accent-hover: #0757b8;
      --danger: #cf222e;
      --warn-bg: #fff8c5;
      --warn-border: #d4a72c;
      --warn-fg: #6a4d00;
      --ok-bg: #dafbe1;
      --ok-fg: #1a7f37;
      --code-bg: #eff1f3;
      --shadow: 0 12px 36px rgba(31, 35, 40, 0.22);
    }
    :host([data-theme="dark"]) {
      --surface: #0d1117;
      --surface-subtle: #161b22;
      --surface-hover: #21262d;
      --fg: #e6edf3;
      --fg-muted: #9198a1;
      --border: #30363d;
      --control-bg: #21262d;
      --control-bg-hover: #30363d;
      --overlay-bg: #161b22;
      --overlay-shadow: 0 0 0 1px #30363d, 0 8px 24px rgba(1, 4, 9, 0.65);
      --accent: #2f81f7;
      --accent-fg: #ffffff;
      --accent-hover: #388bfd;
      --danger: #f85149;
      --warn-bg: rgba(187, 128, 9, 0.16);
      --warn-border: rgba(210, 153, 34, 0.45);
      --warn-fg: #e3b341;
      --ok-bg: rgba(46, 160, 67, 0.16);
      --ok-fg: #3fb950;
      --code-bg: rgba(110, 118, 129, 0.25);
      --shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
    }
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      justify-content: flex-end;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 180ms;
    }
    .backdrop.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0s;
    }
    .drawer {
      width: min(760px, 100vw);
      height: 100vh;
      background: var(--surface);
      color: var(--fg);
      border-left: 1px solid var(--border);
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translate3d(28px, 0, 0);
      will-change: transform, opacity;
      transition: transform 180ms cubic-bezier(0.4, 0, 1, 1), opacity 160ms ease;
    }
    .backdrop.open .drawer {
      opacity: 1;
      transform: translate3d(0, 0, 0);
      transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .backdrop, .drawer { transition: none !important; transform: none !important; }
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-subtle);
    }
    .title-wrap { min-width: 0; }
    .title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .repo-badge {
      font-size: 12px;
      font-weight: 500;
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
    }
    .header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .provider-select { width: auto; min-width: 132px; max-width: 190px; }
    .body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stack-grow { flex: 1; }
    .hidden { display: none !important; }
    .card {
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .compare-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 8px;
      align-items: end;
    }
    @media (max-width: 600px) {
      .compare-grid { grid-template-columns: 1fr; }
      .swap-btn { justify-self: start; }
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--fg-muted);
      margin-bottom: 4px;
    }
    input[type="text"], input[type="password"], input[type="number"], select, textarea {
      width: 100%;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--fg);
      font: inherit;
      font-size: 13px;
    }
    textarea { min-height: 70px; resize: vertical; }
    input:focus, select:focus, textarea:focus {
      outline: 2px solid var(--accent);
      outline-offset: -1px;
    }
    .secret-row { display: flex; align-items: center; gap: 6px; }
    .secret-row input { flex: 1; }
    .secret-masked { -webkit-text-security: disc; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--fg);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn:hover:not(:disabled) { background: var(--surface-hover); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary {
      background: var(--accent);
      border-color: transparent;
      color: var(--accent-fg);
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-danger { color: var(--danger); }
    .btn-sm { padding: 4px 9px; font-size: 12px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .mt-8 { margin-top: 8px; }
    .mt-10 { margin-top: 10px; }
    .mb-8 { margin-bottom: 8px; }
    .section-title { display: block; margin-bottom: 8px; font-weight: 600; }
    .checkbox-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--fg-muted);
      cursor: pointer;
    }
    .checkbox-label input { width: auto; }
    .banner {
      padding: 9px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      border: 1px solid var(--border);
      background: var(--surface-subtle);
    }
    .banner.warn {
      background: var(--warn-bg);
      border-color: var(--warn-border);
      color: var(--warn-fg);
    }
    .banner.error {
      border-color: var(--danger);
      color: var(--danger);
    }
    .banner.ok {
      background: var(--ok-bg);
      color: var(--ok-fg);
    }
    .banner.loading {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--fg-muted);
    }
    .ai-thinking-row {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .ai-spark-pulse {
      color: var(--accent);
      font-size: 13px;
      line-height: 1;
      flex-shrink: 0;
      animation: gh-ai-spark 1.8s ease-in-out infinite;
    }
    .ai-shimmer-text {
      background: linear-gradient(90deg, var(--fg-muted) 0%, var(--fg) 45%, var(--fg-muted) 90%);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: gh-ai-shimmer 2s linear infinite;
    }
    .ai-dots {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .ai-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.35;
      animation: gh-ai-dot 1.2s ease-in-out infinite;
    }
    .ai-dot:nth-child(2) { animation-delay: 0.2s; }
    .ai-dot:nth-child(3) { animation-delay: 0.4s; }
    .thinking-state {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 10px 4px;
    }
    .thinking-head {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      font-weight: 500;
    }
    .skeleton-stack { display: flex; flex-direction: column; gap: 9px; }
    .skeleton-line {
      height: 11px;
      border-radius: 6px;
      background: linear-gradient(90deg, var(--surface-subtle) 0%, var(--surface-hover) 50%, var(--surface-subtle) 100%);
      background-size: 200% 100%;
      animation: gh-ai-shimmer 1.8s ease-in-out infinite;
    }
    .skeleton-line.w-78 { width: 78%; }
    .skeleton-line.w-94 { width: 94%; }
    .skeleton-line.w-56 { width: 56%; }
    @keyframes gh-ai-spark {
      0%, 100% { opacity: 0.55; transform: scale(0.92); }
      50% { opacity: 1; transform: scale(1.08); }
    }
    @keyframes gh-ai-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    @keyframes gh-ai-dot {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ai-spark-pulse, .ai-dot, .skeleton-line { animation: none !important; }
      .ai-shimmer-text { animation: none !important; background: none; color: var(--fg-muted); -webkit-text-fill-color: currentColor; }
    }
    .stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: var(--fg-muted);
    }
    .stat-pill {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
    }
    .output-box {
      flex: 1;
      min-height: 220px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      background: var(--surface);
      overflow-wrap: anywhere;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
      margin: 14px 0 8px;
      line-height: 1.3;
      font-weight: 600;
    }
    .markdown-body h1:first-child, .markdown-body h2:first-child, .markdown-body h3:first-child { margin-top: 0; }
    .markdown-body p { margin: 8px 0; }
    .markdown-body ul, .markdown-body ol { margin: 8px 0; padding-left: 22px; }
    .markdown-body li { margin: 4px 0; }
    .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 85%;
      padding: 2px 5px;
      border-radius: 4px;
      background: var(--code-bg);
    }
    .markdown-body pre {
      margin: 10px 0;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      overflow-x: auto;
    }
    .markdown-body pre code { padding: 0; background: transparent; font-size: 12px; }
    .markdown-body blockquote {
      margin: 8px 0;
      padding: 2px 12px;
      border-left: 3px solid var(--border);
      color: var(--fg-muted);
    }
    .markdown-body a { color: var(--accent); text-decoration: none; }
    .markdown-body a:hover { text-decoration: underline; }
    .raw-pre {
      margin: 0;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
    }
    .provider-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      margin-bottom: 6px;
    }
    .provider-meta { min-width: 0; }
    .provider-title { font-weight: 600; font-size: 13px; }
    .provider-sub { font-size: 12px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
    .hint { font-size: 11.5px; color: var(--fg-muted); margin-top: 4px; }
    .hint-inline { margin-top: 0; }
    .empty-state { color: var(--fg-muted); text-align: center; padding: 36px 16px; font-size: 13px; }
    .gh-menu-wrap { position: relative; }
    .gh-select-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      height: 32px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--control-bg);
      color: var(--fg);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .gh-select-btn:hover { background: var(--control-bg-hover); }
    .gh-select-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
    .gh-select-sm .gh-select-btn { height: 28px; padding: 0 8px; font-size: 12px; }
    .gh-select-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
    .gh-chevron { width: 16px; height: 16px; flex-shrink: 0; fill: var(--fg-muted); }
    .gh-overlay {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 100%;
      z-index: 30;
      border-radius: 12px;
      background: var(--overlay-bg);
      box-shadow: var(--overlay-shadow);
      padding: 6px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(0, -4px, 0) scale(0.985);
      transform-origin: top center;
      transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 140ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 140ms;
    }
    .gh-overlay.align-right { left: auto; right: 0; }
    .gh-overlay.open-up {
      top: auto;
      bottom: calc(100% + 6px);
      transform-origin: bottom center;
      transform: translate3d(0, 4px, 0) scale(0.985);
    }
    .gh-overlay.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0) scale(1);
      transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0s;
    }
    .gh-select-overlay { min-width: max(100%, 210px); max-width: 300px; max-height: 240px; overflow-y: auto; }
    .gh-ref-overlay { width: min(330px, 86vw); padding: 0; overflow: hidden; }
    .gh-ref-control {
      display: flex;
      align-items: center;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      overflow: hidden;
      transition: border-color 0.15s ease;
    }
    .gh-ref-control:focus-within { outline: 2px solid var(--accent); outline-offset: -1px; }
    .gh-ref-control input.gh-ref-input {
      flex: 1;
      min-width: 0;
      height: 30px;
      border: none;
      border-radius: 0;
      background: transparent;
      padding: 4px 8px;
      outline: none;
    }
    .gh-ref-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 30px;
      border: none;
      border-left: 1px solid var(--border);
      background: var(--control-bg);
      color: var(--fg-muted);
      cursor: pointer;
      flex-shrink: 0;
    }
    .gh-ref-toggle:hover { background: var(--control-bg-hover); color: var(--fg); }
    .gh-ref-header {
      padding: 8px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .gh-segmented {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 4px;
      padding: 2px;
      border-radius: 6px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
    }
    .gh-seg-btn {
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--fg-muted);
      font: inherit;
      font-size: 11.5px;
      font-weight: 500;
      padding: 3px 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .gh-seg-btn:hover { color: var(--fg); }
    .gh-seg-btn.is-active {
      background: var(--surface);
      color: var(--fg);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
    .gh-ref-filter {
      height: 28px;
      padding: 4px 8px;
      font-size: 12.5px;
    }
    .gh-ref-list {
      max-height: 230px;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .gh-action-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }
    .gh-action-item:hover { background: var(--surface-hover); }
    .gh-action-item.is-selected { font-weight: 600; background: var(--surface-subtle); }
    .gh-item-check { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
    .gh-item-check svg { width: 14px; height: 14px; fill: var(--fg); }
    .gh-item-icon { width: 14px; height: 14px; flex-shrink: 0; fill: var(--fg-muted); }
    .gh-item-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gh-item-badge {
      font-size: 11px;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 6px;
      line-height: 18px;
      flex-shrink: 0;
    }
    .gh-empty-list { padding: 14px 8px; text-align: center; font-size: 12px; color: var(--fg-muted); }
    @media (prefers-reduced-motion: reduce) {
      .gh-overlay { transition: none !important; transform: none !important; }
    }
  `;

  function initBrowserApp() {
    const state = {
      repo: null,
      settings: loadSettings(),
      refsByRepo: new Map(),
      viewMode: 'main',
      outputMode: 'rendered',
      editingProviderId: null,
      markdown: '',
      stats: null,
      isGenerating: false,
      activeRequest: null,
      lastHref: ''
    };

    let drawerElements = null;
    let mountObserverTimer = null;
    const openMenus = new Set();

    function createOcticonSvg(pathData, className = '') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('aria-hidden', 'true');
      if (className) {
        svg.setAttribute('class', className);
      }
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', pathData);
      svg.appendChild(pathEl);
      return svg;
    }

    const ICON_CHEVRON = 'M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z';
    const ICON_CHECK = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z';
    const ICON_TAG = 'M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z';
    const ICON_BRANCH = 'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z';

    function closeAllMenus(exceptMenu = null) {
      let closedAny = false;
      for (const menu of [...openMenus]) {
        if (menu !== exceptMenu && menu.isOpen()) {
          menu.close();
          closedAny = true;
        }
      }
      return closedAny;
    }

    function createPrimerSelect(config = {}) {
      let optionsList = Array.isArray(config.options) ? config.options : [];
      let currentValue = '';
      const changeListeners = [];

      const wrap = createEl('div', {
        className: `gh-menu-wrap${config.compact ? ' gh-select-sm' : ''}${config.className ? ` ${config.className}` : ''}`
      });
      const labelSpan = createEl('span', { className: 'gh-select-label' });
      const triggerBtn = createEl('button', {
        type: 'button',
        id: config.id || '',
        className: 'gh-select-btn',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-label': config.ariaLabel || ''
      }, [labelSpan, createOcticonSvg(ICON_CHEVRON, 'gh-chevron')]);
      const overlay = createEl('div', {
        className: `gh-overlay gh-select-overlay${config.alignRight ? ' align-right' : ''}`,
        role: 'listbox'
      });
      wrap.appendChild(triggerBtn);
      wrap.appendChild(overlay);

      function syncLabel() {
        const matched = optionsList.find((opt) => opt.value === currentValue) || optionsList[0];
        labelSpan.textContent = matched ? matched.label : '';
      }

      function renderItems() {
        overlay.replaceChildren();
        for (const opt of optionsList) {
          const selected = opt.value === currentValue;
          const checkWrap = createEl('span', { className: 'gh-item-check' });
          if (selected) {
            checkWrap.appendChild(createOcticonSvg(ICON_CHECK));
          }
          const itemBtn = createEl('button', {
            type: 'button',
            className: `gh-action-item${selected ? ' is-selected' : ''}`,
            role: 'option',
            'aria-selected': selected ? 'true' : 'false'
          }, [checkWrap, createEl('span', { className: 'gh-item-text', text: opt.label })]);
          itemBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const changed = currentValue !== opt.value;
            currentValue = opt.value;
            syncLabel();
            renderItems();
            controller.close();
            if (changed) {
              for (const listener of changeListeners) {
                listener();
              }
            }
          });
          overlay.appendChild(itemBtn);
        }
      }

      const controller = {
        element: wrap,
        isOpen() {
          return overlay.classList.contains('is-open');
        },
        open() {
          closeAllMenus(controller);
          renderItems();
          const rect = triggerBtn.getBoundingClientRect();
          const shouldFlipUp = typeof window !== 'undefined' && rect.bottom + 240 > window.innerHeight && rect.top > 200;
          overlay.classList.toggle('open-up', shouldFlipUp);
          overlay.classList.add('is-open');
          triggerBtn.setAttribute('aria-expanded', 'true');
          openMenus.add(controller);
        },
        close() {
          overlay.classList.remove('is-open');
          triggerBtn.setAttribute('aria-expanded', 'false');
          openMenus.delete(controller);
        },
        setOptions(nextOptions, preferredValue) {
          optionsList = Array.isArray(nextOptions) ? nextOptions : [];
          if (preferredValue !== undefined && optionsList.some((opt) => opt.value === preferredValue)) {
            currentValue = preferredValue;
          } else if (!optionsList.some((opt) => opt.value === currentValue)) {
            currentValue = optionsList[0] ? optionsList[0].value : '';
          }
          syncLabel();
          if (controller.isOpen()) {
            renderItems();
          }
        },
        addEventListener(eventName, handler) {
          if (eventName === 'change' && typeof handler === 'function') {
            changeListeners.push(handler);
          }
        },
        get value() {
          return currentValue;
        },
        set value(nextVal) {
          const normalized = String(nextVal ?? '');
          if (optionsList.some((opt) => opt.value === normalized)) {
            currentValue = normalized;
          } else if (optionsList[0]) {
            currentValue = optionsList[0].value;
          } else {
            currentValue = '';
          }
          syncLabel();
          if (controller.isOpen()) {
            renderItems();
          }
        }
      };

      triggerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (controller.isOpen()) {
          controller.close();
        } else {
          controller.open();
        }
      });

      controller.setOptions(optionsList, config.value);
      return controller;
    }

    function createRefPicker(config = {}) {
      let refsData = { tags: [], branches: [] };
      let activeTab = 'tags';

      const wrap = createEl('div', { className: 'gh-menu-wrap' });
      const inputEl = createEl('input', {
        type: 'text',
        id: config.id || '',
        className: 'gh-ref-input',
        autocomplete: 'off',
        spellcheck: false,
        placeholder: config.placeholder || 'Tag / Commit SHA / 分支'
      });
      const toggleBtn = createEl('button', {
        type: 'button',
        className: 'gh-ref-toggle',
        'aria-label': '选择 Tag 或分支',
        'aria-expanded': 'false'
      }, [createOcticonSvg(ICON_CHEVRON, 'gh-chevron')]);
      const controlBox = createEl('div', { className: 'gh-ref-control' }, [inputEl, toggleBtn]);

      const tagsTabBtn = createEl('button', { type: 'button', className: 'gh-seg-btn is-active', text: 'Tags (0)' });
      const branchesTabBtn = createEl('button', { type: 'button', className: 'gh-seg-btn', text: 'Branches (0)' });
      const allTabBtn = createEl('button', { type: 'button', className: 'gh-seg-btn', text: '全部' });
      const filterInput = createEl('input', {
        type: 'text',
        className: 'gh-ref-filter',
        autocomplete: 'off',
        spellcheck: false,
        placeholder: '筛选 Tag / 分支...'
      });
      const listEl = createEl('div', { className: 'gh-ref-list', role: 'listbox' });
      const overlay = createEl('div', {
        className: `gh-overlay gh-ref-overlay${config.alignRight ? ' align-right' : ''}`
      }, [
        createEl('div', { className: 'gh-ref-header' }, [
          createEl('div', { className: 'gh-segmented' }, [tagsTabBtn, branchesTabBtn, allTabBtn]),
          filterInput
        ]),
        listEl
      ]);

      wrap.appendChild(controlBox);
      wrap.appendChild(overlay);

      function syncTabs() {
        tagsTabBtn.textContent = `Tags (${refsData.tags.length})`;
        branchesTabBtn.textContent = `Branches (${refsData.branches.length})`;
        tagsTabBtn.classList.toggle('is-active', activeTab === 'tags');
        branchesTabBtn.classList.toggle('is-active', activeTab === 'branches');
        allTabBtn.classList.toggle('is-active', activeTab === 'all');
      }

      function renderList(filterQuery = '') {
        syncTabs();
        listEl.replaceChildren();
        const queryLower = filterQuery.trim().toLowerCase();
        const currentVal = inputEl.value.trim();
        const sourceItems = [];

        if (activeTab === 'tags' || activeTab === 'all') {
          for (const name of refsData.tags) {
            sourceItems.push({ name, kind: 'Tag' });
          }
        }
        if (activeTab === 'branches' || activeTab === 'all') {
          for (const name of refsData.branches) {
            sourceItems.push({ name, kind: 'Branch' });
          }
        }

        const filtered = queryLower
          ? sourceItems.filter((item) => item.name.toLowerCase().includes(queryLower))
          : sourceItems;

        if (filtered.length === 0) {
          const emptyText = sourceItems.length === 0
            ? '暂无可选 Tag 或分支，可直接输入 Commit SHA'
            : '无匹配结果，可直接关闭使用已输入的 Commit SHA';
          listEl.appendChild(createEl('div', { className: 'gh-empty-list', text: emptyText }));
          return;
        }

        for (const item of filtered) {
          const selected = item.name === currentVal;
          const checkWrap = createEl('span', { className: 'gh-item-check' });
          if (selected) {
            checkWrap.appendChild(createOcticonSvg(ICON_CHECK));
          }
          const iconSvg = createOcticonSvg(item.kind === 'Tag' ? ICON_TAG : ICON_BRANCH, 'gh-item-icon');
          const textSpan = createEl('span', { className: 'gh-item-text', text: item.name });
          const children = [checkWrap, iconSvg, textSpan];
          if (activeTab === 'all') {
            children.push(createEl('span', { className: 'gh-item-badge', text: item.kind }));
          }
          const rowBtn = createEl('button', {
            type: 'button',
            className: `gh-action-item${selected ? ' is-selected' : ''}`,
            role: 'option',
            'aria-selected': selected ? 'true' : 'false'
          }, children);
          rowBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            inputEl.value = item.name;
            controller.close();
          });
          listEl.appendChild(rowBtn);
        }
      }

      const controller = {
        element: wrap,
        input: inputEl,
        isOpen() {
          return overlay.classList.contains('is-open');
        },
        open(initialFilter = '') {
          closeAllMenus(controller);
          if (refsData.tags.length === 0 && refsData.branches.length > 0 && activeTab === 'tags') {
            activeTab = 'branches';
          }
          filterInput.value = initialFilter;
          renderList(filterInput.value);
          overlay.classList.add('is-open');
          toggleBtn.setAttribute('aria-expanded', 'true');
          openMenus.add(controller);
        },
        close() {
          overlay.classList.remove('is-open');
          toggleBtn.setAttribute('aria-expanded', 'false');
          openMenus.delete(controller);
        },
        setRefs(nextRefs) {
          refsData = {
            tags: Array.isArray(nextRefs && nextRefs.tags) ? nextRefs.tags : [],
            branches: Array.isArray(nextRefs && nextRefs.branches) ? nextRefs.branches : []
          };
          if (refsData.tags.length > 0 && activeTab === 'branches' && refsData.branches.length === 0) {
            activeTab = 'tags';
          }
          if (controller.isOpen()) {
            renderList(filterInput.value);
          }
        },
        get value() {
          return inputEl.value;
        },
        set value(nextVal) {
          inputEl.value = String(nextVal ?? '');
          if (controller.isOpen()) {
            renderList(filterInput.value);
          }
        }
      };

      overlay.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      inputEl.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!controller.isOpen()) {
          controller.open('');
        }
      });
      inputEl.addEventListener('input', () => {
        if (!controller.isOpen()) {
          controller.open(inputEl.value);
        } else {
          filterInput.value = inputEl.value;
          renderList(filterInput.value);
        }
      });
      inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
          controller.close();
        }
      });
      toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (controller.isOpen()) {
          controller.close();
        } else {
          controller.open('');
          filterInput.focus();
        }
      });
      filterInput.addEventListener('input', () => {
        renderList(filterInput.value);
      });
      tagsTabBtn.addEventListener('click', () => {
        activeTab = 'tags';
        renderList(filterInput.value);
      });
      branchesTabBtn.addEventListener('click', () => {
        activeTab = 'branches';
        renderList(filterInput.value);
      });
      allTabBtn.addEventListener('click', () => {
        activeTab = 'all';
        renderList(filterInput.value);
      });

      return controller;
    }

    function syncThemeAttributes() {
      const theme = isDarkThemeActive() ? 'dark' : 'light';
      for (const hostId of [TRIGGER_HOST_ID, FLOATING_HOST_ID, DRAWER_HOST_ID]) {
        const host = document.getElementById(hostId);
        if (host) {
          host.setAttribute('data-theme', theme);
        }
      }
    }

    function ensureDrawer() {
      if (drawerElements && document.body.contains(drawerElements.host)) {
        return drawerElements;
      }
      const existing = document.getElementById(DRAWER_HOST_ID);
      if (existing) {
        existing.remove();
      }

      const host = document.createElement('div');
      host.id = DRAWER_HOST_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      applyShadowStyles(shadow, DRAWER_CSS);

      const repoBadge = createEl('span', { className: 'repo-badge' });
      const headerProviderSelect = createPrimerSelect({
        id: 'header-provider-select',
        className: 'provider-select',
        ariaLabel: '当前 AI 服务',
        compact: true,
        alignRight: true,
        options: [{ value: '', label: '未配置 AI 服务' }]
      });
      const toggleSettingsBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '设置' });
      const closeBtn = createEl('button', { type: 'button', className: 'btn btn-sm', 'aria-label': '关闭', text: '✕' });

      const baseInput = createRefPicker({
        id: 'base-input',
        placeholder: 'Tag / Commit SHA / 分支'
      });
      const swapRefsBtn = createEl('button', {
        type: 'button',
        className: 'btn btn-sm swap-btn',
        title: '交换起止版本',
        text: '⇄'
      });
      const headInput = createRefPicker({
        id: 'head-input',
        placeholder: 'Tag / Commit SHA / 分支',
        alignRight: true
      });
      const generateBtn = createEl('button', { type: 'button', className: 'btn btn-primary', text: '生成变更日志' });
      const regenerateBtn = createEl('button', { type: 'button', className: 'btn hidden', text: '重新生成' });
      const abortBtn = createEl('button', { type: 'button', className: 'btn btn-danger hidden', text: '停止生成' });
      const refreshRefsBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '刷新 Tags' });
      const commitsOnlyCheckbox = createEl('input', { type: 'checkbox' });
      const refsHint = createEl('div', { className: 'hint', text: '正在读取仓库 Tags 与分支...' });
      const statusBanner = createEl('div', { className: 'banner hidden' });
      const statsBar = createEl('div', { className: 'stats-bar hidden' });
      const modeRenderedBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '渲染视图' });
      const modeRawBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: 'Markdown 原文' });
      const copyBtn = createEl('button', { type: 'button', className: 'btn btn-sm', disabled: true, text: '复制 Markdown' });
      const emptyState = createEl('div', {
        className: 'empty-state',
        text: '选择两个 Commit、Tag 或分支后点击「生成变更日志」。'
      });
      const thinkingState = createEl('div', { className: 'thinking-state hidden' }, [
        createEl('div', { className: 'thinking-head' }, [
          createEl('span', { className: 'ai-spark-pulse', text: '✦' }),
          createEl('span', { className: 'ai-shimmer-text', text: 'AI 正在梳理提交与代码变更' }),
          createEl('span', { className: 'ai-dots', 'aria-hidden': 'true' }, [
            createEl('span', { className: 'ai-dot' }),
            createEl('span', { className: 'ai-dot' }),
            createEl('span', { className: 'ai-dot' })
          ])
        ]),
        createEl('div', { className: 'skeleton-stack', 'aria-hidden': 'true' }, [
          createEl('div', { className: 'skeleton-line w-78' }),
          createEl('div', { className: 'skeleton-line w-94' }),
          createEl('div', { className: 'skeleton-line w-56' })
        ])
      ]);
      const renderedOutput = createEl('div', { className: 'markdown-body hidden' });
      const rawOutput = createEl('pre', { className: 'raw-pre hidden' });

      const mainView = createEl('div', { className: 'stack stack-grow' }, [
        createEl('div', { className: 'card' }, [
          createEl('div', { className: 'compare-grid' }, [
            createEl('div', {}, [
              createEl('label', { htmlFor: 'base-input', text: 'Base（旧版本 / 起点）' }),
              baseInput.element
            ]),
            swapRefsBtn,
            createEl('div', {}, [
              createEl('label', { htmlFor: 'head-input', text: 'Head（新版本 / 终点）' }),
              headInput.element
            ])
          ]),
          createEl('div', { className: 'row-between mt-10' }, [
            createEl('div', { className: 'row' }, [generateBtn, regenerateBtn, abortBtn, refreshRefsBtn]),
            createEl('label', { className: 'checkbox-label' }, [
              commitsOnlyCheckbox,
              '仅基于 Commit 摘要（跳过 Diff）'
            ])
          ]),
          refsHint
        ]),
        statusBanner,
        statsBar,
        createEl('div', { className: 'row-between' }, [
          createEl('div', { className: 'row' }, [modeRenderedBtn, modeRawBtn]),
          copyBtn
        ]),
        createEl('div', { className: 'output-box' }, [emptyState, thinkingState, renderedOutput, rawOutput])
      ]);

      const newProviderBtn = createEl('button', { type: 'button', className: 'btn btn-sm btn-primary', text: '+ 添加 AI 服务' });
      const providersList = createEl('div');
      const editorTitle = createEl('strong', { text: '添加 AI 服务' });
      const provName = createEl('input', { type: 'text', id: 'prov-name', placeholder: '例如：DeepSeek' });
      const provType = createPrimerSelect({
        id: 'prov-type',
        ariaLabel: '协议类型',
        alignRight: true,
        options: [
          { value: 'openai', label: 'OpenAI Compatible (/chat/completions)' },
          { value: 'anthropic', label: 'Anthropic Messages (/v1/messages)' }
        ]
      });
      const provEndpoint = createEl('input', {
        type: 'text',
        id: 'prov-endpoint',
        placeholder: 'https://api.openai.com/v1/chat/completions'
      });
      const provModel = createEl('input', {
        type: 'text',
        id: 'prov-model',
        placeholder: 'gpt-4o-mini / deepseek-chat'
      });
      const provKey = createEl('input', {
        type: 'text',
        id: 'prov-key',
        className: 'secret-masked',
        autocomplete: 'off',
        spellcheck: false,
        'data-1p-ignore': 'true',
        'data-lpignore': 'true',
        placeholder: '填写 API Key（仅保存在本地油猴存储）'
      });
      const toggleProvKeyBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '显示' });
      const saveProviderBtn = createEl('button', { type: 'button', className: 'btn btn-primary btn-sm', text: '保存服务' });
      const testProviderBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '测试连接' });
      const cancelProviderBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '取消' });
      const providerTestBanner = createEl('div', { className: 'banner hidden mt-8' });

      const presetButtons = [
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'openrouterFree' }, text: 'OpenRouter (Free)' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'gemini' }, text: 'Gemini' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'groq' }, text: 'Groq' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'siliconflowFree' }, text: '硅基流动 (Free)' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'openai' }, text: 'OpenAI' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'deepseek' }, text: 'DeepSeek' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'anthropic' }, text: 'Claude' }),
        createEl('button', { type: 'button', className: 'btn btn-sm', dataset: { preset: 'ollama' }, text: 'Ollama' })
      ];

      const providerEditor = createEl('div', { className: 'card hidden' }, [
        createEl('div', { className: 'mb-8' }, [editorTitle]),
        createEl('div', { className: 'row mb-8' }, presetButtons),
        createEl('div', { className: 'form-grid' }, [
          createEl('div', {}, [createEl('label', { htmlFor: 'prov-name', text: '服务名称' }), provName]),
          createEl('div', {}, [createEl('label', { htmlFor: 'prov-type', text: '协议类型' }), provType.element]),
          createEl('div', {}, [createEl('label', { htmlFor: 'prov-endpoint', text: 'API Endpoint' }), provEndpoint]),
          createEl('div', {}, [createEl('label', { htmlFor: 'prov-model', text: '模型名称' }), provModel])
        ]),
        createEl('div', { className: 'mt-8' }, [
          createEl('label', { htmlFor: 'prov-key', text: 'API Key' }),
          createEl('div', { className: 'secret-row' }, [provKey, toggleProvKeyBtn])
        ]),
        createEl('div', { className: 'row mt-10' }, [saveProviderBtn, testProviderBtn, cancelProviderBtn]),
        providerTestBanner
      ]);

      const prefLanguage = createPrimerSelect({
        id: 'pref-language',
        ariaLabel: '输出语言',
        options: [
          { value: 'auto', label: `跟随浏览器语言（自动 · ${detectBrowserLanguage()}）` },
          { value: 'zh-CN', label: '简体中文' },
          { value: 'zh-TW', label: '繁體中文' },
          { value: 'en', label: 'English' }
        ]
      });
      const prefBudget = createEl('input', {
        type: 'number',
        id: 'pref-budget',
        min: '4000',
        max: '200000',
        step: '2000'
      });
      const prefGithubToken = createEl('input', {
        type: 'text',
        id: 'pref-github-token',
        className: 'secret-masked',
        autocomplete: 'off',
        spellcheck: false,
        'data-1p-ignore': 'true',
        'data-lpignore': 'true',
        placeholder: '可选只读 PAT（用于私有库或突破 60 次/小时限流）'
      });
      const toggleGithubTokenBtn = createEl('button', { type: 'button', className: 'btn btn-sm', text: '显示' });
      const prefCustomPrompt = createEl('textarea', {
        id: 'pref-custom-prompt',
        placeholder: '例如：突出对 Android 兼容性的影响，列出具体模块名'
      });
      const savePrefsBtn = createEl('button', { type: 'button', className: 'btn btn-primary btn-sm', text: '保存偏好设置' });
      const prefsSavedHint = createEl('span', { className: 'hint hint-inline' });

      const settingsView = createEl('div', { className: 'stack hidden' }, [
        createEl('div', { className: 'card' }, [
          createEl('div', { className: 'row-between mb-8' }, [
            createEl('strong', { text: '已配置的 AI 服务' }),
            newProviderBtn
          ]),
          providersList
        ]),
        providerEditor,
        createEl('div', { className: 'card' }, [
          createEl('strong', { className: 'section-title', text: '生成偏好与 GitHub 访问' }),
          createEl('div', { className: 'form-grid' }, [
            createEl('div', {}, [createEl('label', { htmlFor: 'pref-language', text: '输出语言' }), prefLanguage.element]),
            createEl('div', {}, [createEl('label', { htmlFor: 'pref-budget', text: 'Diff 字符预算' }), prefBudget])
          ]),
          createEl('div', { className: 'mt-8' }, [
            createEl('label', { htmlFor: 'pref-github-token', text: '可选 GitHub Token（只读 PAT）' }),
            createEl('div', { className: 'secret-row' }, [prefGithubToken, toggleGithubTokenBtn])
          ]),
          createEl('div', { className: 'mt-8' }, [
            createEl('label', { htmlFor: 'pref-custom-prompt', text: '自定义补充提示词（可选）' }),
            prefCustomPrompt
          ]),
          createEl('div', { className: 'row mt-10' }, [savePrefsBtn, prefsSavedHint])
        ])
      ]);

      const backdrop = createEl('div', { className: 'backdrop' }, [
        createEl('aside', { className: 'drawer', role: 'dialog', 'aria-label': 'GitHub AI Changelog' }, [
          createEl('div', { className: 'header' }, [
            createEl('div', { className: 'title-wrap' }, [
              createEl('h2', { className: 'title', text: '✦ AI 变更日志' }),
              repoBadge
            ]),
            createEl('div', { className: 'header-actions' }, [
              headerProviderSelect.element,
              toggleSettingsBtn,
              closeBtn
            ])
          ]),
          createEl('div', { className: 'body' }, [mainView, settingsView])
        ])
      ]);

      shadow.appendChild(backdrop);
      document.body.appendChild(host);

      drawerElements = {
        host,
        shadow,
        backdrop,
        repoBadge,
        headerProviderSelect,
        toggleSettingsBtn,
        closeBtn,
        mainView,
        settingsView,
        baseInput,
        headInput,
        swapRefsBtn,
        refsHint,
        generateBtn,
        regenerateBtn,
        abortBtn,
        refreshRefsBtn,
        commitsOnlyCheckbox,
        statusBanner,
        statsBar,
        modeRenderedBtn,
        modeRawBtn,
        copyBtn,
        emptyState,
        thinkingState,
        renderedOutput,
        rawOutput,
        newProviderBtn,
        providersList,
        providerEditor,
        editorTitle,
        provName,
        provType,
        provEndpoint,
        provModel,
        provKey,
        toggleProvKeyBtn,
        saveProviderBtn,
        testProviderBtn,
        cancelProviderBtn,
        providerTestBanner,
        prefLanguage,
        prefBudget,
        prefGithubToken,
        toggleGithubTokenBtn,
        prefCustomPrompt,
        savePrefsBtn,
        prefsSavedHint
      };

      bindDrawerEvents(drawerElements);
      syncThemeAttributes();
      return drawerElements;
    }

    function setBanner(bannerEl, text, kind = 'info') {
      if (!text) {
        bannerEl.className = 'banner hidden';
        bannerEl.replaceChildren();
        return;
      }
      if (kind === 'loading') {
        bannerEl.className = 'banner loading';
        bannerEl.replaceChildren(
          createEl('span', { className: 'ai-thinking-row' }, [
            createEl('span', { className: 'ai-spark-pulse', text: '✦' }),
            createEl('span', { className: 'ai-shimmer-text', text }),
            createEl('span', { className: 'ai-dots', 'aria-hidden': 'true' }, [
              createEl('span', { className: 'ai-dot' }),
              createEl('span', { className: 'ai-dot' }),
              createEl('span', { className: 'ai-dot' })
            ])
          ])
        );
        return;
      }
      bannerEl.className = `banner ${kind === 'warn' || kind === 'error' || kind === 'ok' ? kind : ''}`.trim();
      bannerEl.textContent = text;
    }

    function renderStats(statsBar, stats) {
      statsBar.replaceChildren();
      if (!stats) {
        statsBar.classList.add('hidden');
        return;
      }
      const pills = [
        `${stats.returnedCommits}${stats.commitsTruncated ? ` / ${stats.totalCommits}` : ''} commits`,
        `${stats.listedFiles} files (+${stats.totalAdditions}/-${stats.totalDeletions})`,
        stats.commitsOnly
          ? '仅 Commit 模式'
          : `已纳入 ${stats.includedPatchCount} 个 Patch${stats.filteredNoiseCount ? ` · 已过滤 ${stats.filteredNoiseCount} 个噪声文件` : ''}`
      ];
      for (const label of pills) {
        const span = document.createElement('span');
        span.className = 'stat-pill';
        span.textContent = label;
        statsBar.appendChild(span);
      }
      statsBar.classList.remove('hidden');
    }

    function updateOutputView() {
      const els = ensureDrawer();
      const hasMarkdown = Boolean(state.markdown);
      const showThinking = state.isGenerating && !hasMarkdown;
      els.copyBtn.disabled = !hasMarkdown;
      els.regenerateBtn.classList.toggle('hidden', !hasMarkdown || state.isGenerating);
      els.emptyState.classList.toggle('hidden', hasMarkdown || showThinking);
      els.thinkingState.classList.toggle('hidden', !showThinking);

      if (state.outputMode === 'raw') {
        els.modeRawBtn.classList.add('btn-primary');
        els.modeRenderedBtn.classList.remove('btn-primary');
        els.renderedOutput.classList.add('hidden');
        els.rawOutput.classList.toggle('hidden', !hasMarkdown);
        els.rawOutput.textContent = state.markdown;
      } else {
        els.modeRenderedBtn.classList.add('btn-primary');
        els.modeRawBtn.classList.remove('btn-primary');
        els.rawOutput.classList.add('hidden');
        els.renderedOutput.classList.toggle('hidden', !hasMarkdown);
        if (hasMarkdown) {
          renderMarkdownSafely(els.renderedOutput, state.markdown);
        } else {
          els.renderedOutput.replaceChildren();
        }
      }
    }

    function syncProviderSelects() {
      const els = ensureDrawer();
      const selectEl = els.headerProviderSelect;
      if (state.settings.providers.length === 0) {
        selectEl.setOptions([{ value: '', label: '未配置 AI 服务' }], '');
        return;
      }
      selectEl.setOptions(
        state.settings.providers.map((provider) => ({
          value: provider.id,
          label: `${provider.name} (${provider.model})`
        })),
        state.settings.activeProviderId
      );
    }

    function renderProvidersList() {
      const els = ensureDrawer();
      const container = els.providersList;
      container.replaceChildren();

      if (state.settings.providers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'hint';
        empty.textContent = '尚未添加任何 AI 服务，请点击右上角「+ 添加 AI 服务」。';
        container.appendChild(empty);
        return;
      }

      for (const provider of state.settings.providers) {
        const item = document.createElement('div');
        item.className = 'provider-item';

        const meta = document.createElement('div');
        meta.className = 'provider-meta';
        const title = document.createElement('div');
        title.className = 'provider-title';
        title.textContent = provider.id === state.settings.activeProviderId
          ? `${provider.name}（当前使用）`
          : provider.name;
        const sub = document.createElement('div');
        sub.className = 'provider-sub';
        sub.textContent = `${provider.type} · ${provider.model} · ${provider.endpoint}`;
        meta.appendChild(title);
        meta.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'row';

        if (provider.id !== state.settings.activeProviderId) {
          const useBtn = document.createElement('button');
          useBtn.type = 'button';
          useBtn.className = 'btn btn-sm';
          useBtn.textContent = '设为当前';
          useBtn.addEventListener('click', () => {
            state.settings.activeProviderId = provider.id;
            saveSettings(state.settings);
            syncProviderSelects();
            renderProvidersList();
          });
          actions.appendChild(useBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-sm';
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', () => openProviderEditor(provider));
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', () => {
          state.settings.providers = state.settings.providers.filter((entry) => entry.id !== provider.id);
          if (state.settings.activeProviderId === provider.id) {
            state.settings.activeProviderId = state.settings.providers[0] ? state.settings.providers[0].id : '';
          }
          saveSettings(state.settings);
          syncProviderSelects();
          renderProvidersList();
        });
        actions.appendChild(deleteBtn);

        item.appendChild(meta);
        item.appendChild(actions);
        container.appendChild(item);
      }
    }

    function openProviderEditor(existingProvider) {
      const els = ensureDrawer();
      state.editingProviderId = existingProvider ? existingProvider.id : null;
      els.editorTitle.textContent = existingProvider ? '编辑 AI 服务' : '添加 AI 服务';
      els.provName.value = existingProvider ? existingProvider.name : '';
      els.provType.value = existingProvider ? existingProvider.type : 'openai';
      els.provEndpoint.value = existingProvider ? existingProvider.endpoint : '';
      els.provModel.value = existingProvider ? existingProvider.model : '';
      els.provKey.value = existingProvider ? existingProvider.apiKey : '';
      els.provKey.classList.add('secret-masked');
      els.toggleProvKeyBtn.textContent = '显示';
      setBanner(els.providerTestBanner, '');
      els.providerEditor.classList.remove('hidden');
    }

    function syncSettingsView() {
      const els = ensureDrawer();
      els.prefLanguage.value = state.settings.language;
      els.prefBudget.value = String(state.settings.maxPatchChars);
      els.prefGithubToken.value = state.settings.githubToken;
      els.prefGithubToken.classList.add('secret-masked');
      els.toggleGithubTokenBtn.textContent = '显示';
      els.prefCustomPrompt.value = state.settings.customPrompt;
      els.prefsSavedHint.textContent = '';
      renderProvidersList();
    }

    function switchView(mode) {
      closeAllMenus();
      const els = ensureDrawer();
      state.viewMode = mode;
      const isSettings = mode === 'settings';
      els.mainView.classList.toggle('hidden', isSettings);
      els.settingsView.classList.toggle('hidden', !isSettings);
      els.toggleSettingsBtn.textContent = isSettings ? '返回对比' : '设置';
      if (isSettings) {
        syncSettingsView();
        if (state.settings.providers.length === 0) {
          openProviderEditor(null);
        }
      }
    }

    function buildGitHubHeaders() {
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (state.settings.githubToken) {
        headers.Authorization = `Bearer ${state.settings.githubToken}`;
      }
      return headers;
    }

    async function fetchRepoRefs(forceRefresh = false) {
      const repo = state.repo;
      if (!repo) {
        return;
      }
      const els = ensureDrawer();
      const cached = state.refsByRepo.get(repo.repoFullName);
      if (cached && !forceRefresh) {
        populateRefsDatalist(cached);
        return;
      }

      els.refsHint.textContent = '正在读取仓库 Tags 与分支...';

      try {
        const webUrls = buildWebRefsUrls(repo.owner, repo.repo);
        if (typeof fetch === 'function') {
          const [webTagRes, webBranchRes] = await Promise.allSettled([
            fetch(webUrls.tagsUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }),
            fetch(webUrls.branchesUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
          ]);
          let webTags = null;
          let webBranches = null;
          if (webTagRes.status === 'fulfilled' && webTagRes.value.ok) {
            webTags = parseGitHubRefsPayload(await webTagRes.value.text());
          }
          if (webBranchRes.status === 'fulfilled' && webBranchRes.value.ok) {
            webBranches = parseGitHubRefsPayload(await webBranchRes.value.text());
          }
          if (webTags !== null || webBranches !== null) {
            const refsData = {
              tags: webTags || [],
              branches: webBranches || []
            };
            state.refsByRepo.set(repo.repoFullName, refsData);
            populateRefsDatalist(refsData);
            return;
          }
        }

        const { tagsUrl, branchesUrl } = buildRefsApiUrls(repo.owner, repo.repo);
        const headers = buildGitHubHeaders();
        const [tagsResult, branchesResult] = await Promise.allSettled([
          gmFetchText({ url: tagsUrl, headers, timeout: 20000 }).promise,
          gmFetchText({ url: branchesUrl, headers, timeout: 20000 }).promise
        ]);

        const tags = [];
        const branches = [];

        if (tagsResult.status === 'fulfilled' && tagsResult.value.status >= 200 && tagsResult.value.status < 300) {
          const parsedTags = parseGitHubRefsPayload(tagsResult.value.responseText);
          if (Array.isArray(parsedTags)) {
            tags.push(...parsedTags);
          }
        } else if (tagsResult.status === 'fulfilled' && tagsResult.value.status >= 400) {
          els.refsHint.textContent = formatGitHubError(
            tagsResult.value.status,
            tagsResult.value.responseText,
            tagsResult.value.responseHeaders
          );
          return;
        }

        if (branchesResult.status === 'fulfilled' && branchesResult.value.status >= 200 && branchesResult.value.status < 300) {
          const parsedBranches = parseGitHubRefsPayload(branchesResult.value.responseText);
          if (Array.isArray(parsedBranches)) {
            branches.push(...parsedBranches);
          }
        }

        const refsData = { tags, branches };
        state.refsByRepo.set(repo.repoFullName, refsData);
        populateRefsDatalist(refsData);
      } catch (err) {
        els.refsHint.textContent = `无法读取 Tags：${err.message}（仍可直接手动输入 Commit SHA 或 Tag）`;
      }
    }

    function populateRefsDatalist(refsData) {
      const els = ensureDrawer();
      els.baseInput.setRefs(refsData);
      els.headInput.setRefs(refsData);

      if (!els.baseInput.value.trim() && !els.headInput.value.trim()) {
        if (refsData.tags.length >= 2) {
          els.baseInput.value = refsData.tags[1];
          els.headInput.value = refsData.tags[0];
        } else if (refsData.tags.length === 1 && refsData.branches.length >= 1) {
          els.baseInput.value = refsData.tags[0];
          els.headInput.value = refsData.branches[0];
        }
      }

      els.refsHint.textContent = `已加载 ${refsData.tags.length} 个 Tag、${refsData.branches.length} 个分支，也支持输入任意 Commit SHA。`;
    }

    function setGeneratingState(isGenerating) {
      const els = ensureDrawer();
      state.isGenerating = isGenerating;
      els.generateBtn.disabled = isGenerating || !state.repo;
      els.regenerateBtn.classList.toggle('hidden', isGenerating || !state.markdown);
      els.abortBtn.classList.toggle('hidden', !isGenerating);
      updateOutputView();
    }

    async function runGenerate(bypassCache = false) {
      if (!state.repo || state.isGenerating) {
        return;
      }
      const els = ensureDrawer();
      const base = els.baseInput.value.trim();
      const head = els.headInput.value.trim();

      if (!base || !head) {
        setBanner(els.statusBanner, '请同时填写 Base 与 Head（Commit SHA、Tag 或分支名）。', 'warn');
        return;
      }
      if (base === head) {
        setBanner(els.statusBanner, 'Base 与 Head 不能相同，请选择两个不同的提交或标签。', 'warn');
        return;
      }

      const activeProvider = state.settings.providers.find(
        (entry) => entry.id === state.settings.activeProviderId
      );
      if (!activeProvider) {
        setBanner(els.statusBanner, '请先在设置中至少配置一个 AI 服务。', 'warn');
        switchView('settings');
        openProviderEditor(null);
        return;
      }

      const commitsOnly = els.commitsOnlyCheckbox.checked;
      const resolvedLang = resolveOutputLanguage(state.settings.language);
      const cacheKey = buildCacheKey(
        state.repo.owner,
        state.repo.repo,
        base,
        head,
        activeProvider.id,
        resolvedLang.localeCode,
        commitsOnly
      );

      if (!bypassCache) {
        const cache = loadCache();
        const cachedEntry = cache[cacheKey];
        if (cachedEntry && cachedEntry.markdown) {
          state.markdown = cachedEntry.markdown;
          state.stats = cachedEntry.stats || null;
          renderStats(els.statsBar, state.stats);
          updateOutputView();
          setBanner(els.statusBanner, '已命中本地缓存结果，可点击「重新生成」向 AI 重新请求。', 'ok');
          return;
        }
      }

      setGeneratingState(true);
      state.markdown = '';
      state.stats = null;
      renderStats(els.statsBar, null);
      updateOutputView();
      setBanner(els.statusBanner, `正在拉取 ${base}...${head} 的 GitHub 对比数据`, 'loading');

      try {
        const compareUrl = buildCompareApiUrl(state.repo.owner, state.repo.repo, base, head);
        const compareReq = gmFetchText({
          url: compareUrl,
          headers: buildGitHubHeaders(),
          timeout: 45000
        });
        state.activeRequest = compareReq;
        const compareRes = await compareReq.promise;

        if (compareRes.status < 200 || compareRes.status >= 300) {
          throw new Error(formatGitHubError(compareRes.status, compareRes.responseText, compareRes.responseHeaders));
        }

        const compareData = JSON.parse(compareRes.responseText || '{}');
        if (compareData.total_commits === 0 && (!Array.isArray(compareData.files) || compareData.files.length === 0)) {
          throw new Error(`${base} 与 ${head} 之间没有差异（total_commits = 0）。请检查起止顺序是否正确。`);
        }

        const promptContext = buildChangelogPromptContext(compareData, {
          owner: state.repo.owner,
          repo: state.repo.repo,
          base,
          head,
          language: state.settings.language,
          maxPatchChars: state.settings.maxPatchChars,
          customPrompt: state.settings.customPrompt,
          commitsOnly
        });

        state.stats = promptContext.stats;
        renderStats(els.statsBar, promptContext.stats);

        const warnings = [];
        if (promptContext.stats.commitsTruncated) {
          warnings.push(`Commit 数量 (${promptContext.stats.totalCommits}) 超过 GitHub Compare API 单次 250 条上限，仅能覆盖接口返回部分。`);
        }
        if (promptContext.stats.filesTruncated) {
          warnings.push('变更文件数达到 GitHub Compare API 300 文件上限，部分文件未在接口中返回。');
        }
        if (promptContext.stats.omittedPatchCount > 0 || promptContext.stats.partiallyTruncatedPatchCount > 0) {
          warnings.push(`已按字符预算自动裁剪部分大文件 Diff（未展示 ${promptContext.stats.omittedPatchCount} 个、截断 ${promptContext.stats.partiallyTruncatedPatchCount} 个），全部 Commit 与文件列表仍已保留。`);
        }
        if (warnings.length > 0) {
          setBanner(els.statusBanner, `${warnings.join(' ')} 正在调用 ${activeProvider.name} 生成中`, 'loading');
        } else {
          setBanner(els.statusBanner, `正在通过 ${activeProvider.name} (${activeProvider.model}) 生成变更日志`, 'loading');
        }

        const aiRequestSpec = buildAiRequest(activeProvider, promptContext.systemPrompt, promptContext.userPrompt, {
          stream: true
        });

        let parseCursor = 0;
        let rawAiOutput = '';
        let renderedReasoningNotice = false;
        let pendingRenderTimer = null;

        const scheduleOutputRender = () => {
          if (pendingRenderTimer) {
            return;
          }
          pendingRenderTimer = setTimeout(() => {
            pendingRenderTimer = null;
            updateOutputView();
          }, 80);
        };

        const aiReq = gmFetchText({
          method: 'POST',
          url: aiRequestSpec.url,
          headers: aiRequestSpec.headers,
          data: aiRequestSpec.body,
          timeout: 120000,
          onProgress(rawChunkText) {
            const chunk = parseAiResponseChunk(activeProvider.type, rawChunkText, parseCursor, false);
            parseCursor = chunk.cursor;
            if (chunk.errorMessage) {
              setBanner(els.statusBanner, `AI 接口返回错误：${chunk.errorMessage}`, 'error');
            }
            if (chunk.reasoningDelta && !state.markdown && !renderedReasoningNotice) {
              renderedReasoningNotice = true;
              setBanner(els.statusBanner, `${activeProvider.name} 正在深度思考中`, 'loading');
            }
            if (chunk.textDelta) {
              rawAiOutput += chunk.textDelta;
              const preview = extractStreamingChangelogPreview(rawAiOutput, promptContext);
              if (preview) {
                state.markdown = preview;
                scheduleOutputRender();
              }
            }
          }
        });
        state.activeRequest = aiReq;
        const aiRes = await aiReq.promise;

        if (pendingRenderTimer) {
          clearTimeout(pendingRenderTimer);
          pendingRenderTimer = null;
        }

        const finalChunk = parseAiResponseChunk(activeProvider.type, aiRes.responseText || '', parseCursor, true);
        if (finalChunk.textDelta) {
          rawAiOutput += finalChunk.textDelta;
        }

        if (aiRes.status < 200 || aiRes.status >= 300) {
          const snippet = String(aiRes.responseText || '').trim().slice(0, 160);
          throw new Error(finalChunk.errorMessage || `AI 服务请求失败 (HTTP ${aiRes.status})${snippet ? `: ${snippet}` : ''}`);
        }
        if (finalChunk.errorMessage) {
          throw new Error(finalChunk.errorMessage);
        }
        if (!rawAiOutput.trim()) {
          throw new Error('AI 服务未返回有效文本内容，请检查模型名称与接口协议是否匹配。');
        }

        const validatedChangelog = parseAndValidateChangelog(rawAiOutput, promptContext.grounding);
        if (!validatedChangelog.isStructured) {
          warnings.push('模型未按 JSON 契约返回，已启用标准框架兜底排版。');
        }
        state.markdown = compileCanonicalChangelog(validatedChangelog, promptContext);
        updateOutputView();

        saveCacheEntry(cacheKey, { markdown: state.markdown, stats: state.stats });
        if (warnings.length > 0) {
          setBanner(els.statusBanner, `生成完成（提示：${warnings.join(' ')}）`, 'warn');
        } else {
          setBanner(els.statusBanner, '变更日志生成完成。', 'ok');
        }
      } catch (err) {
        if (err && err.isAbort) {
          setBanner(els.statusBanner, '已停止生成。', 'warn');
        } else {
          setBanner(els.statusBanner, err && err.message ? err.message : '生成失败', 'error');
        }
      } finally {
        state.activeRequest = null;
        setGeneratingState(false);
      }
    }

    async function testProviderConnection() {
      const els = ensureDrawer();
      const draft = {
        id: state.editingProviderId || 'test',
        name: els.provName.value.trim() || 'Test',
        type: els.provType.value,
        endpoint: els.provEndpoint.value.trim(),
        model: els.provModel.value.trim(),
        apiKey: els.provKey.value.trim()
      };
      try {
        const spec = buildAiRequest(draft, 'Reply with OK.', 'OK', { stream: true, maxTokens: 64 });
        const targetHost = (() => {
          try { return new URL(spec.url).host; } catch (_err) { return spec.url; }
        })();
        setBanner(
          els.providerTestBanner,
          `正在流式探测 ${targetHost}（若弹出 Tampermonkey 授权窗口请点击「始终允许」）`,
          'loading'
        );
        let streamCursor = 0;
        let streamText = '';
        let sawReasoning = false;
        const req = gmFetchText({
          method: 'POST',
          url: spec.url,
          headers: spec.headers,
          data: spec.body,
          timeout: 45000,
          onProgress(rawChunkText) {
            const chunk = parseAiResponseChunk(draft.type === 'anthropic' ? 'anthropic' : 'openai', rawChunkText, streamCursor, false);
            streamCursor = chunk.cursor;
            if (chunk.textDelta) {
              streamText += chunk.textDelta;
              setBanner(els.providerTestBanner, `已收到模型响应流：${streamText.trim().slice(0, 40)}`, 'loading');
            } else if (chunk.reasoningDelta && !sawReasoning) {
              sawReasoning = true;
              setBanner(els.providerTestBanner, '模型正在思考中，等待输出', 'loading');
            }
          }
        });
        let res;
        try {
          res = await req.promise;
        } catch (firstErr) {
          if (firstErr && firstErr.isTimeout && draft.type === 'openai' && /\/chat\/completions(\?.*)?$/.test(spec.url)) {
            setBanner(els.providerTestBanner, '聊天接口超时，正在探测 /models 诊断权限与网络', 'loading');
            const modelsUrl = spec.url.replace(/\/chat\/completions(\?.*)?$/, '/models$1');
            const modelHeaders = {};
            if (spec.headers.Authorization) {
              modelHeaders.Authorization = spec.headers.Authorization;
            }
            try {
              const modelsRes = await gmFetchText({ url: modelsUrl, headers: modelHeaders, timeout: 8000 }).promise;
              if (modelsRes.status >= 200 && modelsRes.status < 300) {
                const modelsJson = JSON.parse(modelsRes.responseText || '{}');
                const modelIds = Array.isArray(modelsJson.data) ? modelsJson.data.map((item) => item.id).filter(Boolean) : [];
                const matched = modelIds.includes(draft.model);
                if (modelIds.length > 0 && !matched) {
                  const samples = modelIds.filter((name) => /deepseek/i.test(name)).slice(0, 4);
                  const sampleList = (samples.length ? samples : modelIds.slice(0, 4)).join(', ');
                  throw new Error(`/models 返回 200 但未找到模型 "${draft.model}"（可用示例：${sampleList}）`);
                }
                throw new Error('GET /models 返回 200（网络与 Key 有效），但 POST /chat/completions 在 45s 内超时无返回；若为 NVIDIA 个人账号请确认已在控制台开通 Public API Endpoints 推理权限，或尝试其他模型/服务商。');
              }
              throw new Error(`聊天接口超时，且探测 /models 返回 HTTP ${modelsRes.status}`);
            } catch (diagErr) {
              if (diagErr && diagErr.message && diagErr.message !== firstErr.message) {
                throw diagErr;
              }
            }
          }
          throw firstErr;
        }
        const parsed = parseAiResponseChunk(draft.type === 'anthropic' ? 'anthropic' : 'openai', res.responseText || '', 0, true);
        if (res.status < 200 || res.status >= 300 || parsed.errorMessage) {
          const snippet = String(res.responseText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
          const jwtHint = /Invalid JWT serialization/i.test(snippet + (parsed.errorMessage || ''))
            ? '（请点「显示」核对 API Key 是否有效且未被浏览器自动填充为登录密码）'
            : '';
          throw new Error(`${parsed.errorMessage || `HTTP ${res.status}`}${!parsed.errorMessage && snippet ? ` (${snippet})` : ''}${jwtHint} [请求地址: ${spec.url}]`);
        }
        const preview = (parsed.textDelta || streamText || (parsed.reasoningDelta ? '(收到推理输出)' : 'OK')).trim().slice(0, 60);
        setBanner(els.providerTestBanner, `连接成功：模型返回 "${preview}"`, 'ok');
      } catch (err) {
        setBanner(els.providerTestBanner, `连接失败：${err.message}`, 'error');
      }
    }

    function bindDrawerEvents(els) {
      els.closeBtn.addEventListener('click', closeDrawer);
      els.shadow.addEventListener('click', (event) => {
        const insideMenu = event.composedPath().some(
          (node) => node && node.classList && node.classList.contains('gh-menu-wrap')
        );
        if (!insideMenu) {
          closeAllMenus();
        }
      });
      els.backdrop.addEventListener('click', (event) => {
        if (event.target === els.backdrop) {
          closeDrawer();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && els.backdrop.classList.contains('open')) {
          if (closeAllMenus()) {
            return;
          }
          closeDrawer();
        }
      });

      els.toggleSettingsBtn.addEventListener('click', () => {
        switchView(state.viewMode === 'settings' ? 'main' : 'settings');
      });

      els.headerProviderSelect.addEventListener('change', () => {
        state.settings.activeProviderId = els.headerProviderSelect.value;
        saveSettings(state.settings);
      });

      els.swapRefsBtn.addEventListener('click', () => {
        const oldBase = els.baseInput.value;
        els.baseInput.value = els.headInput.value;
        els.headInput.value = oldBase;
      });

      els.refreshRefsBtn.addEventListener('click', () => fetchRepoRefs(true));
      els.generateBtn.addEventListener('click', () => runGenerate(false));
      els.regenerateBtn.addEventListener('click', () => runGenerate(true));
      els.abortBtn.addEventListener('click', () => {
        if (state.activeRequest) {
          state.activeRequest.abort();
        }
      });

      els.modeRenderedBtn.addEventListener('click', () => {
        state.outputMode = 'rendered';
        updateOutputView();
      });
      els.modeRawBtn.addEventListener('click', () => {
        state.outputMode = 'raw';
        updateOutputView();
      });

      els.copyBtn.addEventListener('click', async () => {
        if (!state.markdown) {
          return;
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(state.markdown);
          } else if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(state.markdown);
          }
          els.copyBtn.textContent = '已复制 ✓';
          setTimeout(() => {
            els.copyBtn.textContent = '复制 Markdown';
          }, 1600);
        } catch (_err) {
          if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(state.markdown);
          }
        }
      });

      els.newProviderBtn.addEventListener('click', () => openProviderEditor(null));
      els.cancelProviderBtn.addEventListener('click', () => {
        els.providerEditor.classList.add('hidden');
      });

      els.providerEditor.querySelectorAll('[data-preset]').forEach((presetBtn) => {
        presetBtn.addEventListener('click', () => {
          const preset = PROVIDER_PRESETS[presetBtn.dataset.preset];
          if (!preset) {
            return;
          }
          els.provName.value = preset.name;
          els.provType.value = preset.type;
          els.provEndpoint.value = preset.endpoint;
          els.provModel.value = preset.model;
          setBanner(els.providerTestBanner, preset.hint || '', 'info');
        });
      });

      els.saveProviderBtn.addEventListener('click', () => {
        const candidate = normalizeProviderConfig({
          id: state.editingProviderId || `prov_${Date.now()}`,
          name: els.provName.value,
          type: els.provType.value,
          endpoint: els.provEndpoint.value,
          model: els.provModel.value,
          apiKey: els.provKey.value
        });
        if (!candidate.name || !candidate.endpoint || !candidate.model) {
          setBanner(els.providerTestBanner, '请填写服务名称、Endpoint 和模型名称。', 'warn');
          return;
        }
        const existingIndex = state.settings.providers.findIndex((entry) => entry.id === candidate.id);
        if (existingIndex >= 0) {
          state.settings.providers[existingIndex] = candidate;
        } else {
          state.settings.providers.push(candidate);
        }
        if (!state.settings.activeProviderId) {
          state.settings.activeProviderId = candidate.id;
        }
        saveSettings(state.settings);
        syncProviderSelects();
        renderProvidersList();
        els.providerEditor.classList.add('hidden');
      });

      els.testProviderBtn.addEventListener('click', testProviderConnection);
      els.toggleProvKeyBtn.addEventListener('click', () => {
        const masked = els.provKey.classList.toggle('secret-masked');
        els.toggleProvKeyBtn.textContent = masked ? '显示' : '隐藏';
      });
      els.toggleGithubTokenBtn.addEventListener('click', () => {
        const masked = els.prefGithubToken.classList.toggle('secret-masked');
        els.toggleGithubTokenBtn.textContent = masked ? '显示' : '隐藏';
      });

      els.savePrefsBtn.addEventListener('click', () => {
        const parsedBudget = Number(els.prefBudget.value);
        const chosenLang = els.prefLanguage.value;
        state.settings.language = ['auto', 'zh-CN', 'zh-TW', 'en'].includes(chosenLang) ? chosenLang : 'auto';
        state.settings.languageExplicit = true;
        state.settings.maxPatchChars = Number.isFinite(parsedBudget) && parsedBudget >= 4000
          ? Math.floor(parsedBudget)
          : DEFAULT_MAX_PATCH_CHARS;
        state.settings.githubToken = els.prefGithubToken.value.trim();
        state.settings.customPrompt = els.prefCustomPrompt.value.trim();
        saveSettings(state.settings);
        els.prefsSavedHint.textContent = '偏好设置已保存';
      });
    }

    function detectNotFoundPage() {
      const title = typeof document !== 'undefined' ? (document.title || '') : '';
      return /^Page not found\b/i.test(title) || Boolean(document.querySelector('.error-404'));
    }

    function openDrawer(initialTab = 'main') {
      if (!document.body) {
        return;
      }
      const detected = parseGitHubRepoUrl(window.location.href, {
        isNotFoundPage: detectNotFoundPage()
      });
      if (detected) {
        state.repo = detected;
      } else {
        state.repo = null;
      }
      const els = ensureDrawer();
      syncThemeAttributes();
      if (state.repo) {
        els.repoBadge.textContent = state.repo.repoFullName;
        els.generateBtn.disabled = state.isGenerating;
        if (state.repo.compareBase) {
          els.baseInput.value = state.repo.compareBase;
        }
        if (state.repo.compareHead) {
          els.headInput.value = state.repo.compareHead;
        }
        if (!state.isGenerating && !state.markdown) {
          if (state.settings.providers.length === 0) {
            setBanner(els.statusBanner, '首次使用请先点击右上角「设置」添加一个 AI 服务配置。', 'info');
          } else {
            setBanner(els.statusBanner, '');
          }
        }
      } else {
        els.repoBadge.textContent = '非仓库页面（可先配置全局设置）';
        els.generateBtn.disabled = true;
        els.refsHint.textContent = '打开任意 GitHub 仓库页面后即可读取 Tags 与分支。';
        if (initialTab === 'main') {
          setBanner(
            els.statusBanner,
            '当前页面不是 GitHub 仓库页面。请进入任意仓库（如 github.com/owner/repo）后再对比，或点击右上角「设置」先配置 AI 服务。',
            'warn'
          );
        }
      }
      syncProviderSelects();
      switchView(initialTab);
      updateOutputView();
      if (!els.backdrop.classList.contains('open')) {
        void els.backdrop.offsetWidth;
        els.backdrop.classList.add('open');
      }
      if (state.repo) {
        fetchRepoRefs(false);
      }
    }

    function closeDrawer() {
      closeAllMenus();
      if (drawerElements) {
        drawerElements.backdrop.classList.remove('open');
      }
    }

    function createTriggerShadowButton(isFloating) {
      const host = document.createElement('div');
      host.id = isFloating ? FLOATING_HOST_ID : TRIGGER_HOST_ID;
      if (isFloating) {
        host.className = 'is-floating';
      }
      host.setAttribute('data-theme', isDarkThemeActive() ? 'dark' : 'light');
      const shadow = host.attachShadow({ mode: 'open' });
      applyShadowStyles(shadow, TRIGGER_CSS);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = isFloating ? 'btn-trigger floating' : 'btn-trigger';
      const spark = document.createElement('span');
      spark.className = 'spark';
      spark.textContent = '✦';
      const label = document.createElement('span');
      label.textContent = 'AI Changelog';
      button.appendChild(spark);
      button.appendChild(label);
      button.addEventListener('click', () => openDrawer('main'));

      shadow.appendChild(button);
      return host;
    }

    function unmountTriggers() {
      const existingInline = document.getElementById(TRIGGER_HOST_ID);
      if (existingInline) {
        const parentLi = existingInline.closest('li[data-gh-ai-changelog="1"]');
        if (parentLi) {
          parentLi.remove();
        } else {
          existingInline.remove();
        }
      }
      const existingFloating = document.getElementById(FLOATING_HOST_ID);
      if (existingFloating) {
        existingFloating.remove();
      }
    }

    function syncRepoMount() {
      const parsedRepo = parseGitHubRepoUrl(window.location.href, {
        isNotFoundPage: detectNotFoundPage()
      });

      if (!parsedRepo) {
        if (state.activeRequest) {
          state.activeRequest.abort();
          state.activeRequest = null;
        }
        state.repo = null;
        unmountTriggers();
        return;
      }

      const repoChanged = !state.repo || state.repo.repoFullName !== parsedRepo.repoFullName;
      state.repo = parsedRepo;
      if (drawerElements && !state.isGenerating) {
        drawerElements.generateBtn.disabled = false;
      }

      if (repoChanged) {
        if (state.activeRequest) {
          state.activeRequest.abort();
          state.activeRequest = null;
        }
        if (drawerElements) {
          drawerElements.baseInput.value = parsedRepo.compareBase || '';
          drawerElements.headInput.value = parsedRepo.compareHead || '';
          state.markdown = '';
          state.stats = null;
          setBanner(drawerElements.statusBanner, '');
          renderStats(drawerElements.statsBar, null);
          updateOutputView();
        }
      }

      const actionsList = document.querySelector(
        'ul[data-testid="repo-header-actions"], #repository-container-header ul.pagehead-actions, ul.pagehead-actions'
      );
      const actionsVisible = Boolean(actionsList && actionsList.offsetParent !== null);

      if (actionsVisible) {
        const existingFloating = document.getElementById(FLOATING_HOST_ID);
        if (existingFloating) {
          existingFloating.remove();
        }
        const existingInline = document.getElementById(TRIGGER_HOST_ID);
        if (!existingInline) {
          const listItem = document.createElement('li');
          listItem.setAttribute('data-gh-ai-changelog', '1');
          listItem.appendChild(createTriggerShadowButton(false));
          actionsList.prepend(listItem);
        } else {
          const parentLi = existingInline.closest('li[data-gh-ai-changelog="1"]');
          if (parentLi && actionsList.firstElementChild !== parentLi) {
            actionsList.prepend(parentLi);
          }
        }
      } else {
        const existingInline = document.getElementById(TRIGGER_HOST_ID);
        if (existingInline) {
          const parentLi = existingInline.closest('li[data-gh-ai-changelog="1"]');
          if (parentLi) {
            parentLi.remove();
          } else {
            existingInline.remove();
          }
        }
        if (!document.getElementById(FLOATING_HOST_ID) && document.body) {
          document.body.appendChild(createTriggerShadowButton(true));
        }
      }

      syncThemeAttributes();
      state.lastHref = window.location.href;
    }

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开 AI 变更日志', () => openDrawer('main'));
      GM_registerMenuCommand('配置 AI 服务与偏好', () => openDrawer('settings'));
    }

    syncRepoMount();
    document.addEventListener('turbo:load', syncRepoMount);
    document.addEventListener('turbo:render', syncRepoMount);
    window.addEventListener('popstate', syncRepoMount);

    if (document.body && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (mountObserverTimer) {
          return;
        }
        mountObserverTimer = setTimeout(() => {
          mountObserverTimer = null;
          const urlChanged = state.lastHref !== window.location.href;
          const inlineHost = document.getElementById(TRIGGER_HOST_ID);
          const inlineParent = inlineHost && inlineHost.closest('li[data-gh-ai-changelog="1"]');
          const inlineNotLeftmost = Boolean(
            inlineParent && inlineParent.parentElement && inlineParent.parentElement.firstElementChild !== inlineParent
          );
          const missingTrigger = Boolean(
            state.repo
            && !inlineHost
            && !document.getElementById(FLOATING_HOST_ID)
          );
          if (urlChanged || missingTrigger || inlineNotLeftmost) {
            syncRepoMount();
          }
        }, 160);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initBrowserApp();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
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
      normalizeProviderConfig,
      buildAiRequest,
      parseAiResponseChunk,
      sanitizeSafeHttpUrl,
      parseMarkdownAst,
      buildCacheKey,
      pruneCacheEntries,
      parseRateLimitHeaders,
      formatGitHubError
    };
  }
})();
