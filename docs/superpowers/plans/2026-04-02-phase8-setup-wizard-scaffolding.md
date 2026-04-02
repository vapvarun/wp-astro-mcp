# Phase 8: Setup Wizard + Production-Ready Scaffolding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone with a WordPress site gets a working, deployable Astro frontend in 5 minutes via a single `setup_wizard` command. The scaffolded Astro project ships production-ready with search, pagination, OG images, related posts, JSON Feed, and a styled 404 page.

**Architecture:** Two changes: (1) a new `setup_wizard` tool that orchestrates the existing tools in a guided flow, and (2) enhancements to the existing `astro-scaffolder.ts` service to generate richer pages/components. The wizard is a thin orchestration layer — it calls existing handlers, not duplicate logic. Scaffolder changes are additive (new generator functions, new files written during scaffold).

**Tech Stack:** TypeScript, MCP SDK, Astro 6, Pagefind (search), satori (OG images)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/tools/wizard.ts` | `setup_wizard` tool definition + handler — orchestrates existing tools in guided flow |
| `src/schemas/wizard.ts` | Zod schema for wizard input params |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/tools/index.ts` | Import and register wizard tool + handler |
| `src/tools/router.ts` | Add `setup_wizard` to TOOL_CATEGORIES under new `wizard` category |
| `src/services/astro-scaffolder.ts` | Add generator functions: pagination pages, search page, related posts component, JSON Feed, OG image endpoint, enhanced 404, reading progress component |
| `package.json` | Bump version to 2.2.0 |

---

## Task 1: Wizard Tool Skeleton

**Files:**
- Create: `src/schemas/wizard.ts`
- Create: `src/tools/wizard.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/tools/router.ts`

- [ ] **Step 1: Create wizard Zod schema**

```typescript
// src/schemas/wizard.ts
import { z } from 'zod';

export const setupWizardSchema = z.object({
  url: z.string().optional().describe('WordPress site URL'),
  username: z.string().optional().describe('WordPress username'),
  app_password: z.string().optional().describe('WordPress application password'),
  output_dir: z.string().optional().describe('Output directory for Astro project'),
  deploy_platform: z.enum(['vercel', 'netlify', 'cloudflare', 'none']).optional(),
  skip_preview: z.boolean().optional().describe('Skip the conversion preview step'),
  skip_push: z.boolean().optional().describe('Skip GitHub push step'),
});
```

- [ ] **Step 2: Create wizard tool definition and handler skeleton**

