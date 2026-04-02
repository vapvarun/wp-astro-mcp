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
