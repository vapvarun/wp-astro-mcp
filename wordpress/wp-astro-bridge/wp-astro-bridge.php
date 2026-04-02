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

// Load classes.
require_once WP_ASTRO_BRIDGE_PATH . 'admin/class-settings.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-webhook.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-preview.php';
require_once WP_ASTRO_BRIDGE_PATH . 'includes/class-rest.php';

/**
 * Initialize plugin.
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

// Always load settings (even when disabled).
new WP_Astro_Bridge_Settings();

/**
 * Activation hook — generate webhook secret if not set.
 */
function wp_astro_bridge_activate() {
	$options = get_option( 'wp_astro_bridge_settings', array() );
	if ( empty( $options['webhook_secret'] ) ) {
		$options['webhook_secret'] = wp_generate_password( 32, false );
		update_option( 'wp_astro_bridge_settings', $options );
	}
}
register_activation_hook( __FILE__, 'wp_astro_bridge_activate' );
