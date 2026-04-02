# Phase 9: wp-astro-bridge WordPress Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lightweight WordPress plugin that fires webhooks on content changes, rewrites the Preview button to point to the Astro frontend, and exposes normalized SEO data via REST API. 3 classes, zero dependencies, installable via zip upload.

**Architecture:** Standard WordPress plugin structure under `wordpress/wp-astro-bridge/`. Main plugin file registers hooks and loads classes. Each class has a single responsibility: webhook dispatch, preview URL rewriting, or REST API extensions. Settings stored in `wp_options`. No custom DB tables, no Composer, no JS bundles.

**Tech Stack:** PHP 7.4+, WordPress 5.6+ APIs (REST API, Settings API, Transients API)

---

## File Structure

### New Files (all created from scratch)

| File | Responsibility |
|------|---------------|
| `wordpress/wp-astro-bridge/wp-astro-bridge.php` | Plugin header, constants, class autoloading, activation hook |
| `wordpress/wp-astro-bridge/includes/class-webhook.php` | Fires webhook on post status transitions, HMAC signature, debounce |
| `wordpress/wp-astro-bridge/includes/class-preview.php` | Filters `preview_post_link`, generates HMAC preview tokens |
| `wordpress/wp-astro-bridge/includes/class-rest.php` | Normalized `astro_seo` REST field, health endpoint, token verification |
| `wordpress/wp-astro-bridge/admin/class-settings.php` | Settings page: Astro URL, webhook URL, webhook secret, enable/disable |
| `wordpress/wp-astro-bridge/readme.txt` | WordPress.org plugin directory format readme |

---

## Task 1: Plugin Bootstrap + Settings Page

**Files:**
- Create: `wordpress/wp-astro-bridge/wp-astro-bridge.php`
- Create: `wordpress/wp-astro-bridge/admin/class-settings.php`

- [ ] **Step 1: Create plugin main file**

```php
<?php
/**
 * Plugin Name: WP Astro Bridge
 * Plugin URI: https://github.com/vapvarun/wp-astro-mcp
 * Description: Lightweight bridge between WordPress and your Astro frontend. Fires webhooks on content changes, enables draft preview on Astro, and normalizes SEO data via REST API.
 * Version: 1.0.0
 * Author: Varun Dubey
 * Author URI: https://vapvarun.com
 * License: MIT
 * Requires at least: 5.6
 * Requires PHP: 7.4
 * Text Domain: wp-astro-bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'WP_ASTRO_BRIDGE_VERSION', '1.0.0' );
define( 'WP_ASTRO_BRIDGE_PATH', plugin_dir_path( __FILE__ ) );

// Load classes
require_once WP_ASTRO_BRIDGE_PATH . 'admin/class-settings.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-webhook.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-preview.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-rest.php';

/**
 * Initialize plugin
 */
function wp_astro_bridge_init() {
    $options = get_option( 'wp_astro_bridge_settings', array() );
    $enabled = isset( $options['enabled'] ) ? (bool) $options['enabled'] : true;

    if ( ! $enabled ) {
        return;
    }

    new WP_Astro_Bridge_Webhook( $options );
    new WP_Astro_Bridge_Preview( $options );
    new WP_Astro_Bridge_REST( $options );
}
add_action( 'init', 'wp_astro_bridge_init' );

// Always load settings (even when disabled)
new WP_Astro_Bridge_Settings();

/**
 * Activation hook — generate webhook secret
 */
function wp_astro_bridge_activate() {
    $options = get_option( 'wp_astro_bridge_settings', array() );
    if ( empty( $options['webhook_secret'] ) ) {
        $options['webhook_secret'] = wp_generate_password( 32, false );
        update_option( 'wp_astro_bridge_settings', $options );
    }
}
register_activation_hook( __FILE__, 'wp_astro_bridge_activate' );
```

- [ ] **Step 2: Create settings page**

