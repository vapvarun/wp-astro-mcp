# Getting Started

This guide walks you through your first WordPress-to-Astro migration using WP Astro MCP.

## Prerequisites

- Node.js 18+
- A WordPress site with REST API enabled
- An application password for your WordPress user
- Claude Code with MCP support

## Step 1: Install WP Astro MCP

```bash
git clone https://github.com/vapvarun/wp-astro-mcp.git
cd wp-astro-mcp
npm install
npm run build
```

## Step 2: Configure Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "wp-astro-mcp": {
      "command": "node",
      "args": ["/full/path/to/wp-astro-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code after adding the config.

## Step 3: Generate a WordPress Application Password

1. Log in to your WordPress admin
2. Go to **Users → Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g., "Astro Migration")
5. Click **Add New Application Password**
6. Copy the generated password (you won't see it again)

> **Note:** Application Passwords are available natively in WordPress 5.6+. For older versions, install the [Application Passwords plugin](https://wordpress.org/plugins/application-passwords/).

## Step 4: Register Your Site

In Claude Code, tell it:

```
Add my WordPress site https://myblog.com with username admin
and app password "abcd efgh ijkl mnop qrst uvwx"
```

The MCP server will:
- Verify the connection
- Authenticate with your credentials
- Auto-detect: WordPress version, SEO plugin, page builder, ACF, WooCommerce
- Discover all post types and taxonomies
- Save the configuration

## Step 5: Analyze Your Site

```
Analyze myblog.com
```

This counts all content (posts, pages, CPTs, categories, tags, media, authors) and estimates migration time.

## Step 6: Configure Export Settings

```
Configure export for myblog.com:
- Output to C:/projects/myblog-astro
- Markdown format
- Media strategy: rewrite with domain app.myblog.com
- Deploy to Vercel
- Include only published posts
- Organize in year/month directories
```

## Step 7: Audit Content

```
Run a content audit on myblog.com
```

This samples posts and reports:
- Shortcodes in use (and whether they have handlers)
- Gutenberg blocks used
- Page builder detection
- Embed types (YouTube, Vimeo, etc.)
- Content complexity distribution (simple/moderate/complex)
- Galleries, tables, forms, iframes

## Step 8: Preview Conversion

```
Preview 5 converted posts from myblog.com
```

Review the Markdown output. If shortcodes need configuration:

```
Configure shortcode "my_custom_widget" as keep_content for myblog.com
```

## Step 9: Scaffold & Export

```
Scaffold the Astro project for myblog.com
```

This creates the full Astro project structure. Then:

```
Start exporting myblog.com
```

For large sites (500+ posts), the export processes in batches:

```
Resume the export
```

Keep running `resume` until complete.

## Step 10: Validate & Publish

```
Validate the export for myblog.com
Generate redirects for myblog.com
Push myblog.com to GitHub
```

## What's Next

- Connect your GitHub repo to Vercel/Netlify/Cloudflare for auto-deploys
- Run `media_rewrite` when swapping domains at go-live
- Use `export_start` with date filters for incremental updates
- See [Use Cases](use-cases.md) for more advanced workflows