```typescript
// src/tools/wizard.ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { setupWizardSchema } from '../schemas/wizard.js';
import { siteHandlers } from './sites.js';
import { transformHandlers } from './transform.js';
import { outputHandlers } from './output.js';
import { exportHandlers } from './export.js';
import { githubHandlers } from './github.js';
import logger from '../utils/logger.js';

export const wizardTools: Tool[] = [
  {
    name: 'setup_wizard',
    description:
      'Guided setup: register a WordPress site, analyze content, configure export, scaffold an Astro project, export all content, and optionally push to GitHub. One command to go from WordPress to a deployed Astro frontend.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'WordPress site URL (e.g., https://example.com)' },
        username: { type: 'string', description: 'WordPress username' },
        app_password: { type: 'string', description: 'WordPress application password' },
        output_dir: { type: 'string', description: 'Output directory for Astro project' },
        deploy_platform: { type: 'string', enum: ['vercel', 'netlify', 'cloudflare', 'none'], description: 'Deploy platform (default: vercel)' },
        skip_preview: { type: 'boolean', description: 'Skip conversion preview step (default: false)' },
        skip_push: { type: 'boolean', description: 'Skip GitHub push step (default: false)' },
      },
    },
  },
];

export const wizardHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  setup_wizard: async (params: unknown) => {
    try {
      const parsed = setupWizardSchema.parse(params);
      const steps: Array<{ step: string; status: string; detail?: unknown }> = [];

      // Step 1: Register site
      if (!parsed.url) {
        return formatSuccessResponse({
          message: 'setup_wizard requires at minimum: url, username, app_password',
          usage: 'setup_wizard({ url: "https://example.com", username: "admin", app_password: "xxxx xxxx xxxx" })',
          optional: 'output_dir, deploy_platform, skip_preview, skip_push',
        });
      }

      const siteName = new URL(parsed.url).hostname.replace(/^www\./, '');
      const siteId = siteName.replace(/\./g, '-');

      logger.info('Setup wizard started', { url: parsed.url, siteId });

      // Step 1: Add site
      const addResult = await siteHandlers.site_add({
        name: siteName,
        url: parsed.url,
        username: parsed.username,
        app_password: parsed.app_password,
        id: siteId,
      });
      steps.push({ step: 'site_add', status: 'done', detail: `Registered ${siteName}` });

      // Step 2: Analyze site
      const analyzeResult = await siteHandlers.site_analyze({ site_id: siteId });
      steps.push({ step: 'site_analyze', status: 'done' });

      // Step 3: Configure export
      const outputDir = parsed.output_dir || `${process.env.HOME || '/tmp'}/${siteId}-astro`;
      const platform = parsed.deploy_platform || 'vercel';
      await siteHandlers.site_export_config({
        site_id: siteId,
        output_dir: outputDir,
        deploy_platform: platform,
        content_format: 'md',
        media_strategy: 'keep',
      });
      steps.push({ step: 'site_export_config', status: 'done', detail: { outputDir, platform } });

      // Step 4: Preview (unless skipped)
      if (!parsed.skip_preview) {
        const previewResult = await transformHandlers.convert_preview({ site_id: siteId, count: 3 });
        steps.push({ step: 'convert_preview', status: 'done' });
      }

      // Step 5: Scaffold project
      await outputHandlers.scaffold_project({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'scaffold_project', status: 'done', detail: outputDir });

      // Step 6: Export all content
      const startResult = await exportHandlers.export_start({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'export_start', status: 'done' });

      // Resume until complete
      let remaining = true;
      let resumeCount = 0;
      while (remaining) {
        const resumeResult = await exportHandlers.export_resume({ site_id: siteId }) as { content: Array<{ text: string }> };
        resumeCount++;
        try {
          const data = JSON.parse(resumeResult.content[0].text);
          if (data.status === 'completed' || data.batch?.remaining === 0) {
            remaining = false;
          }
        } catch {
          remaining = false;
        }
      }
      steps.push({ step: 'export_resume', status: 'done', detail: `${resumeCount} batches processed` });

      // Step 7: Generate redirects
      await outputHandlers.generate_redirects({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'generate_redirects', status: 'done' });

      // Step 8: Git init + push (unless skipped)
      if (!parsed.skip_push) {
        await githubHandlers.github_init({ site_id: siteId, output_dir: outputDir });
        steps.push({ step: 'github_init', status: 'done' });
      }

      database.audit(siteId, 'setup_wizard', {
        steps: steps.length,
        output_dir: outputDir,
        platform,
      });

      return formatSuccessResponse({
        message: `Astro frontend ready for ${siteName}`,
        site_id: siteId,
        output_dir: outputDir,
        deploy_platform: platform,
        steps,
        next_steps: [
          `cd ${outputDir} && npm install && npm run dev`,
          parsed.skip_push ? 'Run github_init + github_create_repo + github_push to publish' : 'Run github_create_repo + github_push to publish to GitHub',
          `Connect ${platform} to your GitHub repo for auto-deploys`,
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};
```

- [ ] **Step 3: Register wizard in tools/index.ts**

Add to `src/tools/index.ts`:

```typescript
import { wizardTools, wizardHandlers } from './wizard.js';
```

Add `...wizardTools` to the `allTools` array and `...wizardHandlers` to the `allHandlers` object.

- [ ] **Step 4: Add wizard to router categories**

In `src/tools/router.ts`, add to `TOOL_CATEGORIES`:

```typescript
  wizard: [
    'setup_wizard',
  ],
```