```php
<?php
/**
 * Settings page for WP Astro Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Astro_Bridge_Settings {

    private $option_name = 'wp_astro_bridge_settings';

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'add_menu' ) );
        add_action( 'admin_init', array( $this, 'register_settings' ) );
    }

    public function add_menu() {
        add_options_page(
            'WP Astro Bridge',
            'Astro Bridge',
            'manage_options',
            'wp-astro-bridge',
            array( $this, 'render_page' )
        );
    }

    public function register_settings() {
        register_setting( 'wp_astro_bridge', $this->option_name, array(
            'sanitize_callback' => array( $this, 'sanitize' ),
        ) );

        add_settings_section(
            'wp_astro_bridge_main',
            'Connection Settings',
            null,
            'wp-astro-bridge'
        );

        add_settings_field( 'enabled', 'Enable Bridge', array( $this, 'field_enabled' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
        add_settings_field( 'astro_url', 'Astro Frontend URL', array( $this, 'field_astro_url' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
        add_settings_field( 'webhook_url', 'Webhook URL', array( $this, 'field_webhook_url' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
        add_settings_field( 'webhook_secret', 'Webhook Secret', array( $this, 'field_webhook_secret' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
    }

    public function sanitize( $input ) {
        $output = array();
        $output['enabled']        = ! empty( $input['enabled'] );
        $output['astro_url']      = esc_url_raw( rtrim( $input['astro_url'] ?? '', '/' ) );
        $output['webhook_url']    = esc_url_raw( $input['webhook_url'] ?? '' );
        $output['webhook_secret'] = sanitize_text_field( $input['webhook_secret'] ?? '' );
        return $output;
    }

    public function field_enabled() {
        $options = get_option( $this->option_name, array() );
        $checked = isset( $options['enabled'] ) ? (bool) $options['enabled'] : true;
        echo '<label><input type="checkbox" name="' . $this->option_name . '[enabled]" value="1" ' . checked( $checked, true, false ) . ' /> Enable webhooks and preview rewriting</label>';
    }

    public function field_astro_url() {
        $options = get_option( $this->option_name, array() );
        $value   = $options['astro_url'] ?? '';
        echo '<input type="url" name="' . $this->option_name . '[astro_url]" value="' . esc_attr( $value ) . '" class="regular-text" placeholder="https://example.com" />';
        echo '<p class="description">The public URL of your Astro frontend.</p>';
    }

    public function field_webhook_url() {
        $options = get_option( $this->option_name, array() );
        $value   = $options['webhook_url'] ?? '';
        echo '<input type="url" name="' . $this->option_name . '[webhook_url]" value="' . esc_attr( $value ) . '" class="regular-text" placeholder="https://example.com/api/hook" />';
        echo '<p class="description">URL to POST when content changes (e.g., Vercel/Netlify deploy hook or Astro webhook endpoint).</p>';
    }

    public function field_webhook_secret() {
        $options = get_option( $this->option_name, array() );
        $value   = $options['webhook_secret'] ?? '';
        echo '<input type="text" name="' . $this->option_name . '[webhook_secret]" value="' . esc_attr( $value ) . '" class="regular-text" readonly />';
        echo '<p class="description">Auto-generated. Used to sign webhook payloads (HMAC-SHA256). Share with your MCP server config.</p>';
    }

    public function render_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>WP Astro Bridge</h1>
            <p>Connect your WordPress site to an Astro frontend. <a href="https://github.com/vapvarun/wp-astro-mcp" target="_blank">Documentation</a></p>
            <form method="post" action="options.php">
                <?php
                settings_fields( 'wp_astro_bridge' );
                do_settings_sections( 'wp-astro-bridge' );
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }
}
```

- [ ] **Step 3: Verify PHP syntax**

Run: `php -l wordpress/wp-astro-bridge/wp-astro-bridge.php`
Run: `php -l wordpress/wp-astro-bridge/admin/class-settings.php`
Expected: No syntax errors.

- [ ] **Step 4: Commit**

```bash
git add wordpress/wp-astro-bridge/wp-astro-bridge.php wordpress/wp-astro-bridge/admin/class-settings.php
git commit -m "Add wp-astro-bridge plugin bootstrap and settings page"
```

---

## Task 2: Webhook Dispatcher

**Files:**
- Create: `wordpress/wp-astro-bridge/includes/class-webhook.php`

- [ ] **Step 1: Create webhook class**

