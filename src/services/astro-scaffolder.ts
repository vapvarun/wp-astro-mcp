/**
 * Astro Project Scaffolder
 * Generates Astro project structure with content collections,
 * config, layouts, and deploy platform configuration.
 */

import fs from 'fs';
import path from 'path';
import type { SiteConfig } from '../types/index.js';
import logger from '../utils/logger.js';

export interface ScaffoldResult {
  filesCreated: string[];
  filesSkipped: string[];
  outputDir: string;
}

/**
 * Scaffold a complete Astro project structure
 */
export function scaffoldProject(
  site: SiteConfig,
  outputDir: string,
  force = false
): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];

  const config = site.export || {};
  const componentLib = config.component_library || 'none';
  const deployPlatform = config.deploy_platform || 'none';
  const contentFormat = config.content_format || 'md';
  const useJsonMode = contentFormat === 'json';
  const useTailwind = componentLib === 'starwind';

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Helper to write file if not exists (or if force)
  const writeFile = (relPath: string, content: string) => {
    const fullPath = path.join(outputDir, relPath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    if (!force && fs.existsSync(fullPath)) {
      skipped.push(relPath);
      return;
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    created.push(relPath);
  };

  // 1. package.json
  writeFile('package.json', generatePackageJson(site, componentLib, deployPlatform));

  // 2. astro.config.mjs
  writeFile('astro.config.mjs', generateAstroConfig(site, deployPlatform, componentLib));

  // 3. tsconfig.json
  writeFile('tsconfig.json', JSON.stringify({
    extends: 'astro/tsconfigs/strict',
    compilerOptions: {
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
    },
  }, null, 2));

  // 4. Content config (skip for JSON mode — no content collections)
  if (!useJsonMode) {
    writeFile('src/content.config.ts', generateContentConfig(site));
  }

  // 4b. Global content stylesheet (framework-free baseline + Tailwind prose when enabled)
  writeFile('src/styles/global.css', generateGlobalCss(useTailwind));

  // 5. Base layout
  writeFile('src/layouts/BaseLayout.astro', generateBaseLayout(site));

  // 6. Blog post layout
  writeFile('src/layouts/PostLayout.astro', useJsonMode ? generatePostLayoutJson(useTailwind) : generatePostLayout(useTailwind));

  // 7. Index page
  writeFile('src/pages/index.astro', useJsonMode ? generateIndexPageJson(site) : generateIndexPage(site));

  // 8. Blog listing page (paginated)
  writeFile('src/pages/blog/[...page].astro', useJsonMode ? generateBlogListPaginatedJson() : generateBlogListPaginated());

  // 9. Blog post page (dynamic route)
  writeFile('src/pages/blog/[...slug].astro', useJsonMode ? generateBlogPostPageJson() : generateBlogPostPage());

  // 10. 404 page
  writeFile('src/pages/404.astro', generate404Page());

  // 10b. Search page (Pagefind)
  writeFile('src/pages/search.astro', generateSearchPage());

  // 10c. Webhook endpoint for wp-astro-bridge
  writeFile('src/pages/api/hook.ts', generateWebhookEndpoint());

  // 10d. Preview page (SSR — requires hybrid output mode with an adapter)
  if (deployPlatform !== 'none') {
    writeFile('src/pages/preview.astro', generatePreviewPage(site, useTailwind));
  }

  // 11. RSS feed (optional)
  writeFile('src/pages/rss.xml.ts', generateRssFeed(site));

  // 11b. JSON Feed
  writeFile('src/pages/feed.json.ts', useJsonMode ? generateJsonFeedJson(site) : generateJsonFeed(site));

  // 12. Deploy platform config
  if (deployPlatform === 'vercel') {
    writeFile('vercel.json', JSON.stringify({ framework: 'astro' }, null, 2));
  } else if (deployPlatform === 'netlify') {
    writeFile('netlify.toml', `[build]\n  command = "npm run build"\n  publish = "dist"\n`);
  } else if (deployPlatform === 'cloudflare') {
    writeFile('wrangler.toml', `name = "${site.id}"\ncompatibility_date = "2026-03-01"\npages_build_output_dir = "dist"\n`);
  }

  // 13. .gitignore
  writeFile('.gitignore', `node_modules/\ndist/\n.astro/\n.env\n*.log\n`);

  // 13b. .nvmrc (Astro 6 requires Node 22.12+)
  writeFile('.nvmrc', '22');

  // 14. Content directories (or data directory for JSON mode)
  if (useJsonMode) {
    fs.mkdirSync(path.join(outputDir, 'src', 'data'), { recursive: true });
    created.push('src/data/');
  } else {
    const postTypes = site.post_types || [
      { slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true },
      { slug: 'page', rest_base: 'pages', name: 'Pages', hierarchical: true, has_archive: false },
    ];

    for (const pt of postTypes) {
      if (['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)) continue;
      const dir = getCollectionDir(pt.slug, config.content_type_config);
      fs.mkdirSync(path.join(outputDir, 'src', 'content', dir), { recursive: true });
      created.push(`src/content/${dir}/`);
    }
  }

  // 15. Public directory
  fs.mkdirSync(path.join(outputDir, 'public'), { recursive: true });

  // 16. env.d.ts
  writeFile('src/env.d.ts', '/// <reference types="astro/client" />\n');

  logger.info('Project scaffolded', { outputDir, created: created.length, skipped: skipped.length });

  return { filesCreated: created, filesSkipped: skipped, outputDir };
}

function getCollectionDir(
  postType: string,
  contentTypeConfig?: Record<string, { directory: string }>
): string {
  if (contentTypeConfig?.[postType]?.directory) {
    return contentTypeConfig[postType].directory;
  }
  switch (postType) {
    case 'post': return 'blog';
    case 'page': return 'pages';
    default: return postType.replace(/_/g, '-');
  }
}

export function getCollectionDirForType(
  postType: string,
  site: SiteConfig
): string {
  return getCollectionDir(postType, site.export?.content_type_config);
}

function generatePackageJson(site: SiteConfig, componentLib: string, deployPlatform: string): string {
  const deps: Record<string, string> = {
    astro: '^6.0.0',
    '@astrojs/sitemap': '^4.0.0',
    '@astrojs/rss': '^5.0.0',
  };

  if (deployPlatform === 'vercel') deps['@astrojs/vercel'] = '^9.0.0';
  if (deployPlatform === 'netlify') deps['@astrojs/netlify'] = '^7.0.0';
  if (deployPlatform === 'cloudflare') deps['@astrojs/cloudflare'] = '^13.0.0';

  if (componentLib === 'starwind') {
    deps['@starwindui/core'] = '^0.2.0';
    deps['tailwindcss'] = '^4.0.0';
    deps['@tailwindcss/vite'] = '^4.0.0';
    deps['@tailwindcss/typography'] = '^0.5.16';
  }

  const pkg = {
    name: site.id,
    type: 'module',
    version: '1.0.0',
    description: `${site.name} — Powered by WordPress + Astro`,
    engines: { node: '>=22.12.0' },
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      postbuild: 'npx pagefind --site dist',
      preview: 'astro preview',
      'astro': 'astro',
    },
    dependencies: deps,
  };

  return JSON.stringify(pkg, null, 2);
}

function generateAstroConfig(site: SiteConfig, deployPlatform: string, componentLib: string): string {
  const useTailwind = componentLib === 'starwind';
  const integrations: string[] = ['sitemap()'];
  const imports: string[] = [
    "import { defineConfig } from 'astro/config';",
    "import sitemap from '@astrojs/sitemap';",
  ];

  if (useTailwind) {
    imports.push("import tailwindcss from '@tailwindcss/vite';");
  }

  if (deployPlatform === 'vercel') {
    imports.push("import vercel from '@astrojs/vercel';");
  } else if (deployPlatform === 'netlify') {
    imports.push("import netlify from '@astrojs/netlify';");
  } else if (deployPlatform === 'cloudflare') {
    imports.push("import cloudflare from '@astrojs/cloudflare';");
  }

  const siteUrl = site.url.replace(/\/+$/, '');

  let config = `${imports.join('\n')}

export default defineConfig({
  site: '${siteUrl}',
  integrations: [${integrations.join(', ')}],
  image: {
    layout: 'constrained',
    responsiveStyles: true,
  },
  experimental: {
    fonts: [
      {
        provider: 'google',
        family: 'Inter',
        weights: [400, 500, 600, 700],
      },
    ],
  },`;

  if (deployPlatform !== 'none') {
    const adapterMap: Record<string, string> = {
      vercel: 'vercel()',
      netlify: 'netlify()',
      cloudflare: 'cloudflare()',
    };
    if (adapterMap[deployPlatform]) {
      config += `\n  adapter: ${adapterMap[deployPlatform]},`;
      config += `\n  output: 'hybrid',`;
    }
  }

  if (useTailwind) {
    config += `\n  vite: { plugins: [tailwindcss()] },`;
  }

  config += '\n});\n';
  return config;
}

function generateContentConfig(site: SiteConfig): string {
  const postTypes = site.post_types || [
    { slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true },
    { slug: 'page', rest_base: 'pages', name: 'Pages', hierarchical: true, has_archive: false },
  ];

  const collections: string[] = [];
  for (const pt of postTypes) {
    if (['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)) continue;
    const dir = getCollectionDir(pt.slug, site.export?.content_type_config);
    const name = dir.replace(/-/g, '_');
    collections.push(`  ${name}: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "src/content/${dir}" }),
    schema: baseSchema,
  })`);
  }

  return `import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const baseSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  modified: z.string().optional(),
  author: z.object({
    name: z.string(),
    id: z.number(),
    slug: z.string(),
    avatar: z.string().optional(),
  }).optional(),
  status: z.string(),
  draft: z.boolean().optional(),
  categories: z.array(z.object({
    name: z.string(),
    slug: z.string(),
  })).optional(),
  tags: z.array(z.object({
    name: z.string(),
    slug: z.string(),
  })).optional(),
  excerpt: z.string().optional(),
  featuredImage: z.object({
    url: z.string(),
    alt: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    canonical: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
    focusKeyword: z.string().optional(),
    jsonLd: z.record(z.unknown()).optional(),
  }).optional(),
  readingTime: z.number().optional(),
  wordCount: z.number().optional(),
  wpPostId: z.number(),
  wpUrl: z.string(),
  postType: z.string(),
});

export const collections = {
${collections.join(',\n')}
};
`;
}

function generateGlobalCss(useTailwind: boolean): string {
  const tailwind = useTailwind
    ? `/* ---- Tailwind (only when enabled) ---- */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

`
    : '';

  return `${tailwind}/* Content typography — baseline (backs off when Tailwind \`prose\` is applied) */
.content:not(.prose){max-width:70ch;font-size:1.0625rem;line-height:1.75;color:#1f2937;}
.content:not(.prose) > * + *{margin-top:1.25em;}
.content:not(.prose) h1,.content:not(.prose) h2,.content:not(.prose) h3,.content:not(.prose) h4{line-height:1.25;font-weight:700;color:#111827;margin-top:2em;margin-bottom:.6em;}
.content:not(.prose) h2{font-size:1.6rem;}
.content:not(.prose) h3{font-size:1.3rem;}
.content:not(.prose) a{color:#2563eb;text-decoration:underline;text-underline-offset:2px;}
.content:not(.prose) a:hover{color:#1d4ed8;}
.content:not(.prose) ul,.content:not(.prose) ol{padding-left:1.5em;}
.content:not(.prose) li + li{margin-top:.35em;}
.content:not(.prose) blockquote{border-left:3px solid #e5e7eb;padding-left:1em;color:#4b5563;font-style:italic;}
.content:not(.prose) pre{background:#0f172a;color:#e2e8f0;padding:1rem 1.25rem;border-radius:.5rem;overflow-x:auto;font-size:.9rem;line-height:1.6;}
.content:not(.prose) :not(pre) > code{background:#f1f5f9;padding:.15em .4em;border-radius:.3em;font-size:.9em;}
.content:not(.prose) table{width:100%;border-collapse:collapse;font-size:.95rem;}
.content:not(.prose) th,.content:not(.prose) td{border:1px solid #e5e7eb;padding:.5rem .75rem;text-align:left;}
.content:not(.prose) hr{border:0;border-top:1px solid #e5e7eb;margin:2em 0;}

/* Media — BOTH modes (also augments Tailwind prose) */
.content img{max-width:100%;height:auto;border-radius:.5rem;}
.content figure{margin:1.5em 0;}
.content figure img{display:block;margin-inline:auto;}
.content figcaption{text-align:center;font-size:.875rem;color:#6b7280;margin-top:.5em;}
.content iframe{max-width:100%;}

/* WordPress block compatibility — JSON mode retains these classes (prose doesn't know them) */
.content .aligncenter{display:block;margin-inline:auto;}
.content .alignleft{float:left;margin:.3em 1.25em 1em 0;}
.content .alignright{float:right;margin:.3em 0 1em 1.25em;}
.content .alignwide,.content figure.alignwide{width:min(100%,1100px);margin-inline:auto;}
.content .alignfull,.content figure.alignfull{width:100vw;max-width:100vw;margin-inline:calc(50% - 50vw);}
.content .wp-caption{max-width:100%;}
.content .wp-caption-text,.content .wp-element-caption{text-align:center;font-size:.875rem;color:#6b7280;margin-top:.5em;}
.content .wp-block-columns{display:flex;flex-wrap:wrap;gap:1.5rem;}
.content .wp-block-column{flex:1 1 0;min-width:0;}
.content .wp-block-button__link{display:inline-block;padding:.6em 1.2em;background:#2563eb;color:#fff;border-radius:.4em;text-decoration:none;}
.content .wp-block-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;}
.content .wp-block-gallery img{width:100%;}
.content .wp-block-quote,.content .wp-block-pullquote{border-left:3px solid #e5e7eb;padding-left:1em;color:#4b5563;}
.content .wp-block-code pre,.content .wp-block-preformatted pre{overflow-x:auto;}

/* Responsive (≤640px) */
@media (max-width:640px){
  .content:not(.prose){font-size:1rem;line-height:1.7;}
  .content:not(.prose) h2{font-size:1.4rem;}
  .content:not(.prose) h3{font-size:1.2rem;}
  .content .alignleft,.content .alignright{float:none;display:block;margin-inline:auto;}
  .content .wp-block-columns{flex-direction:column;gap:1rem;}
  .content pre{font-size:.825rem;}
}
`;
}

function generateBaseLayout(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const tagline = site.site_tagline || '';
  return `---
import '../styles/global.css';

interface Props {
  title?: string;
  description?: string;
  ogImage?: string;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  jsonLd?: Record<string, unknown>;
}

const {
  title = '${title}',
  description = '${tagline}',
  ogImage,
  type = 'website',
  publishedTime,
  modifiedTime,
  jsonLd,
} = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
const siteTitle = '${title}';
const fullTitle = title === siteTitle ? title : \`\${title} | \${siteTitle}\`;
---

<!DOCTYPE html>
<html lang="${site.site_language || 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="canonical" href={canonicalURL.href} />
  <meta name="description" content={description} />

  <!-- Open Graph -->
  <meta property="og:type" content={type} />
  <meta property="og:title" content={fullTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalURL.href} />
  <meta property="og:site_name" content={siteTitle} />
  {ogImage && <meta property="og:image" content={ogImage} />}
  {publishedTime && <meta property="article:published_time" content={publishedTime} />}
  {modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}

  <!-- Twitter Card -->
  <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={fullTitle} />
  <meta name="twitter:description" content={description} />
  {ogImage && <meta name="twitter:image" content={ogImage} />}

  <link rel="sitemap" href="/sitemap-index.xml" />
  <link rel="alternate" type="application/rss+xml" title={siteTitle} href="/rss.xml" />
  <link rel="alternate" type="application/feed+json" title={siteTitle} href="/feed.json" />

  {jsonLd && (
    <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
  )}

  <title>{fullTitle}</title>
</head>
<body>
  <header>
    <nav>
      <a href="/">${title}</a>
      <a href="/blog">Blog</a>
      <a href="/search">Search</a>
    </nav>
  </header>
  <main>
    <slot />
  </main>
  <footer>
    <p>&copy; {new Date().getFullYear()} ${title}</p>
  </footer>
</body>
</html>
`;
}

function generatePostLayout(useTailwind: boolean): string {
  const contentClass = useTailwind ? 'content prose prose-slate max-w-none' : 'content';
  return `---
import BaseLayout from './BaseLayout.astro';

const { frontmatter } = Astro.props;
const { title, date, modified, author, categories, tags, featuredImage, excerpt, seo, readingTime, wordCount } = frontmatter;
const pageTitle = seo?.title || title;
const pageDescription = seo?.description || excerpt || '';
const ogImage = seo?.ogImage || featuredImage?.url;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);

// JSON-LD BlogPosting schema
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: title,
  description: pageDescription,
  mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalURL.href },
  ...(date && { datePublished: date }),
  ...(modified && { dateModified: modified }),
  ...(author && { author: { '@type': 'Person', name: author.name } }),
  ...(featuredImage && { image: featuredImage.url }),
  ...(wordCount && { wordCount }),
  url: canonicalURL.href,
};
---

<BaseLayout
  title={pageTitle}
  description={pageDescription}
  ogImage={ogImage}
  type="article"
  publishedTime={date}
  modifiedTime={modified}
  jsonLd={jsonLd}
>
  <div id="progress-bar" style="position: fixed; top: 0; left: 0; height: 3px; background: #3b82f6; width: 0%; z-index: 50; transition: width 0.1s;"></div>
  <script is:inline>
    window.addEventListener('scroll', () => {
      const el = document.getElementById('progress-bar');
      if (!el) return;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
    });
  <\/script>
  <article>
    <header>
      <h1>{title}</h1>
      <div class="meta">
        {date && <time datetime={date}>{new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>}
        {author && <span>by {author.name}</span>}
        {readingTime && <span>{readingTime} min read</span>}
      </div>
      {categories && categories.length > 0 && (
        <div class="categories">
          {categories.map((cat: { name: string; slug: string }) => (
            <a href={\`/blog/category/\${cat.slug}\`}>{cat.name}</a>
          ))}
        </div>
      )}
    </header>

    {featuredImage && (
      <img
        src={featuredImage.url}
        alt={featuredImage.alt || title}
        width={featuredImage.width}
        height={featuredImage.height}
        loading="eager"
        style={featuredImage.width && featuredImage.height ? \`aspect-ratio: \${featuredImage.width}/\${featuredImage.height}\` : undefined}
      />
    )}

    <div class="${contentClass}">
      <slot />
    </div>

    {tags && tags.length > 0 && (
      <footer>
        <div class="tags">
          {tags.map((tag: { name: string; slug: string }) => (
            <a href={\`/blog/tag/\${tag.slug}\`}>{tag.name}</a>
          ))}
        </div>
      </footer>
    )}

    <slot name="related" />
  </article>
</BaseLayout>
`;
}

function generateIndexPage(site: SiteConfig): string {
  const title = site.site_title || site.name;
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog'))
  .filter(post => !post.data.draft)
  .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
  .slice(0, 10);
---

<BaseLayout>
  <h1>${title}</h1>
  <section>
    <h2>Latest Posts</h2>
    <ul>
      {posts.map(post => (
        <li>
          <a href={\`/blog/\${post.data.slug}\`}>
            <h3>{post.data.title}</h3>
          </a>
          {post.data.excerpt && <p>{post.data.excerpt}</p>}
          <time datetime={post.data.date}>{new Date(post.data.date).toLocaleDateString()}</time>
        </li>
      ))}
    </ul>
  </section>
</BaseLayout>
`;
}

function generateBlogListPaginated(): string {
  return `---
import type { GetStaticPaths } from 'astro';
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

export const getStaticPaths = (async ({ paginate }) => {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
  return paginate(posts, { pageSize: 12 });
}) satisfies GetStaticPaths;

const { page } = Astro.props;
---

<BaseLayout title={page.currentPage === 1 ? 'Blog' : \`Blog — Page \${page.currentPage}\`}>
  <h1>Blog</h1>
  <ul>
    {page.data.map(post => (
      <li>
        <a href={\`/blog/\${post.data.slug}\`}>
          <h2>{post.data.title}</h2>
        </a>
        {post.data.excerpt && <p>{post.data.excerpt}</p>}
        <div class="meta">
          <time datetime={post.data.date}>{new Date(post.data.date).toLocaleDateString()}</time>
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
import type { GetStaticPaths } from 'astro';
import BaseLayout from '../../layouts/BaseLayout.astro';
import allPosts from '../../data/blog.json';

export const getStaticPaths = (({ paginate }) => {
  return paginate(allPosts, { pageSize: 12 });
}) satisfies GetStaticPaths;

const { page } = Astro.props;
---

<BaseLayout title={page.currentPage === 1 ? 'Blog' : \`Blog — Page \${page.currentPage}\`}>
  <h1>Blog</h1>
  <ul>
    {page.data.map(post => (
      <li>
        <a href={\`/blog/\${post.slug}\`}>
          <h2>{post.title}</h2>
        </a>
        {post.excerpt && <p>{post.excerpt}</p>}
        <div class="meta">
          <time datetime={post.date}>{new Date(post.date).toLocaleDateString()}</time>
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

function generateBlogPostPage(): string {
  return `---
import { getCollection, render } from 'astro:content';
import PostLayout from '../../layouts/PostLayout.astro';

export async function getStaticPaths() {
  const allPosts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());

  return allPosts.map(post => {
    const postCats = (post.data.categories || []).map(c => c.slug);
    const postTags = (post.data.tags || []).map(t => t.slug);

    const scored = allPosts
      .filter(p => p.data.slug !== post.data.slug)
      .map(p => {
        const pCats = (p.data.categories || []).map(c => c.slug);
        const pTags = (p.data.tags || []).map(t => t.slug);
        const catScore = pCats.filter(c => postCats.includes(c)).length * 2;
        const tagScore = pTags.filter(t => postTags.includes(t)).length;
        return { post: p, score: catScore + tagScore };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.post);

    return {
      params: { slug: post.data.slug },
      props: { post, related: scored },
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
          <li><a href={\`/blog/\${r.data.slug}\`}>{r.data.title}</a></li>
        ))}
      </ul>
    </aside>
  )}
</PostLayout>
`;
}

function generate404Page(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Page Not Found">
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; padding: 2rem;">
    <h1 style="font-size: 6rem; font-weight: 800; margin: 0; line-height: 1; color: #1e293b;">404</h1>
    <p style="font-size: 1.25rem; color: #64748b; margin: 1rem 0 2rem;">This page doesn't exist. It may have been moved or deleted.</p>
    <nav style="display: flex; gap: 1.5rem; flex-wrap: wrap; justify-content: center;">
      <a href="/" style="color: #3b82f6; text-decoration: underline;">Home</a>
      <a href="/blog" style="color: #3b82f6; text-decoration: underline;">Blog</a>
      <a href="/search" style="color: #3b82f6; text-decoration: underline;">Search</a>
    </nav>
  </div>
</BaseLayout>
`;
}

function generateSearchPage(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Search">
  <h1>Search</h1>
  <link rel="stylesheet" href="/pagefind/pagefind-ui.css" />
  <div id="search"></div>
  <script is:inline src="/pagefind/pagefind-ui.js"><\/script>
  <script is:inline>
    document.addEventListener('DOMContentLoaded', () => {
      new PagefindUI({ element: '#search', showSubResults: true });
    });
  <\/script>
</BaseLayout>
`;
}

function generateWebhookEndpoint(): string {
  return `import type { APIRoute } from 'astro';

/**
 * Webhook endpoint -- receives content change notifications from wp-astro-bridge.
 *
 * Configure your deploy platform's build hook URL as the webhook_url in wp-astro-bridge settings.
 * This endpoint is an alternative: it validates the webhook signature and can trigger
 * platform-specific rebuild APIs.
 *
 * For most setups, pointing wp-astro-bridge directly at the deploy hook is simpler.
 */
export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get('x-astro-signature') || '';
  const event = request.headers.get('x-astro-event') || '';
  const body = await request.text();

  // Log the webhook event
  console.log('[webhook]', event, body.substring(0, 200));

  // TODO: Add your deploy platform's rebuild trigger here
  // Vercel: fetch('https://api.vercel.com/v1/integrations/deploy/...', { method: 'POST' })
  // Netlify: fetch('https://api.netlify.com/build_hooks/...', { method: 'POST' })

  return new Response(JSON.stringify({ received: true, event }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
`;
}

function generatePreviewPage(site: SiteConfig, useTailwind: boolean): string {
  const wpUrl = site.url.replace(/\/+$/, '');
  const contentClass = useTailwind ? 'content prose prose-slate max-w-none' : 'content';
  return `---
export const prerender = false;

const url = new URL(Astro.request.url);
const token = url.searchParams.get('token');
const postId = url.searchParams.get('id');

if (!token || !postId) {
  return Astro.redirect('/404');
}

// Verify token and fetch draft content from WordPress
let post = null;
let error = null;

try {
  const verifyUrl = '${wpUrl}/wp-json/astro-bridge/v1/verify-token?' + new URLSearchParams({ token, post_id: postId }).toString();
  const response = await fetch(verifyUrl);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    error = data.message || 'Preview token is invalid or expired. Click Preview again in WordPress.';
  } else {
    post = await response.json();
  }
} catch (e) {
  error = 'Could not connect to WordPress. Make sure the site is accessible.';
}

import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title={post ? \`Preview: \${post.title}\` : 'Preview Error'}>
  {error ? (
    <div style="max-width: 600px; margin: 4rem auto; text-align: center;">
      <h1 style="color: #dc2626;">Preview Unavailable</h1>
      <p style="color: #666; font-size: 1.1rem;">{error}</p>
      <p style="margin-top: 2rem;"><a href="/">Go to homepage</a></p>
    </div>
  ) : post ? (
    <>
      <div style="background: #fef3c7; border-bottom: 1px solid #f59e0b; padding: 0.75rem 1rem; text-align: center; font-size: 0.875rem; color: #92400e; position: sticky; top: 0; z-index: 40;">
        You are previewing a draft. This page is not published.
      </div>
      <article style="max-width: 800px; margin: 0 auto; padding: 2rem 1rem;">
        <header>
          <h1>{post.title}</h1>
          <div class="meta" style="color: #666; margin: 0.5rem 0 2rem;">
            {post.date && <time datetime={post.date}>{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>}
            {post.author && <span> by {post.author.name}</span>}
          </div>
          {post.categories && post.categories.length > 0 && (
            <div style="margin-bottom: 1rem;">
              {post.categories.map((cat) => (
                <span style="background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 0.25rem; margin-right: 0.5rem; font-size: 0.875rem;">{cat.name}</span>
              ))}
            </div>
          )}
        </header>

        {post.featured_image && (
          <img
            src={post.featured_image.url}
            alt={post.featured_image.alt || post.title}
            width={post.featured_image.width}
            height={post.featured_image.height}
            loading="eager"
            style={post.featured_image.width && post.featured_image.height ? \`aspect-ratio: \${post.featured_image.width}/\${post.featured_image.height}; max-width: 100%; height: auto;\` : 'max-width: 100%;'}
          />
        )}

        <div class="${contentClass}" set:html={post.content} />

        {post.tags && post.tags.length > 0 && (
          <footer style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;">
            {post.tags.map((tag) => (
              <span style="background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 0.25rem; margin-right: 0.5rem; font-size: 0.875rem;">{tag.name}</span>
            ))}
          </footer>
        )}
      </article>
    </>
  ) : null}
</BaseLayout>
`;
}

function generateRssFeed(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const description = site.site_tagline || '';
  return `import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());

  return rss({
    title: '${title}',
    description: '${description}',
    site: import.meta.env.SITE,
    items: posts.map(post => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      description: post.data.excerpt || '',
      link: \`/blog/\${post.data.slug}/\`,
    })),
  });
}
`;
}

function generateJsonFeed(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const description = site.site_tagline || '';
  const language = site.site_language || 'en';
  return `import { getCollection } from 'astro:content';

export async function GET() {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());

  const siteUrl = import.meta.env.SITE;

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: '${title}',
    description: '${description}',
    home_page_url: siteUrl,
    feed_url: \`\${siteUrl}/feed.json\`,
    language: '${language}',
    items: posts.map(post => ({
      id: \`\${siteUrl}/blog/\${post.data.slug}/\`,
      url: \`\${siteUrl}/blog/\${post.data.slug}/\`,
      title: post.data.title,
      summary: post.data.excerpt || '',
      date_published: post.data.date,
      ...(post.data.modified && { date_modified: post.data.modified }),
      ...(post.data.author && { authors: [{ name: post.data.author.name }] }),
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
  const language = site.site_language || 'en';
  return `import allPosts from '../data/blog.json';

export function GET() {
  const siteUrl = import.meta.env.SITE;

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: '${title}',
    description: '${description}',
    home_page_url: siteUrl,
    feed_url: \`\${siteUrl}/feed.json\`,
    language: '${language}',
    items: allPosts.map(post => ({
      id: \`\${siteUrl}/blog/\${post.slug}/\`,
      url: \`\${siteUrl}/blog/\${post.slug}/\`,
      title: post.title,
      summary: post.excerpt || '',
      date_published: post.date,
      ...(post.modified && { date_modified: post.modified }),
      ...(post.author && { authors: [{ name: post.author.name }] }),
    })),
  };

  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json' },
  });
}
`;
}

// ============================================================
// JSON Mode Page Generators
// For large sites (500+ posts), skip content collections entirely.
// Content stays as HTML, imported from a single JSON file.
// This avoids Astro's markdown parsing pipeline which OOMs on large sites.
// ============================================================

function generatePostLayoutJson(useTailwind: boolean): string {
  const contentClass = useTailwind ? 'content prose prose-slate max-w-none' : 'content';
  return `---
import BaseLayout from './BaseLayout.astro';

interface Props {
  post: {
    title: string;
    date: string;
    modified?: string;
    author?: { name: string };
    categories?: Array<{ name: string; slug: string }>;
    tags?: Array<{ name: string; slug: string }>;
    featuredImage?: { url: string; alt: string; width?: number; height?: number };
    excerpt?: string;
    content: string;
    seo?: { title?: string; description?: string; ogImage?: string };
    readingTime?: number;
    wordCount?: number;
  };
}

const { post } = Astro.props;
const pageTitle = post.seo?.title || post.title;
const pageDescription = post.seo?.description || post.excerpt || '';
const ogImage = post.seo?.ogImage || post.featuredImage?.url;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);

// JSON-LD BlogPosting schema
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: post.title,
  description: pageDescription,
  mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalURL.href },
  ...(post.date && { datePublished: post.date }),
  ...(post.modified && { dateModified: post.modified }),
  ...(post.author && { author: { '@type': 'Person', name: post.author.name } }),
  ...(post.featuredImage && { image: post.featuredImage.url }),
  ...(post.wordCount && { wordCount: post.wordCount }),
  url: canonicalURL.href,
};
---

<BaseLayout
  title={pageTitle}
  description={pageDescription}
  ogImage={ogImage}
  type="article"
  publishedTime={post.date}
  modifiedTime={post.modified}
  jsonLd={jsonLd}
>
  <div id="progress-bar" style="position: fixed; top: 0; left: 0; height: 3px; background: #3b82f6; width: 0%; z-index: 50; transition: width 0.1s;"></div>
  <script is:inline>
    window.addEventListener('scroll', () => {
      const el = document.getElementById('progress-bar');
      if (!el) return;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
    });
  <\/script>
  <article>
    <header>
      <h1>{post.title}</h1>
      <div class="meta">
        {post.date && <time datetime={post.date}>{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>}
        {post.author && <span>by {post.author.name}</span>}
        {post.readingTime && <span>{post.readingTime} min read</span>}
      </div>
      {post.categories && post.categories.length > 0 && (
        <div class="categories">
          {post.categories.map((cat) => (
            <a href={\`/blog/category/\${cat.slug}\`}>{cat.name}</a>
          ))}
        </div>
      )}
    </header>

    {post.featuredImage && (
      <img
        src={post.featuredImage.url}
        alt={post.featuredImage.alt || post.title}
        width={post.featuredImage.width}
        height={post.featuredImage.height}
        loading="eager"
        style={post.featuredImage.width && post.featuredImage.height ? \`aspect-ratio: \${post.featuredImage.width}/\${post.featuredImage.height}\` : undefined}
      />
    )}

    <div class="${contentClass}" set:html={post.content} />

    {post.tags && post.tags.length > 0 && (
      <footer>
        <div class="tags">
          {post.tags.map((tag) => (
            <a href={\`/blog/tag/\${tag.slug}\`}>{tag.name}</a>
          ))}
        </div>
      </footer>
    )}
  </article>
</BaseLayout>
`;
}

function generateIndexPageJson(site: SiteConfig): string {
  const title = site.site_title || site.name;
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
import posts from '../data/blog.json';

const latest = posts.slice(0, 10);
---

<BaseLayout>
  <h1>${title}</h1>
  <section>
    <h2>Latest Posts</h2>
    <ul>
      {latest.map(post => (
        <li>
          <a href={\`/blog/\${post.slug}\`}>
            <h3>{post.title}</h3>
          </a>
          {post.excerpt && <p>{post.excerpt}</p>}
          <time datetime={post.date}>{new Date(post.date).toLocaleDateString()}</time>
        </li>
      ))}
    </ul>
  </section>
</BaseLayout>
`;
}

function generateBlogPostPageJson(): string {
  return `---
import PostLayout from '../../layouts/PostLayout.astro';
import allPosts from '../../data/blog.json';

export function getStaticPaths() {
  return allPosts.map(post => {
    const postCats = (post.categories || []).map(c => c.slug);
    const postTags = (post.tags || []).map(c => c.slug);

    const related = allPosts
      .filter(p => p.slug !== post.slug)
      .map(p => {
        const pCats = (p.categories || []).map(c => c.slug);
        const pTags = (p.tags || []).map(c => c.slug);
        const catScore = pCats.filter(c => postCats.includes(c)).length * 2;
        const tagScore = pTags.filter(t => postTags.includes(t)).length;
        return { post: p, score: catScore + tagScore };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.post);

    return {
      params: { slug: post.slug },
      props: { post, related },
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
        <li><a href={\`/blog/\${r.slug}\`}>{r.title}</a></li>
      ))}
    </ul>
  </aside>
)}
`;
}