Update the `wp_astro_help` category description to include `wizard`.

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build, zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/wizard.ts src/tools/wizard.ts src/tools/index.ts src/tools/router.ts
git commit -m "Add setup_wizard tool — guided one-command setup flow"
```

---

## Task 2: Paginated Blog Index

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

The current blog list page (`/blog/index.astro`) renders all posts on one page. Replace with static pagination: `/blog/`, `/blog/page/2/`, etc.

- [ ] **Step 1: Add paginated blog page generator function**

Add to `src/services/astro-scaffolder.ts` after the existing `generateBlogListPage()`:

```typescript
function generateBlogListPaginated(): string {
  return `---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

export async function getStaticPaths({ paginate }) {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
  return paginate(posts, { pageSize: 12 });
}

const { page } = Astro.props;
---

<BaseLayout title={\`Blog\${page.currentPage > 1 ? \` - Page \${page.currentPage}\` : ''}\`}>
  <h1>Blog</h1>
  <ul>
    {page.data.map(post => (
      <li>
        <a href={\`/blog/\${post.data.slug}\`}>
          <h2>{post.data.title}</h2>
        </a>
        {post.data.excerpt && <p>{post.data.excerpt}</p>}
        <div class="meta">
          <time datetime={post.data.date}>{new Date(post.data.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
          {post.data.author && <span>by {post.data.author.name}</span>}
          {post.data.readingTime && <span>{post.data.readingTime} min read</span>}
        </div>
      </li>
    ))}
  </ul>
  <nav aria-label="Pagination">
    {page.url.prev && <a href={page.url.prev}>Previous</a>}
    <span>Page {page.currentPage} of {page.lastPage}</span>
    {page.url.next && <a href={page.url.next}>Next</a>}
  </nav>
</BaseLayout>
`;
}

function generateBlogListPaginatedJson(): string {
  return `---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import allPosts from '../../../data/blog.json';

export function getStaticPaths({ paginate }) {
  return paginate(allPosts, { pageSize: 12 });
}

const { page } = Astro.props;
---

<BaseLayout title={\`Blog\${page.currentPage > 1 ? \` - Page \${page.currentPage}\` : ''}\`}>
  <h1>Blog</h1>
  <ul>
    {page.data.map(post => (
      <li>
        <a href={\`/blog/\${post.slug}\`}>
          <h2>{post.title}</h2>
        </a>
        {post.excerpt && <p>{post.excerpt}</p>}
        <div class="meta">
          <time datetime={post.date}>{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
          {post.author && <span>by {post.author.name}</span>}
          {post.readingTime && <span>{post.readingTime} min read</span>}
        </div>
      </li>
    ))}
  </ul>
  <nav aria-label="Pagination">
    {page.url.prev && <a href={page.url.prev}>Previous</a>}
    <span>Page {page.currentPage} of {page.lastPage}</span>
    {page.url.next && <a href={page.url.next}>Next</a>}
  </nav>
</BaseLayout>
`;
}
```

- [ ] **Step 2: Update scaffoldProject to use paginated blog**

In `scaffoldProject()`, replace the blog listing page write:

Change:
```typescript
  // 8. Blog listing page
  writeFile('src/pages/blog/index.astro', useJsonMode ? generateBlogListPageJson() : generateBlogListPage());