```php
<?php
/**
 * Webhook dispatcher — fires POST on content changes
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Astro_Bridge_Webhook {

    private $options;

    public function __construct( $options ) {
        $this->options = $options;

        if ( empty( $this->options['webhook_url'] ) ) {
            return;
        }

        add_action( 'transition_post_status', array( $this, 'on_status_change' ), 10, 3 );
    }

    /**
     * Fire webhook when post status changes
     */
    public function on_status_change( $new_status, $old_status, $post ) {
        // Only public post types
        $post_type_obj = get_post_type_object( $post->post_type );
        if ( ! $post_type_obj || ! $post_type_obj->public ) {
            return;
        }

        // Only meaningful transitions
        $publish_statuses = array( 'publish', 'trash' );
        if ( ! in_array( $new_status, $publish_statuses, true ) && ! in_array( $old_status, $publish_statuses, true ) ) {
            return;
        }

        // Debounce — prevent duplicate fires from autosave
        $transient_key = 'astro_bridge_webhook_' . $post->ID;
        if ( get_transient( $transient_key ) ) {
            return;
        }
        set_transient( $transient_key, 1, 2 );

        // Determine action
        $action = 'post_updated';
        if ( $new_status === 'publish' && $old_status !== 'publish' ) {
            $action = 'post_published';
        } elseif ( $new_status === 'trash' ) {
            $action = 'post_trashed';
        } elseif ( $old_status === 'publish' && $new_status !== 'publish' && $new_status !== 'trash' ) {
            $action = 'post_unpublished';
        }

        $this->fire( $action, $post );
    }

    /**
     * Send webhook payload
     */
    private function fire( $action, $post ) {
        $payload = array(
            'action'       => $action,
            'post_id'      => $post->ID,
            'post_type'    => $post->post_type,
            'slug'         => $post->post_name,
            'status'       => $post->post_status,
            'modified_gmt' => get_post_modified_time( 'c', true, $post ),
            'bridge_version' => WP_ASTRO_BRIDGE_VERSION,
        );

        $body      = wp_json_encode( $payload );
        $secret    = $this->options['webhook_secret'] ?? '';
        $signature = hash_hmac( 'sha256', $body, $secret );

        wp_remote_post( $this->options['webhook_url'], array(
            'timeout'  => 5,
            'blocking' => false,
            'headers'  => array(
                'Content-Type'      => 'application/json',
                'X-Astro-Signature' => $signature,
                'X-Astro-Event'     => $action,
            ),
            'body'     => $body,
        ) );

        // Store last webhook time for health endpoint
        update_option( 'wp_astro_bridge_last_webhook', array(
            'time'   => current_time( 'c' ),
            'action' => $action,
            'post_id' => $post->ID,
        ), false );
    }
}
```

- [ ] **Step 2: Verify PHP syntax**

Run: `php -l wordpress/wp-astro-bridge/includes/class-webhook.php`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add wordpress/wp-astro-bridge/includes/class-webhook.php
git commit -m "Add webhook dispatcher to wp-astro-bridge"
```

---

## Task 3: Preview URL Rewriter

**Files:**
- Create: `wordpress/wp-astro-bridge/includes/class-preview.php`

- [ ] **Step 1: Create preview class**

```php
<?php
/**
 * Preview URL rewriter — redirects WordPress preview to Astro frontend
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Astro_Bridge_Preview {

    private $options;

    public function __construct( $options ) {
        $this->options = $options;

        if ( empty( $this->options['astro_url'] ) ) {
            return;
        }

        add_filter( 'preview_post_link', array( $this, 'rewrite_preview_link' ), 10, 2 );
    }

    /**
     * Rewrite the WordPress preview URL to point to Astro frontend
     */
    public function rewrite_preview_link( $preview_link, $post ) {
        $post_type_obj = get_post_type_object( $post->post_type );
        if ( ! $post_type_obj || ! $post_type_obj->public ) {
            return $preview_link;
        }

        $token = $this->generate_token( $post->ID );
        $astro_url = rtrim( $this->options['astro_url'], '/' );

        return add_query_arg(
            array(
                'token' => $token,
                'id'    => $post->ID,
            ),
            $astro_url . '/preview'
        );
    }

    /**
     * Generate a short-lived HMAC token for preview authentication
     *
     * Token payload: post_id|user_id|expiry
     * Signed with wp_salt('auth')
     * Expires in 5 minutes
     */
    public function generate_token( $post_id ) {
        $user_id = get_current_user_id();
        $expiry  = time() + ( 5 * MINUTE_IN_SECONDS );
        $payload = $post_id . '|' . $user_id . '|' . $expiry;
        $signature = hash_hmac( 'sha256', $payload, wp_salt( 'auth' ) );

        return base64_encode( $payload . '|' . $signature );
    }

    /**
     * Verify a preview token (used by REST endpoint)
     *
     * @param string $token Base64-encoded token
     * @param int $post_id Expected post ID
     * @return bool|WP_Error True if valid, WP_Error if not
     */
    public static function verify_token( $token, $post_id ) {
        $decoded = base64_decode( $token, true );
        if ( ! $decoded ) {
            return new \WP_Error( 'invalid_token', 'Token is malformed.', array( 'status' => 403 ) );
        }

        $parts = explode( '|', $decoded );
        if ( count( $parts ) !== 4 ) {
            return new \WP_Error( 'invalid_token', 'Token format is invalid.', array( 'status' => 403 ) );
        }

        list( $token_post_id, $token_user_id, $expiry, $signature ) = $parts;

        // Check expiry
        if ( (int) $expiry < time() ) {
            return new \WP_Error( 'token_expired', 'Preview token has expired. Click Preview again in WordPress.', array( 'status' => 403 ) );
        }

        // Check post ID matches
        if ( (int) $token_post_id !== (int) $post_id ) {
            return new \WP_Error( 'post_mismatch', 'Token does not match requested post.', array( 'status' => 403 ) );
        }

        // Verify HMAC
        $payload = $token_post_id . '|' . $token_user_id . '|' . $expiry;
        $expected_signature = hash_hmac( 'sha256', $payload, wp_salt( 'auth' ) );

        if ( ! hash_equals( $expected_signature, $signature ) ) {
            return new \WP_Error( 'invalid_signature', 'Token signature is invalid.', array( 'status' => 403 ) );
        }

        return true;
    }
}
```

- [ ] **Step 2: Verify PHP syntax**

Run: `php -l wordpress/wp-astro-bridge/includes/class-preview.php`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add wordpress/wp-astro-bridge/includes/class-preview.php
git commit -m "Add preview URL rewriter to wp-astro-bridge"
```

---

## Task 4: REST API Extensions

**Files:**
- Create: `wordpress/wp-astro-bridge/includes/class-rest.php`

- [ ] **Step 1: Create REST class**