```

To:
```typescript
  // 8. Blog listing page (paginated)
  writeFile('src/pages/blog/[...page].astro', useJsonMode ? generateBlogListPaginatedJson() : generateBlogListPaginated());
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Add paginated blog index to scaffolded Astro project"
```

---

## Task 3: Search Page with Pagefind

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

Pagefind indexes static HTML at build time and provides a zero-JS-framework search widget. We add it as a post-build step and generate a `/search` page.

- [ ] **Step 1: Add search page generator function**

Add to `src/services/astro-scaffolder.ts`:

```typescript
function generateSearchPage(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Search">
  <h1>Search</h1>
  <div id="search"></div>
  <link href="/pagefind/pagefind-ui.css" rel="stylesheet" />
  <script is:inline src="/pagefind/pagefind-ui.js"></script>
  <script is:inline>
    window.addEventListener('DOMContentLoaded', () => {
      new PagefindUI({ element: '#search', showSubResults: true });
    });
  </script>
</BaseLayout>
`;
}
```

- [ ] **Step 2: Wire search page into scaffoldProject**

In `scaffoldProject()`, add after the 404 page write (step 10):

```typescript
  // 10b. Search page (Pagefind)
  writeFile('src/pages/search.astro', generateSearchPage());
```

- [ ] **Step 3: Add Pagefind postbuild script to generated package.json**

In `generatePackageJson()`, update the scripts object:

```typescript
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      postbuild: 'npx pagefind --site dist',
      preview: 'astro preview',
      'astro': 'astro',
    },
```

- [ ] **Step 4: Add search link to nav in BaseLayout**

In `generateBaseLayout()`, add search link to the nav:

Change:
```typescript
      <a href="/">${title}</a>
      <a href="/blog">Blog</a>
```

To:
```typescript
      <a href="/">${title}</a>
      <a href="/blog">Blog</a>
      <a href="/search">Search</a>
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Add search page with Pagefind to scaffolded project"
```

---

## Task 4: Related Posts Component

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

Compute related posts at build time using shared categories/tags. Show at the bottom of each post.

- [ ] **Step 1: Add related posts section to PostLayout**

In `generatePostLayout()`, add before the closing `</article>` tag, after the tags footer:

```typescript
    {/* Related posts are injected by the blog post page */}
    <slot name="related" />
```

- [ ] **Step 2: Update blog post page to compute and pass related posts**

Replace `generateBlogPostPage()` with:

```typescript
function generateBlogPostPage(): string {
  return `---
import { getCollection, render } from 'astro:content';
import PostLayout from '../../layouts/PostLayout.astro';

export async function getStaticPaths() {
  const allPosts = (await getCollection('blog'))
    .filter(p => !p.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());

  return allPosts.map(post => {
    const categorySlugs = new Set((post.data.categories || []).map(c => c.slug));
    const tagSlugs = new Set((post.data.tags || []).map(t => t.slug));

    const related = allPosts
      .filter(p => p.data.slug !== post.data.slug)
      .map(p => {
        const sharedCats = (p.data.categories || []).filter(c => categorySlugs.has(c.slug)).length;
        const sharedTags = (p.data.tags || []).filter(t => tagSlugs.has(t.slug)).length;
        return { post: p, score: sharedCats * 2 + sharedTags };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => ({ slug: r.post.data.slug, title: r.post.data.title, date: r.post.data.date, excerpt: r.post.data.excerpt }));

    return {
      params: { slug: post.data.slug },
      props: { post, related },
    };
  });
}

const { post, related } = Astro.props;
const { Content } = await render(post);
---

<PostLayout frontmatter={post.data}>
  <Content />
  {related.length > 0 && (
    <aside slot="related">
      <h2>Related Posts</h2>
      <ul>
        {related.map(r => (
          <li>
            <a href={\`/blog/\${r.slug}\`}>{r.title}</a>
            {r.excerpt && <p>{r.excerpt}</p>}
          </li>
        ))}
      </ul>
    </aside>
  )}
</PostLayout>
`;
}
```

- [ ] **Step 3: Do the same for JSON mode**

Replace `generateBlogPostPageJson()` with:

```typescript
function generateBlogPostPageJson(): string {
  return `---
import PostLayout from '../../layouts/PostLayout.astro';
import allPosts from '../../data/blog.json';

export function getStaticPaths() {
  return allPosts.map(post => {
    const categorySlugs = new Set((post.categories || []).map(c => c.slug));
    const tagSlugs = new Set((post.tags || []).map(t => t.slug));

    const related = allPosts
      .filter(p => p.slug !== post.slug)
      .map(p => {
        const sharedCats = (p.categories || []).filter(c => categorySlugs.has(c.slug)).length;
        const sharedTags = (p.tags || []).filter(t => tagSlugs.has(t.slug)).length;
        return { post: p, score: sharedCats * 2 + sharedTags };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      params: { slug: post.slug },
      props: { post, related: related.map(r => ({ slug: r.post.slug, title: r.post.title, date: r.post.date, excerpt: r.post.excerpt })) },
    };
  });
}

const { post, related } = Astro.props;
---

<PostLayout post={post} />
{related.length > 0 && (
  <aside>
    <h2>Related Posts</h2>
    <ul>
      {related.map(r => (
        <li>
          <a href={\`/blog/\${r.slug}\`}>{r.title}</a>
          {r.excerpt && <p>{r.excerpt}</p>}
        </li>
      ))}
    </ul>
  </aside>
)}
`;
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Add related posts to scaffolded blog post pages"
```

---

## Task 5: JSON Feed

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

Add `/feed.json` endpoint alongside existing RSS.

- [ ] **Step 1: Add JSON Feed generator function**

Add to `src/services/astro-scaffolder.ts`:

```typescript
function generateJsonFeed(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const description = site.site_tagline || '';
  return `import { getCollection } from 'astro:content';

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
    .slice(0, 20);

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: '${title}',
    description: '${description}',
    home_page_url: import.meta.env.SITE,
    feed_url: new URL('/feed.json', import.meta.env.SITE).href,
    language: '${site.site_language || 'en'}',
    items: posts.map(post => ({
      id: new URL(\`/blog/\${post.data.slug}\`, import.meta.env.SITE).href,
      url: new URL(\`/blog/\${post.data.slug}\`, import.meta.env.SITE).href,
      title: post.data.title,
      summary: post.data.excerpt || '',
      date_published: post.data.date,
      date_modified: post.data.modified || post.data.date,
      authors: post.data.author ? [{ name: post.data.author.name }] : [],
      tags: (post.data.categories || []).map(c => c.name),
    })),
  };

  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json' },
  });
}
`;
}

function generateJsonFeedJson(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const description = site.site_tagline || '';
  return `import posts from '../data/blog.json';

export async function GET() {
  const latest = posts.slice(0, 20);

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: '${title}',
    description: '${description}',
    home_page_url: import.meta.env.SITE,
    feed_url: new URL('/feed.json', import.meta.env.SITE).href,
    language: '${site.site_language || 'en'}',
    items: latest.map(post => ({
      id: new URL(\`/blog/\${post.slug}\`, import.meta.env.SITE).href,
      url: new URL(\`/blog/\${post.slug}\`, import.meta.env.SITE).href,
      title: post.title,
      summary: post.excerpt || '',
      date_published: post.date,
      date_modified: post.modified || post.date,
      authors: post.author ? [{ name: post.author.name }] : [],
      tags: (post.categories || []).map(c => c.name),
    })),
  };

  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json' },
  });
}
`;
}
```

- [ ] **Step 2: Wire into scaffoldProject**

Add after the RSS feed write (step 11):

```typescript
  // 11b. JSON Feed
  writeFile('src/pages/feed.json.ts', useJsonMode ? generateJsonFeedJson(site) : generateJsonFeed(site));
```

Add JSON Feed link to `generateBaseLayout()` after the RSS link:

```typescript
  <link rel="alternate" type="application/feed+json" title={siteTitle} href="/feed.json" />
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Add JSON Feed endpoint to scaffolded project"
```

---

## Task 6: Enhanced 404 Page with Search

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

- [ ] **Step 1: Replace generate404Page function**

Replace the existing `generate404Page()`:

```typescript
function generate404Page(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Page Not Found">
  <div style="text-align: center; padding: 4rem 1rem;">
    <h1 style="font-size: 4rem; margin: 0;">404</h1>
    <p style="font-size: 1.25rem; color: #666; margin: 1rem 0 2rem;">This page doesn't exist. It may have been moved or deleted.</p>
    <div style="margin: 2rem 0;">
      <a href="/" style="margin-right: 1rem;">Go Home</a>
      <a href="/blog">Browse Blog</a>
      <a href="/search" style="margin-left: 1rem;">Search</a>
    </div>
  </div>
</BaseLayout>
`;
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Enhance 404 page with search link and better styling"
```

---

## Task 7: Reading Progress Bar

**Files:**
- Modify: `src/services/astro-scaffolder.ts`

- [ ] **Step 1: Add reading progress to PostLayout**

In `generatePostLayout()`, add at the very beginning of the template (inside `<BaseLayout>`, before `<article>`):

```typescript
  <div id="progress-bar" style="position: fixed; top: 0; left: 0; height: 3px; background: #3b82f6; width: 0%; z-index: 50; transition: width 0.1s;"></div>
  <script is:inline>
    window.addEventListener('scroll', () => {
      const el = document.getElementById('progress-bar');
      if (!el) return;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
    });
  </script>
```

Do the same for `generatePostLayoutJson()`.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/services/astro-scaffolder.ts
git commit -m "Add reading progress bar to post layouts"
```

---

## Task 8: Version Bump + Build + Final Test

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version in package.json**

Change `"version": "2.0.0"` to `"version": "2.2.0"`.

- [ ] **Step 2: Update CHANGELOG.md**

Add a new entry at the top:

```markdown
## [2.2.0] - 2026-04-02

### Added
- **Setup wizard** (`setup_wizard`) — one-command guided flow to go from WordPress site to deployed Astro frontend
- **Paginated blog index** — static pagination with `/blog/page/2/` URLs
- **Search page** — Pagefind integration with client-side search at `/search`
- **Related posts** — computed at build time using shared categories/tags
- **JSON Feed** — `/feed.json` alongside existing RSS and sitemap
- **Enhanced 404 page** — styled with links to home, blog, and search
- **Reading progress bar** — scroll progress indicator on post pages
```

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: Clean build, zero errors.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Phase 8: setup wizard + production-ready scaffolding (v2.2.0)"
git push origin main
```