```php
<?php
/**
 * REST API extensions — normalized SEO field, health endpoint, token verification
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Astro_Bridge_REST {

    private $options;

    public function __construct( $options ) {
        $this->options = $options;

        add_action( 'rest_api_init', array( $this, 'register_routes' ) );
        add_action( 'rest_api_init', array( $this, 'register_seo_field' ) );
    }

    /**
     * Register custom REST routes
     */
    public function register_routes() {
        // Health endpoint
        register_rest_route( 'astro-bridge/v1', '/health', array(
            'methods'             => 'GET',
            'callback'            => array( $this, 'health_check' ),
            'permission_callback' => '__return_true',
        ) );

        // Token verification endpoint
        register_rest_route( 'astro-bridge/v1', '/verify-token', array(
            'methods'             => 'GET',
            'callback'            => array( $this, 'verify_token' ),
            'permission_callback' => '__return_true',
            'args'                => array(
                'token'   => array(
                    'required' => true,
                    'type'     => 'string',
                ),
                'post_id' => array(
                    'required' => true,
                    'type'     => 'integer',
                ),
            ),
        ) );
    }

    /**
     * Health check endpoint
     */
    public function health_check() {
        $last_webhook = get_option( 'wp_astro_bridge_last_webhook', null );

        return rest_ensure_response( array(
            'status'          => 'ok',
            'plugin_version'  => WP_ASTRO_BRIDGE_VERSION,
            'wp_version'      => get_bloginfo( 'version' ),
            'php_version'     => phpversion(),
            'astro_url'       => $this->options['astro_url'] ?? '',
            'webhook_url'     => $this->options['webhook_url'] ? '***configured***' : '',
            'webhook_enabled' => ! empty( $this->options['webhook_url'] ),
            'preview_enabled' => ! empty( $this->options['astro_url'] ),
            'last_webhook'    => $last_webhook,
            'timestamp'       => current_time( 'c' ),
        ) );
    }

    /**
     * Verify preview token and return draft post data
     */
    public function verify_token( $request ) {
        $token   = $request->get_param( 'token' );
        $post_id = (int) $request->get_param( 'post_id' );

        $result = WP_Astro_Bridge_Preview::verify_token( $token, $post_id );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        // Token valid — fetch post data (including drafts)
        $post = get_post( $post_id );
        if ( ! $post ) {
            return new WP_Error( 'not_found', 'Post not found.', array( 'status' => 404 ) );
        }

        // Build response similar to REST API post response
        $author = get_userdata( $post->post_author );
        $thumbnail_id = get_post_thumbnail_id( $post_id );
        $featured = null;
        if ( $thumbnail_id ) {
            $img = wp_get_attachment_image_src( $thumbnail_id, 'full' );
            $featured = array(
                'url'    => $img[0] ?? '',
                'width'  => $img[1] ?? null,
                'height' => $img[2] ?? null,
                'alt'    => get_post_meta( $thumbnail_id, '_wp_attachment_image_alt', true ),
            );
        }

        $categories = wp_get_post_terms( $post_id, 'category', array( 'fields' => 'all' ) );
        $tags = wp_get_post_terms( $post_id, 'post_tag', array( 'fields' => 'all' ) );

        return rest_ensure_response( array(
            'id'             => $post->ID,
            'title'          => $post->post_title,
            'slug'           => $post->post_name,
            'status'         => $post->post_status,
            'date'           => get_the_date( 'c', $post ),
            'modified'       => get_the_modified_date( 'c', $post ),
            'content'        => apply_filters( 'the_content', $post->post_content ),
            'excerpt'        => $post->post_excerpt ?: wp_trim_words( $post->post_content, 55 ),
            'author'         => $author ? array(
                'name' => $author->display_name,
                'slug' => $author->user_nicename,
            ) : null,
            'featured_image' => $featured,
            'categories'     => array_map( function( $term ) {
                return array( 'name' => $term->name, 'slug' => $term->slug );
            }, is_array( $categories ) ? $categories : array() ),
            'tags'           => array_map( function( $term ) {
                return array( 'name' => $term->name, 'slug' => $term->slug );
            }, is_array( $tags ) ? $tags : array() ),
            'seo'            => $this->get_normalized_seo( $post_id ),
            'is_preview'     => true,
        ) );
    }

    /**
     * Register astro_seo REST field on all public post types
     */
    public function register_seo_field() {
        $post_types = get_post_types( array( 'public' => true ), 'names' );

        foreach ( $post_types as $post_type ) {
            register_rest_field( $post_type, 'astro_seo', array(
                'get_callback' => array( $this, 'get_seo_field' ),
                'schema'       => array(
                    'type'        => 'object',
                    'description' => 'Normalized SEO data (works with Yoast, RankMath, AIOSEO)',
                    'properties'  => array(
                        'title'         => array( 'type' => 'string' ),
                        'description'   => array( 'type' => 'string' ),
                        'canonical'     => array( 'type' => 'string' ),
                        'og_image'      => array( 'type' => 'string' ),
                        'robots'        => array( 'type' => 'string' ),
                        'focus_keyword' => array( 'type' => 'string' ),
                    ),
                ),
            ) );
        }
    }

    /**
     * REST field callback for astro_seo
     */
    public function get_seo_field( $post_arr ) {
        return $this->get_normalized_seo( $post_arr['id'] );
    }

    /**
     * Get normalized SEO data regardless of which SEO plugin is active
     */
    private function get_normalized_seo( $post_id ) {
        $seo = array(
            'title'         => '',
            'description'   => '',
            'canonical'     => '',
            'og_image'      => '',
            'robots'        => 'index,follow',
            'focus_keyword' => '',
        );

        // Yoast SEO
        if ( function_exists( 'YoastSEO' ) || defined( 'WPSEO_VERSION' ) ) {
            $seo['title']         = get_post_meta( $post_id, '_yoast_wpseo_title', true );
            $seo['description']   = get_post_meta( $post_id, '_yoast_wpseo_metadesc', true );
            $seo['canonical']     = get_post_meta( $post_id, '_yoast_wpseo_canonical', true );
            $seo['focus_keyword'] = get_post_meta( $post_id, '_yoast_wpseo_focuskw', true );

            $robots_noindex = get_post_meta( $post_id, '_yoast_wpseo_meta-robots-noindex', true );
            if ( $robots_noindex === '1' ) {
                $seo['robots'] = 'noindex,follow';
            }

            // OG image from Yoast
            $og_image_id = get_post_meta( $post_id, '_yoast_wpseo_opengraph-image-id', true );
            if ( $og_image_id ) {
                $img = wp_get_attachment_url( $og_image_id );
                if ( $img ) {
                    $seo['og_image'] = $img;
                }
            }
        }

        // Rank Math
        if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
            $rm_title = get_post_meta( $post_id, 'rank_math_title', true );
            $rm_desc  = get_post_meta( $post_id, 'rank_math_description', true );
            if ( $rm_title ) $seo['title'] = $rm_title;
            if ( $rm_desc ) $seo['description'] = $rm_desc;
            $seo['canonical']     = get_post_meta( $post_id, 'rank_math_canonical_url', true ) ?: $seo['canonical'];
            $seo['focus_keyword'] = get_post_meta( $post_id, 'rank_math_focus_keyword', true ) ?: $seo['focus_keyword'];

            $rm_robots = get_post_meta( $post_id, 'rank_math_robots', true );
            if ( is_array( $rm_robots ) && in_array( 'noindex', $rm_robots, true ) ) {
                $seo['robots'] = 'noindex,follow';
            }

            $rm_og = get_post_meta( $post_id, 'rank_math_facebook_image', true );
            if ( $rm_og ) $seo['og_image'] = $rm_og;
        }

        // AIOSEO
        if ( function_exists( 'aioseo' ) || defined( 'AIOSEO_VERSION' ) ) {
            global $wpdb;
            $table = $wpdb->prefix . 'aioseo_posts';
            if ( $wpdb->get_var( "SHOW TABLES LIKE '{$table}'" ) === $table ) {
                $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE post_id = %d", $post_id ) );
                if ( $row ) {
                    if ( ! empty( $row->title ) ) $seo['title'] = $row->title;
                    if ( ! empty( $row->description ) ) $seo['description'] = $row->description;
                    if ( ! empty( $row->canonical_url ) ) $seo['canonical'] = $row->canonical_url;
                    if ( ! empty( $row->keyphrases ) ) {
                        $kp = json_decode( $row->keyphrases, true );
                        if ( isset( $kp['focus']['keyphrase'] ) ) {
                            $seo['focus_keyword'] = $kp['focus']['keyphrase'];
                        }
                    }
                    if ( isset( $row->robots_noindex ) && $row->robots_noindex ) {
                        $seo['robots'] = 'noindex,follow';
                    }
                    if ( ! empty( $row->og_image_custom_url ) ) {
                        $seo['og_image'] = $row->og_image_custom_url;
                    }
                }
            }
        }

        // Fallbacks
        if ( empty( $seo['title'] ) ) {
            $seo['title'] = get_the_title( $post_id );
        }
        if ( empty( $seo['canonical'] ) ) {
            $seo['canonical'] = get_permalink( $post_id );
        }
        if ( empty( $seo['og_image'] ) ) {
            $thumb_id = get_post_thumbnail_id( $post_id );
            if ( $thumb_id ) {
                $seo['og_image'] = wp_get_attachment_url( $thumb_id );
            }
        }

        return $seo;
    }
}
```

- [ ] **Step 2: Verify PHP syntax**

Run: `php -l wordpress/wp-astro-bridge/includes/class-rest.php`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add wordpress/wp-astro-bridge/includes/class-rest.php
git commit -m "Add REST API extensions to wp-astro-bridge (SEO field, health, token verify)"
```

---

## Task 5: WordPress.org Readme

**Files:**
- Create: `wordpress/wp-astro-bridge/readme.txt`

- [ ] **Step 1: Create readme.txt**

Standard WordPress.org plugin directory format.

- [ ] **Step 2: Commit**

```bash
git add wordpress/wp-astro-bridge/readme.txt
git commit -m "Add WordPress.org readme for wp-astro-bridge"
```

---

## Task 6: Final Build + Push

- [ ] **Step 1: Verify all PHP files have no syntax errors**

```bash
find wordpress/wp-astro-bridge -name '*.php' -exec php -l {} \;
```

- [ ] **Step 2: Verify MCP server still builds**

```bash
cd /path/to/wp-astro-mcp && npm run build
```

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "Phase 9: wp-astro-bridge WordPress plugin v1.0.0"
git push origin main
```
